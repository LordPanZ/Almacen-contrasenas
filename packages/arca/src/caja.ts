import {
  ARGON2_PROFILES,
  SecretBuffer,
  deriveKey,
  deriveMasterKey,
  generateSalt,
  open as aeadOpen,
  randomBytes,
  resolveProfile,
  seal as aeadSeal,
  toHex,
} from "@cerbero/crypto";
import type { Argon2Profile, Argon2ProfileName } from "@cerbero/crypto";
import { abrirDocumento, sellarDocumento } from "./documento.ts";
import type { OpcionesTrozo } from "./documento.ts";
import { CajaBloqueadaError, CajaPasswordError } from "./errores.ts";
import {
  ARCA_VERSION,
  CAJA_ID_LENGTH,
  CLAVE_DATOS_LENGTH,
  aadSobre,
  codificarCabecera,
  leerCabecera,
} from "./formato.ts";
import type { Cabecera } from "./formato.ts";
import { abrirIndice, sellarIndice } from "./indice.ts";
import type { Indice } from "./indice.ts";

/**
 * Jerarquía de claves de Arca.
 *
 * ```
 * contraseña + sal --Argon2id--> MK
 * MK --HKDF "arca-wrap-key"--> clave de envoltorio --abre--> sobre --> CD (aleatoria)
 * CD --HKDF "arca-index-key"-----------> clave del índice
 * CD --HKDF "arca-doc-key" ‖ docId------> clave de cada documento
 * ```
 *
 * La clave de datos (CD) es aleatoria y no se deriva de la contraseña. Así
 * cambiar la contraseña solo reenvuelve 72 bytes y nunca los documentos: sin
 * esa indirección, cambiarla obligaría a recifrar todos los PDF y fotos, que es
 * justo la operación que más fácil se interrumpe a medias.
 *
 * Ni el índice ni los documentos se cifran con la MK, y la MK se destruye en
 * cuanto produce la clave de envoltorio: una caja abierta en memoria no
 * contiene la clave derivada de la contraseña.
 */

function claveEnvoltorio(
  password: SecretBuffer,
  cabecera: Omit<Cabecera, "sobre">,
): SecretBuffer {
  const maestra = deriveMasterKey(password, cabecera.sal, cabecera.argon2);
  try {
    return deriveKey(maestra.bytes, "arca-wrap-key");
  } finally {
    maestra.destroy();
  }
}

/** Una caja abierta: guarda la clave de datos y nada más. */
export class Caja {
  #claveDatos: SecretBuffer | null;
  readonly #cajaId: Uint8Array;

  /** @internal Se crea con `crearCaja` o `abrirCaja`. */
  constructor(claveDatos: SecretBuffer, cajaId: Uint8Array) {
    this.#claveDatos = claveDatos;
    this.#cajaId = cajaId;
  }

  /** Identificador de la caja en hexadecimal. */
  get id(): string {
    return toHex(this.#cajaId);
  }

  get bloqueada(): boolean {
    return this.#claveDatos === null;
  }

  #clave(): SecretBuffer {
    if (!this.#claveDatos) throw new CajaBloqueadaError();
    return this.#claveDatos;
  }

  sellarIndice(indice: Indice): Uint8Array {
    return sellarIndice(this.#clave(), this.#cajaId, indice);
  }

  abrirIndice(sellado: Uint8Array): Indice {
    return abrirIndice(this.#clave(), this.#cajaId, sellado);
  }

  sellarDocumento(id: string, datos: Uint8Array, opciones?: OpcionesTrozo): Uint8Array {
    return sellarDocumento(this.#clave(), this.#cajaId, id, datos, opciones);
  }

  abrirDocumento(id: string, sellado: Uint8Array, opciones?: OpcionesTrozo): Uint8Array {
    return abrirDocumento(this.#clave(), this.#cajaId, id, sellado, opciones);
  }

  /** Borra de memoria la clave de datos. Después nada se puede cifrar ni descifrar. */
  bloquear(): void {
    this.#claveDatos?.destroy();
    this.#claveDatos = null;
  }
}

/** Identificador de documento nuevo: azar puro, sin estructura que leer. */
export function nuevoIdDocumento(): string {
  return toHex(randomBytes(16));
}

function envolver(
  claveDatos: SecretBuffer,
  password: SecretBuffer,
  cajaId: Uint8Array,
  perfil: Argon2Profile,
): Uint8Array {
  const sinSobre = { version: ARCA_VERSION, cajaId, argon2: perfil, sal: generateSalt() };
  const clave = claveEnvoltorio(password, sinSobre);
  try {
    const sobre = aeadSeal(clave, claveDatos.bytes, aadSobre(sinSobre));
    return codificarCabecera({ ...sinSobre, sobre });
  } finally {
    clave.destroy();
  }
}

export interface OpcionesCrear {
  readonly perfil?: Argon2ProfileName | Argon2Profile;
}

/** Crea una caja nueva. Devuelve su cabecera —lo único que hay que guardar en claro— y la caja abierta. */
export function crearCaja(
  password: SecretBuffer,
  opciones: OpcionesCrear = {},
): { cabecera: Uint8Array; caja: Caja } {
  const perfil = resolveProfile(opciones.perfil ?? ARGON2_PROFILES.moderate);
  const cajaId = randomBytes(CAJA_ID_LENGTH);
  const claveDatos = SecretBuffer.random(CLAVE_DATOS_LENGTH);
  try {
    const cabecera = envolver(claveDatos, password, cajaId, perfil);
    return { cabecera, caja: new Caja(claveDatos.clone(), cajaId) };
  } finally {
    claveDatos.destroy();
  }
}

/**
 * Desenvuelve la clave de datos. Es el único sitio donde se paga el Argon2 de
 * una contraseña existente, y falla igual con contraseña incorrecta que con
 * cabecera alterada: el mensaje no debe servir de oráculo.
 */
function desenvolver(
  cabecera: Uint8Array,
  password: SecretBuffer,
): { claveDatos: SecretBuffer; leida: Cabecera } {
  const leida = leerCabecera(cabecera);
  const clave = claveEnvoltorio(password, leida);
  try {
    return { claveDatos: SecretBuffer.wrap(aeadOpen(clave, leida.sobre, aadSobre(leida))), leida };
  } catch {
    throw new CajaPasswordError();
  } finally {
    clave.destroy();
  }
}

/** Abre una caja con su contraseña. */
export function abrirCaja(cabecera: Uint8Array, password: SecretBuffer): Caja {
  const { claveDatos, leida } = desenvolver(cabecera, password);
  return new Caja(claveDatos, leida.cajaId);
}

/**
 * Cambia la contraseña y devuelve la cabecera nueva.
 *
 * Primero se desenvuelve con la contraseña actual: sin esa comprobación un
 * despiste al teclear reenvolvería la clave de datos bajo una contraseña que
 * nadie conoce y la caja se perdería en silencio. Los documentos no se tocan.
 * La sal es nueva: una contraseña cambiada no debe compartir derivación con la
 * anterior.
 */
export function cambiarPassword(
  cabecera: Uint8Array,
  actual: SecretBuffer,
  nueva: SecretBuffer,
  opciones: OpcionesCrear = {},
): Uint8Array {
  const { claveDatos, leida } = desenvolver(cabecera, actual);
  try {
    const perfil = resolveProfile(opciones.perfil ?? leida.argon2);
    return envolver(claveDatos, nueva, leida.cajaId, perfil);
  } finally {
    claveDatos.destroy();
  }
}
