import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ByteReader, concatBytes } from "./encoding.ts";
import { AeadError, InvalidInputError } from "./errors.ts";
import { randomBytes } from "./random.ts";
import type { SecretBuffer } from "./secret.ts";

export const AEAD_KEY_LENGTH = 32;
export const AEAD_NONCE_LENGTH = 24;
export const AEAD_TAG_LENGTH = 16;
/** Sobrecarga fija de `seal`: nonce + etiqueta de autenticación. */
export const AEAD_OVERHEAD = AEAD_NONCE_LENGTH + AEAD_TAG_LENGTH;

function keyBytes(key: SecretBuffer | Uint8Array): Uint8Array {
  const bytes = key instanceof Uint8Array ? key : key.bytes;
  if (bytes.length !== AEAD_KEY_LENGTH) {
    throw new InvalidInputError(`la clave AEAD debe tener ${AEAD_KEY_LENGTH} bytes`);
  }
  return bytes;
}

/**
 * Cifra y autentica. Formato de salida: `nonce (24) || ciphertext || tag (16)`.
 *
 * XChaCha20-Poly1305 y no AES-GCM por dos razones: el nonce de 192 bits permite
 * generarlo al azar sin miedo a colisiones (con los 96 bits de GCM, repetir un
 * nonce con la misma clave revela el texto en claro y permite falsificar), y no
 * depende de instrucciones AES del procesador, así que es de tiempo constante
 * también en JavaScript puro y en móviles antiguos.
 *
 * `aad` (datos autenticados no cifrados) es la herramienta contra los ataques de
 * confusión de contexto: ata el criptograma a su sitio (identificador de ítem,
 * versión, tipo de registro) para que no pueda moverse a otro y seguir validando.
 */
export function seal(
  key: SecretBuffer | Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  const nonce = randomBytes(AEAD_NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(keyBytes(key), nonce, aad).encrypt(plaintext);
  return concatBytes(nonce, ciphertext);
}

/**
 * Descifra y verifica. Lanza `AeadError` si la clave es incorrecta, si los datos
 * fueron alterados o si el `aad` no coincide; los tres casos son
 * indistinguibles desde fuera, y esa indistinguibilidad es intencionada.
 */
export function open(
  key: SecretBuffer | Uint8Array,
  sealed: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  if (sealed.length < AEAD_OVERHEAD) {
    throw new AeadError();
  }
  const reader = new ByteReader(sealed);
  const nonce = reader.take(AEAD_NONCE_LENGTH);
  const ciphertext = reader.take(reader.remaining);
  try {
    return xchacha20poly1305(keyBytes(key), nonce, aad).decrypt(ciphertext);
  } catch (cause) {
    throw new AeadError();
  }
}

/**
 * Intenta descifrar y devuelve `null` en vez de lanzar.
 *
 * Es la primitiva sobre la que se construye la bóveda de coacción: probar N
 * ranuras hasta encontrar la que abre, sin que un fallo sea un evento
 * excepcional ni distinga "ranura vacía" de "contraseña incorrecta".
 */
export function tryOpen(
  key: SecretBuffer | Uint8Array,
  sealed: Uint8Array,
  aad?: Uint8Array,
): Uint8Array | null {
  try {
    return open(key, sealed, aad);
  } catch {
    return null;
  }
}

/**
 * Cifrado con nonce explícito. Solo para construcciones deterministas donde el
 * nonce se deriva de forma demostrablemente única (por ejemplo, de un índice de
 * registro monótono). Reutilizar un nonce con la misma clave rompe el cifrado
 * por completo: no usar salvo que se pueda demostrar la unicidad.
 */
export function sealWithNonce(
  key: SecretBuffer | Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  if (nonce.length !== AEAD_NONCE_LENGTH) {
    throw new InvalidInputError(`el nonce debe tener ${AEAD_NONCE_LENGTH} bytes`);
  }
  return concatBytes(nonce, xchacha20poly1305(keyBytes(key), nonce, aad).encrypt(plaintext));
}
