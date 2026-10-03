/**
 * Categorías con las que se ordenan los documentos.
 *
 * Son una comodidad de la interfaz: en la caja se guarda solo el `valor`, dentro
 * del índice cifrado. Un valor que ya no exista cae en «otros» sin romper nada.
 */
export const CATEGORIAS = [
  { valor: "identidad", nombre: "Identidad" },
  { valor: "vivienda", nombre: "Vivienda" },
  { valor: "vehiculo", nombre: "Vehículo" },
  { valor: "seguros", nombre: "Seguros" },
  { valor: "salud", nombre: "Salud" },
  { valor: "finanzas", nombre: "Finanzas" },
  { valor: "trabajo", nombre: "Trabajo y estudios" },
  { valor: "legal", nombre: "Legal y familia" },
  { valor: "otros", nombre: "Otros" },
] as const;

export type Categoria = (typeof CATEGORIAS)[number]["valor"];

export const CATEGORIA_POR_DEFECTO: Categoria = "otros";

export function nombreCategoria(valor: string): string {
  return CATEGORIAS.find((c) => c.valor === valor)?.nombre ?? "Otros";
}

export function comoCategoria(valor: string): Categoria {
  return CATEGORIAS.some((c) => c.valor === valor) ? (valor as Categoria) : CATEGORIA_POR_DEFECTO;
}
