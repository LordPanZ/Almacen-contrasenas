import {
  ByteReader,
  concatBytes,
  constantTimeEqual,
  domainHash,
  InvalidInputError,
  lengthPrefixed,
  uint32,
  uint64,
  utf8Decode,
  utf8Encode,
} from "@cerbero/crypto";
import { leafHash } from "./merkle.ts";

/**
 * Sucesos que el registro sabe anotar. El conjunto es cerrado a propósito: un
 * tipo libre convertiría el campo en un canal por el que colar texto arbitrario
 * —posiblemente sensible— dentro de un registro que está pensado para poder
 * enseñarse a terceros.
 */
export type LedgerEventType =
  | "vault-created"
  | "vault-unlocked"
  | "unlock-failed"
  | "duress-unlock"
  | "item-added"
  | "item-updated"
  | "item-removed"
  | "item-read"
  | "guardian-added"
  | "guardian-removed"
  | "recovery-initiated"
  | "recovery-completed"
  | "canary-triggered"
  | "export"
  | "slot-added"
  | "policy-changed";

export const LEDGER_EVENT_TYPES: readonly LedgerEventType[] = [
  "vault-created",
  "vault-unlocked",
  "unlock-failed",
  "duress-unlock",
  "item-added",
  "item-updated",
  "item-removed",
  "item-read",
  "guardian-added",
  "guardian-removed",
  "recovery-initiated",
  "recovery-completed",
  "canary-triggered",
  "export",
  "slot-added",
  "policy-changed",
];

const KNOWN_EVENT_TYPES = new Set<string>(LEDGER_EVENT_TYPES);

export function isLedgerEventType(value: string): value is LedgerEventType {
  return KNOWN_EVENT_TYPES.has(value);
}

export interface LedgerEntry {
  readonly index: number;
  readonly timestamp: number;
  readonly type: LedgerEventType;
  /** Hash del detalle, NO el detalle: el registro debe poder enseñarse sin revelar la bóveda. */
  readonly detailHash: Uint8Array;
  readonly device?: string;
  /** Encadenado, además del árbol: es el hash de hoja de la entrada anterior. */
  readonly previousHash: Uint8Array;
}

/**
 * Ancla de la cadena, derivada de la clave pública de firma del registro.
 *
 * Que dependa de la clave —y no sea una constante— es lo que ata el historial
 * a quien lo firma. Si fuese fija, alguien podría cambiar la clave pública del
 * fichero serializado por la suya, firmar una cabecera nueva y presentar un
 * registro que verifica perfectamente: la sustitución de clave sería
 * indetectable. Atándola al génesis, cambiar la clave rompe la cadena en la
 * primera entrada y la recarga falla.
 *
 * El dominio propio (en vez de 32 ceros) impide además que una entrada
 * arrancada de otro registro pueda pegarse como génesis de este.
 */
export function genesisHash(publicKey: Uint8Array): Uint8Array {
  return domainHash("ledger-genesis", publicKey);
}

/**
 * Hash del detalle de un suceso.
 *
 * El registro guarda esto y nunca el detalle: así el historial puede
 * enseñarse a un auditor, sincronizarse con un servidor o publicarse sin
 * revelar qué contraseñas hay dentro.
 *
 * Límite conocido y asumido: es un compromiso sin cegado, de modo que quien
 * tenga el registro puede confirmar por fuerza bruta un detalle que *ya
 * sospeche* (probar "gmail.com" y comparar). Protege frente a quien no sabe qué
 * buscar, no frente a quien solo quiere confirmar una conjetura sobre un
 * espacio pequeño. Para ocultar también eso, el detalle debe llevar ya un valor
 * aleatorio dentro antes de llegar aquí.
 */
export function detailHash(detail: Uint8Array): Uint8Array {
  return domainHash("ledger-detail", detail);
}

/** Comprueba que un detalle revelado se corresponde con el hash anotado. */
export function verifyDetail(entry: LedgerEntry, detail: Uint8Array): boolean {
  return constantTimeEqual(detailHash(detail), entry.detailHash);
}

const ENTRY_FORMAT_VERSION = 1;

/**
 * Codificación canónica de una entrada: es lo que se hashea como hoja del
 * árbol, así que dos entradas distintas jamás pueden producir los mismos
 * bytes. Cada campo variable va con su longitud delante, y la presencia del
 * dispositivo se marca con un byte propio: sin él, `device: ""` y `device`
 * ausente colisionarían. La versión de formato va dentro del compromiso para
 * que un formato futuro no pueda reinterpretarse como este.
 */
export function encodeEntry(entry: LedgerEntry): Uint8Array {
  return concatBytes(
    new Uint8Array([ENTRY_FORMAT_VERSION]),
    uint32(entry.index),
    uint64(entry.timestamp),
    lengthPrefixed(utf8Encode(entry.type)),
    lengthPrefixed(entry.detailHash),
    entry.device === undefined
      ? new Uint8Array([0])
      : concatBytes(new Uint8Array([1]), lengthPrefixed(utf8Encode(entry.device))),
    lengthPrefixed(entry.previousHash),
  );
}

export function decodeEntry(bytes: Uint8Array): LedgerEntry {
  const reader = new ByteReader(bytes);
  const version = reader.takeUint8();
  if (version !== ENTRY_FORMAT_VERSION) {
    throw new InvalidInputError(`versión de entrada no soportada: ${version}`);
  }
  const index = reader.takeUint32();
  const timestamp = reader.takeUint64();
  const type = utf8Decode(reader.takeLengthPrefixed());
  const detailHashBytes = Uint8Array.from(reader.takeLengthPrefixed());
  const hasDevice = reader.takeUint8();
  if (hasDevice > 1) {
    throw new InvalidInputError("marca de dispositivo no válida");
  }
  const device = hasDevice === 1 ? utf8Decode(reader.takeLengthPrefixed()) : undefined;
  const previousHash = Uint8Array.from(reader.takeLengthPrefixed());
  reader.expectEnd();

  if (!isLedgerEventType(type)) {
    throw new InvalidInputError(`tipo de suceso desconocido: ${type}`);
  }
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError("marca de tiempo fuera del rango representable");
  }
  return {
    index,
    timestamp: Number(timestamp),
    type,
    detailHash: detailHashBytes,
    ...(device === undefined ? {} : { device }),
    previousHash,
  };
}

/**
 * Hash de hoja de la entrada. Es a la vez el eslabón que la siguiente entrada
 * guarda en `previousHash`: cadena y árbol comprometen exactamente el mismo
 * valor, así que no pueden discrepar entre sí.
 */
export function entryHash(entry: LedgerEntry): Uint8Array {
  return leafHash(encodeEntry(entry));
}

/** Copia defensiva: quien recibe una entrada no debe poder alterar el registro. */
export function cloneEntry(entry: LedgerEntry): LedgerEntry {
  return Object.freeze({
    index: entry.index,
    timestamp: entry.timestamp,
    type: entry.type,
    detailHash: Uint8Array.from(entry.detailHash),
    ...(entry.device === undefined ? {} : { device: entry.device }),
    previousHash: Uint8Array.from(entry.previousHash),
  });
}
