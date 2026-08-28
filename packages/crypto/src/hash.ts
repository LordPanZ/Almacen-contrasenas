import { blake3 } from "@noble/hashes/blake3.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, lengthPrefixed, utf8Encode } from "./encoding.ts";

export { blake3, sha256, sha512 };

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message);
}

/**
 * Comparación en tiempo constante.
 *
 * Un `===` byte a byte con salida temprana filtra, por el tiempo de ejecución,
 * cuántos bytes iniciales acertó el atacante. Eso convierte una búsqueda
 * exponencial en una lineal: es como se rompen las etiquetas de autenticación.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // La diferencia de longitud no es secreta: la longitud del texto cifrado ya
  // es pública. Lo que no debe filtrarse es *dónde* difiere el contenido.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/**
 * Hash con separación de dominios y marcado inequívoco.
 *
 * Cada bloque va precedido de su longitud, de modo que ("ab","c") y ("a","bc")
 * nunca producen el mismo hash. Sin esto, un formato que concatena campos
 * permite construir colisiones desplazando el límite entre ellos.
 */
export function domainHash(domain: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const encoded = [lengthPrefixed(utf8Encode(`cerbero/v1/${domain}`))];
  for (const part of parts) encoded.push(lengthPrefixed(part));
  return sha256(concatBytes(...encoded));
}
