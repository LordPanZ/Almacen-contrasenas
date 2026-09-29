import {
  ByteReader,
  InvalidInputError,
  KDF_LABELS,
  concatBytes,
  deriveKey,
  domainHash,
  open as aeadOpen,
  randomBytes,
  seal as aeadSeal,
  toHex,
  uint32,
  utf8Encode,
  zeroize,
} from "@cerbero/crypto";
import type { SecretBuffer } from "@cerbero/crypto";
import { VaultFormatError } from "./errors.ts";
import { ITEM_ID_LENGTH, padToBucket, unpadBucket } from "./items.ts";
import { VAULT_ID_LENGTH, parseId } from "./keys.ts";

/**
 * Documentos adjuntos: PDF, fotos de un DNI, escrituras.
 *
 * No caben en la ranura. Es de tamaño fijo (256 KiB por defecto) y debe seguir
 * siéndolo: agrandarla a decenas de MiB multiplicaría por el número de ranuras
 * el peso del fichero y obligaría a reescribirlo entero en cada guardado. Cada
 * documento se cifra por separado y la entrada de la bóveda solo guarda su
 * referencia, que sí viaja dentro del cifrado de la ranura.
 *
 * La construcción repite la de los ítems, con dos diferencias deliberadas:
 *
 * - Clave propia por documento, derivada del VDK con etiqueta distinta a la de
 *   los ítems. Que el identificador de un documento coincidiera con el de un
 *   ítem no debe dar nunca la misma clave.
 * - Datos autenticados atados a la bóveda y al identificador: un documento no
 *   puede copiarse a otra bóveda ni intercambiarse por otro del mismo fichero.
 */

/** Tope por documento. Se cifra de una vez, así que la memoria manda. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_ID_LENGTH = ITEM_ID_LENGTH;

/** Identificador aleatorio de documento, sin relación con su contenido. */
export function newAttachmentId(): string {
  return toHex(randomBytes(ATTACHMENT_ID_LENGTH));
}

function attachmentAad(vaultId: Uint8Array, id: Uint8Array): Uint8Array {
  return domainHash("vault-attachment", vaultId, id);
}

/**
 * Cifra un documento. La salida es autónoma y se puede guardar suelta: el
 * relleno hasta el cubo (múltiplos de 64 KiB a partir de ahí) impide deducir el
 * tamaño exacto del original.
 */
export function sealAttachment(
  dataKey: SecretBuffer | Uint8Array,
  vaultId: string,
  attachmentId: string,
  data: Uint8Array,
): Uint8Array {
  if (data.length === 0) throw new InvalidInputError("el documento está vacío");
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new InvalidInputError(
      `el documento pesa ${data.length} bytes y el máximo es ${MAX_ATTACHMENT_BYTES}`,
    );
  }
  const vaultIdBytes = parseId(vaultId, VAULT_ID_LENGTH, "identificador de bóveda");
  const idBytes = parseId(attachmentId, ATTACHMENT_ID_LENGTH, "identificador de documento");
  const ikm = dataKey instanceof Uint8Array ? dataKey : dataKey.bytes;
  const key = deriveKey(ikm, KDF_LABELS.attachmentKey, { context: idBytes });
  const padded = padToBucket(data);
  try {
    return aeadSeal(key, padded, attachmentAad(vaultIdBytes, idBytes));
  } finally {
    key.destroy();
    zeroize(padded);
  }
}

/** Inverso de `sealAttachment`. Lanza `AeadError` si algo no encaja. */
export function openAttachment(
  dataKey: SecretBuffer | Uint8Array,
  vaultId: string,
  attachmentId: string,
  sealed: Uint8Array,
): Uint8Array {
  const vaultIdBytes = parseId(vaultId, VAULT_ID_LENGTH, "identificador de bóveda");
  const idBytes = parseId(attachmentId, ATTACHMENT_ID_LENGTH, "identificador de documento");
  const ikm = dataKey instanceof Uint8Array ? dataKey : dataKey.bytes;
  const key = deriveKey(ikm, KDF_LABELS.attachmentKey, { context: idBytes });
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = aeadOpen(key, sealed, attachmentAad(vaultIdBytes, idBytes));
    // Copia antes de borrar: `unpadBucket` devuelve una vista sobre `plaintext`.
    return Uint8Array.from(unpadBucket(plaintext));
  } finally {
    key.destroy();
    zeroize(plaintext);
  }
}

/* ─── Copia de seguridad de los documentos ────────────────────────────── */

const PACK_MAGIC = utf8Encode("CERBADJ1");
const MAX_PACK_ENTRIES = 100_000;

export interface PackedAttachment {
  readonly id: string;
  readonly sealed: Uint8Array;
}

/**
 * Empaqueta documentos ya cifrados en un solo fichero.
 *
 * Los documentos no viajan en el `.cerbero`, así que sin esto cambiar de móvil
 * los perdería. El paquete no añade cifrado propio ni revela nada nuevo: son
 * los mismos criptogramas que hay en el navegador, uno tras otro.
 */
export function packAttachments(items: readonly PackedAttachment[]): Uint8Array {
  const parts: Uint8Array[] = [PACK_MAGIC, uint32(items.length)];
  for (const item of items) {
    parts.push(parseId(item.id, ATTACHMENT_ID_LENGTH, "identificador de documento"));
    parts.push(uint32(item.sealed.length), item.sealed);
  }
  return concatBytes(...parts);
}

/** Lee un paquete validando cada longitud contra lo que queda por leer. */
export function unpackAttachments(bytes: Uint8Array): PackedAttachment[] {
  if (bytes.length < PACK_MAGIC.length + 4) {
    throw new VaultFormatError("el fichero es demasiado corto para ser una copia de documentos");
  }
  const reader = new ByteReader(bytes);
  const magic = reader.take(PACK_MAGIC.length);
  for (let i = 0; i < PACK_MAGIC.length; i++) {
    if (magic[i] !== PACK_MAGIC[i]) {
      throw new VaultFormatError("no es una copia de documentos de Cerbero");
    }
  }
  const count = reader.takeUint32();
  if (count > MAX_PACK_ENTRIES) throw new VaultFormatError("la copia declara demasiados documentos");

  const vistos = new Set<string>();
  const out: PackedAttachment[] = [];
  for (let i = 0; i < count; i++) {
    const id = toHex(reader.take(ATTACHMENT_ID_LENGTH));
    const length = reader.takeUint32();
    if (length > reader.remaining) throw new VaultFormatError("la copia está cortada o corrupta");
    if (vistos.has(id)) throw new VaultFormatError("la copia repite un documento");
    vistos.add(id);
    out.push({ id, sealed: Uint8Array.from(reader.take(length)) });
  }
  if (reader.remaining !== 0) throw new VaultFormatError("la copia tiene datos sobrantes");
  return out;
}
