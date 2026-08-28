import {
  ByteReader,
  concatBytes,
  deriveKey,
  hybridSign,
  hybridVerify,
  SecretBuffer,
  uint32,
  utf8Encode,
  type HybridSigningKeyPair,
} from "@cerbero/crypto";
import { SwitchError } from "./errors.ts";
import {
  newId,
  RECORD_TYPES,
  readBlock,
  readHeader,
  readMillis,
  readText,
  writeBlock,
  writeHeader,
  writeMillis,
  writeText,
} from "./format.ts";
import {
  createRecoveryPackage,
  recoverSecret,
  type Guardian,
  type RecoveryPackage,
} from "./recovery.ts";
import {
  createTimeLock,
  openTimeLockWithTrapdoor,
  solveTimeLock,
  type TimeLockPuzzle,
} from "./timelock.ts";
import type { ShamirShare } from "@cerbero/crypto";

/** Contexto de firma de las señales de vida. Separado de todo lo demás. */
export const HEARTBEAT_CONTEXT = "dead-man-heartbeat";

export type SwitchEstado = "activo" | "vencido" | "en-gracia" | "liberable" | "revocado";

/** Señal de vida firmada por el titular. */
export interface Heartbeat {
  readonly switchId: string;
  readonly emitidaEn: number;
  readonly signature: Uint8Array;
}

export interface DeadManSwitch {
  readonly id: string;
  readonly creadoEn: number;
  /** Cada cuánto debe dar señal de vida el titular. */
  readonly intervaloSenalMs: number;
  /** Margen adicional tras el vencimiento antes de liberar el legado. */
  readonly periodoGraciaMs: number;
  readonly ultimaSenal: number;
  /** Clave con la que se verifican las señales de vida. */
  readonly signingPublicKey: Uint8Array;
  readonly revocado: boolean;
}

export interface CreateSwitchOptions {
  readonly intervaloSenalMs: number;
  readonly periodoGraciaMs: number;
  readonly ahora?: number;
}

/**
 * Interruptor de hombre muerto.
 *
 * El titular da señales de vida periódicas; si dejan de llegar y pasa el
 * periodo de gracia, el legado queda liberable.
 *
 * Las señales van **firmadas**. Sin firma, cualquiera que pudiera escribir en
 * el almacén compartido —el servidor de sincronización, por ejemplo— podría
 * fabricar señales de vida indefinidamente y mantener el legado bloqueado para
 * siempre, que es exactamente el ataque contra el que existe el interruptor.
 */
export function createDeadManSwitch(
  signingKey: HybridSigningKeyPair,
  options: CreateSwitchOptions,
): DeadManSwitch {
  const { intervaloSenalMs, periodoGraciaMs } = options;
  if (!Number.isFinite(intervaloSenalMs) || intervaloSenalMs <= 0) {
    throw new SwitchError("el intervalo entre señales debe ser positivo");
  }
  if (!Number.isFinite(periodoGraciaMs) || periodoGraciaMs < 0) {
    throw new SwitchError("el periodo de gracia no puede ser negativo");
  }
  const ahora = options.ahora ?? Date.now();
  return {
    id: newId("sw"),
    creadoEn: ahora,
    intervaloSenalMs,
    periodoGraciaMs,
    ultimaSenal: ahora,
    signingPublicKey: Uint8Array.from(signingKey.publicKey),
    revocado: false,
  };
}

function mensajeSenal(switchId: string, emitidaEn: number): Uint8Array {
  return concatBytes(writeText(switchId), writeMillis(emitidaEn));
}

/** Emite una señal de vida firmada. */
export function emitHeartbeat(
  estado: DeadManSwitch,
  signingKey: SecretBuffer | Uint8Array,
  ahora = Date.now(),
): Heartbeat {
  return {
    switchId: estado.id,
    emitidaEn: ahora,
    signature: hybridSign(signingKey, mensajeSenal(estado.id, ahora), HEARTBEAT_CONTEXT),
  };
}

/**
 * Aplica una señal de vida, si es auténtica.
 *
 * Se rechazan las señales del futuro: sin ese límite, una sola señal con fecha
 * lejana congelaría el interruptor para siempre.
 */
export function applyHeartbeat(
  estado: DeadManSwitch,
  heartbeat: Heartbeat,
  ahora = Date.now(),
): DeadManSwitch {
  if (estado.revocado) throw new SwitchError("el interruptor está revocado");
  if (heartbeat.switchId !== estado.id) {
    throw new SwitchError("la señal de vida es de otro interruptor");
  }
  if (heartbeat.emitidaEn > ahora + 60_000) {
    throw new SwitchError("la señal de vida viene fechada en el futuro");
  }
  const valida = hybridVerify(
    estado.signingPublicKey,
    mensajeSenal(heartbeat.switchId, heartbeat.emitidaEn),
    heartbeat.signature,
    HEARTBEAT_CONTEXT,
  );
  if (!valida) throw new SwitchError("la firma de la señal de vida no es válida");
  if (heartbeat.emitidaEn <= estado.ultimaSenal) return estado;
  return { ...estado, ultimaSenal: heartbeat.emitidaEn };
}

