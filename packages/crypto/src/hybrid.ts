import { ml_kem768_x25519 } from "@noble/post-quantum/hybrid.js";
import { open as aeadOpen, seal as aeadSeal } from "./aead.ts";
import { ByteReader, concatBytes, toHex } from "./encoding.ts";
import { domainHash } from "./hash.ts";
import { InvalidInputError } from "./errors.ts";
import { deriveKey } from "./kdf.ts";
import { randomBytes } from "./random.ts";
import { SecretBuffer } from "./secret.ts";

/**
 * KEM híbrido X-Wing: ML-KEM-768 (post-cuántico, FIPS 203) combinado con
 * X25519 (clásico, ampliamente auditado).
 *
 * Por qué híbrido y no solo post-cuántico: la criptografía reticular es joven y
 * podría tener fallos aún no descubiertos. Al combinar ambos, romper el sistema
 * exige romper *los dos*: un ordenador cuántico no basta (X25519 cae, ML-KEM
 * aguanta) y un fallo en ML-KEM tampoco (X25519 aguanta).
 *
 * Por qué post-cuántico ya, hoy: el ataque "cosechar ahora, descifrar después".
 * Una bóveda robada hoy y guardada se descifra el día que exista el ordenador
 * cuántico. Para contraseñas —que la gente reutiliza durante décadas— el modelo
 * de amenaza no es "¿existe hoy?" sino "¿existirá antes de que el secreto deje
 * de importar?".
 */
export const HYBRID_KEM = {
  seedLength: 32,
  publicKeyLength: 1216,
  secretKeyLength: 32,
  ciphertextLength: 1120,
  sharedSecretLength: 32,
} as const;

// Las longitudes están fijadas por el estándar X-Wing, pero las contrastamos
// con la implementación al cargar el módulo: una actualización de dependencia
// que cambie el formato debe fallar aquí y no al descifrar la bóveda de alguien.
{
  const actual = ml_kem768_x25519.lengths;
  const mismatch =
    actual.seed !== HYBRID_KEM.seedLength ||
    actual.publicKey !== HYBRID_KEM.publicKeyLength ||
    actual.secretKey !== HYBRID_KEM.secretKeyLength ||
    actual.cipherText !== HYBRID_KEM.ciphertextLength;
  if (mismatch) {
    throw new InvalidInputError(
      "las longitudes del KEM híbrido no coinciden con las de la implementación",
    );
  }
}

export interface HybridKeyPair {
  /** Clave pública, distribuible libremente. */
  readonly publicKey: Uint8Array;
  /** Clave privada. Propiedad del llamante: destrúyela cuando termines. */
  readonly secretKey: SecretBuffer;
}

/** Genera un par de claves; con `seed` (32 bytes) el resultado es determinista. */
export function generateHybridKeyPair(seed?: Uint8Array): HybridKeyPair {
  const material = seed ?? randomBytes(HYBRID_KEM.seedLength);
  if (material.length !== HYBRID_KEM.seedLength) {
    throw new InvalidInputError(`la semilla debe tener ${HYBRID_KEM.seedLength} bytes`);
  }
  const { publicKey, secretKey } = ml_kem768_x25519.keygen(material);
  return { publicKey, secretKey: SecretBuffer.wrap(secretKey) };
}

export function hybridPublicKeyFrom(secretKey: SecretBuffer | Uint8Array): Uint8Array {
  const bytes = secretKey instanceof Uint8Array ? secretKey : secretKey.bytes;
  return ml_kem768_x25519.getPublicKey(bytes);
}

export interface Encapsulation {
  /** Enviar al destinatario junto al mensaje. */
  readonly ciphertext: Uint8Array;
  /** Secreto compartido de 32 bytes. Nunca se transmite. */
  readonly sharedSecret: SecretBuffer;
}

export function hybridEncapsulate(publicKey: Uint8Array): Encapsulation {
  if (publicKey.length !== HYBRID_KEM.publicKeyLength) {
    throw new InvalidInputError("longitud de clave pública híbrida incorrecta");
  }
  const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(publicKey);
  return { ciphertext: cipherText, sharedSecret: SecretBuffer.wrap(sharedSecret) };
}

export function hybridDecapsulate(
  secretKey: SecretBuffer | Uint8Array,
  ciphertext: Uint8Array,
): SecretBuffer {
  if (ciphertext.length !== HYBRID_KEM.ciphertextLength) {
    throw new InvalidInputError("longitud de texto cifrado KEM incorrecta");
  }
  const bytes = secretKey instanceof Uint8Array ? secretKey : secretKey.bytes;
  return SecretBuffer.wrap(ml_kem768_x25519.decapsulate(ciphertext, bytes));
}

/**
 * Deriva la clave AEAD atándola al criptograma KEM y a la clave pública del
 * destinatario. Esta atadura es la que impide reutilizar una encapsulación con
 * otro destinatario o recombinar piezas de mensajes distintos.
 */
function derivePayloadKey(sharedSecret: SecretBuffer, ciphertext: Uint8Array, publicKey: Uint8Array): SecretBuffer {
  return deriveKey(sharedSecret.bytes, "hybrid-seal", {
    salt: domainHash("hybrid-seal-binding", ciphertext, publicKey),
  });
}

/**
 * Cifra `plaintext` para el titular de `publicKey` (construcción KEM-DEM).
 * Salida: `ciphertextKEM (1120) || nonce || ciphertext || tag`.
 */
export function hybridSeal(publicKey: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  const { ciphertext, sharedSecret } = hybridEncapsulate(publicKey);
  const payloadKey = derivePayloadKey(sharedSecret, ciphertext, publicKey);
  try {
    return concatBytes(ciphertext, aeadSeal(payloadKey, plaintext, aad));
  } finally {
    payloadKey.destroy();
    sharedSecret.destroy();
  }
}

export function hybridOpen(
  secretKey: SecretBuffer | Uint8Array,
  sealed: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  const reader = new ByteReader(sealed);
  const kemCiphertext = reader.take(HYBRID_KEM.ciphertextLength);
  const payload = reader.take(reader.remaining);
  const publicKey = hybridPublicKeyFrom(secretKey);
  const sharedSecret = hybridDecapsulate(secretKey, kemCiphertext);
  const payloadKey = derivePayloadKey(sharedSecret, kemCiphertext, publicKey);
  try {
    return aeadOpen(payloadKey, payload, aad);
  } finally {
    payloadKey.destroy();
    sharedSecret.destroy();
  }
}

/**
 * Huella corta y legible de una clave pública, para verificarla por un canal
 * distinto (en persona, por teléfono). Comparar 1216 bytes a ojo es inviable;
 * comparar seis grupos de cuatro caracteres, no.
 */
export function hybridFingerprint(publicKey: Uint8Array): string {
  const digest = domainHash("public-key-fingerprint", publicKey);
  const hex = toHex(digest.subarray(0, 12)).toUpperCase();
  return (hex.match(/.{4}/g) ?? []).join("-");
}
