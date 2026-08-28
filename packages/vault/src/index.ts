/**
 * @cerbero/vault — jerarquía de claves, cifrado de ítems y bóvedas de coacción.
 *
 * Dos propiedades definen este paquete y conviene tenerlas presentes al leerlo:
 * los metadatos viajan **dentro** del cifrado (fuera solo queda un identificador
 * aleatorio sin significado), y todas las ranuras de un fichero son
 * indistinguibles entre sí, tengan una bóveda dentro o solo ruido.
 */

export {
  VaultError,
  VaultFormatError,
  VaultFullError,
  VaultLockedError,
  VaultPasswordError,
  VaultUnlockError,
} from "./errors.ts";

export {
  DEFAULT_SLOT_COUNT,
  DEFAULT_SLOT_SIZE,
  MAX_SLOT_COUNT,
  MAX_SLOT_SIZE,
  MIN_SLOT_SIZE,
  VAULT_FORMAT_VERSION,
  VAULT_HEADER_LENGTH,
  slotPlaintextCapacity,
  vaultFileInfo,
} from "./format.ts";
export type { VaultFileInfo } from "./format.ts";

export {
  IDENTITY_SEED_LENGTH,
  VAULT_DATA_KEY_LENGTH,
  VAULT_ID_LENGTH,
  deriveAuthKey,
  deriveFileAuthKey,
  deriveItemKey,
  deriveSlotKey,
} from "./keys.ts";

export {
  ITEM_BUCKETS,
  ITEM_ID_LENGTH,
  VAULT_ITEM_TYPES,
  bucketFor,
  itemSummary,
  newItemId,
  openVaultItem,
  sealVaultItem,
} from "./items.ts";
export type { VaultItem, VaultItemDraft, VaultItemSummary, VaultItemType } from "./items.ts";

export {
  UnlockedVault,
  addVaultSlot,
  createVault,
  unlockVault,
  verifyVaultPassword,
} from "./vault.ts";
export type { AddVaultSlotOptions, CreateVaultOptions } from "./vault.ts";
