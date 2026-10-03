import type { Categoria } from "./tipos.ts";

/**
 * Las carpetas son del usuario y viajan dentro del índice cifrado; aquí solo hay
 * ayudas para mostrarlas. Una carpeta que ya no exista (borrada desde otra
 * pestaña, por ejemplo) se enseña como «Sin carpeta» en vez de romper la lista.
 */
export function nombreCarpeta(categorias: readonly Categoria[], id: string): string {
  return categorias.find((c) => c.id === id)?.nombre ?? "Sin carpeta";
}

/** Dónde cae un documento si nadie dice otra cosa: «Otros» si existe, y si no la primera. */
export function carpetaPorDefecto(categorias: readonly Categoria[]): string {
  return categorias.find((c) => c.id === "otros")?.id ?? categorias[0]?.id ?? "";
}

export function textoDocumentos(n: number): string {
  return n === 1 ? "1 documento" : `${n} documentos`;
}
