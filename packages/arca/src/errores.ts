import { CerberoError } from "@cerbero/crypto";

/** El fichero o el paquete no tiene la forma de una caja de Arca. */
export class CajaFormatoError extends CerberoError {
  constructor(message = "el fichero no tiene el formato de una caja de Arca") {
    super(message);
  }
}

/**
 * La clave derivada no abre el sobre.
 *
 * Contraseña incorrecta y cabecera alterada son indistinguibles a propósito: el
 * mensaje no debe servir de oráculo.
 */
export class CajaPasswordError extends CerberoError {
  constructor() {
    super("contraseña incorrecta, o el fichero está alterado");
  }
}

/** Se intentó usar una caja cuyas claves ya se borraron de memoria. */
export class CajaBloqueadaError extends CerberoError {
  constructor() {
    super("la caja está bloqueada");
  }
}

/**
 * Una operación sobre las carpetas que no se puede hacer: nombre repetido,
 * carpeta que no existe, última que queda… El mensaje se enseña tal cual al
 * usuario, así que está escrito para él.
 */
export class CategoriaError extends CerberoError {}

/** El fichero no tiene la forma de un envío cifrado de Arca. */
export class CompartidoFormatoError extends CerberoError {
  constructor(message = "el fichero no tiene el formato de un envío de Arca") {
    super(message);
  }
}

/**
 * El código no abre el envío.
 *
 * Código equivocado y fichero alterado son indistinguibles a propósito, por lo
 * mismo que en `CajaPasswordError`.
 */
export class CompartidoCodigoError extends CerberoError {
  constructor() {
    super("código incorrecto, o el fichero está alterado");
  }
}
