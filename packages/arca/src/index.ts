/**
 * @cerbero/arca — caja cifrada para documentos.
 *
 * Es independiente de `@cerbero/vault`: no comparte contraseña, formato ni
 * claves con el gestor de contraseñas. Solo reutiliza las primitivas de
 * `@cerbero/crypto`, que es el único paquete autorizado a tocar criptografía.
 */

export { CajaBloqueadaError, CajaFormatoError, CajaPasswordError } from "./errores.ts";

export {
  ARCA_MAGIC,
  ARCA_VERSION,
  CABECERA_LENGTH,
  CAJA_ID_LENGTH,
  leerCabecera,
} from "./formato.ts";
export type { Cabecera } from "./formato.ts";

export { Caja, abrirCaja, cambiarPassword, crearCaja, nuevoIdDocumento } from "./caja.ts";
export type { OpcionesCrear } from "./caja.ts";

export { MAX_DOCUMENTO, abrirIndice, indiceVacio, leerIndice, sellarIndice } from "./indice.ts";
export type { DocumentoMeta, Indice } from "./indice.ts";

export { MAX_SELLADO, SOBRECARGA_TROZO, TROZO, tamanoSellado } from "./documento.ts";
export type { OpcionesTrozo } from "./documento.ts";

export { CUBOS, cubo } from "./relleno.ts";

export {
  PAQUETE_MAGIC,
  inspeccionarPaquete,
  lectorDeBytes,
  preambuloPaquete,
  prefijoDocumento,
} from "./paquete.ts";
export type { LectorAleatorio, PaqueteInspeccionado, RegistroPaquete } from "./paquete.ts";
