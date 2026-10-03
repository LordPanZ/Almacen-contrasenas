import ArcaWorker from "./arca.worker.ts?worker&inline";
import type {
  Biblioteca,
  EstadoCaja,
  Fuerza,
  NuevoDocumento,
  PerfilArgon2,
  Uso,
  DocumentoMeta,
} from "./tipos.ts";

/**
 * Puente con el trabajador criptográfico.
 *
 * Una sola instancia: la caja abierta vive dentro del trabajador y no debe haber
 * dos copias del estado sensible.
 */
const worker = new ArcaWorker();

let siguienteId = 1;
const pendientes = new Map<number, { ok: (v: unknown) => void; fallo: (e: Error) => void }>();

worker.addEventListener("message", (evento: MessageEvent) => {
  const { id, ok, resultado, error, tipo } = evento.data as {
    id: number;
    ok: boolean;
    resultado?: unknown;
    error?: string;
    tipo?: string;
  };
  const pendiente = pendientes.get(id);
  if (!pendiente) return;
  pendientes.delete(id);
  if (ok) {
    pendiente.ok(resultado);
  } else {
    const e = new Error(error ?? "fallo desconocido en el trabajador");
    if (tipo) e.name = tipo;
    pendiente.fallo(e);
  }
});

function llamar<T>(operacion: string, carga: unknown = {}, transferibles: Transferable[] = []): Promise<T> {
  const id = siguienteId++;
  return new Promise<T>((resolve, reject) => {
    pendientes.set(id, { ok: resolve as (v: unknown) => void, fallo: reject });
    worker.postMessage({ id, operacion, carga }, transferibles);
  });
}

export const arca = {
  estado: () => llamar<EstadoCaja>("estado"),
  evaluar: (password: string) => llamar<{ fuerza: Fuerza }>("evaluar", { password }),
  crear: (password: string, perfil: PerfilArgon2) => llamar<Biblioteca>("crear", { password, perfil }),
  abrir: (password: string) => llamar<Biblioteca>("abrir", { password }),
  listar: () => llamar<Biblioteca>("listar"),
  /** El contenido se transfiere, no se copia: pasa al trabajador y deja de ser nuestro. */
  anadir: (documento: NuevoDocumento) =>
    llamar<Biblioteca>("anadir", documento, [documento.datos]),
  leer: (id: string) => llamar<{ meta: DocumentoMeta; datos: ArrayBuffer }>("leer", { id }),
  editar: (id: string, cambios: { nombre: string; categoria: string; notas: string }) =>
    llamar<Biblioteca>("editar", { id, ...cambios }),
  borrar: (id: string) => llamar<Biblioteca>("borrar", { id }),
  uso: () => llamar<Uso>("uso"),
  liberar: () => llamar<boolean>("liberar"),
  cambiarPassword: (actual: string, nueva: string, perfil?: PerfilArgon2) =>
    llamar<boolean>("cambiarPassword", { actual, nueva, ...(perfil ? { perfil } : {}) }),
  exportar: () => llamar<{ archivo: Blob; nombre: string; documentos: number }>("exportar"),
  restaurar: (archivo: Blob) => llamar<{ documentos: number }>("restaurar", { archivo }),
  borrarTodo: () => llamar<boolean>("borrarTodo"),
  cerrar: () => llamar<boolean>("cerrar"),
};
