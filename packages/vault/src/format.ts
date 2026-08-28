import {
  AEAD_OVERHEAD,
  ARGON2_PROFILES,
  ByteReader,
  SALT_LENGTH,
  concatBytes,
  domainHash,
  uint16,
  uint32,
  utf8Encode,
} from "@cerbero/crypto";
import type { Argon2Profile } from "@cerbero/crypto";
import { VaultFormatError } from "./errors.ts";

/** Ocho bytes ASCII al principio del fichero: "CERBerO VaulT". */
export const VAULT_MAGIC = /* @__PURE__ */ utf8Encode("CERBOVLT");

export const VAULT_FORMAT_VERSION = 1;

/** Número de ranuras por defecto. Cuatro caben en cualquier historia creíble. */
export const DEFAULT_SLOT_COUNT = 4;

/** 256 KiB por ranura: sitio para varios cientos de entradas corrientes. */
export const DEFAULT_SLOT_SIZE = 256 * 1024;

export const MIN_SLOT_SIZE = 1024;
export const MAX_SLOT_SIZE = 64 * 1024 * 1024;
export const MAX_SLOT_COUNT = 64;

/** `magic(8) | versión(2) | ranuras(2) | tamaño(4) | argon2(12) | sal(32)`. */
export const VAULT_HEADER_LENGTH = VAULT_MAGIC.length + 2 + 2 + 4 + 12 + SALT_LENGTH;

// Cotas de cordura sobre los parámetros de Argon2 leídos del fichero. Sin
// ellas, alterar dos bytes de la cabecera bastaría para que el desbloqueo
// intentara reservar terabytes de memoria: una denegación de servicio gratuita
// contra quien solo quería abrir su bóveda.
const MAX_TIME_COST = 64;
const MIN_MEMORY_KIB = 8;
const MAX_MEMORY_KIB = 1024 * 1024;
const MAX_PARALLELISM = 64;

/** Lo único que un fichero de bóveda revela sin conocer ninguna contraseña. */
export interface VaultFileInfo {
  readonly version: number;
  readonly slotCount: number;
  readonly slotSize: number;
  readonly argon2: Argon2Profile;
  readonly salt: Uint8Array;
}

/** Fichero ya validado: cabecera aparte, porque entra íntegra en cada `aad`. */
export interface ParsedVaultFile {
  readonly info: VaultFileInfo;
  readonly header: Uint8Array;
  readonly bytes: Uint8Array;
}

/**
 * Nombre del perfil de Argon2 que corresponde a unos parámetros. La cabecera
 * guarda solo los números: el nombre es azúcar para las interfaces de usuario y
 * no debe influir en ninguna decisión criptográfica.
 */
function profileForParams(timeCost: number, memoryKiB: number, parallelism: number): Argon2Profile {
  for (const candidate of Object.values(ARGON2_PROFILES)) {
    if (
      candidate.timeCost === timeCost &&
      candidate.memoryKiB === memoryKiB &&
      candidate.parallelism === parallelism
    ) {
      return candidate;
    }
  }
  return { name: "personalizado", timeCost, memoryKiB, parallelism };
}

export function encodeVaultHeader(info: VaultFileInfo): Uint8Array {
  if (info.salt.length !== SALT_LENGTH) {
    throw new VaultFormatError(`la sal del fichero debe tener ${SALT_LENGTH} bytes`);
  }
  return concatBytes(
    VAULT_MAGIC,
    uint16(info.version),
    uint16(info.slotCount),
    uint32(info.slotSize),
    uint32(info.argon2.timeCost),
    uint32(info.argon2.memoryKiB),
    uint32(info.argon2.parallelism),
    info.salt,
  );
}

/**
 * Lee y valida la parte pública del fichero.
 *
 * Todo el parseo pasa por `ByteReader` y termina comprobando que el tamaño del
 * fichero coincide *exactamente* con el que anuncia la cabecera: un fichero
 * recortado, alargado o con una cuenta de ranuras alterada se rechaza aquí, y
 * no más adentro con media estructura ya interpretada.
 */
