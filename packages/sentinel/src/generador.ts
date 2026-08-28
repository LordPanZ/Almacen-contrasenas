import { InvalidInputError, randomInt } from "@cerbero/crypto";
import { FUENTE_SISTEMA, type FuenteAleatoria } from "./flujo.ts";
import { PALABRAS_FRASE } from "./listas.ts";

/**
 * Clases de caracteres del generador.
 *
 * El juego de símbolos es deliberadamente conservador: sin comillas, barras,
 * espacios ni acentos. No es estética, es que esos caracteres se rompen al
 * pasar por scripts de shell, exportaciones CSV y formularios mal escritos, y
 * una contraseña que el usuario no puede pegar acaba sustituida por otra peor.
 */
export const CLASES_CARACTERES = {
  minusculas: "abcdefghijklmnopqrstuvwxyz",
  mayusculas: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digitos: "0123456789",
  simbolos: "!#$%&*+-=?@^_~",
} as const;

export type ClaseCaracteres = keyof typeof CLASES_CARACTERES;

/** Caracteres que se confunden al leerlos en voz alta o al copiarlos a mano. */
export const CARACTERES_AMBIGUOS = "O0lI1";

export const LONGITUD_POR_DEFECTO = 20;
export const PALABRAS_POR_DEFECTO = 7;

export interface PasswordOptions {
  readonly longitud?: number;
  readonly minusculas?: boolean;
  readonly mayusculas?: boolean;
  readonly digitos?: boolean;
  readonly simbolos?: boolean;
  /** Quita `O0lI1` de todas las clases, a costa de algo menos de entropía. */
  readonly excluirAmbiguos?: boolean;
  /** Caracteres concretos que el servicio de destino no admite. */
  readonly excluir?: string;
}

export interface PassphraseOptions {
  readonly palabras?: number;
  readonly separador?: string;
  /** Pone en mayúscula la inicial de cada palabra, para servicios que la exigen. */
  readonly capitalizar?: boolean;
  /** Añade un número de dos cifras al final, para servicios que exigen dígito. */
  readonly incluirNumero?: boolean;
  readonly lista?: readonly string[];
}

/** Clases activas ya filtradas, cada una como array de caracteres sueltos. */
function clasesActivas(opciones: PasswordOptions): string[][] {
  const excluidos = new Set<string>([
    ...(opciones.excluirAmbiguos === true ? CARACTERES_AMBIGUOS : ""),
    ...(opciones.excluir ?? ""),
  ]);
  const pedidas: ClaseCaracteres[] = [];
  if (opciones.minusculas !== false) pedidas.push("minusculas");
  if (opciones.mayusculas !== false) pedidas.push("mayusculas");
  if (opciones.digitos !== false) pedidas.push("digitos");
  if (opciones.simbolos !== false) pedidas.push("simbolos");

  const clases: string[][] = [];
  for (const nombre of pedidas) {
    const caracteres = [...CLASES_CARACTERES[nombre]].filter((c) => !excluidos.has(c));
    if (caracteres.length === 0) {
      throw new InvalidInputError(`la clase ${nombre} se queda sin caracteres tras las exclusiones`);
    }
    clases.push(caracteres);
  }
  if (clases.length === 0) {
    throw new InvalidInputError("hay que activar al menos una clase de caracteres");
  }
  return clases;
}

/**
 * Multiconjunto de caracteres de una contraseña, todavía sin barajar.
 *
 * Garantiza una aparición de cada clase pedida *añadiendo* un representante de
 * cada una antes de rellenar. La alternativa habitual —generar y luego
 * sustituir la primera posición por un dígito— fija caracteres en posiciones
 * conocidas y recorta el espacio de búsqueda: la contraseña anuncia N bits y
 * entrega bastantes menos.
 */
export function construirCaracteres(
  opciones: PasswordOptions,
  fuente: FuenteAleatoria,
): string[] {
  const longitud = opciones.longitud ?? LONGITUD_POR_DEFECTO;
  if (!Number.isSafeInteger(longitud) || longitud < 4) {
    throw new InvalidInputError("la longitud debe ser un entero de al menos 4");
  }
  const clases = clasesActivas(opciones);
  if (longitud < clases.length) {
    throw new InvalidInputError(
      "la longitud no alcanza para cubrir todas las clases de caracteres pedidas",
    );
  }
  const alfabeto = clases.flat();
  const caracteres: string[] = [];
  for (const clase of clases) caracteres.push(fuente.elegir(clase));
  while (caracteres.length < longitud) caracteres.push(fuente.elegir(alfabeto));
  return caracteres;
}

/** Tamaño del alfabeto efectivo, para calcular la entropía anunciada. */
export function tamanoAlfabeto(opciones: PasswordOptions = {}): number {
  return clasesActivas(opciones).reduce((total, clase) => total + clase.length, 0);
}

/**
 * Contraseña aleatoria que cumple las clases pedidas.
 *
 * El barajado final con Fisher-Yates sin sesgo es lo que evita que los
 * representantes de clase queden siempre en las mismas posiciones.
 */
export function generatePassword(opciones: PasswordOptions = {}): string {
  const caracteres = construirCaracteres(opciones, FUENTE_SISTEMA);
  return FUENTE_SISTEMA.barajar(caracteres).join("");
}

/**
 * Frase de contraseña con palabras elegidas *con reemplazo*.
 *
 * Muestrear sin reemplazo parece "mejor" pero reduce la entropía real y la
 * vuelve difícil de calcular; con reemplazo la cuenta es exacta:
 * `palabras x log2(lista)`.
 */
export function generatePassphrase(opciones: PassphraseOptions = {}): string {
  const palabras = opciones.palabras ?? PALABRAS_POR_DEFECTO;
  const lista = opciones.lista ?? PALABRAS_FRASE;
  const separador = opciones.separador ?? "-";
  if (!Number.isSafeInteger(palabras) || palabras < 3) {
    throw new InvalidInputError("una frase de contraseña necesita al menos 3 palabras");
  }
  if (lista.length < 2) {
    throw new InvalidInputError("la lista de palabras es demasiado corta");
  }
  const elegidas: string[] = [];
  for (let i = 0; i < palabras; i++) {
    const palabra = FUENTE_SISTEMA.elegir(lista);
    elegidas.push(opciones.capitalizar === true ? capitalizar(palabra) : palabra);
  }
  if (opciones.incluirNumero === true) {
    elegidas.push(String(randomInt(100)).padStart(2, "0"));
  }
  return elegidas.join(separador);
}

/** Bits de entropía que entrega `generatePassphrase` con estas opciones. */
export function entropiaFrase(opciones: PassphraseOptions = {}): number {
  const palabras = opciones.palabras ?? PALABRAS_POR_DEFECTO;
  const lista = opciones.lista ?? PALABRAS_FRASE;
  const extra = opciones.incluirNumero === true ? Math.log2(100) : 0;
  return palabras * Math.log2(lista.length) + extra;
}

function capitalizar(palabra: string): string {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1);
}
