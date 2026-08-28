import {
  ByteReader,
  KDF_LABELS,
  SecretBuffer,
  concatBytes,
  deriveBytes,
  deriveKey,
  deriveMasterKey,
  fromHex,
  generateHybridKeyPair,
  generateSigningKeyPair,
  randomBytes,
  toHex,
  uint16,
  uint32,
  uint64,
} from "@cerbero/crypto";
import type { HybridKeyPair, HybridSigningKeyPair } from "@cerbero/crypto";
import { VaultFormatError } from "./errors.ts";
import { parseVaultFile } from "./format.ts";

export const VAULT_ID_LENGTH = 16;
export const VAULT_DATA_KEY_LENGTH = 32;
export const IDENTITY_SEED_LENGTH = 32;

const ENVELOPE_VERSION = 1;

/** `versión(2) | vaultId(16) | creado(8) | VDK(32) | semillaKEM(32) | semillaFirma(32)`. */
export const ENVELOPE_LENGTH =
  2 + VAULT_ID_LENGTH + 8 + VAULT_DATA_KEY_LENGTH + IDENTITY_SEED_LENGTH * 2;

/**
 * El sobre de una bóveda: lo que aparece al abrir una ranura y lo único que
 * hace falta para descifrar todo lo demás.
 *
 * La clave de datos (VDK) es aleatoria y vive aquí dentro, no se deriva de la
 * contraseña. Gracias a eso cambiar la contraseña maestra solo obliga a
 * recifrar el sobre —unos cientos de bytes— y nunca los ítems: sin esta
 * indirección, cada cambio de contraseña reescribiría la bóveda entera, que es
 * justo el momento en el que más fácil resulta corromperla o perderla.
 */
export interface VaultEnvelope {
  /** Identificador aleatorio sin significado; no se deriva de nada del usuario. */
  readonly vaultId: Uint8Array;
  readonly createdAt: number;
  /** Clave de datos de la bóveda: raíz de todas las claves de ítem. */
  readonly dataKey: SecretBuffer;
  readonly kemSeed: SecretBuffer;
  readonly signingSeed: SecretBuffer;
}

/**
 * Jerarquía de claves de Cerbero.
 *
 * ```
 * contraseña + sal --Argon2id--> MK
 * MK --HKDF "auth-key"----------------------> AuthKey
 * MK --HKDF "duress-slot-key" ctx=uint32(i)--> SlotKey_i --abre--> Sobre_i
 * Sobre.VDK --HKDF "item-key" ctx=itemId----> ItemKey
 * ```
 *
 * Por qué la MK no cifra nunca datos y la AuthKey nunca descifra nada: al
 * autenticarte contra un servidor le entregas necesariamente algo que él puede
 * comprobar. Si ese algo fuese la MK —o cualquier clave de la que la MK se
 * pueda recuperar— el servidor tendría, por definición, poder de descifrado
 * sobre la bóveda entera, y el "conocimiento cero" sería una promesa de
 * intenciones y no una propiedad del diseño. HKDF es una función de un solo
 * sentido: de la AuthKey no se vuelve a la MK, y sin la MK no hay SlotKey, ni
 * sobre, ni VDK, ni claves de ítem. El servidor puede verificar quién eres y
 * seguir siendo incapaz de leer un solo título de una entrada.
 *
 * La MK, además, vive lo mínimo: se deriva, produce la clave de ranura y se
 * destruye. Una bóveda abierta en memoria no contiene la clave maestra.
 */
export function deriveAuthKey(masterKey: SecretBuffer | Uint8Array): SecretBuffer {
  return deriveKey(bytesOf(masterKey), KDF_LABELS.authentication);
}

/**
 * Clave que abre la ranura `index`. El índice entra como contexto de HKDF, así
 * que la misma contraseña produce una clave distinta por ranura y probar las N
 * ranuras cuesta N derivaciones HKDF (microsegundos) tras un único Argon2.
 */
export function deriveSlotKey(masterKey: SecretBuffer | Uint8Array, index: number): SecretBuffer {
  return deriveKey(bytesOf(masterKey), KDF_LABELS.duressSlot, { context: uint32(index) });
}

/**
 * Clave de un ítem concreto. Una clave por ítem: quien logre romper o filtrar
 * la clave de una entrada no obtiene ninguna otra, y el mismo mecanismo permite
 * sincronizar ítems sueltos con un servidor sin darle nada más.
 */
export function deriveItemKey(
  dataKey: SecretBuffer | Uint8Array,
  itemId: Uint8Array,
): SecretBuffer {
  return deriveKey(bytesOf(dataKey), KDF_LABELS.itemKey, { context: itemId });
}

