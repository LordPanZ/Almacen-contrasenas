import { InvalidInputError } from "./errors.ts";

/**
 * Único punto de entrada de aleatoriedad de todo el sistema.
 *
 * Siempre el CSPRNG del sistema operativo vía WebCrypto (presente tanto en
 * Node >=18 como en navegadores). Nunca `Math.random`, y nunca un PRNG propio:
 * la calidad de todas las claves de Cerbero se apoya en esta función.
 */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new InvalidInputError("la longitud debe ser un entero no negativo");
  }
  const out = new Uint8Array(length);
  // getRandomValues está limitado a 65536 bytes por llamada.
  const CHUNK = 65536;
  for (let offset = 0; offset < length; offset += CHUNK) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + CHUNK, length)));
  }
  return out;
}

/**
 * Entero uniforme en [0, maxExclusive) por muestreo con rechazo.
 *
 * El atajo `randomBytes(4)[0] % n` introduce un sesgo modular que en un
 * generador de contraseñas se traduce en caracteres más probables que otros,
 * es decir, en entropía real por debajo de la anunciada.
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new InvalidInputError("maxExclusive debe ser un entero positivo");
  }
  if (maxExclusive === 1) return 0;

  // Menor número de bytes capaz de representar maxExclusive - 1.
  const bytesNeeded = Math.ceil(Math.log2(maxExclusive) / 8);
  const range = 256 ** bytesNeeded;
  // Mayor múltiplo de maxExclusive que cabe en `range`; por encima, rechazamos.
  const limit = range - (range % maxExclusive);

  for (;;) {
    const bytes = randomBytes(bytesNeeded);
    let value = 0;
    for (let i = 0; i < bytesNeeded; i++) value = value * 256 + (bytes[i] as number);
    if (value < limit) return value % maxExclusive;
  }
}

/** Elemento aleatorio uniforme de un array no vacío. */
export function randomChoice<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new InvalidInputError("no se puede elegir de una colección vacía");
  }
  return items[randomInt(items.length)] as T;
}

/** Baraja Fisher-Yates in situ con aleatoriedad sin sesgo. */
export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
