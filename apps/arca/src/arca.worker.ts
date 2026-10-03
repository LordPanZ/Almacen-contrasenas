import {
  Caja,
  abrirCaja,
  cambiarPassword,
  crearCaja,
  indiceVacio,
  inspeccionarPaquete,
  nuevoIdDocumento,
  preambuloPaquete,
  prefijoDocumento,
  type DocumentoMeta,
  type Indice,
} from "@cerbero/arca";
import { SecretBuffer } from "@cerbero/crypto";
import { estimateStrength } from "@cerbero/sentinel";
import * as almacen from "./almacen.ts";
import type { Biblioteca, NuevoDocumento, PerfilArgon2, Uso } from "./tipos.ts";

/**
 * Trabajador criptográfico de Arca.
 *
 * Es el único sitio donde viven las claves y donde se toca el almacén: la
 * interfaz nunca recibe la clave de datos ni un criptograma. Además el Argon2 de
 * desbloquear (~10 s) bloquearía la pantalla si corriera en el hilo principal.
 */

/** Otra pestaña ha cambiado la caja desde que esta la leyó. */
class CajaModificadaError extends Error {
  constructor() {
    super(
      "La caja se modificó desde otra pestaña. Recarga la página y vuelve a desbloquearla para no perder cambios.",
    );
    this.name = "CajaModificadaError";
  }
}

let caja: Caja | null = null;
let indice: Indice | null = null;

function exigir(): { caja: Caja; indice: Indice } {
  if (!caja || !indice) throw new Error("La caja está bloqueada.");
  return { caja, indice };
}

function cerrarInterno(): void {
  caja?.bloquear();
  caja = null;
  indice = null;
}

/** Guarda un índice nuevo comprobando que nadie más tocó el de disco. */
async function guardarIndice(nuevo: Indice): Promise<void> {
  const { caja: c, indice: actual } = exigir();
  await almacen.guardarIndiceSi(c.sellarIndice(nuevo), (enDisco) => {
    if (!enDisco || c.abrirIndice(enDisco).revision !== actual.revision) {
      throw new CajaModificadaError();
    }
  });
  indice = nuevo;
}

async function biblioteca(): Promise<Biblioteca> {
  const { indice: i } = exigir();
  const presentes = new Set(await almacen.idsDocs());
  return {
    documentos: i.documentos,
    faltan: i.documentos.filter((d) => !presentes.has(d.id)).map((d) => d.id),
  };
}

function limpiarNombre(nombre: string): string {
  const limpio = nombre.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, 200);
  return limpio === "" ? "documento" : limpio;
}

/** `Blob` solo admite vistas sobre `ArrayBuffer`; las nuestras nunca lo son sobre uno compartido. */
const comoParte = (bytes: Uint8Array): BlobPart => bytes as unknown as BlobPart;

/** Devuelve el valor y marca qué buffers deben transferirse en vez de copiarse. */
class Transferir<T> {
  constructor(
    readonly valor: T,
    readonly buffers: Transferable[],
  ) {}
}

