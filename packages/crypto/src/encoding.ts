import { InvalidInputError } from "./errors.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export function utf8Encode(text: string): Uint8Array {
  return TEXT_ENCODER.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

const HEX_ALPHABET = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    out += HEX_ALPHABET[byte >>> 4];
    out += HEX_ALPHABET[byte & 0x0f];
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new InvalidInputError("una cadena hexadecimal debe tener longitud par");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new InvalidInputError("carácter no hexadecimal en la entrada");
    }
    out[i] = byte;
  }
  return out;
}

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64URL_LOOKUP = /* @__PURE__ */ (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i++) {
    table[B64URL_ALPHABET.charCodeAt(i)] = i;
  }
  // Aceptamos también el alfabeto base64 clásico al decodificar, por comodidad.
  table["+".charCodeAt(0)] = 62;
  table["/".charCodeAt(0)] = 63;
  return table;
})();

/** Base64 con alfabeto URL-safe y sin relleno (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64URL_ALPHABET[(chunk >>> 18) & 63];
    out += B64URL_ALPHABET[(chunk >>> 12) & 63];
    out += B64URL_ALPHABET[(chunk >>> 6) & 63];
    out += B64URL_ALPHABET[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = (bytes[i] as number) << 16;
    out += B64URL_ALPHABET[(chunk >>> 18) & 63];
    out += B64URL_ALPHABET[(chunk >>> 12) & 63];
  } else if (remaining === 2) {
    const chunk = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64URL_ALPHABET[(chunk >>> 18) & 63];
    out += B64URL_ALPHABET[(chunk >>> 12) & 63];
    out += B64URL_ALPHABET[(chunk >>> 6) & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const remainder = clean.length % 4;
  if (remainder === 1) {
    throw new InvalidInputError("longitud base64url imposible");
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let accumulator = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? (B64URL_LOOKUP[code] as number) : -1;
    if (value < 0) {
      throw new InvalidInputError("carácter no válido en base64url");
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (accumulator >>> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** Concatena buffers en uno nuevo. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Lector secuencial con comprobación de límites. Evita la clase de bugs de
 * parseo (leer más allá del buffer, longitudes negativas) que históricamente
 * han roto formatos criptográficos.
 */
export class ByteReader {
  #offset = 0;

  constructor(private readonly source: Uint8Array) {}

  get remaining(): number {
    return this.source.length - this.#offset;
  }

  get offset(): number {
    return this.#offset;
  }

  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new InvalidInputError("longitud de lectura no válida");
    }
    if (length > this.remaining) {
      throw new InvalidInputError("datos truncados: se leyó más allá del final");
    }
    const slice = this.source.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return slice;
  }

  takeUint8(): number {
    return this.take(1)[0] as number;
  }

  takeUint16(): number {
    const bytes = this.take(2);
    return ((bytes[0] as number) << 8) | (bytes[1] as number);
  }

  takeUint32(): number {
    const bytes = this.take(4);
    return (
      (bytes[0] as number) * 0x1000000 +
      (((bytes[1] as number) << 16) | ((bytes[2] as number) << 8) | (bytes[3] as number))
    );
  }

  /** Entero de 64 bits sin signo, como bigint (para marcas de tiempo e índices). */
  takeUint64(): bigint {
    const bytes = this.take(8);
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[i] as number);
    return value;
  }

  /** Bloque precedido por su longitud en 4 bytes big-endian. */
  takeLengthPrefixed(): Uint8Array {
    return this.take(this.takeUint32());
  }

  expectEnd(): void {
    if (this.remaining !== 0) {
      throw new InvalidInputError("datos sobrantes tras el final del registro");
    }
  }
}

export function uint16(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new InvalidInputError("valor fuera del rango de 16 bits");
  }
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

export function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new InvalidInputError("valor fuera del rango de 32 bits");
  }
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

export function uint64(value: bigint | number): Uint8Array {
  let big = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (big < 0n || big > 0xffffffffffffffffn) {
    throw new InvalidInputError("valor fuera del rango de 64 bits");
  }
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(big & 0xffn);
    big >>= 8n;
  }
  return out;
}

/** Prefija un bloque con su longitud de 4 bytes. Base del marcado inequívoco. */
export function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  return concatBytes(uint32(bytes.length), bytes);
}
