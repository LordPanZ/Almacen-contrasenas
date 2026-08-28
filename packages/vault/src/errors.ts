import { CerberoError } from "@cerbero/crypto";

/** Raíz de los errores del almacén, para poder capturar todo el paquete de golpe. */
export class VaultError extends CerberoError {}

/**
 * El fichero no tiene la forma de una bóveda de Cerbero: magia, versión o
 * dimensiones incoherentes.
 *
 * Se distingue de `VaultUnlockError` a propósito: aquí no hay nada secreto que
 * proteger, el error habla solo de datos públicos que cualquiera puede leer.
 */
export class VaultFormatError extends VaultError {
  constructor(message = "el fichero no tiene el formato de una bóveda de Cerbero") {
    super(message);
  }
}

/**
 * Ninguna ranura del fichero se abrió con la contraseña dada.
 *
 * El mensaje es constante y no admite detalles: no distingue "contraseña
 * incorrecta" de "esa ranura está vacía" ni de "la ranura fue alterada". Esa
 * indistinguibilidad *es* la negación plausible; cualquier matiz aquí sería un
 * oráculo con el que demostrar cuántas bóvedas reales contiene el fichero.
 */
export class VaultUnlockError extends VaultError {
  constructor() {
    super("ninguna ranura de la bóveda se abre con esa contraseña");
  }
}

/**
 * Se intentó reescribir una ranura con una contraseña distinta de la que la
 * abre. Guardar así no rompería el fichero, pero cambiaría en silencio la
 * contraseña de la bóveda: preferimos fallar a que una errata al teclear
 * reescriba la puerta de entrada.
 */
export class VaultPasswordError extends VaultError {
  constructor() {
    super("la contraseña no es la que abre esta ranura");
  }
}

/**
 * El contenido no cabe en la ranura.
 *
 * Las ranuras nunca crecen: si crecieran habría que recifrar ranuras cuyas
 * contraseñas no conocemos, y el propio crecimiento del fichero delataría
 * cuántas bóvedas reales hay dentro. Llenarla es un error recuperable
 * (borra ítems o crea un fichero con ranuras mayores), no un fallo del formato.
 */
export class VaultFullError extends VaultError {}

/** Se usó una bóveda cuyo material de clave ya fue destruido con `lock()`. */
export class VaultLockedError extends VaultError {
  constructor() {
    super("la bóveda está bloqueada: su material de clave ya fue destruido");
  }
}
