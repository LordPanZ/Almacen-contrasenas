import {
  AEAD_OVERHEAD,
  SecretBuffer,
  deriveKey,
  domainHash,
  fromHex,
  open as aeadOpen,
  seal as aeadSeal,
  uint32,
  zeroize,
} from "@cerbero/crypto";
import { CajaFormatoError } from "./errores.ts";
import { MAX_DOCUMENTO } from "./indice.ts";
import { longitudRellenada } from "./relleno.ts";

/**
 * Cifrado de un documento por trozos.
 *
 * Un PDF escaneado pesa decenas de MiB. Cifrarlo de una vez obliga a tener a la
 * vez el original, una copia rellenada y el criptograma, y en un móvil eso es
 * lo que termina matando la pestaña. Por trozos de 1 MiB basta con el original
 * y la salida.
 *
 * Cada trozo lleva su propio nonce aleatorio y sus datos autenticados atan el
 * trozo a su caja, a su documento, a su posición y a si es el último. Eso cierra
 * lo que el cifrado por trozos abre: reordenar trozos, repetir uno, quitar el
 * final para entregar un documento recortado o añadir uno de otro sitio. Todos
 * fallan la autenticación.
 */

export const TROZO = 1024 * 1024;
export const SOBRECARGA_TROZO = AEAD_OVERHEAD;

export interface OpcionesTrozo {
  /** Solo para tests: cambia el tamaño de trozo para cubrir los bordes sin MiB de datos. */
  readonly trozo?: number;
}

function aadTrozo(cajaId: Uint8Array, docId: Uint8Array, posicion: number, ultimo: boolean) {
  return domainHash("arca-doc", cajaId, docId, uint32(posicion), new Uint8Array([ultimo ? 1 : 0]));
}

function claveDocumento(claveDatos: SecretBuffer, docId: Uint8Array): SecretBuffer {
  return deriveKey(claveDatos.bytes, "arca-doc-key", { context: docId });
}

function idABytes(id: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new CajaFormatoError("identificador de documento no válido");
  return fromHex(id);
}

/** Bytes que ocupará el documento cifrado, sin llegar a cifrarlo. */
export function tamanoSellado(longitud: number, opciones: OpcionesTrozo = {}): number {
  const trozo = opciones.trozo ?? TROZO;
  const total = longitudRellenada(longitud);
  return total + Math.ceil(total / trozo) * SOBRECARGA_TROZO;
}

/** Cota superior de un documento cifrado válido. */
export const MAX_SELLADO = /* @__PURE__ */ tamanoSellado(MAX_DOCUMENTO);

/**
 * Rellena `destino` con el tramo del flujo lógico que empieza en `desde`.
 *
 * El flujo lógico es `longitud(4) | datos | ceros hasta el cubo`. Se construye
 * al vuelo en vez de materializarlo entero: ahorra una copia completa.
 */
function tramo(destino: Uint8Array, desde: number, datos: Uint8Array): void {
  destino.fill(0);
  const hasta = desde + destino.length;
  if (desde < 4) {
    const cabecera = uint32(datos.length);
    for (let k = desde; k < Math.min(4, hasta); k++) destino[k - desde] = cabecera[k] as number;
  }
  const a = Math.max(desde, 4);
  const b = Math.min(hasta, 4 + datos.length);
  if (a < b) destino.set(datos.subarray(a - 4, b - 4), a - desde);
}

export function sellarDocumento(
  claveDatos: SecretBuffer,
  cajaId: Uint8Array,
  id: string,
  datos: Uint8Array,
  opciones: OpcionesTrozo = {},
): Uint8Array {
  if (datos.length === 0) throw new CajaFormatoError("el documento está vacío");
  if (datos.length > MAX_DOCUMENTO) {
    throw new CajaFormatoError(
      `el documento pesa ${datos.length} bytes y el máximo es ${MAX_DOCUMENTO}`,
    );
  }
  const docId = idABytes(id);
  const trozo = opciones.trozo ?? TROZO;
  const total = longitudRellenada(datos.length);
  const trozos = Math.ceil(total / trozo);
  const salida = new Uint8Array(total + trozos * SOBRECARGA_TROZO);
  const borrador = new Uint8Array(trozo);
  const clave = claveDocumento(claveDatos, docId);
  try {
    let posicion = 0;
    for (let i = 0; i < trozos; i++) {
      const desde = i * trozo;
      const parte = borrador.subarray(0, Math.min(total, desde + trozo) - desde);
      tramo(parte, desde, datos);
      const sellado = aeadSeal(clave, parte, aadTrozo(cajaId, docId, i, i === trozos - 1));
      salida.set(sellado, posicion);
      posicion += sellado.length;
    }
    return salida;
  } finally {
    clave.destroy();
    zeroize(borrador);
  }
}

/** Descifra un documento. Lanza `AeadError` ante cualquier alteración. */
export function abrirDocumento(
  claveDatos: SecretBuffer,
  cajaId: Uint8Array,
  id: string,
  sellado: Uint8Array,
  opciones: OpcionesTrozo = {},
): Uint8Array {
  const docId = idABytes(id);
  const trozo = opciones.trozo ?? TROZO;
  const unidad = trozo + SOBRECARGA_TROZO;
  if (sellado.length <= SOBRECARGA_TROZO || sellado.length > MAX_SELLADO) {
    throw new CajaFormatoError("el tamaño de un documento cifrado no es válido");
  }
  const trozos = Math.ceil(sellado.length / unidad);
  const ultimoTam = sellado.length - (trozos - 1) * unidad;
  if (ultimoTam <= SOBRECARGA_TROZO) {
    throw new CajaFormatoError("el último trozo de un documento está vacío");
  }

  const clave = claveDocumento(claveDatos, docId);
  let salida: Uint8Array | null = null;
  let longitud = 0;
  try {
    for (let i = 0; i < trozos; i++) {
      const desde = i * unidad;
      const hasta = Math.min(sellado.length, desde + unidad);
      const plano = aeadOpen(
        clave,
        sellado.subarray(desde, hasta),
        aadTrozo(cajaId, docId, i, i === trozos - 1),
      );
      try {
        if (i === 0) {
          longitud = new DataView(plano.buffer, plano.byteOffset, plano.byteLength).getUint32(0);
          const esperado = sellado.length - trozos * SOBRECARGA_TROZO;
          if (longitud === 0 || longitud > MAX_DOCUMENTO || longitudRellenada(longitud) !== esperado) {
            throw new CajaFormatoError("la longitud declarada de un documento no cuadra");
          }
          salida = new Uint8Array(longitud);
        }
        const inicioLogico = i * trozo;
        const a = Math.max(inicioLogico, 4);
        const b = Math.min(inicioLogico + plano.length, 4 + longitud);
        if (a < b && salida) salida.set(plano.subarray(a - inicioLogico, b - inicioLogico), a - 4);
      } finally {
        zeroize(plano);
      }
    }
    return salida as Uint8Array;
  } catch (fallo) {
    // Un descifrado a medias no debe dejar a la vista lo ya copiado.
    zeroize(salida);
    throw fallo;
  } finally {
    clave.destroy();
  }
}
