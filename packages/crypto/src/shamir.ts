import { ByteReader, concatBytes, uint16 } from "./encoding.ts";
import { constantTimeEqual, hmacSha256 } from "./hash.ts";
import { InvalidInputError } from "./errors.ts";
import { randomBytes } from "./random.ts";
import { SecretBuffer } from "./secret.ts";

/**
 * Compartición de secretos de Shamir sobre GF(2^8).
 *
 * Propiedad clave: con menos de `threshold` fragmentos no se obtiene *ninguna*
 * información sobre el secreto. No es que sea difícil de romper —es que
 * cualquier secreto del mismo tamaño es igual de compatible con lo que se
 * tiene—. Seguridad de la información, no computacional: no la rompe ni un
 * ordenador cuántico.
 *
 * En Cerbero es la base de la recuperación social: reparte tu clave de
 * recuperación entre personas de confianza de forma que hagan falta k de n para
 * reconstruirla. Ninguna empresa custodia tu clave y ningún guardián suelto
 * puede abrir tu bóveda.
 */

// Tablas de logaritmo y exponencial en GF(2^8) con el polinomio 0x11b (el de AES).
const { EXP, LOG } = /* @__PURE__ */ (() => {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    // Multiplicación por el generador 0x03, con reducción módulo 0x11b.
    let next = x ^ ((x << 1) & 0xff);
    if (x & 0x80) next ^= 0x1b;
    x = next;
  }
  // Duplicamos la tabla para poder sumar índices sin hacer módulo.
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255] as number;
  return { EXP: exp, LOG: log };
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new InvalidInputError("división por cero en GF(2^8)");
  if (a === 0) return 0;
  return EXP[(LOG[a] as number) + 255 - (LOG[b] as number)] as number;
}

export const SHARE_SET_ID_LENGTH = 8;
const SHARE_CHECKSUM_LENGTH = 8;
const SHARE_FORMAT_VERSION = 1;

export interface ShamirShare {
  /** Coordenada x del fragmento, en 1..255. Nunca 0: ahí vive el secreto. */
  readonly index: number;
  /** Fragmentos necesarios para reconstruir. */
  readonly threshold: number;
  /** Identifica el conjunto: impide mezclar fragmentos de secretos distintos. */
  readonly setId: Uint8Array;
  readonly data: Uint8Array;
  readonly checksum: Uint8Array;
}

/**
 * La suma de comprobación es HMAC(setId, secreto) truncado, y permite detectar
 * una combinación errónea en vez de devolver basura silenciosamente.
 *
 * Compromiso asumido: quien tenga un fragmento tiene un valor verificable
 * contra el secreto, así que podría probar candidatos a fuerza bruta. Es
 * irrelevante para secretos de alta entropía (claves de 32 bytes aleatorias,
 * que es el único uso previsto) y sería inaceptable para secretos adivinables
 * como una contraseña humana. Para ese caso, `checksum: false`.
 */
function computeChecksum(setId: Uint8Array, secret: Uint8Array): Uint8Array {
  return hmacSha256(setId, secret).subarray(0, SHARE_CHECKSUM_LENGTH);
}

export function splitSecret(
  secret: SecretBuffer | Uint8Array,
  options: { readonly threshold: number; readonly shares: number; readonly checksum?: boolean },
): ShamirShare[] {
  const { threshold, shares } = options;
  const secretBytes = secret instanceof Uint8Array ? secret : secret.bytes;

  if (!Number.isSafeInteger(threshold) || threshold < 2) {
    throw new InvalidInputError("el umbral debe ser al menos 2");
  }
  if (!Number.isSafeInteger(shares) || shares < threshold) {
    throw new InvalidInputError("el número de fragmentos no puede ser menor que el umbral");
  }
  if (shares > 255) {
    throw new InvalidInputError("GF(2^8) admite como máximo 255 fragmentos");
  }
  if (secretBytes.length === 0) {
    throw new InvalidInputError("el secreto no puede estar vacío");
  }

  const setId = randomBytes(SHARE_SET_ID_LENGTH);
  const useChecksum = options.checksum ?? true;
  const checksum = useChecksum ? computeChecksum(setId, secretBytes) : new Uint8Array(0);

  const result: ShamirShare[] = [];
  for (let i = 1; i <= shares; i++) {
    result.push({
      index: i,
      threshold,
      setId,
      data: new Uint8Array(secretBytes.length),
      checksum,
    });
  }

  // Un polinomio independiente por byte: f(0) = byte del secreto, coeficientes
  // superiores aleatorios. Evaluamos en x = 1..shares.
  const coefficients = new Uint8Array(threshold - 1);
  for (let byteIndex = 0; byteIndex < secretBytes.length; byteIndex++) {
    coefficients.set(randomBytes(threshold - 1));
    const constantTerm = secretBytes[byteIndex] as number;

    for (const share of result) {
      // Horner: f(x) = ((a_{k-1}·x + a_{k-2})·x + …)·x + a_0
      let accumulator = 0;
      for (let c = coefficients.length - 1; c >= 0; c--) {
        accumulator = gfMul(accumulator, share.index) ^ (coefficients[c] as number);
      }
      share.data[byteIndex] = gfMul(accumulator, share.index) ^ constantTerm;
    }
  }
  coefficients.fill(0);
  return result;
}

