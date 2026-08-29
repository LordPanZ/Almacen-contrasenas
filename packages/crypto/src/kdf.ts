import { argon2id } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8Encode } from "./encoding.ts";
import { InvalidInputError } from "./errors.ts";
import { randomBytes } from "./random.ts";
import { SecretBuffer } from "./secret.ts";

export const MASTER_KEY_LENGTH = 32;
export const SALT_LENGTH = 32;

/**
 * Parámetros de Argon2id. `memoryKiB` es el que de verdad importa: encarece el
 * ataque con hardware dedicado (GPU/ASIC), que es el escenario real cuando
 * alguien se lleva el fichero de la bóveda y ataca sin prisa y sin conexión.
 */
export interface Argon2Profile {
  readonly name: string;
  readonly timeCost: number;
  readonly memoryKiB: number;
  readonly parallelism: number;
}

/**
 * Perfiles calibrados para la implementación en JavaScript puro. Con enlaces
 * nativos (libargon2) los mismos parámetros son de 5 a 10 veces más rápidos,
 * así que en producción conviene subir de perfil, no bajarlo.
 */
export const ARGON2_PROFILES = {
  /** SOLO para tests: sin coste de memoria real, no usar con datos reales. */
  test: { name: "test", timeCost: 1, memoryKiB: 8 * 1024, parallelism: 1 },
  /** Desbloqueo interactivo en un portátil corriente (~2 s). */
  interactive: { name: "interactive", timeCost: 3, memoryKiB: 64 * 1024, parallelism: 4 },
  /** Por defecto para una bóveda personal (~10 s). */
  moderate: { name: "moderate", timeCost: 4, memoryKiB: 256 * 1024, parallelism: 4 },
  /** Secretos de alto valor, cuando la espera al desbloquear no importa. */
  paranoid: { name: "paranoid", timeCost: 6, memoryKiB: 512 * 1024, parallelism: 4 },
} as const satisfies Record<string, Argon2Profile>;

export type Argon2ProfileName = keyof typeof ARGON2_PROFILES;

export function resolveProfile(profile: Argon2ProfileName | Argon2Profile): Argon2Profile {
  if (typeof profile === "string") {
    const found = ARGON2_PROFILES[profile];
    if (!found) throw new InvalidInputError(`perfil de Argon2 desconocido: ${profile}`);
    return found;
  }
  if (profile.timeCost < 1 || profile.memoryKiB < 8 || profile.parallelism < 1) {
    throw new InvalidInputError("parámetros de Argon2 fuera de rango");
  }
  return profile;
}

export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

/**
 * Deriva la clave maestra a partir de la contraseña maestra.
 *
 * Argon2id combina resistencia a canal lateral (fase tipo Argon2i) con
 * resistencia a hardware dedicado (fase tipo Argon2d): es la elección de
 * referencia frente a PBKDF2, que al no usar memoria se paraleliza en GPU casi
 * gratis. Este es el único punto donde la seguridad depende de la calidad de
 * una contraseña humana, de ahí el coste deliberadamente alto.
 */
export function deriveMasterKey(
  password: SecretBuffer,
  salt: Uint8Array,
  profile: Argon2ProfileName | Argon2Profile = "moderate",
): SecretBuffer {
  if (salt.length < 16) {
    throw new InvalidInputError("la sal debe tener al menos 16 bytes");
  }
  const params = resolveProfile(profile);
  const derived = argon2id(password.bytes, salt, {
    t: params.timeCost,
    m: params.memoryKiB,
    p: params.parallelism,
    dkLen: MASTER_KEY_LENGTH,
  });
  return SecretBuffer.wrap(derived);
}

/**
 * Etiquetas de derivación. Cada clave del sistema nace de una etiqueta distinta,
 * de forma que dos claves nunca coinciden aunque partan del mismo secreto.
 * Sin esta separación, la clave de autenticación con el servidor podría
 * coincidir con la que descifra la bóveda: entregarías el vault al servidor.
 */
