import { randomBytes, toHex } from "@cerbero/crypto";
import { CategoriaError } from "./errores.ts";
import type { Indice } from "./indice.ts";

/**
 * Carpetas del índice.
 *
 * Una categoría es una carpeta: cada documento está en exactamente una. La lista
 * viaja dentro del índice cifrado, igual que el resto de metadatos, así que ni
 * los nombres de las carpetas ni cuántas hay se ven desde fuera.
 *
 * Los documentos apuntan a su carpeta por identificador, no por nombre: renombrar
 * una carpeta no toca ningún documento.
 */
export interface Categoria {
  readonly id: string;
  readonly nombre: string;
}

const base = (id: string, nombre: string): Categoria => Object.freeze({ id, nombre });

/**
 * Las carpetas con las que nace una caja. Son las mismas de la primera versión de
 * Arca, con los mismos identificadores: así los documentos que ya estaban
 * guardados siguen en su sitio sin migrar nada.
 */
export const CATEGORIAS_BASE: readonly Categoria[] = Object.freeze([
  base("identidad", "Identidad"),
  base("vivienda", "Vivienda"),
  base("vehiculo", "Vehículo"),
  base("seguros", "Seguros"),
  base("salud", "Salud"),
  base("finanzas", "Finanzas"),
  base("trabajo", "Trabajo y estudios"),
  base("legal", "Legal y familia"),
  base("otros", "Otros"),
]);

/** A donde van a parar los documentos cuya carpeta no se encuentra. */
export const CATEGORIA_RESERVA = "otros";

export const MAX_CATEGORIAS = 100;
export const MAX_NOMBRE_CATEGORIA = 40;

/** Cota de lectura: más generosa que la de escritura, para no rechazar nada que ya se guardó. */
export const MAX_NOMBRE_CATEGORIA_LECTURA = 200;

export const ID_CATEGORIA = /^[a-z0-9-]{1,32}$/;

/**
 * Deja un nombre en su forma canónica: sin espacios de más, sin caracteres de
 * control y con la normalización Unicode compuesta, para que «Vehículo» escrito
 * de dos maneras distintas sea el mismo nombre.
 */
export function normalizarNombreCategoria(nombre: string): string {
  const limpio = nombre
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  if (limpio === "") throw new CategoriaError("La carpeta necesita un nombre.");
  if ([...limpio].length > MAX_NOMBRE_CATEGORIA) {
    throw new CategoriaError(`El nombre es demasiado largo: máximo ${MAX_NOMBRE_CATEGORIA} caracteres.`);
  }
  return limpio;
}

/** Con qué se comparan los nombres: «Vehículo», «vehiculo» y «VEHÍCULO » son la misma carpeta. */
function claveNombre(nombre: string): string {
  return nombre.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

function comprobarNombreLibre(categorias: readonly Categoria[], nombre: string): void {
  const clave = claveNombre(nombre);
  if (categorias.some((c) => claveNombre(c.nombre) === clave)) {
    throw new CategoriaError("Ya hay una carpeta con ese nombre.");
  }
}

export function existeCategoria(indice: Pick<Indice, "categorias">, id: string): boolean {
  return indice.categorias.some((c) => c.id === id);
}

function nuevoIdCategoria(existentes: readonly Categoria[]): string {
  for (;;) {
    const id = toHex(randomBytes(8));
    if (!existentes.some((c) => c.id === id)) return id;
  }
}

/** Añade una carpeta. Devuelve el índice nuevo (con la revisión subida) y la carpeta creada. */
export function conCategoriaNueva(
  indice: Indice,
  nombre: string,
): { indice: Indice; categoria: Categoria } {
  const limpio = normalizarNombreCategoria(nombre);
  if (indice.categorias.length >= MAX_CATEGORIAS) {
    throw new CategoriaError(`No puede haber más de ${MAX_CATEGORIAS} carpetas.`);
  }
  comprobarNombreLibre(indice.categorias, limpio);
  const categoria: Categoria = { id: nuevoIdCategoria(indice.categorias), nombre: limpio };
  return {
    indice: { ...indice, revision: indice.revision + 1, categorias: [...indice.categorias, categoria] },
    categoria,
  };
}

/** Cambia el nombre de una carpeta. Si no cambia nada devuelve el mismo índice, sin subir la revisión. */
export function conCategoriaRenombrada(indice: Indice, id: string, nombre: string): Indice {
  const actual = indice.categorias.find((c) => c.id === id);
  if (!actual) throw new CategoriaError("Esa carpeta ya no existe.");
  const limpio = normalizarNombreCategoria(nombre);
  comprobarNombreLibre(
    indice.categorias.filter((c) => c.id !== id),
    limpio,
  );
  if (limpio === actual.nombre) return indice;
  return {
    ...indice,
    revision: indice.revision + 1,
    categorias: indice.categorias.map((c) => (c.id === id ? { id, nombre: limpio } : c)),
  };
}

/**
 * Quita una carpeta. Si tiene documentos hay que decir a cuál se mueven: borrar
 * una carpeta nunca borra documentos, y tampoco los deja apuntando a la nada.
 */
export function sinCategoria(
  indice: Indice,
  id: string,
  destino?: string,
  ahora: number = Date.now(),
): Indice {
  if (!existeCategoria(indice, id)) throw new CategoriaError("Esa carpeta ya no existe.");
  if (indice.categorias.length <= 1) throw new CategoriaError("Tiene que quedar al menos una carpeta.");
  const hayDocumentos = indice.documentos.some((d) => d.categoria === id);
  if (hayDocumentos) {
    if (destino === undefined) {
      throw new CategoriaError("La carpeta tiene documentos: elige a qué carpeta moverlos.");
    }
    if (destino === id || !existeCategoria(indice, destino)) {
      throw new CategoriaError("La carpeta de destino no existe.");
    }
  }
  return {
    ...indice,
    revision: indice.revision + 1,
    categorias: indice.categorias.filter((c) => c.id !== id),
    documentos: hayDocumentos
      ? indice.documentos.map((d) =>
          d.categoria === id ? { ...d, categoria: destino as string, actualizado: ahora } : d,
        )
      : indice.documentos,
  };
}