/** Reconstruye el secreto por interpolación de Lagrange evaluada en x = 0. */
export function combineShares(shares: readonly ShamirShare[]): SecretBuffer {
  if (shares.length === 0) {
    throw new InvalidInputError("no se aportó ningún fragmento");
  }
  const first = shares[0] as ShamirShare;
  if (shares.length < first.threshold) {
    throw new InvalidInputError(
      `hacen falta ${first.threshold} fragmentos y solo se aportaron ${shares.length}`,
    );
  }

  const seen = new Set<number>();
  for (const share of shares) {
    if (share.data.length !== first.data.length) {
      throw new InvalidInputError("los fragmentos tienen longitudes distintas");
    }
    if (!constantTimeEqual(share.setId, first.setId)) {
      throw new InvalidInputError("los fragmentos pertenecen a secretos distintos");
    }
    if (share.index < 1 || share.index > 255) {
      throw new InvalidInputError("índice de fragmento fuera de rango");
    }
    if (seen.has(share.index)) {
      throw new InvalidInputError("fragmento duplicado: los índices deben ser distintos");
    }
    seen.add(share.index);
  }

  // Con más fragmentos de los necesarios, usamos exactamente `threshold`:
  // añadir más no aporta información y multiplica el trabajo.
  const used = shares.slice(0, first.threshold);
  const secret = new Uint8Array(first.data.length);

  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    let accumulator = 0;
    for (let i = 0; i < used.length; i++) {
      const share = used[i] as ShamirShare;
      // Base de Lagrange evaluada en 0: producto de x_j / (x_j - x_i).
      let basis = 1;
      for (let j = 0; j < used.length; j++) {
        if (i === j) continue;
        const other = used[j] as ShamirShare;
        // En GF(2^8) la resta es XOR.
        basis = gfMul(basis, gfDiv(other.index, share.index ^ other.index));
      }
      accumulator ^= gfMul(share.data[byteIndex] as number, basis);
    }
    secret[byteIndex] = accumulator;
  }

  if (first.checksum.length > 0) {
    const expected = computeChecksum(first.setId, secret);
    if (!constantTimeEqual(expected, first.checksum)) {
      secret.fill(0);
      throw new InvalidInputError(
        "el secreto reconstruido no supera la verificación: fragmentos incorrectos o alterados",
      );
    }
  }
  return SecretBuffer.wrap(secret);
}

/** Serializa un fragmento para entregarlo a un guardián. */
export function encodeShare(share: ShamirShare): Uint8Array {
  return concatBytes(
    new Uint8Array([SHARE_FORMAT_VERSION, share.index, share.threshold]),
    share.setId,
    new Uint8Array([share.checksum.length]),
    share.checksum,
    uint16(share.data.length),
    share.data,
  );
}

export function decodeShare(encoded: Uint8Array): ShamirShare {
  const reader = new ByteReader(encoded);
  const version = reader.takeUint8();
  if (version !== SHARE_FORMAT_VERSION) {
    throw new InvalidInputError(`versión de fragmento no soportada: ${version}`);
  }
  const index = reader.takeUint8();
  const threshold = reader.takeUint8();
  const setId = Uint8Array.from(reader.take(SHARE_SET_ID_LENGTH));
  const checksum = Uint8Array.from(reader.take(reader.takeUint8()));
  const data = Uint8Array.from(reader.take(reader.takeUint16()));
  reader.expectEnd();
  if (index < 1 || threshold < 2) {
    throw new InvalidInputError("cabecera de fragmento no válida");
  }
  return { index, threshold, setId, data, checksum };
}
