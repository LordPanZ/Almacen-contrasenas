import {
  AEAD_OVERHEAD,
  ByteReader,
  SecretBuffer,
  domainHash,
  open as aeadOpen,
  randomBytes,
  seal as aeadSeal,
  toHex,
  uint32,
  utf8Decode,
  utf8Encode,
  zeroize,
} from "@cerbero/crypto";
import { VaultFormatError } from "./errors.ts";
import { VAULT_ID_LENGTH, deriveItemKey, parseId } from "./keys.ts";

export const ITEM_ID_LENGTH = 16;

export const VAULT_ITEM_TYPES = ["login", "note", "card", "identity", "key"] as const;

export type VaultItemType = (typeof VAULT_ITEM_TYPES)[number];

/**
 * Una entrada de la bóveda. **Todo** lo que hay aquí —incluidos título, usuario,
 * dirección, notas, etiquetas y fechas— viaja dentro del texto cifrado.
 *
 * Fuera del cifrado solo queda `id`, dieciséis bytes de azar sin ninguna
 * relación con el contenido. Es la diferencia práctica con los gestores
 * actuales: los suyos entregan al servidor la lista de dominios en los que
 * tienes cuenta, que es un mapa de tu vida (bancos, sanidad, partidos,
 * relaciones) tan revelador como las propias contraseñas y, a menudo, más fácil
 * de vender.
 */
export interface VaultItem {
  readonly id: string;
  readonly type: VaultItemType;
  readonly title: string;
  readonly username?: string;
  readonly secret?: string;
  readonly url?: string;
  readonly notes?: string;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly custom?: Readonly<Record<string, string>>;
}

/** Lo que aporta quien crea una entrada: sin id ni fechas, los pone la bóveda. */
export interface VaultItemDraft {
  readonly type: VaultItemType;
  readonly title: string;
  readonly username?: string;
  readonly secret?: string;
  readonly url?: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
  readonly custom?: Readonly<Record<string, string>>;
}

/** Vista de listado: nunca incluye el secreto, para no pasearlo por la interfaz. */
export interface VaultItemSummary {
  readonly id: string;
  readonly type: VaultItemType;
  readonly title: string;
  readonly tags: readonly string[];
  readonly updatedAt: number;
}

/**
 * Cubos de relleno para el texto cifrado de cada ítem.
 *
 * Sin ellos la longitud del criptograma delata el contenido: una entrada de
 * 300 bytes es una contraseña con su URL y una de 40 KiB es una nota larga o un
 * documento, y viendo crecer un fichero sincronizado se deduce qué tipo de
 * secreto acabas de guardar. Con los cubos, todas las entradas corrientes pesan
 * exactamente lo mismo. La escalera es multiplicativa (×4) para que el
 * desperdicio esté acotado: como mucho se paga cuatro veces el tamaño útil.
 */
export const ITEM_BUCKETS = [256, 1024, 4096, 16 * 1024, 64 * 1024] as const;

/** Sobrecarga fija de un ítem dentro de la ranura: id, longitud y AEAD. */
export const ITEM_RECORD_OVERHEAD = ITEM_ID_LENGTH + 4 + AEAD_OVERHEAD;

/** Cubo en el que cae un bloque de `length` bytes ya rellenado. */
export function bucketFor(length: number): number {
  for (const bucket of ITEM_BUCKETS) {
    if (length <= bucket) return bucket;
  }
  // Por encima del cubo mayor seguimos cuantizando en múltiplos suyos: un
  // adjunto grande no debe revelar su tamaño exacto solo por ser grande.
  const largest = ITEM_BUCKETS[ITEM_BUCKETS.length - 1] as number;
  return Math.ceil(length / largest) * largest;
}

/**
 * Rellena hasta el cubo correspondiente.
 *
 * La longitud real va delante en cuatro bytes, así que el relleno se elimina de
 * forma inequívoca: no hay que adivinar dónde acaban los datos ni confiar en un
 * byte centinela, y el bloque entero —longitud incluida— queda bajo la etiqueta
 * de autenticación, de modo que nadie puede mover la frontera.
 */
export function padToBucket(data: Uint8Array): Uint8Array {
  const total = 4 + data.length;
  const padded = new Uint8Array(bucketFor(total));
  padded.set(uint32(data.length), 0);
  padded.set(data, 4);
  // El relleno son ceros y no bytes al azar a propósito: va *dentro* del
  // cifrado, donde el texto cifrado ya es indistinguible del ruido, así que
  // gastar entropía del sistema en él no compraría ninguna propiedad.
  return padded;
}

/** Recupera los datos originales de un bloque rellenado. */
export function unpadBucket(padded: Uint8Array): Uint8Array {
  const reader = new ByteReader(padded);
  return reader.take(reader.takeUint32());
}

/**
 * Datos autenticados de un ítem: atan el criptograma a su bóveda y a su id.
 *
 * Sin esto, quien tenga acceso al fichero podría copiar la entrada cifrada de
 * una bóveda a otra, o cambiar el id de un ítem por el de otro, y el descifrado
 * seguiría funcionando: bastaría para intercambiar la contraseña de tu banco
 * por la de un sitio que controla el atacante.
 */
