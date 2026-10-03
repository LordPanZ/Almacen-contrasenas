import {
  SecretBuffer,
  deriveKey,
  domainHash,
  open as aeadOpen,
  seal as aeadSeal,
  utf8Decode,
  utf8Encode,
  zeroize,
} from "@cerbero/crypto";
import {
  CATEGORIAS_BASE,
  CATEGORIA_RESERVA,
  ID_CATEGORIA,
  MAX_CATEGORIAS,
  MAX_NOMBRE_CATEGORIA_LECTURA,
} from "./categorias.ts";
import type { Categoria } from "./categorias.ts";
import { CajaFormatoError } from "./errores.ts";
import { quitarRelleno, rellenar } from "./relleno.ts";

/** Tope por documento. Se cifra por trozos, así que lo que manda es la memoria del móvil. */
export const MAX_DOCUMENTO = 50 * 1024 * 1024;

/**
 * Suelo del índice cifrado. Con 16 KiB caben unos cincuenta documentos y las
 * carpetas que traiga la caja, así que una con 3 y otra con 40 pesan exactamente
 * lo mismo en disco; sin suelo, el tamaño del índice iría contando cuántos
 * documentos hay.
 */
const SUELO_INDICE = 16 * 1024;

/** Cota del índice descifrado: es JSON de metadatos, no hay motivo para que pese más. */
const MAX_INDICE_BYTES = 32 * 1024 * 1024;

/**
 * Lo que Arca sabe de cada documento. **Todo** esto viaja cifrado: nombre, tipo,
 * tamaño real, carpeta y notas. Fuera del cifrado solo queda un identificador
 * aleatorio de 16 bytes sin relación con el contenido.
 *
 * `categoria` es el identificador de una de las carpetas del índice.
 */
export interface DocumentoMeta {
  readonly id: string;
  readonly nombre: string;
  readonly mime: string;
  readonly tam: number;
  readonly categoria: string;
  readonly notas: string;
  readonly creado: number;
  readonly actualizado: number;
}

/**
 * El índice de la caja: qué carpetas hay y qué documentos hay en ellas.
 *
 * `revision` sube con cada guardado. Quien guarda comprueba que la que hay en
 * disco es la que él leyó: dos pestañas abiertas sobre la misma caja se pisarían
 * el índice en silencio, y el documento añadido en una desaparecería de la lista
 * aunque su contenido siguiera ocupando espacio.
 *
 * La versión 2 añade la lista de carpetas. Un índice de la versión 1 se lee sin
 * más: las carpetas son las de siempre, con los mismos identificadores que ya
 * usaban sus documentos, y se guarda como versión 2 la primera vez que algo
 * cambia.
 */
export interface Indice {
  readonly version: 2;
  readonly revision: number;
  readonly categorias: readonly Categoria[];
  readonly documentos: readonly DocumentoMeta[];
}

export function indiceVacio(): Indice {
  return { version: 2, revision: 0, categorias: CATEGORIAS_BASE, documentos: [] };
}

const ID_DOCUMENTO = /^[0-9a-f]{32}$/;

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== "string") throw new CajaFormatoError(`el campo «${campo}» no es texto`);
  return valor;
}

function numero(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) {
    throw new CajaFormatoError(`el campo «${campo}» no es un número válido`);
  }
  return valor;
}

function leerCategorias(bruto: unknown): readonly Categoria[] {
  if (!Array.isArray(bruto)) throw new CajaFormatoError("el índice no trae la lista de carpetas");
  if (bruto.length > MAX_CATEGORIAS * 10) throw new CajaFormatoError("el índice trae demasiadas carpetas");
  const vistas = new Set<string>();
  const categorias = bruto.map((candidata: unknown): Categoria => {
    if (typeof candidata !== "object" || candidata === null) {
      throw new CajaFormatoError("una carpeta del índice no es un objeto");
    }
    const c = candidata as Record<string, unknown>;
    const id = texto(c["id"], "id de carpeta");
    if (!ID_CATEGORIA.test(id)) throw new CajaFormatoError("un identificador de carpeta no es válido");
    if (vistas.has(id)) throw new CajaFormatoError("el índice repite una carpeta");
    vistas.add(id);
    const nombre = texto(c["nombre"], "nombre de carpeta");
    if (nombre === "" || nombre.length > MAX_NOMBRE_CATEGORIA_LECTURA) {
      throw new CajaFormatoError("el nombre de una carpeta no es válido");
    }
    return { id, nombre };
  });
  return categorias;
}

