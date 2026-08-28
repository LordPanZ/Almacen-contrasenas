import { ristretto255_oprf } from "@noble/curves/ed25519.js";
import {
  CerberoError,
  InvalidInputError,
  SecretBuffer,
  domainHash,
  randomBytes,
  toHex,
  utf8Encode,
} from "@cerbero/crypto";

/**
 * Variante **verificable** del OPRF (VOPRF, RFC 9497).
 *
 * La variante simple bastaría para que el servidor no aprenda tu contraseña,
 * pero deja una puerta abierta en la otra dirección: un servidor malicioso
 * puede devolver un valor cualquiera, tu contraseña filtrada no aparecería en
 * el índice y te quedarías tranquilo con una credencial quemada. Con VOPRF el
 * servidor adjunta una prueba de conocimiento cero de que evaluó con la clave
 * que anuncia, y el cliente la verifica antes de creerse el resultado.
 */
const VOPRF = ristretto255_oprf.voprf;

/**
 * `evaluate` existe en el VOPRF de @noble/curves pero falta en sus tipos
 * publicados. Es la evaluación directa que usa el servidor para construir su
 * índice: mismo resultado que el protocolo cegado completo, sin dar la vuelta
 * por el cliente. El acceso va acotado aquí, con la firma real, en vez de
 * repartir aserciones por el archivo.
 */
const evaluarDirecto = (
  VOPRF as unknown as { evaluate(secretKey: Uint8Array, input: Uint8Array): Uint8Array }
).evaluate.bind(VOPRF);

/**
 * Bytes del identificador que se guardan en el índice de filtradas.
 *
 * La salida del OPRF son 64 bytes; con 16 (128 bits) la probabilidad de
 * colisión sigue siendo despreciable incluso para los miles de millones de
 * contraseñas de los volcados publicados, y el índice ocupa cuatro veces menos.
 */
const LONGITUD_IDENTIFICADOR = 16;

/** Separa este uso del OPRF de cualquier otro que compartiera la misma clave. */
const DOMINIO_CONSULTA = "breach-check";

export class BreachProofError extends CerberoError {
  constructor() {
    super(
      "el servidor no demostró haber evaluado con su clave declarada: la respuesta no es de fiar",
    );
  }
}

function entradaOprf(password: string | SecretBuffer): Uint8Array {
  const bytes = typeof password === "string" ? utf8Encode(password) : password.bytes;
  // Pasar por un hash con dominio propio evita que la longitud del texto llegue
  // al OPRF y que la misma contraseña colisione con su evaluación en otro
  // protocolo que reutilizara la clave del servidor.
  return domainHash(DOMINIO_CONSULTA, bytes);
}

function identificador(salida: Uint8Array): string {
  return toHex(salida.subarray(0, LONGITUD_IDENTIFICADOR));
}

/** Índice de contraseñas filtradas, ya evaluadas bajo la clave del servidor. */
export interface BreachedSet {
  readonly identifiers: ReadonlySet<string>;
  readonly size: number;
}

/** Lo único que sale del dispositivo del usuario: un punto cegado. */
export interface BreachQuery {
  readonly blinded: Uint8Array;
}

/** Respuesta del servidor: la evaluación y la prueba de que usó su clave. */
export interface BreachResponse {
  readonly evaluated: Uint8Array;
  readonly proof: Uint8Array;
}

/** Estado que el cliente guarda entre el envío y la respuesta. No se envía. */
export interface PreparedBreachQuery {
  readonly query: BreachQuery;
  readonly blind: Uint8Array;
  readonly input: Uint8Array;
}

export interface BreachResult {
  readonly filtrada: boolean;
  /** Identificador local; permite cachear el veredicto sin guardar la contraseña. */
  readonly identificador: string;
}

/**
 * Servidor de referencia del protocolo de filtraciones.
 *
 * Comprobar hoy si una contraseña está en una filtración significa enviarle a
 * un tercero un prefijo del hash: es el modelo de k-anonimato del servicio
 * habitual, que reduce el anonimato sin eliminarlo, porque el prefijo acota el
 * conjunto de candidatas y permite correlacionar consultas repetidas.
 *
 * Aquí el servidor evalúa sobre un punto **cegado**: no aprende la contraseña,
 * ni su hash, ni un prefijo, ni puede saber si dos consultas fueron de la misma
 * contraseña, porque el factor de cegado es nuevo en cada envío. Y como la
 * comparación contra el índice ocurre en el dispositivo, tampoco se entera de
 * si el resultado fue positivo.
 *
 * Límite conocido y asumido: el servidor tiene su clave, así que puede
 * precalcular identificadores de contraseñas que él elija y ver cuáles están en
 * su propio índice. Lo que no puede es saber cuál consultaste tú. Eso es
 * inherente a cualquier construcción de este tipo, no un defecto de esta.
 */
export class BreachOracle {
  readonly #secretKey: SecretBuffer;
  readonly #publicKey: Uint8Array;

  private constructor(secretKey: Uint8Array, publicKey: Uint8Array) {
    this.#secretKey = SecretBuffer.wrap(secretKey);
    this.#publicKey = publicKey;
  }

