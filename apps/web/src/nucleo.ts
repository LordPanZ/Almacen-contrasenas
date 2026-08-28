import type { Argon2Profile } from "@cerbero/crypto";
import type { VaultItemDraft, VaultItemType } from "@cerbero/vault";

/**
 * Puente con el worker criptográfico.
 *
 * Una sola instancia para toda la aplicación: la bóveda abierta vive dentro del
 * worker y no debe haber dos copias del estado sensible.
 */
const worker = new Worker(new URL("./boveda.worker.ts", import.meta.url), { type: "module" });

let siguienteId = 1;
const pendientes = new Map<number, { ok: (v: unknown) => void; fallo: (e: Error) => void }>();

worker.addEventListener("message", (evento: MessageEvent) => {
  const { id, ok, resultado, error } = evento.data as {
    id: number;
    ok: boolean;
    resultado?: unknown;
    error?: string;
  };
  const pendiente = pendientes.get(id);
  if (!pendiente) return;
  pendientes.delete(id);
  if (ok) pendiente.ok(resultado);
  else pendiente.fallo(new Error(error ?? "fallo desconocido en el worker"));
});

function llamar<T>(operacion: string, carga: unknown = {}): Promise<T> {
  const id = siguienteId++;
  return new Promise<T>((resolve, reject) => {
    pendientes.set(id, { ok: resolve as (v: unknown) => void, fallo: reject });
    worker.postMessage({ id, operacion, carga });
  });
}

export interface ResumenBoveda {
  readonly vaultId: string;
  readonly ranuras: number;
  readonly tamanoRanura: number;
  readonly usados: number;
  readonly capacidad: number;
  readonly entradas: number;
}

export interface FilaEntrada {
  readonly id: string;
  readonly tipo: VaultItemType;
  readonly titulo: string;
  readonly usuario: string;
  readonly url: string;
  readonly etiquetas: readonly string[];
  readonly actualizado: number;
  readonly trampa: boolean;
  readonly bits: number;
}

export interface Fuerza {
  readonly bits: number;
  readonly veredicto: string;
  readonly avisos: readonly string[];
  readonly consejos: readonly string[];
}

export interface DetalleEntrada {
  readonly item: {
    id: string;
    type: VaultItemType;
    title: string;
    username: string;
    secret: string;
    url: string;
    notes: string;
    tags: readonly string[];
    createdAt: number;
    updatedAt: number;
  };
  readonly trampa: boolean;
  readonly fuerza: Fuerza | null;
}

export interface InfoFichero {
  readonly version: number;
  readonly ranuras: number;
  readonly tamanoRanura: number;
  readonly argon2: Argon2Profile;
  readonly sal: string;
  readonly bytes: number;
}

export interface FilaFiltracion {
  readonly id: string;
  readonly titulo: string;
  readonly filtrada: boolean;
  readonly bits: number;
  readonly veredicto: string;
  readonly avisos: readonly string[];
}

export interface EntradaAuditoria {
  readonly indice: number;
  readonly momento: number;
  readonly tipo: string;
}

