import {
  InvalidInputError,
  KDF_LABELS,
  SecretBuffer,
  constantTimeEqual,
  deriveBytes,
  deriveKey,
  domainHash,
  hmacSha256,
  randomBytes,
  shuffleInPlace,
  toHex,
  utf8Encode,
} from "@cerbero/crypto";
import { FlujoDeterminista } from "./flujo.ts";
import { LONGITUD_POR_DEFECTO, construirCaracteres, type PasswordOptions } from "./generador.ts";
import {
  APELLIDOS_SENUELO,
  DOMINIOS_SENUELO,
  NOMBRES_SENUELO,
  SERVICIOS_SENUELO,
} from "./listas.ts";

/** Bytes de identificador de canario; 16 bastan para no colisionar nunca. */
export const LONGITUD_ID_CANARIO = 16;

/** Bytes de marca que se publican en el registro del canario. */
export const LONGITUD_MARCA = 8;

/**
 * Por debajo de esta longitud el número de ordenaciones posibles es demasiado
 * pequeño y `isCanary` empezaría a dar falsos positivos apreciables sobre
 * contraseñas ajenas. Se rechaza en vez de degradar en silencio.
 */
export const LONGITUD_MINIMA_CANARIO = 12;

export type CanaryOrigin = "lectura" | "uso" | "exportacion" | "sincronizacion";
export type CanarySeverity = "media" | "alta" | "crítica";

export interface CanaryCredential {
  /** Identificador público del señuelo; independiente de su contraseña. */
  readonly id: string;
  readonly servicio: string;
  readonly usuario: string;
  readonly secret: string;
  readonly creadoEn: number;
  /** Marca truncada en hexadecimal, para cotejar el registro con la clave. */
  readonly marca: string;
}

export interface CanaryOptions {
  /** Id concreto: con el mismo id y la misma clave sale el mismo señuelo. */
  readonly id?: string;
  readonly servicio?: string;
  readonly usuario?: string;
  readonly longitud?: number;
  readonly creadoEn?: number;
}

export interface CanaryContext {
  readonly origen: CanaryOrigin;
  readonly detalle?: string;
  readonly dispositivo?: string;
  readonly direccion?: string;
  readonly ocurridoEn?: number;
}

export interface CanaryAlarm {
  readonly canaryId: string;
  readonly servicio: string;
  readonly severidad: CanarySeverity;
  readonly detectadoEn: number;
  readonly contexto: CanaryContext;
  readonly mensaje: string;
}

/**
 * Un intento de *uso* significa que la credencial ya salió de la bóveda y
 * alguien la está probando contra el servicio: eso es una intrusión confirmada.
 * Una *lectura* puede ser todavía el propio titular curioseando.
 */
export const SEVERIDAD_POR_ORIGEN: Readonly<Record<CanaryOrigin, CanarySeverity>> = {
  uso: "crítica",
  exportacion: "crítica",
  lectura: "alta",
  sincronizacion: "media",
};

const DESCRIPCION_ORIGEN: Readonly<Record<CanaryOrigin, string>> = {
  uso: "se ha intentado usar",
  exportacion: "se ha exportado",
  lectura: "se ha leído",
  sincronizacion: "se ha sincronizado",
};

function bytesDeClave(clave: SecretBuffer | Uint8Array): Uint8Array {
  return clave instanceof SecretBuffer ? clave.bytes : clave;
}

/**
 * Clave de canarios derivada de la clave de la bóveda.
 *
 * Nace de su propia etiqueta KDF para que, aunque se filtre, no sirva para
 * descifrar nada: reconocer señuelos y abrir la bóveda son capacidades
 * distintas y deben vivir en claves distintas.
 */
export function generateCanaryKey(vaultKey: SecretBuffer | Uint8Array): SecretBuffer {
  return deriveKey(bytesDeClave(vaultKey), KDF_LABELS.canaryTag);
}