  static create(): BreachOracle {
    const { secretKey, publicKey } = VOPRF.generateKeyPair();
    return new BreachOracle(secretKey, publicKey);
  }

  /**
   * Deriva el par de claves de una semilla. Un índice solo sirve con la clave
   * con la que se construyó, así que reproducirla es lo que permite reconstruir
   * el servicio sin rehacer el índice entero.
   */
  static fromSeed(seed: SecretBuffer | Uint8Array): BreachOracle {
    const bytes = seed instanceof Uint8Array ? seed : seed.bytes;
    if (bytes.length < 32) {
      throw new InvalidInputError("la semilla del oráculo debe tener al menos 32 bytes");
    }
    const { secretKey, publicKey } = VOPRF.deriveKeyPair(bytes, utf8Encode(DOMINIO_CONSULTA));
    return new BreachOracle(secretKey, publicKey);
  }

  /** Clave pública del servicio. El cliente la necesita para verificar la prueba. */
  get publicKey(): Uint8Array {
    return Uint8Array.from(this.#publicKey);
  }

  /**
   * Precalcula el índice a partir de un corpus de contraseñas filtradas.
   *
   * En un despliegue real se hace una vez, en el servidor, sobre los volcados
   * públicos. El índice resultante no contiene contraseñas: solo
   * identificadores bajo la clave del servidor.
   */
  indexBreachedPasswords(passwords: Iterable<string>): BreachedSet {
    const identifiers = new Set<string>();
    for (const password of passwords) {
      identifiers.add(identificador(evaluarDirecto(this.#secretKey.bytes, entradaOprf(password))));
    }
    return { identifiers, size: identifiers.size };
  }

  /**
   * Evalúa el punto cegado y demuestra que lo hizo con su clave. Es la única
   * operación por consulta, y en ella no ve nada del texto original.
   */
  blindEvaluate(query: BreachQuery): BreachResponse {
    if (query.blinded.length !== 32) {
      throw new InvalidInputError("el elemento cegado debe tener 32 bytes");
    }
    const { evaluated, proof } = VOPRF.blindEvaluate(
      this.#secretKey.bytes,
      this.#publicKey,
      query.blinded,
    );
    return { evaluated, proof };
  }

  destroy(): void {
    this.#secretKey.destroy();
  }
}

/** Lado cliente: ciega, envía, verifica, descega y compara en local. */
export class BreachClient {
  /** Paso 1: ciega la contraseña. Solo `query` debe salir del dispositivo. */
  prepare(password: string | SecretBuffer): PreparedBreachQuery {
    const input = entradaOprf(password);
    const { blind, blinded } = VOPRF.blind(input);
    return { query: { blinded }, blind, input };
  }

  /**
   * Paso 3: verifica la prueba, descega y compara contra el índice.
   *
   * Si la prueba no cuadra se lanza `BreachProofError` en vez de devolver "no
   * filtrada": un fallo silencioso aquí sería exactamente el resultado que
   * busca un servidor que quiere que te confíes.
   */
  finish(
    prepared: PreparedBreachQuery,
    response: BreachResponse,
    publicKey: Uint8Array,
    breached: BreachedSet,
  ): BreachResult {
    let salida: Uint8Array;
    try {
      salida = VOPRF.finalize(
        prepared.input,
        prepared.blind,
        response.evaluated,
        prepared.query.blinded,
        publicKey,
        response.proof,
      );
    } catch {
      throw new BreachProofError();
    }
    const id = identificador(salida);
    return { filtrada: breached.identifiers.has(id), identificador: id };
  }
}

/**
 * Ejecuta el protocolo completo contra un oráculo local.
 *
 * Atajo para pruebas y para uso sin conexión con un índice ya descargado; en
 * producción los pasos los separa la red, que es donde el cegado importa.
 */
export function checkPasswordAgainstBreaches(
  oracle: BreachOracle,
  breached: BreachedSet,
  password: string | SecretBuffer,
): BreachResult {
  const client = new BreachClient();
  const prepared = client.prepare(password);
  return client.finish(prepared, oracle.blindEvaluate(prepared.query), oracle.publicKey, breached);
}

/** Comprueba varias contraseñas, con una consulta independiente por cada una. */
export function checkPasswordsAgainstBreaches(
  oracle: BreachOracle,
  breached: BreachedSet,
  passwords: readonly (string | SecretBuffer)[],
): BreachResult[] {
  return passwords.map((password) => checkPasswordAgainstBreaches(oracle, breached, password));
}

/**
 * Consultas señuelo para difuminar el patrón de tráfico.
 *
 * Aunque el servidor no vea el contenido, sí ve *cuántas* consultas haces y
 * cuándo. Intercalar consultas de contraseñas inventadas emborrona esa señal,
 * que es la última que queda en el canal.
 */
export function decoyQueries(cantidad: number): PreparedBreachQuery[] {
  const client = new BreachClient();
  return Array.from({ length: cantidad }, () => {
    const relleno = SecretBuffer.wrap(randomBytes(32));
    try {
      return client.prepare(relleno);
    } finally {
      relleno.destroy();
    }
  });
}