/**
 * Deriva únicamente la clave de autenticación de un fichero de bóveda.
 *
 * Es la operación que haría un cliente para identificarse ante un servidor de
 * sincronización: usa la sal y los parámetros públicos del fichero, y devuelve
 * algo que no abre ninguna ranura.
 */
export function deriveFileAuthKey(file: Uint8Array, password: SecretBuffer): SecretBuffer {
  const { info } = parseVaultFile(file);
  const masterKey = deriveMasterKey(password, info.salt, info.argon2);
  try {
    return deriveAuthKey(masterKey);
  } finally {
    masterKey.destroy();
  }
}

export function createEnvelope(): VaultEnvelope {
  return {
    vaultId: randomBytes(VAULT_ID_LENGTH),
    createdAt: Date.now(),
    dataKey: SecretBuffer.random(VAULT_DATA_KEY_LENGTH),
    kemSeed: SecretBuffer.random(IDENTITY_SEED_LENGTH),
    signingSeed: SecretBuffer.random(IDENTITY_SEED_LENGTH),
  };
}

/**
 * Serializa el sobre. El resultado es material de clave en claro: quien lo
 * llama debe sellarlo y borrarlo (`zeroize`) sin dejarlo vivir en el montón.
 */
export function encodeEnvelope(envelope: VaultEnvelope): Uint8Array {
  return concatBytes(
    uint16(ENVELOPE_VERSION),
    envelope.vaultId,
    uint64(envelope.createdAt),
    envelope.dataKey.bytes,
    envelope.kemSeed.bytes,
    envelope.signingSeed.bytes,
  );
}

/**
 * Lee un sobre del texto en claro de una ranura. Copia cada secreto a su propio
 * `SecretBuffer`: `ByteReader` devuelve vistas sobre el buffer de origen, y ese
 * buffer se borra en cuanto termina el desbloqueo.
 */
export function decodeEnvelope(reader: ByteReader): VaultEnvelope {
  const version = reader.takeUint16();
  if (version !== ENVELOPE_VERSION) {
    throw new VaultFormatError(`versión de sobre no soportada: ${version}`);
  }
  const vaultId = Uint8Array.from(reader.take(VAULT_ID_LENGTH));
  const createdAt = Number(reader.takeUint64());
  const dataKey = SecretBuffer.copyOf(reader.take(VAULT_DATA_KEY_LENGTH));
  const kemSeed = SecretBuffer.copyOf(reader.take(IDENTITY_SEED_LENGTH));
  const signingSeed = SecretBuffer.copyOf(reader.take(IDENTITY_SEED_LENGTH));
  return { vaultId, createdAt, dataKey, kemSeed, signingSeed };
}

export function destroyEnvelope(envelope: VaultEnvelope): void {
  envelope.dataKey.destroy();
  envelope.kemSeed.destroy();
  envelope.signingSeed.destroy();
}

/**
 * Par de claves del KEM híbrido de la bóveda.
 *
 * Se regenera desde la semilla del sobre en cada llamada en vez de guardarse:
 * no hay un segundo fichero de claves que perder, filtrar o que se
 * desincronice, y cualquier copia de la bóveda produce exactamente la misma
 * identidad. La semilla pasa antes por HKDF atada al vaultId para que dos
 * bóvedas nunca compartan identidad aunque compartieran semilla.
 */
export function envelopeIdentityKeyPair(envelope: VaultEnvelope): HybridKeyPair {
  const seed = deriveBytes(envelope.kemSeed.bytes, KDF_LABELS.identityKem, {
    context: envelope.vaultId,
  });
  try {
    return generateHybridKeyPair(seed);
  } finally {
    seed.fill(0);
  }
}

/** Par de firma de la bóveda, derivado igual que la identidad KEM. */
export function envelopeSigningKeyPair(envelope: VaultEnvelope): HybridSigningKeyPair {
  const seed = deriveBytes(envelope.signingSeed.bytes, KDF_LABELS.identitySigning, {
    context: envelope.vaultId,
  });
  try {
    return generateSigningKeyPair(seed);
  } finally {
    seed.fill(0);
  }
}

/** Identificador en hexadecimal, la forma en que lo ve el resto del sistema. */
export function formatId(id: Uint8Array): string {
  return toHex(id);
}

/** Inverso de `formatId`, con comprobación estricta de longitud. */
export function parseId(id: string, length: number, what: string): Uint8Array {
  if (id.length !== length * 2 || !/^[0-9a-f]+$/.test(id)) {
    throw new VaultFormatError(`${what} no válido`);
  }
  return fromHex(id);
}

function bytesOf(key: SecretBuffer | Uint8Array): Uint8Array {
  return key instanceof Uint8Array ? key : key.bytes;
}
