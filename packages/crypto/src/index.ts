/**
 * @cerbero/crypto — primitivas criptográficas de Cerbero.
 *
 * Todo el sistema se apoya exclusivamente en este paquete para criptografía.
 * Ningún otro paquete importa @noble/* directamente: así hay un solo sitio que
 * auditar, un solo sitio donde cambiar de algoritmo y ninguna posibilidad de
 * que alguien use una primitiva "casi bien" en un rincón del código.
 */

export {
  AEAD_KEY_LENGTH,
  AEAD_NONCE_LENGTH,
  AEAD_OVERHEAD,
  AEAD_TAG_LENGTH,
  open,
  seal,
  sealWithNonce,
  tryOpen,
} from "./aead.ts";

export {
  ByteReader,
  concatBytes,
  fromBase64Url,
  fromHex,
  lengthPrefixed,
  toBase64Url,
  toHex,
  uint16,
  uint32,
  uint64,
  utf8Decode,
  utf8Encode,
} from "./encoding.ts";

export { AeadError, CerberoError, DestroyedSecretError, InvalidInputError } from "./errors.ts";

export { blake3, constantTimeEqual, domainHash, hmacSha256, sha256, sha512 } from "./hash.ts";

export {
  HYBRID_KEM,
  generateHybridKeyPair,
  hybridDecapsulate,
  hybridEncapsulate,
  hybridFingerprint,
  hybridOpen,
  hybridPublicKeyFrom,
  hybridSeal,
} from "./hybrid.ts";
export type { Encapsulation, HybridKeyPair } from "./hybrid.ts";

export {
  ARGON2_PROFILES,
  KDF_LABELS,
  MASTER_KEY_LENGTH,
  SALT_LENGTH,
  deriveBytes,
  deriveKey,
  deriveMasterKey,
  generateSalt,
  resolveProfile,
} from "./kdf.ts";
export type { Argon2Profile, Argon2ProfileName, KdfLabel } from "./kdf.ts";

export { randomBytes, randomChoice, randomInt, shuffleInPlace } from "./random.ts";

export { SecretBuffer, withSecret, withSecretAsync, zeroize } from "./secret.ts";

export {
  HYBRID_SIGNATURE,
  generateSigningKeyPair,
  hybridSign,
  hybridVerify,
} from "./signature.ts";
export type { HybridSigningKeyPair } from "./signature.ts";

export {
  SHARE_SET_ID_LENGTH,
  combineShares,
  decodeShare,
  encodeShare,
  splitSecret,
} from "./shamir.ts";
export type { ShamirShare } from "./shamir.ts";