export const nucleo = {
  crear: (password: string, perfil: string, ranuras: number) =>
    llamar<{ resumen: ResumenBoveda; fichero: Uint8Array }>("crear", { password, perfil, ranuras }),
  abrir: (fichero: Uint8Array, password: string) =>
    llamar<{ resumen: ResumenBoveda }>("abrir", { fichero, password }),
  inspeccionar: (fichero: Uint8Array) => llamar<InfoFichero>("inspeccionar", { fichero }),
  listar: () => llamar<{ filas: FilaEntrada[] }>("listar"),
  obtener: (id: string) => llamar<DetalleEntrada>("obtener", { id }),
  anadir: (draft: VaultItemDraft) =>
    llamar<{ fichero: Uint8Array; filas: FilaEntrada[]; id: string }>("anadir", { draft }),
  actualizar: (id: string, patch: Partial<VaultItemDraft>) =>
    llamar<{ fichero: Uint8Array; filas: FilaEntrada[] }>("actualizar", { id, patch }),
  borrar: (id: string) =>
    llamar<{ fichero: Uint8Array; filas: FilaEntrada[] }>("borrar", { id }),
  sembrarCanarios: (cantidad: number) =>
    llamar<{ fichero: Uint8Array; filas: FilaEntrada[] }>("sembrarCanarios", { cantidad }),
  coaccion: (actual: string, nueva: string, anteriores: readonly string[]) =>
    llamar<{ fichero: Uint8Array }>("coaccion", { actual, nueva, anteriores }),
  filtraciones: () => llamar<{ filas: FilaFiltracion[]; corpus: number }>("filtraciones"),
  auditoria: () =>
    llamar<{ tamano: number; raiz: string; entradas: EntradaAuditoria[] }>("auditoria"),
  verificarAuditoria: () =>
    llamar<{ verificadas: number; fallos: number[] }>("verificarAuditoria"),
  generar: (frase: boolean, longitud: number, palabras: number) =>
    llamar<{ valor: string; fuerza: Fuerza }>("generar", { frase, longitud, palabras }),
  evaluar: (password: string) => llamar<{ fuerza: Fuerza }>("evaluar", { password }),
  cerrar: () => llamar<{ cerrada: boolean }>("cerrar"),
};

/* ─── Persistencia local ───────────────────────────────────────────────── */

const BASE = "cerbero";
const ALMACEN = "bovedas";
const CLAVE = "actual";

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN);
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error ?? new Error("no se pudo abrir IndexedDB"));
  });
}

/**
 * Guarda el fichero cifrado en IndexedDB.
 *
 * Lo que se guarda es el fichero tal cual, ya cifrado: el navegador almacena
 * exactamente lo mismo que habría en el disco, sin claves ni nada descifrado.
 * Aun así es una comodidad, no una copia de seguridad: limpiar los datos del
 * sitio lo borra, así que la app insiste en exportar el fichero.
 */
export async function guardarLocal(fichero: Uint8Array): Promise<void> {
  const base = await abrirBase();
  await new Promise<void>((resolve, reject) => {
    const tx = base.transaction(ALMACEN, "readwrite");
    tx.objectStore(ALMACEN).put(fichero, CLAVE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("no se pudo guardar"));
  });
  base.close();
}

export async function leerLocal(): Promise<Uint8Array | null> {
  try {
    const base = await abrirBase();
    const resultado = await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = base.transaction(ALMACEN, "readonly");
      const peticion = tx.objectStore(ALMACEN).get(CLAVE);
      peticion.onsuccess = () => resolve((peticion.result as Uint8Array | undefined) ?? null);
      peticion.onerror = () => reject(peticion.error);
    });
    base.close();
    return resultado;
  } catch {
    // Ventana privada, almacenamiento bloqueado… La app debe seguir siendo
    // usable importando el fichero a mano.
    return null;
  }
}

export async function olvidarLocal(): Promise<void> {
  try {
    const base = await abrirBase();
    await new Promise<void>((resolve) => {
      const tx = base.transaction(ALMACEN, "readwrite");
      tx.objectStore(ALMACEN).delete(CLAVE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    base.close();
  } catch {
    /* nada que borrar */
  }
}

/** Descarga el fichero de bóveda. Es la copia de seguridad de verdad. */
export function descargar(fichero: Uint8Array, nombre = "boveda.cerbero"): void {
  // Copia sobre un ArrayBuffer propio: el Uint8Array que llega del worker puede
  // estar respaldado por un buffer compartido, que Blob no acepta.
  const copia = new Uint8Array(fichero.length);
  copia.set(fichero);
  const url = URL.createObjectURL(new Blob([copia.buffer], { type: "application/octet-stream" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}

export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatearFecha(momento: number): string {
  return new Date(momento).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type { VaultItemDraft, VaultItemType };