export function parseVaultFile(file: Uint8Array): ParsedVaultFile {
  if (file.length < VAULT_HEADER_LENGTH) {
    throw new VaultFormatError("el fichero es demasiado corto para contener una cabecera");
  }
  const reader = new ByteReader(file);
  const magic = reader.take(VAULT_MAGIC.length);
  for (let i = 0; i < VAULT_MAGIC.length; i++) {
    if (magic[i] !== VAULT_MAGIC[i]) throw new VaultFormatError();
  }

  const version = reader.takeUint16();
  if (version !== VAULT_FORMAT_VERSION) {
    throw new VaultFormatError(`versión de fichero no soportada: ${version}`);
  }

  const slotCount = reader.takeUint16();
  if (slotCount < 1 || slotCount > MAX_SLOT_COUNT) {
    throw new VaultFormatError("número de ranuras fuera de rango");
  }

  const slotSize = reader.takeUint32();
  if (slotSize < MIN_SLOT_SIZE || slotSize > MAX_SLOT_SIZE) {
    throw new VaultFormatError("tamaño de ranura fuera de rango");
  }

  const timeCost = reader.takeUint32();
  const memoryKiB = reader.takeUint32();
  const parallelism = reader.takeUint32();
  if (
    timeCost < 1 ||
    timeCost > MAX_TIME_COST ||
    memoryKiB < MIN_MEMORY_KIB ||
    memoryKiB > MAX_MEMORY_KIB ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM
  ) {
    throw new VaultFormatError("parámetros de Argon2 fuera de rango");
  }

  const salt = Uint8Array.from(reader.take(SALT_LENGTH));

  if (file.length !== VAULT_HEADER_LENGTH + slotCount * slotSize) {
    throw new VaultFormatError("el tamaño del fichero no cuadra con la cabecera");
  }

  return {
    info: {
      version,
      slotCount,
      slotSize,
      argon2: profileForParams(timeCost, memoryKiB, parallelism),
      salt,
    },
    header: file.subarray(0, VAULT_HEADER_LENGTH),
    bytes: file,
  };
}

/** Datos públicos del fichero. No toca ninguna ranura ni pide contraseña. */
export function vaultFileInfo(file: Uint8Array): VaultFileInfo {
  return parseVaultFile(file).info;
}

/** Posición de la ranura `index` dentro del fichero. */
export function slotOffset(info: VaultFileInfo, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index >= info.slotCount) {
    throw new VaultFormatError(`índice de ranura fuera de rango: ${index}`);
  }
  return VAULT_HEADER_LENGTH + index * info.slotSize;
}

/** Vista sobre los bytes de una ranura. No copia: no la conserves. */
export function slotBytes(parsed: ParsedVaultFile, index: number): Uint8Array {
  const start = slotOffset(parsed.info, index);
  return parsed.bytes.subarray(start, start + parsed.info.slotSize);
}

/**
 * Datos autenticados asociados a una ranura: cabecera completa e índice.
 *
 * Atar la ranura a la cabecera impide trasplantarla a otro fichero (otra sal,
 * otros parámetros) y atarla al índice impide reordenarlas dentro del mismo.
 * Sin esto, quien tuviera dos ficheros podría barajar ranuras entre ellos y las
 * etiquetas de autenticación seguirían validando.
 */
export function slotAad(header: Uint8Array, index: number): Uint8Array {
  return domainHash("vault-slot", header, uint32(index));
}

/** Espacio útil para el texto en claro de una ranura, ya descontado el AEAD. */
export function slotPlaintextCapacity(slotSize: number): number {
  return slotSize - AEAD_OVERHEAD;
}

/**
 * Devuelve una copia del fichero con la ranura `index` sustituida.
 *
 * Trabajar sobre una copia y sustituir un tramo de tamaño fijo es lo que
 * garantiza, por construcción, que guardar una bóveda deje las demás ranuras
 * byte a byte idénticas: no hay ninguna ruta de código capaz de tocarlas.
 */
export function replaceSlot(
  file: Uint8Array,
  info: VaultFileInfo,
  index: number,
  contents: Uint8Array,
): Uint8Array {
  if (contents.length !== info.slotSize) {
    throw new VaultFormatError("una ranura solo puede sustituirse por otra del mismo tamaño");
  }
  const out = Uint8Array.from(file);
  out.set(contents, slotOffset(info, index));
  return out;
}
