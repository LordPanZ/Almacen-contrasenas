import { InvalidInputError, fromHex, randomBytes, toHex } from "@cerbero/crypto";

/**
 * Aritmética modular de precisión arbitraria para la cerradura temporal.
 *
 * Todo se apoya en `BigInt`, que no es de tiempo constante. Es una decisión
 * consciente y acotada: el único exponente secreto que se maneja aquí es el
 * atajo del creador (`2^T mod φ(N)`), y ese cálculo ocurre en la máquina del
 * titular sobre sus propios secretos, no en un servicio que atienda peticiones
 * de terceros. No hay, por tanto, un atacante capaz de medir esos tiempos. El
 * trabajo secuencial —lo que sí ejecuta cualquiera— no usa material secreto.
 */

export function bitLength(value: bigint): number {
  if (value < 0n) throw new InvalidInputError("no se admiten enteros negativos");
  if (value === 0n) return 0;
  return value.toString(2).length;
}

export function byteLength(value: bigint): number {
  return Math.ceil(bitLength(value) / 8);
}

/** Big-endian sin signo. Con `length`, rellena con ceros por la izquierda. */
export function bigIntToBytes(value: bigint, length?: number): Uint8Array {
  if (value < 0n) throw new InvalidInputError("no se admiten enteros negativos");
  const hex = value.toString(16);
  const minimal = fromHex(hex.length % 2 === 0 ? hex : `0${hex}`);
  if (length === undefined) return minimal;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new InvalidInputError("longitud de codificación no válida");
  }
  if (minimal.length > length) {
    throw new InvalidInputError("el entero no cabe en la longitud pedida");
  }
  const out = new Uint8Array(length);
  out.set(minimal, length - minimal.length);
  return out;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  return BigInt(`0x${toHex(bytes)}`);
}

/**
 * Entero uniforme en [0, maxExclusive) por muestreo con rechazo.
 *
 * El atajo `aleatorio % max` sesga los valores bajos. En la elección de la base
 * del puzzle y de las bases de Miller-Rabin ese sesgo estrecha el espacio real
 * de valores, que es justo lo que no queremos.
 */
export function randomBigInt(maxExclusive: bigint): bigint {
  if (maxExclusive <= 0n) throw new InvalidInputError("el límite debe ser positivo");
  const bits = bitLength(maxExclusive);
  const mask = (1n << BigInt(bits)) - 1n;
  const bytes = Math.ceil(bits / 8);
  for (;;) {
    // Al recortar a la longitud exacta en bits, la probabilidad de rechazo
    // queda por debajo de 1/2 y el bucle termina enseguida.
    const candidate = bytesToBigInt(randomBytes(bytes)) & mask;
    if (candidate < maxExclusive) return candidate;
  }
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 0n) throw new InvalidInputError("el módulo debe ser positivo");
  if (exponent < 0n) throw new InvalidInputError("exponente negativo sin inverso definido");
  let result = 1n;
  let acc = base % modulus;
  let rest = exponent;
  while (rest > 0n) {
    if (rest & 1n) result = (result * acc) % modulus;
    acc = (acc * acc) % modulus;
    rest >>= 1n;
  }
  return result;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

// Criba hasta 4096: la división de prueba descarta cerca del 90 % de los
// candidatos impares por una fracción del coste de una ronda de Miller-Rabin.
const SMALL_PRIMES = /* @__PURE__ */ (() => {
  const limit = 4096;
  const composite = new Uint8Array(limit + 1);
  const primes: bigint[] = [];
  for (let n = 2; n <= limit; n++) {
    if (composite[n]) continue;
    primes.push(BigInt(n));
    for (let m = n * n; m <= limit; m += n) composite[m] = 1;
  }
  return primes;
})();

/**
 * Rondas de Miller-Rabin.
 *
 * Con bases elegidas al azar, cada ronda deja pasar un compuesto con
 * probabilidad menor que 1/4, así que 24 rondas acotan el error por debajo de
 * 2^-48 incluso para un candidato construido a mala fe. Para candidatos
 * aleatorios —el caso real— el error efectivo es órdenes de magnitud menor.
 */
export const MILLER_RABIN_ROUNDS = 24;

/**
 * Test de primalidad probabilístico con bases aleatorias.
 *
 * Las bases se sortean en cada llamada y no se usa un conjunto fijo: hay
 * compuestos (pseudoprimos fuertes) construidos a propósito para superar las
 * primeras bases primas, y un conjunto fijo y público es precisamente lo que
 * permite fabricarlos. Contra bases impredecibles no hay nada que preparar.
 */
export function isProbablePrime(value: bigint, rounds: number = MILLER_RABIN_ROUNDS): boolean {
  if (value < 2n) return false;
  for (const small of SMALL_PRIMES) {
    if (value === small) return true;
    if (value % small === 0n) return false;
  }

  // value - 1 = d · 2^r con d impar.
  let d = value - 1n;
  let r = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r += 1;
  }

  for (let round = 0; round < rounds; round++) {
    const base = 2n + randomBigInt(value - 3n);
    let x = modPow(base, d, value);
    if (x === 1n || x === value - 1n) continue;
    let composite = true;
    for (let i = 1; i < r; i++) {
      x = (x * x) % value;
      if (x === value - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

/**
 * Primo probable de exactamente `bits` bits.
 *
 * Se fuerzan los dos bits más altos para que el producto de dos primos de este
 * tamaño tenga siempre el tamaño anunciado (un módulo más corto de lo previsto
 * significaría menos trabajo del contratado para quien resuelva el puzzle), y
 * los dos más bajos para obtener p ≡ 3 (mod 4): con un módulo de Blum y una
 * base que sea un cuadrado, el orden del grupo generado no tiene factores
 * pequeños y no hay ciclo corto por el que atajar las elevaciones.
 */
export function generateProbablePrime(bits: number): bigint {
  if (!Number.isSafeInteger(bits) || bits < 128 || bits % 8 !== 0) {
    throw new InvalidInputError("el tamaño del primo debe ser múltiplo de 8 y de al menos 128 bits");
  }
  const bytes = bits / 8;
  for (;;) {
    const material = randomBytes(bytes);
    material[0] = (material[0] as number) | 0b1100_0000;
    material[bytes - 1] = (material[bytes - 1] as number) | 0b0000_0011;
    const candidate = bytesToBigInt(material);
    if (isProbablePrime(candidate)) return candidate;
  }
}

/**
 * Trabajo secuencial del puzzle: `base^(2^squarings) mod modulus`.
 *
 * Cada elevación al cuadrado necesita el resultado de la anterior, así que la
 * cadena no se puede repartir: mil máquinas tardan lo mismo que una. Esa es la
 * propiedad que convierte el tiempo en una barrera criptográfica y no en una
 * comprobación de calendario que un servidor pueda saltarse cambiando su reloj.
 */
export function repeatedSquaring(
  base: bigint,
  modulus: bigint,
  squarings: number,
  onProgress?: (completed: number, total: number) => void,
): bigint {
  if (modulus <= 1n) throw new InvalidInputError("el módulo debe ser mayor que 1");
  if (!Number.isSafeInteger(squarings) || squarings < 0) {
    throw new InvalidInputError("el número de elevaciones debe ser un entero no negativo");
  }
  let value = base % modulus;
  const step = Math.max(1, Math.ceil(squarings / 100));
  for (let i = 0; i < squarings; i++) {
    value = (value * value) % modulus;
    if (onProgress && (i + 1) % step === 0) onProgress(i + 1, squarings);
  }
  if (onProgress && squarings % step !== 0) onProgress(squarings, squarings);
  return value;
}
