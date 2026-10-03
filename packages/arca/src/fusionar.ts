import {
  CATEGORIA_RESERVA,
  MAX_NOMBRE_CATEGORIA,
  claveNombreCategoria,
} from "./categorias.ts";
import type { Categoria } from "./categorias.ts";
import type { DocumentoMeta, Indice } from "./indice.ts";

/**
 * Combinar dos copias de la misma caja.
 *
 * Una caja copiada a otro dispositivo (el móvil de la pareja, el PC de la casa)
 * empieza idéntica y después cada copia cambia por su lado: en una se añade el
 * DNI de los niños, en la otra la escritura nueva. Restaurar una copia
 * **sustituye** todo lo que hubiera, así que a la segunda vuelta alguien pierde
 * lo suyo. Combinar suma, y nunca quita.
 *
 * Funciona porque las dos copias comparten la clave de datos —se hicieron de la
 * misma caja—, y un documento es inmutable: mismo identificador, mismo
 * contenido. Lo único que puede diferir entre copias es **dónde está** y **cómo
 * se llama**, que viven en el índice.
 *
 * Reglas:
 *
 * - Un documento que solo está en la otra copia se añade.
 * - Un documento que está en las dos conserva el nombre, la carpeta y las notas
 *   de la que se tocó **más recientemente**; el contenido no cambia.
 * - Una carpeta que solo está en la otra copia se añade. Si su nombre ya lo usa
 *   otra carpeta de aquí, se distingue con «(copia)»: dos carpetas con el mismo
 *   nombre son una trampa.
 * - **Borrar no se propaga.** Un índice no guarda lo que ya no está, así que lo
 *   que se borró en una copia y sigue en la otra vuelve a aparecer. Es el
 *   precio de combinar sin servidor, y la interfaz lo avisa antes de aplicar.
 */

export interface PlanFusion {
  /** El índice resultante, con la revisión subida. */
  readonly indice: Indice;
  /** Documentos que solo estaban en la otra copia. */
  readonly documentosNuevos: readonly DocumentoMeta[];
  /** Documentos de los dos lados cuyo nombre, carpeta o notas se tocaron más tarde en la otra. */
  readonly documentosActualizados: readonly DocumentoMeta[];
  /** Carpetas que solo estaban en la otra copia, con el nombre con el que quedan. */
  readonly categoriasNuevas: readonly Categoria[];
}

/** Un nombre libre: el suyo, o con «(copia)» y un número si ya está usado. */
function nombreLibre(nombre: string, usados: ReadonlySet<string>): string {
  if (!usados.has(claveNombreCategoria(nombre))) return nombre;
  for (let n = 1; ; n++) {
    const sufijo = n === 1 ? " (copia)" : ` (copia ${n})`;
    const candidato = [...nombre].slice(0, MAX_NOMBRE_CATEGORIA - sufijo.length).join("").trimEnd() + sufijo;
    if (!usados.has(claveNombreCategoria(candidato))) return candidato;
  }
}

/**
 * Qué quedaría al sumar `otro` a `actual`, o `null` si `otro` no trae nada que
 * `actual` no tenga. No toca ninguno de los dos.
 */
export function planearFusion(actual: Indice, otro: Indice): PlanFusion | null {
  const categorias: Categoria[] = [...actual.categorias];
  const idsCategorias = new Set(categorias.map((c) => c.id));
  const nombresUsados = new Set(categorias.map((c) => claveNombreCategoria(c.nombre)));
  const categoriasNuevas: Categoria[] = [];
  for (const c of otro.categorias) {
    if (idsCategorias.has(c.id)) continue;
    const nombre = nombreLibre(c.nombre, nombresUsados);
    const nueva: Categoria = { id: c.id, nombre };
    categorias.push(nueva);
    categoriasNuevas.push(nueva);
    idsCategorias.add(c.id);
    nombresUsados.add(claveNombreCategoria(nombre));
  }
  const reserva = idsCategorias.has(CATEGORIA_RESERVA) ? CATEGORIA_RESERVA : (categorias[0] as Categoria).id;

  const propios = new Map(actual.documentos.map((d) => [d.id, d]));
  const documentosNuevos: DocumentoMeta[] = [];
  const ganadores = new Map<string, DocumentoMeta>();
  for (const d of otro.documentos) {
    const categoria = idsCategorias.has(d.categoria) ? d.categoria : reserva;
    const propio = propios.get(d.id);
    if (!propio) {
      documentosNuevos.push({ ...d, categoria });
    } else if (d.actualizado > propio.actualizado) {
      // El contenido es el mismo por construcción; solo cambia lo que se puede editar.
      ganadores.set(d.id, {
        ...propio,
        nombre: d.nombre,
        categoria,
        notas: d.notas,
        actualizado: d.actualizado,
      });
    }
  }

  if (documentosNuevos.length === 0 && ganadores.size === 0 && categoriasNuevas.length === 0) return null;

  const documentos = [...actual.documentos.map((d) => ganadores.get(d.id) ?? d), ...documentosNuevos];
  return {
    indice: { ...actual, revision: actual.revision + 1, categorias, documentos },
    documentosNuevos,
    documentosActualizados: [...ganadores.values()],
    categoriasNuevas,
  };
}
