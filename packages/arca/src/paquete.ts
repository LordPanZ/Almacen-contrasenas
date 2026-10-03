import { concatBytes, fromHex, toHex, uint32, utf8Encode } from "@cerbero/crypto";
import { CajaFormatoError } from "./errores.ts";
import { CABECERA_LENGTH, leerCabecera } from "./formato.ts";
import { MAX_SELLADO } from "./documento.ts";
import { SOBRECARGA_TROZO } from "./documento.ts";

/**
 * Copia de seguridad: toda la caja en un solo fichero.
 *
 * ```
 * "ARCABAK1" | u32 len | cabecera | u32 len | índice cifrado | u32 cuántos
 *            | { id(16) | u32 len | documento cifrado } × cuántos
 * ```
 *
 * No añade cifrado propio ni revela nada nuevo: son los mismos criptogramas que
 * hay en el navegador, uno tras otro. La copia se abre con la contraseña de la
 * caja que la generó.
 *
 * Se lee con acceso aleatorio y no entera en memoria: una copia puede pesar
 * cientos de MiB, y en un móvil cargarla de una vez es la forma de perderla.
 */

export const PAQUETE_MAGIC = /* @__PURE__ */ utf8Encode("ARCABAK1");
const MAX_DOCUMENTOS = 100_000;
const MAX_INDICE_PAQUETE = 32 * 1024 * 1024;
const REGISTRO = 16 + 4;

/** Todo lo que va antes de los documentos. */
export function preambuloPaquete(
  cabecera: Uint8Array,
  indice: Uint8Array,
  cuantos: number,
): Uint8Array {
  leerCabecera(cabecera);
  if (!Number.isSafeInteger(cuantos) || cuantos < 0 || cuantos > MAX_DOCUMENTOS) {
    throw new CajaFormatoError("número de documentos fuera de rango");
  }
  return concatBytes(
    PAQUETE_MAGIC,
    uint32(cabecera.length),
    cabecera,
    uint32(indice.length),
    indice,
    uint32(cuantos),
  );
}

/** Identificador y longitud que preceden a cada documento cifrado. */
export function prefijoDocumento(id: string, longitud: number): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new CajaFormatoError("identificador de documento no válido");
  return concatBytes(fromHex(id), uint32(longitud));
}

/** Fuente de bytes con acceso aleatorio: un `Uint8Array` o un `Blob` en el navegador. */
export interface LectorAleatorio {
  readonly tamano: number;
  leer(desde: number, cuantos: number): Promise<Uint8Array>;
}

export interface RegistroPaquete {
  readonly id: string;
  readonly desde: number;
  readonly tam: number;
}

export interface PaqueteInspeccionado {
  readonly cabecera: Uint8Array;
  readonly indice: Uint8Array;
  readonly documentos: readonly RegistroPaquete[];
}

/** Lector sobre un `Uint8Array` en memoria. Útil en tests y para copias pequeñas. */
export function lectorDeBytes(bytes: Uint8Array): LectorAleatorio {
  return {
    tamano: bytes.length,
    leer: async (desde, cuantos) => bytes.subarray(desde, desde + cuantos),
  };
}

/**
 * Recorre el paquete validándolo entero **sin leer los documentos**: solo sus
 * prefijos, saltando el contenido. Devuelve dónde está cada uno. Así quien
 * restaura sabe que la copia es coherente antes de escribir nada, y una copia
 * cortada o manipulada no deja la caja a medias.
 */
export async function inspeccionarPaquete(fuente: LectorAleatorio): Promise<PaqueteInspeccionado> {
  let posicion = 0;

  const tomar = async (cuantos: number): Promise<Uint8Array> => {
    if (cuantos < 0 || posicion + cuantos > fuente.tamano) {
      throw new CajaFormatoError("la copia está cortada o corrupta");
    }
    const bytes = await fuente.leer(posicion, cuantos);
    if (bytes.length !== cuantos) throw new CajaFormatoError("la copia está cortada o corrupta");
    posicion += cuantos;
    return bytes;
  };
  const u32 = async (): Promise<number> => {
    const b = await tomar(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
  };

  if (fuente.tamano < PAQUETE_MAGIC.length + 4) {
    throw new CajaFormatoError("el fichero es demasiado corto para ser una copia de Arca");
  }
  const magic = await tomar(PAQUETE_MAGIC.length);
  for (let i = 0; i < PAQUETE_MAGIC.length; i++) {
    if (magic[i] !== PAQUETE_MAGIC[i]) throw new CajaFormatoError("no es una copia de Arca");
  }

  const longitudCabecera = await u32();
  if (longitudCabecera !== CABECERA_LENGTH) throw new CajaFormatoError("la cabecera de la copia no es válida");
  const cabecera = Uint8Array.from(await tomar(longitudCabecera));
  leerCabecera(cabecera);

  const longitudIndice = await u32();
  if (longitudIndice > MAX_INDICE_PAQUETE) throw new CajaFormatoError("el índice de la copia es demasiado grande");
  const indice = Uint8Array.from(await tomar(longitudIndice));

  const cuantos = await u32();
  if (cuantos > MAX_DOCUMENTOS) throw new CajaFormatoError("la copia declara demasiados documentos");

  const vistos = new Set<string>();
  const documentos: RegistroPaquete[] = [];
  for (let i = 0; i < cuantos; i++) {
    const prefijo = await tomar(REGISTRO);
    const id = toHex(prefijo.subarray(0, 16));
    const tam = new DataView(prefijo.buffer, prefijo.byteOffset + 16, 4).getUint32(0);
    if (tam <= SOBRECARGA_TROZO || tam > MAX_SELLADO) {
      throw new CajaFormatoError("el tamaño de un documento de la copia no es válido");
    }
    if (vistos.has(id)) throw new CajaFormatoError("la copia repite un documento");
    vistos.add(id);
    if (posicion + tam > fuente.tamano) throw new CajaFormatoError("la copia está cortada o corrupta");
    documentos.push({ id, desde: posicion, tam });
    posicion += tam;
  }
  if (posicion !== fuente.tamano) throw new CajaFormatoError("la copia tiene datos sobrantes");
  return { cabecera, indice, documentos };
}
