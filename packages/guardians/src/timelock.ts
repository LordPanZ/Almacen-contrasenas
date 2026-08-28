import {
  ByteReader,
  concatBytes,
  deriveKey,
  open as aeadOpen,
  seal as aeadSeal,
  SecretBuffer,
  uint32,
} from "@cerbero/crypto";
import { TimeLockError } from "./errors.ts";
import {
  RECORD_TYPES,
  readBlock,
  readHeader,
  writeBlock,
  writeHeader,
} from "./format.ts";
import {
  bigIntToBytes,
  bytesToBigInt,
  generateProbablePrime,
  modPow,
  randomBigInt,
  repeatedSquaring,
} from "./numbers.ts";

/**
 * Bits del módulo RSA por defecto.
 *
 * 2048 es el mínimo razonable: la seguridad del puzzle se apoya en que nadie
 * factorice `N`, porque quien conozca `p` y `q` lo abre al instante. Con menos
 * bits, la "cerradura temporal" la abre un factorizador en vez del tiempo.
 */
export const MODULUS_BITS_POR_DEFECTO = 2048;

export interface TimeLockPuzzle {
  /** Módulo `N = p·q`. Público: es lo que permite resolverlo por la vía lenta. */
  readonly modulus: bigint;
  /** Base de la cadena de elevaciones. */
  readonly base: bigint;
  /** Elevaciones al cuadrado necesarias. Fija el coste en tiempo. */
  readonly squarings: number;
  /** El secreto, cifrado con la clave que sale de resolver el puzzle. */
  readonly sealed: Uint8Array;
  readonly creadoEn: number;
  /** Momento estimado de apertura, solo informativo. */
  readonly disponibleDesde: number;
}

export interface CreateTimeLockOptions {
  readonly squarings: number;
  readonly modulusBits?: number;
  /** Elevaciones por segundo que se asumen para estimar la fecha de apertura. */
  readonly velocidadEstimada?: number;
}

/**
 * Deriva la clave del secreto a partir del resultado del puzzle.
 *
 * Se ata al módulo y al número de elevaciones para que dos puzzles distintos
 * que casualmente terminaran en el mismo `y` no produjeran la misma clave.
 */
function claveDelPuzzle(y: bigint, modulus: bigint, squarings: number): SecretBuffer {
  return deriveKey(bigIntToBytes(y), "time-lock-key", {
    context: concatBytes(bigIntToBytes(modulus), uint32(squarings)),
  });
}

/**
 * Crea un puzzle de trabajo secuencial (construcción RSW).
 *
 * El secreto se cifra con una clave derivada de `base^(2^T) mod N`. Quien crea
 * el puzzle conoce `p` y `q`, así que calcula `e = 2^T mod φ(N)` y llega al
 * resultado en una sola exponenciación. Quien no los conoce **tiene que hacer
 * las T elevaciones al cuadrado en cadena**: cada una necesita el resultado de
 * la anterior, así que el trabajo no se reparte. Mil máquinas tardan lo mismo
 * que una.
 *
 * Esa es la diferencia con un "no abrir antes de tal fecha" guardado en un
 * servidor: aquí no hay reloj que adelantar ni administrador al que convencer.
 * La barrera es física, no administrativa.
 *
 * La trampilla que se devuelve permite al creador abrirlo al instante. Hay que
 * guardarla o destruirla conscientemente: quien la tenga se salta la espera.
 */
export function createTimeLock(
  secret: SecretBuffer | Uint8Array,
  options: CreateTimeLockOptions,
): { puzzle: TimeLockPuzzle; trapdoor: SecretBuffer } {
  const { squarings } = options;
  if (!Number.isSafeInteger(squarings) || squarings < 1) {
    throw new TimeLockError("el número de elevaciones debe ser un entero positivo");
  }
  const modulusBits = options.modulusBits ?? MODULUS_BITS_POR_DEFECTO;
  if (modulusBits < 256) {
    throw new TimeLockError("el módulo es demasiado pequeño para ofrecer garantía alguna");
  }

  const p = generateProbablePrime(modulusBits >> 1);
  let q = generateProbablePrime(modulusBits >> 1);
  // Dos primos iguales darían N = p², factorizable de un vistazo.
  while (q === p) q = generateProbablePrime(modulusBits >> 1);

  const modulus = p * q;
  const phi = (p - 1n) * (q - 1n);
  const base = randomBigInt(modulus - 2n) + 2n;

  // Atajo del creador: 2^T mod φ(N) reduce T elevaciones a una exponenciación.
  const exponente = modPow(2n, BigInt(squarings), phi);
  const y = modPow(base, exponente, modulus);

  const clave = claveDelPuzzle(y, modulus, squarings);
  const secretBytes = secret instanceof Uint8Array ? secret : secret.bytes;
  const velocidad = options.velocidadEstimada ?? estimateSquaringsPerSecond();
  const creadoEn = Date.now();

  try {
    const puzzle: TimeLockPuzzle = {
      modulus,
      base,
      squarings,
      sealed: aeadSeal(clave, secretBytes, cabeceraAad(modulus, squarings)),
      creadoEn,
      disponibleDesde: creadoEn + Math.round((squarings / velocidad) * 1000),
    };
    // La trampilla es φ(N): con ella se repite el atajo, sin ella no.
    return { puzzle, trapdoor: SecretBuffer.wrap(bigIntToBytes(phi)) };
  } finally {
    clave.destroy();
  }
}

