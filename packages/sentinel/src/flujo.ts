import {
  InvalidInputError,
  domainHash,
  randomChoice,
  randomInt,
  shuffleInPlace,
  uint32,
} from "@cerbero/crypto";

/**
 * Fuente de números aleatorios sin sesgo.
 *
 * Existe para que el generador de contraseñas reales y el de señuelos compartan
 * exactamente el mismo código: si los señuelos se construyeran con otra rutina,
 * cualquier diferencia de distribución —una clase de caracteres algo más
 * probable, una longitud distinta— serviría para separarlos de las auténticas
 * sin conocer la clave, que es justo lo que un canario no puede permitirse.
 */
export interface FuenteAleatoria {
  /** Entero uniforme en [0, maxExclusive). */
  entero(maxExclusive: number): number;
  /** Elemento uniforme de una colección no vacía. */
  elegir<T>(items: readonly T[]): T;
  /** Baraja in situ y devuelve el mismo array. */
  barajar<T>(items: T[]): T[];
}

/** Fuente respaldada por el CSPRNG del sistema: la de las contraseñas reales. */
export const FUENTE_SISTEMA: FuenteAleatoria = {
  entero: randomInt,
  elegir: randomChoice,
  barajar: shuffleInPlace,
};

/** Bytes que produce cada bloque del flujo (salida de SHA-256). */
const BLOQUE = 32;

/**
 * Flujo pseudoaleatorio reproducible a partir de una semilla.
 *
 * Un canario tiene que poder recrearse desde `(clave, id)` sin guardar nada
 * más: así el titular reconstruye el señuelo perdido y comprueba que el que
 * tiene en la bóveda no ha sido manipulado. Eso obliga a un flujo determinista,
 * pero con la misma calidad estadística que el CSPRNG, o los señuelos volverían
 * a ser distinguibles.
 */
export class FlujoDeterminista implements FuenteAleatoria {
  readonly #semilla: Uint8Array;
  readonly #dominio: string;
  #bloque = 0;
  #buffer: Uint8Array = new Uint8Array(0);
  #posicion = 0;

  constructor(semilla: Uint8Array, dominio: string) {
    if (semilla.length === 0) {
      throw new InvalidInputError("la semilla del flujo no puede estar vacía");
    }
    this.#semilla = Uint8Array.from(semilla);
    this.#dominio = dominio;
  }

  /** Siguientes `longitud` bytes del flujo. */
  bytes(longitud: number): Uint8Array {
    if (!Number.isSafeInteger(longitud) || longitud < 0) {
      throw new InvalidInputError("la longitud debe ser un entero no negativo");
    }
    const salida = new Uint8Array(longitud);
    let escritos = 0;
    while (escritos < longitud) {
      if (this.#posicion >= this.#buffer.length) {
        // El contador va dentro del hash con separación de dominios: dos flujos
        // con la misma semilla y distinto dominio nunca comparten un solo byte.
        this.#buffer = domainHash(this.#dominio, this.#semilla, uint32(this.#bloque));
        this.#bloque += 1;
        this.#posicion = 0;
      }
      const trozo = Math.min(longitud - escritos, BLOQUE - this.#posicion);
      salida.set(this.#buffer.subarray(this.#posicion, this.#posicion + trozo), escritos);
      this.#posicion += trozo;
      escritos += trozo;
    }
    return salida;
  }

  /**
   * Entero uniforme por muestreo con rechazo, idéntico al de `randomInt`.
   *
   * El atajo `byte % n` sesga los primeros valores del rango; en un señuelo eso
   * se traduce en caracteres más frecuentes que en las contraseñas reales, es
   * decir, en una firma estadística que lo delata.
   */
  entero(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new InvalidInputError("maxExclusive debe ser un entero positivo");
    }
    if (maxExclusive === 1) return 0;
    const bytesNecesarios = Math.ceil(Math.log2(maxExclusive) / 8);
    const rango = 256 ** bytesNecesarios;
    const limite = rango - (rango % maxExclusive);
    for (;;) {
      const bytes = this.bytes(bytesNecesarios);
      let valor = 0;
      for (let i = 0; i < bytesNecesarios; i++) valor = valor * 256 + (bytes[i] as number);
      if (valor < limite) return valor % maxExclusive;
    }
  }

  elegir<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new InvalidInputError("no se puede elegir de una colección vacía");
    }
    return items[this.entero(items.length)] as T;
  }

  barajar<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.entero(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