export function revokeSwitch(estado: DeadManSwitch): DeadManSwitch {
  return { ...estado, revocado: true };
}

/** Estado del interruptor en un instante dado. */
export function evaluateSwitch(estado: DeadManSwitch, ahora = Date.now()): SwitchEstado {
  if (estado.revocado) return "revocado";
  const vence = estado.ultimaSenal + estado.intervaloSenalMs;
  if (ahora < vence) return "activo";
  const libera = vence + estado.periodoGraciaMs;
  if (ahora < libera) return "en-gracia";
  return "liberable";
}

/** Milisegundos que faltan para que el legado quede liberable. */
export function timeUntilRelease(estado: DeadManSwitch, ahora = Date.now()): number {
  const libera = estado.ultimaSenal + estado.intervaloSenalMs + estado.periodoGraciaMs;
  return Math.max(0, libera - ahora);
}

export interface InheritancePackage {
  readonly id: string;
  readonly creadoEn: number;
  /** Interruptor que gobierna cuándo puede reclamarse. */
  readonly deadManSwitch: DeadManSwitch;
  /** Umbral de beneficiarios: primera condición. */
  readonly recovery: RecoveryPackage;
  /** Cerradura temporal: segunda condición, independiente de la primera. */
  readonly timeLock: TimeLockPuzzle;
}

export interface CreateInheritanceOptions {
  readonly beneficiarios: readonly Guardian[];
  readonly umbral: number;
  readonly signingKey: HybridSigningKeyPair;
  readonly intervaloSenalMs: number;
  readonly periodoGraciaMs: number;
  readonly squarings: number;
  readonly modulusBits?: number;
  readonly ahora?: number;
}

/**
 * Crea un legado digital protegido por **dos condiciones independientes**.
 *
 * El secreto se parte con Shamir entre los beneficiarios (umbral k-de-n) y,
 * además, el material que necesitan va dentro de una cerradura temporal.
 *
 * Por qué las dos y no una:
 *
 * - Solo el umbral: k beneficiarios que se pusieran de acuerdo podrían abrir tu
 *   herencia estando tú vivo. La cerradura temporal les impone una espera que
 *   nadie puede acortar, tiempo más que suficiente para que te enteres y
 *   revoques.
 * - Solo el tiempo: el legado se abriría solo al vencer el plazo, y bastaría
 *   con que alguien se hiciera con el fichero. Además, calibrar un puzzle a
 *   años vista es poco fiable, porque el hardware futuro será más rápido.
 * - Solo un servidor que "libere" al no ver señales de vida: ese servidor puede
 *   mentir, en cualquiera de las dos direcciones.
 *
 * Con ambas, ni los beneficiarios pueden precipitarse ni el mero paso del
 * tiempo basta, y ningún tercero decide nada.
 */
export function createInheritancePackage(
  secret: SecretBuffer | Uint8Array,
  options: CreateInheritanceOptions,
): { paquete: InheritancePackage; trapdoor: SecretBuffer } {
  const ahora = options.ahora ?? Date.now();
  const secretBytes = secret instanceof Uint8Array ? secret : secret.bytes;

  // Clave intermedia: es lo que se reparte y lo que la cerradura protege. El
  // secreto real solo aparece cuando se cumplen las dos condiciones.
  const claveLegado = SecretBuffer.random(32);
  try {
    const { puzzle, trapdoor } = createTimeLock(claveLegado, {
      squarings: options.squarings,
      ...(options.modulusBits === undefined ? {} : { modulusBits: options.modulusBits }),
    });

    // Lo que se reparte entre beneficiarios es el secreto en sí; la cerradura
    // guarda la clave que hace falta para llegar a los fragmentos combinados.
    const combinado = combinar(secretBytes, claveLegado.bytes);
    const recovery = createRecoveryPackage(combinado, options.beneficiarios, options.umbral, {
      ahora,
    });
    combinado.fill(0);

    return {
      paquete: {
        id: newId("leg"),
        creadoEn: ahora,
        deadManSwitch: createDeadManSwitch(options.signingKey, {
          intervaloSenalMs: options.intervaloSenalMs,
          periodoGraciaMs: options.periodoGraciaMs,
          ahora,
        }),
        recovery,
        timeLock: puzzle,
      },
      trapdoor,
    };
  } finally {
    claveLegado.destroy();
  }
}

/**
 * Enmascara el secreto con una máscara derivada de la clave del legado.
 *
 * La máscara se expande con HKDF hasta la longitud exacta del secreto. Repetir
 * la clave de 32 bytes en bucle habría sido un XOR de clave repetida: con un
 * secreto más largo, dos bloques enmascarados con el mismo tramo se delatan al
 * combinarlos entre sí. Derivar la máscara evita esa clase de fallo sea cual
 * sea el tamaño del secreto.
 *
 * La operación es su propia inversa, y esa es la propiedad que hace que las dos
 * condiciones sean de verdad independientes: los fragmentos de Shamir no
 * revelan nada sin la clave de la cerradura, y la clave no revela nada sin los
 * fragmentos. No es una comprobación encadenada que se pueda saltar.
 */