const operaciones: Record<string, (carga: never) => unknown> = {
  estado: async () => ({ existe: await almacen.existeCaja(), abierta: caja !== null }),

  evaluar: ({ password }: { password: string }) => ({ fuerza: estimateStrength(password) }),

  crear: async ({ password, perfil }: { password: string; perfil: PerfilArgon2 }) => {
    if (await almacen.existeCaja()) {
      throw new Error("Ya hay una caja en este navegador. Desbloquéala o bórrala antes de crear otra.");
    }
    const clave = SecretBuffer.fromText(password);
    try {
      const creada = crearCaja(clave, { perfil });
      const vacio = indiceVacio();
      await almacen.escribirCaja(creada.cabecera, creada.caja.sellarIndice(vacio));
      cerrarInterno();
      caja = creada.caja;
      indice = vacio;
    } finally {
      clave.destroy();
    }
    return biblioteca();
  },

  abrir: async ({ password }: { password: string }) => {
    const { cabecera, indice: sellado } = await almacen.leerCaja();
    if (!cabecera || !sellado) throw new Error("No hay ninguna caja en este navegador.");
    const clave = SecretBuffer.fromText(password);
    let abierta: Caja;
    try {
      abierta = abrirCaja(cabecera, clave);
    } finally {
      clave.destroy();
    }
    try {
      const leido = abierta.abrirIndice(sellado);
      cerrarInterno();
      caja = abierta;
      indice = leido;
    } catch (error) {
      abierta.bloquear();
      throw error;
    }
    return biblioteca();
  },

  listar: () => biblioteca(),

  anadir: async ({ nombre, mime, categoria, notas, datos }: NuevoDocumento) => {
    const { caja: c, indice: i } = exigir();
    const bytes = new Uint8Array(datos);
    const tam = bytes.length;
    const id = nuevoIdDocumento();
    let sellado: Uint8Array;
    try {
      sellado = c.sellarDocumento(id, bytes);
    } finally {
      bytes.fill(0);
    }
    await almacen.guardarDoc(id, sellado);
    const ahora = Date.now();
    const meta: DocumentoMeta = {
      id,
      nombre: limpiarNombre(nombre),
      mime: mime || "application/octet-stream",
      tam,
      categoria,
      notas,
      creado: ahora,
      actualizado: ahora,
    };
    try {
      await guardarIndice({ version: 1, revision: i.revision + 1, documentos: [...i.documentos, meta] });
    } catch (error) {
      // El documento llegó a guardarse pero nada lo referencia: se retira.
      await almacen.borrarDoc(id).catch(() => undefined);
      throw error;
    }
    return biblioteca();
  },

  leer: async ({ id }: { id: string }) => {
    const { caja: c, indice: i } = exigir();
    const meta = i.documentos.find((d) => d.id === id);
    if (!meta) throw new Error("Ese documento ya no existe.");
    const sellado = await almacen.leerDoc(id);
    if (!sellado) {
      throw new Error(
        "Este documento no está en este navegador. Si restauraste una copia, comprueba que sea la completa.",
      );
    }
    const bytes = c.abrirDocumento(id, sellado);
    return new Transferir({ meta, datos: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer]);
  },

  editar: async ({
    id,
    nombre,
    categoria,
    notas,
  }: {
    id: string;
    nombre: string;
    categoria: string;
    notas: string;
  }) => {
    const { indice: i } = exigir();
    if (!i.documentos.some((d) => d.id === id)) throw new Error("Ese documento ya no existe.");
    const documentos = i.documentos.map((d) =>
      d.id === id ? { ...d, nombre: limpiarNombre(nombre), categoria, notas, actualizado: Date.now() } : d,
    );
    await guardarIndice({ version: 1, revision: i.revision + 1, documentos });
    return biblioteca();
  },

  borrar: async ({ id }: { id: string }) => {
    const { indice: i } = exigir();
    if (!i.documentos.some((d) => d.id === id)) throw new Error("Ese documento ya no existe.");
    // El índice primero: si algo falla después, queda un criptograma sin dueño
    // (que se puede liberar), y no una entrada que apunta a nada.
    await guardarIndice({
      version: 1,
      revision: i.revision + 1,
      documentos: i.documentos.filter((d) => d.id !== id),
    });
    await almacen.borrarDoc(id).catch(() => undefined);
    return biblioteca();
  },

  uso: async (): Promise<Uso> => {
    const { indice: i } = exigir();
    const enIndice = new Set(i.documentos.map((d) => d.id));
    const todos = await almacen.idsDocs();
    const huerfanos = todos.filter((id) => !enIndice.has(id));
    return {
      documentos: i.documentos.length,
      bytesOriginales: i.documentos.reduce((n, d) => n + d.tam, 0),
      bytesEnNavegador: await almacen.tamanoDocs(todos.filter((id) => enIndice.has(id))),
      huerfanos: huerfanos.length,
      bytesHuerfanos: await almacen.tamanoDocs(huerfanos),
    };
  },

  liberar: async () => {
    const { indice: i } = exigir();
    const enIndice = new Set(i.documentos.map((d) => d.id));
    for (const id of await almacen.idsDocs()) if (!enIndice.has(id)) await almacen.borrarDoc(id);
    return true;
  },

  cambiarPassword: async ({
    actual,
    nueva,
    perfil,
  }: {
    actual: string;
    nueva: string;
    perfil?: PerfilArgon2;
  }) => {
    exigir();
    const { cabecera } = await almacen.leerCaja();
    if (!cabecera) throw new Error("No hay ninguna caja en este navegador.");
    const a = SecretBuffer.fromText(actual);
    const n = SecretBuffer.fromText(nueva);
    try {
      const nuevaCabecera = cambiarPassword(cabecera, a, n, perfil ? { perfil } : {});
      await almacen.escribirCabecera(nuevaCabecera);
    } finally {
      a.destroy();
      n.destroy();
    }
    return true;
  },

  /** Toda la caja en un solo fichero. Los documentos se encadenan como `Blob`, sin copiarlos a la vez en memoria. */
  exportar: async () => {
    const { indice: i } = exigir();
    const { cabecera, indice: sellado } = await almacen.leerCaja();
    if (!cabecera || !sellado) throw new Error("No hay ninguna caja en este navegador.");
    const partes: BlobPart[] = [comoParte(preambuloPaquete(cabecera, sellado, i.documentos.length))];
    for (const d of i.documentos) {
      const cifrado = await almacen.leerDoc(d.id);
      if (!cifrado) {
        throw new Error(
          `Falta «${d.nombre}» en este navegador: no se puede hacer una copia completa. Quítalo de la lista o restaura una copia que lo tenga.`,
        );
      }
      partes.push(comoParte(prefijoDocumento(d.id, cifrado.length)), new Blob([comoParte(cifrado)]));
    }
    const fecha = new Date().toISOString().slice(0, 10);
    return {
      archivo: new Blob(partes, { type: "application/octet-stream" }),
      nombre: `arca-${fecha}.arca`,
      documentos: i.documentos.length,
    };
  },

  /**
   * Sustituye la caja de este navegador por una copia.
   *
   * Primero se valida la copia entera sin escribir nada; después los documentos
   * y, **al final**, cabecera e índice en una transacción. Mientras no se
   * escriben estos dos, la caja anterior sigue siendo la que hay: una copia
   * cortada no deja nada a medias.
   */
  restaurar: async ({ archivo }: { archivo: Blob }) => {
    const paquete = await inspeccionarPaquete({
      tamano: archivo.size,
      leer: async (desde, cuantos) => new Uint8Array(await archivo.slice(desde, desde + cuantos).arrayBuffer()),
    });
    cerrarInterno();
    for (const registro of paquete.documentos) {
      const cifrado = new Uint8Array(
        await archivo.slice(registro.desde, registro.desde + registro.tam).arrayBuffer(),
      );
      await almacen.guardarDoc(registro.id, cifrado);
    }
    await almacen.escribirCaja(paquete.cabecera, paquete.indice);
    return { documentos: paquete.documentos.length };
  },

  borrarTodo: async () => {
    cerrarInterno();
    await almacen.vaciar();
    return true;
  },

  cerrar: () => {
    cerrarInterno();
    return true;
  },
};

self.addEventListener("message", (evento: MessageEvent) => {
  const { id, operacion, carga } = evento.data as { id: number; operacion: string; carga: unknown };
  const manejador = operaciones[operacion];
  if (!manejador) {
    self.postMessage({ id, ok: false, error: `operación desconocida: ${operacion}` });
    return;
  }
  Promise.resolve()
    .then(() => manejador(carga as never))
    .then((resultado) => {
      if (resultado instanceof Transferir) {
        self.postMessage({ id, ok: true, resultado: resultado.valor }, resultado.buffers);
      } else {
        self.postMessage({ id, ok: true, resultado });
      }
    })
    .catch((error: unknown) => {
      const e = error instanceof Error ? error : new Error(String(error));
      self.postMessage({ id, ok: false, error: e.message, tipo: e.name });
    });
});
