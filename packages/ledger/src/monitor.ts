import { constantTimeEqual, HYBRID_SIGNATURE, InvalidInputError } from "@cerbero/crypto";
import { verifyConsistency } from "./merkle.ts";
import { verifySignedTreeHead } from "./sth.ts";
import type { SignedTreeHead } from "./sth.ts";

/**
 * Veredicto sobre una cabecera recién recibida.
 *
 * Los tres estados de fallo son transferibles: el cliente conserva la cabecera
 * anterior y la nueva, ambas firmadas, y esa pareja es por sí sola la prueba de
 * que el servidor mintió. No hace falta creer al usuario.
 */
export type MonitorVerdict =
  | {
      readonly estado: "ok";
      readonly size: number;
      readonly rootHash: Uint8Array;
      /** Entradas añadidas desde la última cabecera aceptada. */
      readonly nuevasEntradas: number;
    }
  | {
      readonly estado: "retroceso";
      readonly motivo: string;
      readonly sizePrevio: number;
      readonly sizeRecibido: number;
    }
  | {
      readonly estado: "bifurcacion";
      readonly motivo: string;
      readonly sizePrevio: number;
      readonly rootPrevio: Uint8Array;
      readonly sizeRecibido: number;
      readonly rootRecibido: Uint8Array;
    }
  | {
      readonly estado: "firma-invalida";
      readonly motivo: string;
    };

/**
 * Monitor cliente: lo que convierte el árbol en una defensa real.
 *
 * Un registro Merkle firmado no sirve de nada si nadie recuerda lo que ya vio.
 * El monitor **fija** la clave pública de firma y **retiene la última cabecera
 * aceptada**, y con esas dos cosas cierra los tres engaños del servidor:
 *
 * - **Retroceso**: el árbol nunca encoge ni retrocede en el tiempo. Una
 *   cabecera con menos entradas —o con una marca de tiempo anterior a la última
 *   vista— es una versión antigua reservida para ocultar lo que pasó después.
 * - **Bifurcación**: dos historiales distintos para el mismo registro. Se
 *   manifiesta o bien como el mismo tamaño con raíz distinta, o bien como una
 *   prueba de consistencia que no reconstruye la raíz que el cliente ya vio.
 * - **Sustitución de la clave de firma**: la clave se fija al construir el
 *   monitor y no se renegocia jamás. Un servidor que genere un registro nuevo
 *   con otra clave produce cabeceras que sencillamente no verifican, por
 *   impecable que sea el árbol que hay detrás.
 *
 * Lo único que el monitor no puede detectar por sí solo es una bifurcación
 * mantenida de forma consistente contra *este* dispositivo desde el principio:
 * para eso hay que comparar cabeceras con otro dispositivo (o con un testigo),
 * y ahí es donde `observe` se usa sobre la cabecera ajena.
 */
export class LedgerMonitor {
  readonly #publicKey: Uint8Array;
  #latest: SignedTreeHead | undefined;

  constructor(publicKey: Uint8Array, trusted?: SignedTreeHead) {
    if (publicKey.length !== HYBRID_SIGNATURE.publicKeyLength) {
      throw new InvalidInputError("longitud de clave pública de firma incorrecta");
    }
    this.#publicKey = Uint8Array.from(publicKey);
    if (trusted !== undefined) {
      // Una cabecera inicial que ni siquiera verifica no es un punto de
      // partida: aceptarla dejaría al monitor anclado a una mentira.
      if (!verifySignedTreeHead(this.#publicKey, trusted)) {
        throw new InvalidInputError("la cabecera inicial no está firmada por la clave fijada");
      }
      this.#latest = freeze(trusted);
    }
  }

  get publicKey(): Uint8Array {
    return Uint8Array.from(this.#publicKey);
  }

  /** Última cabecera aceptada, o `undefined` si aún no se ha visto ninguna. */
  get latest(): SignedTreeHead | undefined {
    return this.#latest === undefined ? undefined : freeze(this.#latest);
  }

  /**
   * Contrasta una cabecera nueva contra la última aceptada. El estado interno
   * solo avanza cuando el veredicto es `ok`: un intento de engaño no puede
   * dejar al monitor con una referencia peor que la que tenía.
   */
  observe(sth: SignedTreeHead, consistencyProof: readonly Uint8Array[] = []): MonitorVerdict {
    // Primero la firma: una cabecera no autenticada no merece ni que se la
    // compare, y además es aquí donde salta la clave sustituida.
    if (!verifySignedTreeHead(this.#publicKey, sth)) {
      return {
        estado: "firma-invalida",
        motivo:
          "la cabecera no verifica bajo la clave fijada: está forjada o el servidor cambió de clave de firma",
      };
    }

    const previous = this.#latest;
    if (previous === undefined) {
      this.#latest = freeze(sth);
      return {
        estado: "ok",
        size: sth.size,
        rootHash: Uint8Array.from(sth.rootHash),
        nuevasEntradas: sth.size,
      };
    }

    if (sth.size < previous.size) {
      return {
        estado: "retroceso",
        motivo: `el registro pasó de ${previous.size} a ${sth.size} entradas: un árbol append-only nunca encoge`,
        sizePrevio: previous.size,
        sizeRecibido: sth.size,
      };
    }

    if (sth.timestamp < previous.timestamp) {
      return {
        estado: "retroceso",
        motivo: "la cabecera es anterior a la última aceptada: el servidor está reproduciendo una vista antigua",
        sizePrevio: previous.size,
        sizeRecibido: sth.size,
      };
    }

    if (sth.size === previous.size) {
      // Mismo tamaño y raíz distinta: el servidor firmó dos historiales
      // incompatibles. No hay explicación benigna posible.
      if (!constantTimeEqual(sth.rootHash, previous.rootHash)) {
        return this.#forkVerdict(
          previous,
          sth,
          "dos cabeceras firmadas con el mismo tamaño y raíces distintas",
        );
      }
      return {
        estado: "ok",
        size: sth.size,
        rootHash: Uint8Array.from(sth.rootHash),
        nuevasEntradas: 0,
      };
    }

    // El árbol creció: exigimos la demostración de que lo ya visto sigue
    // intacto dentro del nuevo. Sin esta comprobación, el servidor podría
    // reescribir el pasado con solo añadir entradas encima.
    if (
      !verifyConsistency(
        previous.rootHash,
        previous.size,
        sth.rootHash,
        sth.size,
        consistencyProof,
      )
    ) {
      return this.#forkVerdict(
        previous,
        sth,
        `la prueba de consistencia ${previous.size} -> ${sth.size} no reconstruye la raíz ya vista: el historial fue reescrito`,
      );
    }

    this.#latest = freeze(sth);
    return {
      estado: "ok",
      size: sth.size,
      rootHash: Uint8Array.from(sth.rootHash),
      nuevasEntradas: sth.size - previous.size,
    };
  }

  #forkVerdict(previous: SignedTreeHead, sth: SignedTreeHead, motivo: string): MonitorVerdict {
    return {
      estado: "bifurcacion",
      motivo,
      sizePrevio: previous.size,
      rootPrevio: Uint8Array.from(previous.rootHash),
      sizeRecibido: sth.size,
      rootRecibido: Uint8Array.from(sth.rootHash),
    };
  }
}

/** Copia inmutable: el monitor no debe compartir buffers con quien le llama. */
function freeze(sth: SignedTreeHead): SignedTreeHead {
  return Object.freeze({
    size: sth.size,
    rootHash: Uint8Array.from(sth.rootHash),
    timestamp: sth.timestamp,
    signature: Uint8Array.from(sth.signature),
  });
}