/**
 * Reconstruye el índice desde su JSON, validando campo a campo.
 *
 * La autenticación prueba que nadie lo tocó, no que la versión que lo escribió
 * respetara el esquema: se valida igual que si viniera de fuera.
 *
 * Es estricta con la **forma** y tolerante con las **referencias**: un documento
 * que apunta a una carpeta que no existe no impide abrir la caja, pasa a la
 * carpeta de reserva. Rechazar el índice entero por un solo campo suelto
 * dejaría al usuario fuera de todos sus documentos por un fallo que no es suyo.
 */
export function leerIndice(json: string): Indice {
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    throw new CajaFormatoError("el índice no es JSON válido");
  }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    throw new CajaFormatoError("el índice no es un objeto");
  }
  const r = bruto as Record<string, unknown>;
  const version = r["version"];
  if (typeof version === "number" && version > 2) {
    throw new CajaFormatoError(
      "esta caja usa una versión del formato más nueva que la de esta Arca: recarga la página para actualizarla",
    );
  }
  if (version !== 1 && version !== 2) throw new CajaFormatoError("versión de índice no soportada");
  const revision = numero(r["revision"], "revision");
  if (!Number.isSafeInteger(revision)) throw new CajaFormatoError("la revisión no es entera");
  if (!Array.isArray(r["documentos"])) throw new CajaFormatoError("el índice no trae documentos");

  // La versión 1 no tenía carpetas propias: eran las de siempre. Una lista vacía
  // tampoco puede ser: sin carpetas no hay donde poner nada.
  let categorias: readonly Categoria[] = version === 1 ? CATEGORIAS_BASE : leerCategorias(r["categorias"]);
  if (categorias.length === 0) categorias = CATEGORIAS_BASE;
  const conocidas = new Set(categorias.map((c) => c.id));
  const reserva = conocidas.has(CATEGORIA_RESERVA) ? CATEGORIA_RESERVA : (categorias[0] as Categoria).id;

  const vistos = new Set<string>();
  const documentos: DocumentoMeta[] = r["documentos"].map((candidato: unknown) => {
    if (typeof candidato !== "object" || candidato === null) {
      throw new CajaFormatoError("un documento del índice no es un objeto");
    }
    const d = candidato as Record<string, unknown>;
    const id = texto(d["id"], "id");
    if (!ID_DOCUMENTO.test(id)) throw new CajaFormatoError("un identificador de documento no es válido");
    if (vistos.has(id)) throw new CajaFormatoError("el índice repite un documento");
    vistos.add(id);
    const tam = numero(d["tam"], "tam");
    if (!Number.isSafeInteger(tam) || tam > MAX_DOCUMENTO) {
      throw new CajaFormatoError("el tamaño de un documento no es válido");
    }
    const categoria = texto(d["categoria"], "categoria");
    return {
      id,
      nombre: texto(d["nombre"], "nombre"),
      mime: texto(d["mime"], "mime"),
      tam,
      categoria: conocidas.has(categoria) ? categoria : reserva,
      notas: texto(d["notas"], "notas"),
      creado: numero(d["creado"], "creado"),
      actualizado: numero(d["actualizado"], "actualizado"),
    };
  });
  return { version: 2, revision, categorias, documentos };
}

function claveIndice(claveDatos: SecretBuffer): SecretBuffer {
  return deriveKey(claveDatos.bytes, "arca-index-key");
}

function aadIndice(cajaId: Uint8Array): Uint8Array {
  return domainHash("arca-index", cajaId);
}

/** Cifra el índice. Su tamaño solo revela el cubo en el que cae, y hasta ~60 documentos es siempre el mismo. */
export function sellarIndice(
  claveDatos: SecretBuffer,
  cajaId: Uint8Array,
  indice: Indice,
): Uint8Array {
  const json = utf8Encode(JSON.stringify(indice));
  const relleno = rellenar(json, SUELO_INDICE);
  const clave = claveIndice(claveDatos);
  try {
    return aeadSeal(clave, relleno, aadIndice(cajaId));
  } finally {
    clave.destroy();
    zeroize(json, relleno);
  }
}

/** Inverso de `sellarIndice`; lanza `AeadError` si no es de esta caja o fue alterado. */
export function abrirIndice(
  claveDatos: SecretBuffer,
  cajaId: Uint8Array,
  sellado: Uint8Array,
): Indice {
  const clave = claveIndice(claveDatos);
  let plano: Uint8Array | null = null;
  try {
    plano = aeadOpen(clave, sellado, aadIndice(cajaId));
    if (plano.length > MAX_INDICE_BYTES) throw new CajaFormatoError("el índice es demasiado grande");
    return leerIndice(utf8Decode(quitarRelleno(plano, SUELO_INDICE)));
  } finally {
    clave.destroy();
    zeroize(plano);
  }
}