/** Orden canónico de los caracteres: la forma del secreto que no depende del orden. */
function ordenCanonico(secret: string): string[] {
  return [...secret].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Semilla de la marca: HMAC de la clave del titular sobre la forma canónica del
 * secreto.
 *
 * La marca se ata al multiconjunto de caracteres y no al id del canario, y esa
 * es la decisión de diseño importante. Atarla al id obligaría a que el id fuese
 * recuperable desde la contraseña; pero el id viaja en claro dentro del
 * registro de la bóveda, así que quien robe la bóveda podría recalcularlo desde
 * cada contraseña y marcar de un vistazo qué entradas son señuelos. Con la
 * marca sobre los propios caracteres, el id queda estadísticamente
 * independiente del secreto y solo la clave revela la relación.
 */
function semillaMarca(secret: string, canaryKey: SecretBuffer | Uint8Array): Uint8Array {
  const canonico = utf8Encode(ordenCanonico(secret).join(""));
  return hmacSha256(bytesDeClave(canaryKey), domainHash("sentinel/marca-canario", canonico));
}

/**
 * Reconstruye la contraseña que corresponde a ese multiconjunto de caracteres.
 *
 * La marca se incrusta en el *orden* de los caracteres: se ordenan y se barajan
 * con un Fisher-Yates guiado por la marca. El resultado tiene exactamente la
 * misma distribución que `generatePassword` —mismo multiconjunto, permutación
 * uniforme— así que un señuelo es indistinguible de una contraseña real sin la
 * clave, mientras que con ella basta reordenar y comparar.
 */
function contrasenaMarcada(caracteres: readonly string[], semilla: Uint8Array): string {
  const flujo = new FlujoDeterminista(semilla, "sentinel/orden-canario");
  return flujo.barajar([...caracteres]).join("");
}

/** Marca truncada en hexadecimal que se guarda junto al señuelo. */
export function canaryMark(secret: string, canaryKey: SecretBuffer | Uint8Array): string {
  return toHex(semillaMarca(secret, canaryKey).subarray(0, LONGITUD_MARCA));
}

function usuarioVerosimil(flujo: FlujoDeterminista): string {
  const nombre = flujo.elegir(NOMBRES_SENUELO);
  const apellido = flujo.elegir(APELLIDOS_SENUELO);
  const dominio = flujo.elegir(DOMINIOS_SENUELO);
  switch (flujo.entero(6)) {
    case 0:
      return `${nombre}.${apellido}`;
    case 1:
      return `${nombre}_${apellido}`;
    case 2:
      return `${nombre}.${apellido}@${dominio}`;
    case 3:
      return `${nombre}${apellido}@${dominio}`;
    case 4:
      return `${nombre.charAt(0)}${apellido}`;
    default:
      return `${nombre}${apellido}${String(flujo.entero(100)).padStart(2, "0")}`;
  }
}

/**
 * Crea una credencial trampa.
 *
 * Todo el señuelo —servicio, usuario y caracteres de la contraseña— sale de un
 * flujo determinista derivado de `(clave, id)`: el titular puede recrearlo
 * cuando quiera para comprobar que el que hay en la bóveda no ha sido alterado,
 * sin guardar ningún estado adicional.
 */
export function createCanary(
  canaryKey: SecretBuffer | Uint8Array,
  options: CanaryOptions = {},
): CanaryCredential {
  const id = options.id ?? toHex(randomBytes(LONGITUD_ID_CANARIO));
  if (id.length === 0) throw new InvalidInputError("el id del canario no puede estar vacío");
  const longitud = options.longitud ?? LONGITUD_POR_DEFECTO;
  if (!Number.isSafeInteger(longitud) || longitud < LONGITUD_MINIMA_CANARIO) {
    throw new InvalidInputError(
      `un canario necesita al menos ${LONGITUD_MINIMA_CANARIO} caracteres para que la marca sea fiable`,
    );
  }

  const semilla = deriveBytes(bytesDeClave(canaryKey), "canary-decoy-seed", {
    context: utf8Encode(id),
    length: 32,
  });
  const flujo = new FlujoDeterminista(semilla, "sentinel/senuelo");

  const servicio = options.servicio ?? flujo.elegir(SERVICIOS_SENUELO);
  const usuario = options.usuario ?? usuarioVerosimil(flujo);
  const opcionesContrasena: PasswordOptions = { longitud };
  const caracteres = ordenCanonico(construirCaracteres(opcionesContrasena, flujo).join(""));

  // La marca depende solo del multiconjunto ya ordenado, así que se puede
  // calcular antes de decidir el orden final: ese orden *es* la marca.
  const semillaDeMarca = hmacSha256(
    bytesDeClave(canaryKey),
    domainHash("sentinel/marca-canario", utf8Encode(caracteres.join(""))),
  );
  const secret = contrasenaMarcada(caracteres, semillaDeMarca);

  return {
    id,
    servicio,
    usuario,
    secret,
    creadoEn: options.creadoEn ?? Date.now(),
    marca: toHex(semillaDeMarca.subarray(0, LONGITUD_MARCA)),
  };
}

/**
 * ¿Es esta contraseña un canario del titular?
 *
 * No consulta ninguna lista: la respuesta sale de la contraseña y de la clave,
 * así que funciona sobre una credencial vista en un registro de acceso, en un
 * portapapeles o en un intento de inicio de sesión, aunque la bóveda no esté
 * abierta.
 */
export function isCanary(secret: string, canaryKey: SecretBuffer | Uint8Array): boolean {
  if (secret.length < LONGITUD_MINIMA_CANARIO) return false;
  const caracteres = ordenCanonico(secret);
  const esperado = contrasenaMarcada(caracteres, semillaMarca(secret, canaryKey));
  return constantTimeEqual(utf8Encode(esperado), utf8Encode(secret));
}

/**
 * Comprueba que el registro completo del canario es coherente con la clave.
 *
 * Además de reconocer la contraseña verifica la marca almacenada: detecta que
 * alguien haya editado el registro para hacer pasar por señuelo una credencial
 * real, o al revés.
 */
export function verifyCanary(
  canary: CanaryCredential,
  canaryKey: SecretBuffer | Uint8Array,
): boolean {
  if (!isCanary(canary.secret, canaryKey)) return false;
  const esperada = utf8Encode(canaryMark(canary.secret, canaryKey));
  return constantTimeEqual(esperada, utf8Encode(canary.marca));
}

/**
 * Conjunto de señuelos variados.
 *
 * Los servicios se reparten sin repetir mientras alcanza el catálogo: diez
 * entradas del mismo banco en una bóveda de veinte llamarían la atención de
 * cualquiera que la abriese.
 */
export function createCanarySet(
  canaryKey: SecretBuffer | Uint8Array,
  cantidad: number,
  options: Omit<CanaryOptions, "id" | "servicio"> = {},
): CanaryCredential[] {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) {
    throw new InvalidInputError("la cantidad de canarios debe ser un entero positivo");
  }
  const catalogo = shuffleInPlace([...SERVICIOS_SENUELO]);
  const canarios: CanaryCredential[] = [];
  for (let i = 0; i < cantidad; i++) {
    canarios.push(
      createCanary(canaryKey, {
        ...options,
        servicio: catalogo[i % catalogo.length] as string,
      }),
    );
  }
  return canarios;
}

/**
 * Convierte la detección de un canario en un evento de alarma.
 *
 * El mensaje no incluye nunca el secreto: la alarma acaba en el registro de
 * auditoría, y un registro que copia contraseñas convierte cada alerta en una
 * segunda filtración.
 */
export function raiseCanaryAlarm(
  canary: CanaryCredential,
  contexto: CanaryContext,
): CanaryAlarm {
  const severidad = SEVERIDAD_POR_ORIGEN[contexto.origen];
  if (severidad === undefined) {
    throw new InvalidInputError(`origen de alarma desconocido: ${String(contexto.origen)}`);
  }
  const donde = contexto.dispositivo ? ` desde ${contexto.dispositivo}` : "";
  const mensaje =
    `Credencial trampa de ${canary.servicio}: ${DESCRIPCION_ORIGEN[contexto.origen]}${donde}. ` +
    "Nadie debería tocar esta entrada: la bóveda está comprometida.";
  return {
    canaryId: canary.id,
    servicio: canary.servicio,
    severidad,
    detectadoEn: contexto.ocurridoEn ?? Date.now(),
    contexto,
    mensaje,
  };
}
