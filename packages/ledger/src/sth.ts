import {
  ByteReader,
  concatBytes,
  HYBRID_SIGNATURE,
  hybridSign,
  hybridVerify,
  InvalidInputError,
  lengthPrefixed,
  SecretBuffer,
  uint64,
} from "@cerbero/crypto";

/**
 * Cabecera de árbol firmada (Signed Tree Head).
 *
 * Es la promesa que el servidor hace al cliente: "a esta hora, mi registro
 * tenía exactamente este tamaño y esta raíz". Firmarla es lo que la vuelve una
 * promesa de la que no puede desdecirse: dos cabeceras firmadas contradictorias
 * son una prueba transferible de mala conducta que el usuario puede enseñar a
 * cualquiera.
 *
 * La firma es híbrida (Ed25519 + ML-DSA-65) porque su valor probatorio es a
 * largo plazo: una cabecera de hoy debe seguir demostrando algo dentro de
 * décadas, cuando una firma solo de curva elíptica ya no valga nada.
 */
export interface SignedTreeHead {
  readonly size: number;
  readonly rootHash: Uint8Array;
  readonly timestamp: number;
  readonly signature: Uint8Array;
}

/**
 * Contexto de firma propio. Una firma emitida como cabecera del registro no
 * verifica en ningún otro dominio del sistema (ni al revés): impide que una
 * firma capturada en otro sitio se recicle como cabecera.
 */
export const STH_SIGNATURE_CONTEXT = "ledger-sth";

/**
 * Mensaje firmado: los tres campos con marcado inequívoco. Mover un byte del
 * tamaño a la raíz, o alargar la raíz a costa de la marca de tiempo, produce
 * una codificación distinta y por tanto una firma que no verifica.
 */
function encodeTreeHead(size: number, rootHash: Uint8Array, timestamp: number): Uint8Array {
  return concatBytes(uint64(size), lengthPrefixed(rootHash), uint64(timestamp));
}

export function signTreeHead(
  secretKey: SecretBuffer | Uint8Array,
  size: number,
  rootHash: Uint8Array,
  timestamp: number,
): SignedTreeHead {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new InvalidInputError("el tamaño del árbol debe ser un entero no negativo");
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new InvalidInputError("la marca de tiempo debe ser un entero no negativo");
  }
  const message = encodeTreeHead(size, rootHash, timestamp);
  return {
    size,
    rootHash: Uint8Array.from(rootHash),
    timestamp,
    signature: hybridSign(secretKey, message, STH_SIGNATURE_CONTEXT),
  };
}

/**
 * Devuelve `true` solo si la cabecera completa —tamaño, raíz y marca de
 * tiempo— fue firmada por el titular de `publicKey`. Nunca lanza: una cabecera
 * llegada de la red es entrada hostil, y el llamante solo necesita un
 * veredicto.
 */
export function verifySignedTreeHead(publicKey: Uint8Array, sth: SignedTreeHead): boolean {
  if (publicKey.length !== HYBRID_SIGNATURE.publicKeyLength) return false;
  if (sth.signature.length !== HYBRID_SIGNATURE.signatureLength) return false;
  if (!Number.isSafeInteger(sth.size) || sth.size < 0) return false;
  if (!Number.isSafeInteger(sth.timestamp) || sth.timestamp < 0) return false;
  const message = encodeTreeHead(sth.size, sth.rootHash, sth.timestamp);
  return hybridVerify(publicKey, message, sth.signature, STH_SIGNATURE_CONTEXT);
}

/** Serialización de la cabecera, para intercambiarla entre dispositivos. */
export function encodeSignedTreeHead(sth: SignedTreeHead): Uint8Array {
  return concatBytes(
    uint64(sth.size),
    uint64(sth.timestamp),
    lengthPrefixed(sth.rootHash),
    lengthPrefixed(sth.signature),
  );
}

export function decodeSignedTreeHead(bytes: Uint8Array): SignedTreeHead {
  const reader = new ByteReader(bytes);
  const size = reader.takeUint64();
  const timestamp = reader.takeUint64();
  const rootHash = Uint8Array.from(reader.takeLengthPrefixed());
  const signature = Uint8Array.from(reader.takeLengthPrefixed());
  reader.expectEnd();
  if (size > BigInt(Number.MAX_SAFE_INTEGER) || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError("cabecera con valores fuera del rango representable");
  }
  return { size: Number(size), rootHash, timestamp: Number(timestamp), signature };
}