/** Ata el criptograma a los parámetros del puzzle que lo protegen. */
function cabeceraAad(modulus: bigint, squarings: number): Uint8Array {
  return concatBytes(bigIntToBytes(modulus), uint32(squarings));
}

/**
 * Resuelve el puzzle por la vía lenta y descifra el secreto.
 *
 * Bloquea el hilo durante todas las elevaciones: es trabajo, no espera, y
 * cualquier implementación real debería llevarlo a un hilo aparte. `onProgress`
 * permite enseñar cuánto falta.
 */
export function solveTimeLock(
  puzzle: TimeLockPuzzle,
  options: { readonly onProgress?: (hechas: number, total: number) => void } = {},
): SecretBuffer {
  const y = repeatedSquaring(puzzle.base, puzzle.modulus, puzzle.squarings, options.onProgress);
  return abrirCon(puzzle, y);
}

/**
 * Abre el puzzle con la trampilla, sin hacer el trabajo.
 *
 * Es la vía del creador: quien guardó φ(N) puede recuperar su propio secreto en
 * cualquier momento, sin esperar. Para el destinatario del legado no existe.
 */
export function openTimeLockWithTrapdoor(
  puzzle: TimeLockPuzzle,
  trapdoor: SecretBuffer | Uint8Array,
): SecretBuffer {
  const phi = bytesToBigInt(trapdoor instanceof Uint8Array ? trapdoor : trapdoor.bytes);
  if (phi <= 1n) throw new TimeLockError("la trampilla no es válida");
  const exponente = modPow(2n, BigInt(puzzle.squarings), phi);
  return abrirCon(puzzle, modPow(puzzle.base, exponente, puzzle.modulus));
}

function abrirCon(puzzle: TimeLockPuzzle, y: bigint): SecretBuffer {
  const clave = claveDelPuzzle(y, puzzle.modulus, puzzle.squarings);
  try {
    return SecretBuffer.wrap(
      aeadOpen(clave, puzzle.sealed, cabeceraAad(puzzle.modulus, puzzle.squarings)),
    );
  } catch (cause) {
    throw new TimeLockError(
      "el puzzle no se abre: o el resultado no es el correcto o los datos están alterados",
      { cause },
    );
  } finally {
    clave.destroy();
  }
}

/**
 * Mide cuántas elevaciones por segundo hace esta máquina.
 *
 * Sirve para traducir "quiero que tarde un mes" a un número de elevaciones. Es
 * una estimación floja por naturaleza: el hardware del futuro será más rápido,
 * así que un puzzle calibrado hoy se abrirá antes de lo previsto. Por eso la
 * herencia no se apoya solo en el tiempo, sino también en el umbral de
 * beneficiarios.
 */
export function estimateSquaringsPerSecond(muestraMs = 120): number {
  const modulus = (1n << 2047n) | 1n;
  let value = 3n;
  const inicio = performance.now();
  let hechas = 0;
  while (performance.now() - inicio < muestraMs) {
    for (let i = 0; i < 200; i++) value = (value * value) % modulus;
    hechas += 200;
  }
  const transcurrido = (performance.now() - inicio) / 1000;
  return Math.max(1, Math.round(hechas / transcurrido));
}

/** Traduce una duración deseada a elevaciones, según la velocidad medida. */
export function squaringsForDuration(
  duracionMs: number,
  velocidad = estimateSquaringsPerSecond(),
): number {
  if (!Number.isFinite(duracionMs) || duracionMs <= 0) {
    throw new TimeLockError("la duración debe ser positiva");
  }
  return Math.max(1, Math.round((duracionMs / 1000) * velocidad));
}

export function encodeTimeLock(puzzle: TimeLockPuzzle): Uint8Array {
  return concatBytes(
    writeHeader(RECORD_TYPES.puzzle),
    writeBlock(bigIntToBytes(puzzle.modulus)),
    writeBlock(bigIntToBytes(puzzle.base)),
    uint32(puzzle.squarings),
    writeBlock(puzzle.sealed),
    uint32(Math.floor(puzzle.creadoEn / 1000)),
    uint32(Math.floor(puzzle.disponibleDesde / 1000)),
  );
}

export function decodeTimeLock(bytes: Uint8Array): TimeLockPuzzle {
  const reader = new ByteReader(bytes);
  readHeader(reader, RECORD_TYPES.puzzle);
  const modulus = bytesToBigInt(readBlock(reader));
  const base = bytesToBigInt(readBlock(reader));
  const squarings = reader.takeUint32();
  const sealed = Uint8Array.from(readBlock(reader));
  const creadoEn = reader.takeUint32() * 1000;
  const disponibleDesde = reader.takeUint32() * 1000;
  reader.expectEnd();
  if (modulus <= 1n || squarings < 1) {
    throw new TimeLockError("los parámetros del puzzle no son válidos");
  }
  return { modulus, base, squarings, sealed, creadoEn, disponibleDesde };
}
