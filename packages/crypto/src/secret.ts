import { DestroyedSecretError, InvalidInputError } from "./errors.ts";
import { utf8Encode } from "./encoding.ts";
import { randomBytes } from "./random.ts";

/**
 * Sobrescribe memoria con ceros.
 *
 * En JavaScript esto no es una garantía absoluta —el recolector de basura
 * puede haber copiado el buffer— pero reduce drásticamente la ventana en la
 * que una clave vive en el heap, y por tanto lo que aparece en un volcado de
 * memoria, en un fichero de hibernación o en un core dump.
 */
export function zeroize(...buffers: readonly (Uint8Array | undefined | null)[]): void {
  for (const buffer of buffers) {
    if (buffer) buffer.fill(0);
  }
}

/**
 * Contenedor de material secreto con borrado explícito.
 *
 * Motivo de existir: las cadenas de JavaScript son inmutables e internadas, así
 * que una contraseña maestra guardada en un `string` no se puede borrar y puede
 * sobrevivir en memoria de forma indefinida. `SecretBuffer` obliga a que todo
 * secreto viva en un `Uint8Array` mutable con dueño y ciclo de vida claros.
 */
export class SecretBuffer {
  #bytes: Uint8Array | null;

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  /** Toma posesión del array: el llamante no debe seguir usándolo. */
  static wrap(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(bytes);
  }

  /** Copia los bytes de origen; el original sigue siendo del llamante. */
  static copyOf(bytes: Uint8Array): SecretBuffer {
    return new SecretBuffer(Uint8Array.from(bytes));
  }

  /**
   * Convierte texto a secreto. El `string` de origen sigue siendo inmutable y
   * fuera de nuestro control: úsese solo en la frontera del sistema (entrada
   * por teclado) y lo antes posible.
   */
  static fromText(text: string): SecretBuffer {
    return new SecretBuffer(utf8Encode(text));
  }

  /** Secreto nuevo de `length` bytes del CSPRNG del sistema. */
  static random(length: number): SecretBuffer {
    return new SecretBuffer(randomBytes(length));
  }

  /** Buffer de ceros de longitud fija, para rellenar por el llamante. */
  static allocate(length: number): SecretBuffer {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new InvalidInputError("la longitud debe ser un entero no negativo");
    }
    return new SecretBuffer(new Uint8Array(length));
  }

  get destroyed(): boolean {
    return this.#bytes === null;
  }

  get length(): number {
    return this.#read().length;
  }

  /** Vista viva sobre los bytes. No la guardes más allá del uso inmediato. */
  get bytes(): Uint8Array {
    return this.#read();
  }

  /** Copia independiente de los bytes, con su propio ciclo de vida. */
  clone(): SecretBuffer {
    return new SecretBuffer(Uint8Array.from(this.#read()));
  }

  /** Sobrescribe con ceros y marca el secreto como inutilizable. */
  destroy(): void {
    if (this.#bytes) {
      this.#bytes.fill(0);
      this.#bytes = null;
    }
  }

  #read(): Uint8Array {
    if (this.#bytes === null) throw new DestroyedSecretError();
    return this.#bytes;
  }

  /** Nunca filtrar secretos por logs, `console.log` ni `JSON.stringify`. */
  toString(): string {
    return `[SecretBuffer ${this.destroyed ? "borrado" : `${this.#bytes?.length ?? 0} bytes`}]`;
  }

  toJSON(): string {
    return "[secreto omitido]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/**
 * Ejecuta `fn` con el secreto y lo destruye pase lo que pase, incluso si `fn`
 * lanza. Es el equivalente a un `defer zeroize()`: el patrón que evita que una
 * clave sobreviva a una ruta de error.
 */
export function withSecret<T>(secret: SecretBuffer, fn: (bytes: Uint8Array) => T): T {
  try {
    return fn(secret.bytes);
  } finally {
    secret.destroy();
  }
}

/** Igual que `withSecret`, para funciones asíncronas. */
export async function withSecretAsync<T>(
  secret: SecretBuffer,
  fn: (bytes: Uint8Array) => Promise<T>,
): Promise<T> {
  try {
    return await fn(secret.bytes);
  } finally {
    secret.destroy();
  }
}
