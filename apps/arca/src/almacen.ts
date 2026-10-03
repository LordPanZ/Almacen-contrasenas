/**
 * Almacenamiento de la caja en IndexedDB.
 *
 * Dos almacenes: `caja`, con la cabecera y el índice cifrado, y `docs`, con un
 * criptograma por documento indexado por su identificador. Lo que se guarda es
 * exactamente lo que habría en la copia de seguridad: nada en claro.
 *
 * Aquí un fallo **no** se traga. Que guardar un documento falle sin avisar es
 * perder un escrito de propiedad con apariencia de éxito.
 */

const BASE = "arca";
const CAJA = "caja";
const DOCS = "docs";
const K_CABECERA = "cabecera";
const K_INDICE = "indice";

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => {
      const base = peticion.result;
      if (!base.objectStoreNames.contains(CAJA)) base.createObjectStore(CAJA);
      if (!base.objectStoreNames.contains(DOCS)) base.createObjectStore(DOCS);
    };
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error ?? new Error("no se pudo abrir el almacén del navegador"));
    peticion.onblocked = () => reject(new Error("el almacén del navegador está bloqueado por otra pestaña"));
  });
}

/**
 * Ejecuta una transacción y resuelve cuando **termina** de verdad, no cuando
 * responde la petición: es lo que garantiza que lo escrito está guardado.
 */
async function transaccion<T>(
  almacenes: string[],
  modo: IDBTransactionMode,
  fn: (tx: IDBTransaction, terminar: (valor: T) => void, fallar: (e: unknown) => void) => void,
): Promise<T> {
  const base = await abrirBase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = base.transaction(almacenes, modo);
      let valor: T | undefined;
      let fallo: unknown;
      tx.oncomplete = () => resolve(valor as T);
      tx.onabort = () => reject(fallo ?? tx.error ?? new Error("se canceló la operación"));
      tx.onerror = () => {
        fallo ??= tx.error;
      };
      fn(
        tx,
        (v) => {
          valor = v;
        },
        (e) => {
          fallo = e;
          try {
            tx.abort();
          } catch {
            /* ya estaba abortada */
          }
        },
      );
    });
  } finally {
    base.close();
  }
}

export interface CajaGuardada {
  readonly cabecera: Uint8Array | null;
  readonly indice: Uint8Array | null;
}

export function leerCaja(): Promise<CajaGuardada> {
  return transaccion<CajaGuardada>([CAJA], "readonly", (tx, terminar) => {
    const almacen = tx.objectStore(CAJA);
    const cab = almacen.get(K_CABECERA);
    const idx = almacen.get(K_INDICE);
    // Las peticiones de una transacción terminan en orden: cuando responde la
    // segunda, la primera ya tiene resultado.
    idx.onsuccess = () =>
      terminar({
        cabecera: (cab.result as Uint8Array | undefined) ?? null,
        indice: (idx.result as Uint8Array | undefined) ?? null,
      });
  });
}

export async function existeCaja(): Promise<boolean> {
  const { cabecera } = await leerCaja();
  return cabecera !== null;
}

/** Escribe cabecera e índice en una sola transacción: o quedan los dos o ninguno. */
export function escribirCaja(cabecera: Uint8Array, indice: Uint8Array): Promise<void> {
  return transaccion<void>([CAJA], "readwrite", (tx) => {
    const almacen = tx.objectStore(CAJA);
    almacen.put(cabecera, K_CABECERA);
    almacen.put(indice, K_INDICE);
  });
}

export function escribirCabecera(cabecera: Uint8Array): Promise<void> {
  return transaccion<void>([CAJA], "readwrite", (tx) => {
    tx.objectStore(CAJA).put(cabecera, K_CABECERA);
  });
}

/**
 * Guarda el índice solo si `comprobar` da por buena la versión que hay en disco.
 *
 * Comprobar y escribir van en la misma transacción: entre medias no puede
 * colarse otra pestaña. `comprobar` es síncrona a propósito (descifrar un índice
 * lo es), porque una transacción de IndexedDB se cierra sola si se espera algo
 * que no sea suyo.
 */
export function guardarIndiceSi(
  nuevo: Uint8Array,
  comprobar: (actual: Uint8Array | null) => void,
): Promise<void> {
  return transaccion<void>([CAJA], "readwrite", (tx, _terminar, fallar) => {
    const almacen = tx.objectStore(CAJA);
    const lectura = almacen.get(K_INDICE);
    lectura.onsuccess = () => {
      try {
        comprobar((lectura.result as Uint8Array | undefined) ?? null);
      } catch (error) {
        fallar(error);
        return;
      }
      almacen.put(nuevo, K_INDICE);
    };
  });
}

export function guardarDoc(id: string, sellado: Uint8Array): Promise<void> {
  return transaccion<void>([DOCS], "readwrite", (tx) => {
    tx.objectStore(DOCS).put(sellado, id);
  });
}

export function leerDoc(id: string): Promise<Uint8Array | null> {
  return transaccion<Uint8Array | null>([DOCS], "readonly", (tx, terminar) => {
    const lectura = tx.objectStore(DOCS).get(id);
    lectura.onsuccess = () => terminar((lectura.result as Uint8Array | undefined) ?? null);
  });
}

export function borrarDoc(id: string): Promise<void> {
  return transaccion<void>([DOCS], "readwrite", (tx) => {
    tx.objectStore(DOCS).delete(id);
  });
}

export function idsDocs(): Promise<string[]> {
  return transaccion<string[]>([DOCS], "readonly", (tx, terminar) => {
    const lectura = tx.objectStore(DOCS).getAllKeys();
    lectura.onsuccess = () => terminar(lectura.result.map(String));
  });
}

/** Cuántos bytes ocupan los documentos indicados, leyéndolos de uno en uno. */
export function tamanoDocs(ids: readonly string[]): Promise<number> {
  const quiero = new Set(ids);
  return transaccion<number>([DOCS], "readonly", (tx, terminar) => {
    let total = 0;
    const cursor = tx.objectStore(DOCS).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) {
        terminar(total);
        return;
      }
      if (quiero.has(String(c.key))) total += (c.value as Uint8Array).byteLength;
      c.continue();
    };
  });
}

/** Borra todo lo de este navegador: la caja y sus documentos. */
export function vaciar(): Promise<void> {
  return transaccion<void>([CAJA, DOCS], "readwrite", (tx) => {
    tx.objectStore(CAJA).clear();
    tx.objectStore(DOCS).clear();
  });
}
