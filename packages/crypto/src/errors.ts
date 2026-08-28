/**
 * Jerarquía de errores del núcleo criptográfico.
 *
 * Regla de oro: un fallo criptográfico nunca revela *por qué* falló más allá
 * de la categoría. Nada de "tag inválido en el byte 7" ni de mensajes que
 * distingan "clave incorrecta" de "datos corruptos": esa distinción es
 * exactamente lo que un atacante necesita para montar un oráculo.
 */
export class CerberoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Fallo de descifrado o de verificación de autenticidad. Deliberadamente opaco. */
export class AeadError extends CerberoError {
  constructor(message = "fallo de descifrado autenticado") {
    super(message);
  }
}

/** Un argumento no cumple el contrato (longitud, rango, formato). */
export class InvalidInputError extends CerberoError {}

/** Se ha intentado usar material secreto ya borrado de memoria. */
export class DestroyedSecretError extends CerberoError {
  constructor(message = "el material secreto ya fue borrado de memoria") {
    super(message);
  }
}
