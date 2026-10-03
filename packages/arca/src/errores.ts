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
