import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ByteReader, concatBytes, lengthPrefixed, utf8Encode } from "./encoding.ts";
import { InvalidInputError } from "./errors.ts";
import { deriveBytes } from "./kdf.ts";
import { randomBytes } from "./random.ts";
import { SecretBuffer } from "./secret.ts";

const ED25519_PUBLIC_KEY_LENGTH = 32;
const ED25519_SECRET_KEY_LENGTH = 32;
const ED25519_SIGNATURE_LENGTH = 64;
const MLDSA_PUBLIC_KEY_LENGTH = 1952;
const MLDSA_SECRET_KEY_LENGTH = 4032;
const MLDSA_SIGNATURE_LENGTH = 3309;

/**
 * Firma híbrida: Ed25519 + ML-DSA-65 (FIPS 204).
 *
 * Una firma solo vale si *ambas* verifican. Igual que en el KEM híbrido, el
 * atacante necesita romper las dos familias. Aquí importa especialmente porque
 * las firmas del registro de auditoría deben seguir siendo verificables dentro
 * de décadas: es lo que demuestra que el histórico de tu bóveda no fue reescrito.
 */
export const HYBRID_SIGNATURE = {
  seedLength: 32,
  publicKeyLength: ED25519_PUBLIC_KEY_LENGTH + MLDSA_PUBLIC_KEY_LENGTH,
  secretKeyLength: ED25519_SECRET_KEY_LENGTH + MLDSA_SECRET_KEY_LENGTH,
  signatureLength: ED25519_SIGNATURE_LENGTH + MLDSA_SIGNATURE_LENGTH,
} as const;

export interface HybridSigningKeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: SecretBuffer;
}

/** Genera un par de firma; con `seed` (32 bytes) el resultado es determinista. */
export function generateSigningKeyPair(seed?: Uint8Array): HybridSigningKeyPair {
  const material = seed ?? randomBytes(HYBRID_SIGNATURE.seedLength);
  if (material.length !== HYBRID_SIGNATURE.seedLength) {
    throw new InvalidInputError(`la semilla debe tener ${HYBRID_SIGNATURE.seedLength} bytes`);
  }
  // Semillas independientes por algoritmo: un fallo que filtre una no debe
  // comprometer la otra, que es justo el punto de ser híbrido.
  const edSeed = deriveBytes(material, "sig-ed25519", { length: ED25519_SECRET_KEY_LENGTH });
  const dsaSeed = deriveBytes(material, "sig-ml-dsa", { length: 32 });

  const edPublic = ed25519.getPublicKey(edSeed);
  const dsa = ml_dsa65.keygen(dsaSeed);
  dsaSeed.fill(0);

  return {
    publicKey: concatBytes(edPublic, dsa.publicKey),
    secretKey: SecretBuffer.wrap(concatBytes(edSeed, dsa.secretKey)),
  };
}

/**
 * Todo lo que se firma va precedido de una etiqueta de contexto y con marcado
 * inequívoco, para que una firma emitida en un contexto (por ejemplo, una
 * entrada del registro) no pueda reutilizarse en otro (una atestación de guardián).
 */
function preparedMessage(context: string, message: Uint8Array): Uint8Array {
  return concatBytes(lengthPrefixed(utf8Encode(`cerbero/v1/sign/${context}`)), lengthPrefixed(message));
}

export function hybridSign(
  secretKey: SecretBuffer | Uint8Array,
  message: Uint8Array,
  context = "generic",
): Uint8Array {
  const bytes = secretKey instanceof Uint8Array ? secretKey : secretKey.bytes;
  if (bytes.length !== HYBRID_SIGNATURE.secretKeyLength) {
    throw new InvalidInputError("longitud de clave privada de firma incorrecta");
  }
  const reader = new ByteReader(bytes);
  const edSecret = reader.take(ED25519_SECRET_KEY_LENGTH);
  const dsaSecret = reader.take(MLDSA_SECRET_KEY_LENGTH);
  const prepared = preparedMessage(context, message);
  return concatBytes(ed25519.sign(prepared, edSecret), ml_dsa65.sign(prepared, dsaSecret));
}

/**
 * Verifica la firma híbrida. Devuelve `true` solo si ambos algoritmos aceptan.
 *
 * Se evalúan los dos siempre (sin cortocircuito) para no filtrar por tiempo
 * cuál de los dos falló.
 */
export function hybridVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  context = "generic",
): boolean {
  if (
    publicKey.length !== HYBRID_SIGNATURE.publicKeyLength ||
    signature.length !== HYBRID_SIGNATURE.signatureLength
  ) {
    return false;
  }
  const keyReader = new ByteReader(publicKey);
  const edPublic = keyReader.take(ED25519_PUBLIC_KEY_LENGTH);
  const dsaPublic = keyReader.take(MLDSA_PUBLIC_KEY_LENGTH);
  const sigReader = new ByteReader(signature);
  const edSignature = sigReader.take(ED25519_SIGNATURE_LENGTH);
  const dsaSignature = sigReader.take(MLDSA_SIGNATURE_LENGTH);
  const prepared = preparedMessage(context, message);

  let edOk = false;
  let dsaOk = false;
  try {
    edOk = ed25519.verify(edSignature, prepared, edPublic);
  } catch {
    edOk = false;
  }
  try {
    dsaOk = ml_dsa65.verify(dsaSignature, prepared, dsaPublic);
  } catch {
    dsaOk = false;
  }
  return edOk && dsaOk;
}