export const KDF_LABELS = {
  authentication: "auth-key",
  keyWrapping: "key-wrapping-key",
  vaultData: "vault-data-key",
  itemKey: "item-key",
  metadataKey: "metadata-key",
  identityKem: "identity-kem-seed",
  identitySigning: "identity-signing-seed",
  ledgerSigning: "ledger-signing-seed",
  duressSlot: "duress-slot-key",
  guardianShare: "guardian-share-key",
  timeLock: "time-lock-key",
  canaryTag: "canary-tag-key",
  breachRequest: "breach-request-key",
  hardwareFactor: "hardware-factor",
  webauthnSalt: "webauthn-prf-salt",
} as const;

export type KdfLabel = (typeof KDF_LABELS)[keyof typeof KDF_LABELS] | (string & {});

/**
 * HKDF-SHA256 con separación de dominios obligatoria.
 *
 * `context` permite atar la clave derivada a datos concretos (identificador de
 * ítem, versión del formato…), de forma que la misma clave raíz produce claves
 * distintas para contextos distintos.
 */
export function deriveKey(
  ikm: Uint8Array,
  label: KdfLabel,
  options: { readonly salt?: Uint8Array; readonly context?: Uint8Array; readonly length?: number } = {},
): SecretBuffer {
  const length = options.length ?? 32;
  if (length < 1 || length > 8160) {
    throw new InvalidInputError("longitud de clave derivada fuera de rango");
  }
  const info = options.context
    ? concatBytes(utf8Encode(`cerbero/v1/${label}/`), options.context)
    : utf8Encode(`cerbero/v1/${label}`);
  return SecretBuffer.wrap(hkdf(sha256, ikm, options.salt ?? new Uint8Array(0), info, length));
}

/** Variante de `deriveKey` que devuelve bytes sueltos, para datos no secretos. */
export function deriveBytes(
  ikm: Uint8Array,
  label: KdfLabel,
  options: { readonly salt?: Uint8Array; readonly context?: Uint8Array; readonly length?: number } = {},
): Uint8Array {
  const secret = deriveKey(ikm, label, options);
  const copy = Uint8Array.from(secret.bytes);
  secret.destroy();
  return copy;
}

/** Bytes del factor hardware. Es lo que devuelve el PRF de WebAuthn. */
export const HARDWARE_FACTOR_LENGTH = 32;

/**
 * Mezcla un factor de hardware en la clave maestra.
 *
 * El resultado sustituye a la clave maestra para todo lo que venga después, de
 * modo que sin el factor **no se llega a ninguna clave de ranura**: un fichero
 * robado no se abre ni conociendo la contraseña. HKDF es de un solo sentido, así
 * que de la clave resultante tampoco se recupera el factor.
 *
 * El factor entra como `context` y no como `salt` a propósito: el material de
 * entrada sigue siendo la clave maestra, que es donde vive la entropía de la
 * contraseña, y el factor solo separa dominios. Si entrara como IKM, un factor
 * de baja entropía degradaría el resultado.
 */
export function bindHardwareFactor(
  masterKey: SecretBuffer | Uint8Array,
  factor: Uint8Array,
): SecretBuffer {
  if (factor.length < 16) {
    throw new InvalidInputError("el factor de hardware debe tener al menos 16 bytes");
  }
  const ikm = masterKey instanceof Uint8Array ? masterKey : masterKey.bytes;
  return deriveKey(ikm, KDF_LABELS.hardwareFactor, { context: factor });
}

/**
 * Sal que se le pide evaluar al autenticador, derivada de la del fichero.
 *
 * Va atada al fichero para que la misma llave física produzca un factor
 * distinto en cada bóveda: si fuera una constante, quien obtuviera el factor de
 * una bóveda lo tendría para todas las demás protegidas con la misma llave.
 *
 * Es un valor público —la sal del fichero también lo es— y no hace falta
 * guardarlo: se recalcula al abrir, así que el formato del fichero no cambia y
 * nada en él delata que haya una llave de por medio.
 */
export function webauthnPrfSalt(fileSalt: Uint8Array): Uint8Array {
  return deriveBytes(fileSalt, KDF_LABELS.webauthnSalt, { length: 32 });
}