function itemAad(vaultId: Uint8Array, itemId: Uint8Array): Uint8Array {
  return domainHash("vault-item", vaultId, itemId);
}

/** Identificador de ítem nuevo: azar puro, sin ninguna estructura que leer. */
export function newItemId(): string {
  return toHex(randomBytes(ITEM_ID_LENGTH));
}

type ItemFields = { -readonly [K in keyof VaultItem]?: VaultItem[K] };

const OPTIONAL_TEXT_FIELDS = ["username", "secret", "url", "notes"] as const;

/** Objeto que se serializa a JSON dentro del cifrado del ítem. */
function itemPayload(item: VaultItem): Record<string, unknown> {
  // El id no se guarda dentro: ya viaja fuera y el `aad` lo ata al criptograma,
  // así que repetirlo solo gastaría espacio de ranura.
  return {
    type: item.type,
    title: item.title,
    username: item.username,
    secret: item.secret,
    url: item.url,
    notes: item.notes,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    custom: item.custom,
  };
}

function isItemType(value: unknown): value is VaultItemType {
  return typeof value === "string" && (VAULT_ITEM_TYPES as readonly string[]).includes(value);
}

function parseTags(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new VaultFormatError("las etiquetas de un ítem deben ser una lista");
  return value.map((tag) => {
    if (typeof tag !== "string") throw new VaultFormatError("una etiqueta no es una cadena");
    return tag;
  });
}

function parseCustom(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new VaultFormatError("los campos personalizados deben ser un objeto");
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      throw new VaultFormatError("un campo personalizado no es una cadena");
    }
    out[key] = entry;
  }
  return out;
}

function parseTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VaultFormatError(`la fecha "${field}" de un ítem no es válida`);
  }
  return value;
}

/**
 * Reconstruye un ítem desde su JSON.
 *
 * Se valida campo a campo aunque el JSON venga de un criptograma ya
 * autenticado: la autenticidad prueba que nadie lo tocó, no que la versión que
 * lo escribió respetara el esquema.
 */
export function parseItemPayload(id: string, json: string): VaultItem {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new VaultFormatError("el contenido de un ítem no es JSON válido");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new VaultFormatError("el contenido de un ítem no es un objeto");
  }
  const record = raw as Record<string, unknown>;

  if (!isItemType(record["type"])) throw new VaultFormatError("tipo de ítem desconocido");
  if (typeof record["title"] !== "string") throw new VaultFormatError("el título de un ítem no es una cadena");

  const fields: ItemFields = {
    id,
    type: record["type"],
    title: record["title"],
    tags: parseTags(record["tags"]),
    createdAt: parseTimestamp(record["createdAt"], "createdAt"),
    updatedAt: parseTimestamp(record["updatedAt"], "updatedAt"),
  };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new VaultFormatError(`el campo "${field}" no es una cadena`);
    fields[field] = value;
  }
  const custom = parseCustom(record["custom"]);
  if (custom !== undefined) fields.custom = custom;

  return fields as VaultItem;
}

/**
 * Cifra un ítem con su propia clave, derivada del VDK y del id, y lo rellena
 * hasta el cubo que le toca. La salida es autónoma: puede almacenarse o
 * sincronizarse suelta sin revelar nada de lo que contiene.
 */
export function sealVaultItem(
  dataKey: SecretBuffer | Uint8Array,
  vaultId: string,
  item: VaultItem,
): Uint8Array {
  const vaultIdBytes = parseId(vaultId, VAULT_ID_LENGTH, "identificador de bóveda");
  const itemIdBytes = parseId(item.id, ITEM_ID_LENGTH, "identificador de ítem");
  const payload = utf8Encode(JSON.stringify(itemPayload(item)));
  const padded = padToBucket(payload);
  const key = deriveItemKey(dataKey, itemIdBytes);
  try {
    return aeadSeal(key, padded, itemAad(vaultIdBytes, itemIdBytes));
  } finally {
    key.destroy();
    zeroize(payload, padded);
  }
}

/** Inverso de `sealVaultItem`; lanza `AeadError` si algo no encaja. */
export function openVaultItem(
  dataKey: SecretBuffer | Uint8Array,
  vaultId: string,
  itemId: string,
  sealed: Uint8Array,
): VaultItem {
  const vaultIdBytes = parseId(vaultId, VAULT_ID_LENGTH, "identificador de bóveda");
  const itemIdBytes = parseId(itemId, ITEM_ID_LENGTH, "identificador de ítem");
  const key = deriveItemKey(dataKey, itemIdBytes);
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = aeadOpen(key, sealed, itemAad(vaultIdBytes, itemIdBytes));
    return parseItemPayload(itemId, utf8Decode(unpadBucket(plaintext)));
  } finally {
    key.destroy();
    zeroize(plaintext);
  }
}

/** Bytes que ocupará el ítem dentro de la ranura, sin llegar a cifrarlo. */
export function itemRecordLength(item: VaultItem): number {
  const payloadLength = utf8Encode(JSON.stringify(itemPayload(item))).length;
  return ITEM_RECORD_OVERHEAD + bucketFor(4 + payloadLength);
}

/** Resumen de listado a partir del ítem completo. */
export function itemSummary(item: VaultItem): VaultItemSummary {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    tags: item.tags,
    updatedAt: item.updatedAt,
  };
}