function combinar(secreto: Uint8Array, clave: Uint8Array): Uint8Array {
  const mascara = deriveKey(clave, "inheritance-mask", {
    context: uint32(secreto.length),
    length: secreto.length,
  });
  try {
    const salida = new Uint8Array(secreto.length);
    for (let i = 0; i < secreto.length; i++) {
      salida[i] = (secreto[i] as number) ^ (mascara.bytes[i] as number);
    }
    return salida;
  } finally {
    mascara.destroy();
  }
}

export interface ClaimInheritanceOptions {
  /** Fragmentos ya descifrados por los beneficiarios. */
  readonly shares: readonly ShamirShare[];
  /** Trampilla del titular; sin ella hay que resolver el puzzle. */
  readonly trapdoor?: SecretBuffer | Uint8Array;
  readonly onProgress?: (hechas: number, total: number) => void;
  readonly ahora?: number;
  /** Solo para pruebas: salta la comprobación del interruptor. */
  readonly ignorarInterruptor?: boolean;
}

/**
 * Reclama el legado. Exige el umbral de beneficiarios **y** la cerradura
 * temporal, además de que el interruptor esté liberable.
 */
export function claimInheritance(
  paquete: InheritancePackage,
  options: ClaimInheritanceOptions,
): SecretBuffer {
  const ahora = options.ahora ?? Date.now();
  if (!options.ignorarInterruptor) {
    const estado = evaluateSwitch(paquete.deadManSwitch, ahora);
    if (estado !== "liberable") {
      throw new SwitchError(
        `el legado todavía no puede reclamarse: el interruptor está "${estado}"`,
      );
    }
  }

  // Primera condición: el umbral de beneficiarios.
  const combinado = recoverSecret(options.shares, paquete.recovery.policy);
  // Segunda condición: la cerradura temporal.
  const claveLegado = options.trapdoor
    ? openTimeLockWithTrapdoor(paquete.timeLock, options.trapdoor)
    : solveTimeLock(paquete.timeLock, {
        ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      });

  try {
    return SecretBuffer.wrap(combinar(combinado.bytes, claveLegado.bytes));
  } finally {
    combinado.destroy();
    claveLegado.destroy();
  }
}

export function encodeSwitch(estado: DeadManSwitch): Uint8Array {
  return concatBytes(
    writeHeader(RECORD_TYPES.deadManSwitch),
    writeText(estado.id),
    writeMillis(estado.creadoEn),
    writeMillis(estado.intervaloSenalMs),
    writeMillis(estado.periodoGraciaMs),
    writeMillis(estado.ultimaSenal),
    writeBlock(estado.signingPublicKey),
    uint32(estado.revocado ? 1 : 0),
  );
}

export function decodeSwitch(bytes: Uint8Array): DeadManSwitch {
  const reader = new ByteReader(bytes);
  readHeader(reader, RECORD_TYPES.deadManSwitch);
  const id = readText(reader);
  const creadoEn = readMillis(reader);
  const intervaloSenalMs = readMillis(reader);
  const periodoGraciaMs = readMillis(reader);
  const ultimaSenal = readMillis(reader);
  const signingPublicKey = Uint8Array.from(readBlock(reader));
  const revocado = reader.takeUint32() === 1;
  reader.expectEnd();
  return {
    id,
    creadoEn,
    intervaloSenalMs,
    periodoGraciaMs,
    ultimaSenal,
    signingPublicKey,
    revocado,
  };
}

export function encodeHeartbeat(heartbeat: Heartbeat): Uint8Array {
  return concatBytes(
    writeHeader(RECORD_TYPES.heartbeat),
    writeText(heartbeat.switchId),
    writeMillis(heartbeat.emitidaEn),
    writeBlock(heartbeat.signature),
  );
}

export function decodeHeartbeat(bytes: Uint8Array): Heartbeat {
  const reader = new ByteReader(bytes);
  readHeader(reader, RECORD_TYPES.heartbeat);
  const switchId = readText(reader);
  const emitidaEn = readMillis(reader);
  const signature = Uint8Array.from(readBlock(reader));
  reader.expectEnd();
  return { switchId, emitidaEn, signature };
}

/** Resumen legible del estado, para interfaces. */
export function describeSwitch(estado: DeadManSwitch, ahora = Date.now()): string {
  const situacion = evaluateSwitch(estado, ahora);
  if (situacion === "revocado") return "Revocado: el legado ya no puede reclamarse.";
  if (situacion === "liberable") return "Liberable: los beneficiarios ya pueden reclamar el legado.";
  const dias = Math.ceil(timeUntilRelease(estado, ahora) / 86_400_000);
  const cola = `Faltan ${dias} día${dias === 1 ? "" : "s"} para que sea reclamable.`;
  if (situacion === "en-gracia") return `En periodo de gracia. ${cola}`;
  return `Activo. ${cola}`;
}
