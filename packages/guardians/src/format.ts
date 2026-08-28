import {
  ByteReader,
  InvalidInputError,
  lengthPrefixed,
  randomBytes,
  toBase64Url,
  uint16,
  uint32,
  uint64,
  utf8Decode,
  utf8Encode,
} from "@cerbero/crypto";

/**
 * Cimientos del formato binario de este paquete.
 *
 * Dos reglas gobiernan todo lo que se serializa aquí:
 *
 * 1. **Marcado inequívoco**: ningún campo de longitud variable se escribe sin
 *    su longitud delante. Sin eso, mover un byte de la frontera entre dos
 *    campos produce otro registro igual de válido, y ahí es donde nacen los
 *    ataques de confusión de formato.
 * 2. **Tipo de registro explícito**: cada estructura empieza declarando qué es.
 *    Si no lo hiciera, unos bytes de fragmento cifrado podrían decodificarse
 *    como política cuando las longitudes cuadran por casualidad, y el
 *    decodificador equivocado devolvería basura en vez de fallar.
 */
export const FORMAT_VERSION = 1;

export const RECORD_TYPES = {
  policy: 1,
  encryptedShare: 2,
  attestation: 3,
  puzzle: 4,
  deadManSwitch: 5,
  inheritance: 6,
  heartbeat: 7,
} as const;

export type RecordType = (typeof RECORD_TYPES)[keyof typeof RECORD_TYPES];

export function writeHeader(type: RecordType): Uint8Array {
  return new Uint8Array([type, FORMAT_VERSION]);
}

export function readHeader(reader: ByteReader, expected: RecordType): void {
  const type = reader.takeUint8();
  const version = reader.takeUint8();
  if (type !== expected) {
    throw new InvalidInputError("estos bytes no son del tipo de registro esperado");
  }
  if (version !== FORMAT_VERSION) {
    throw new InvalidInputError(`versión de formato no soportada: ${version}`);
  }
}

/**
 * Identificadores públicos de 96 bits de entropía.
 *
 * No son secretos —viajan en el `aad` y en los sobres— pero sí deben ser
 * imposibles de adivinar o de colisionar: un identificador de política
 * predecible permitiría preparar de antemano un fragmento cifrado para una
 * política que aún no existe.
 */
export function newId(prefix: string): string {
  return `${prefix}_${toBase64Url(randomBytes(12))}`;
}

export function writeText(text: string): Uint8Array {
  return lengthPrefixed(utf8Encode(text));
}

export function readText(reader: ByteReader): string {
  return utf8Decode(reader.takeLengthPrefixed());
}

export function writeBlock(bytes: Uint8Array): Uint8Array {
  return lengthPrefixed(bytes);
}

/** Copia los bytes leídos: `take` devuelve una vista viva sobre el buffer origen. */
export function readBlock(reader: ByteReader): Uint8Array {
  return Uint8Array.from(reader.takeLengthPrefixed());
}

export function writeCount(value: number): Uint8Array {
  return uint16(value);
}

export function writeIndex(value: number): Uint8Array {
  return uint32(value);
}

/** Marcas de tiempo y duraciones en milisegundos, siempre en 64 bits. */
export function writeMillis(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInputError("marca de tiempo o duración no válida");
  }
  return uint64(value);
}

export function readMillis(reader: ByteReader): number {
  const value = reader.takeUint64();
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError("marca de tiempo fuera del rango representable");
  }
  return Number(value);
}
