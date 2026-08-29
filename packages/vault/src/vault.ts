import {
  ARGON2_PROFILES,
  ByteReader,
  concatBytes,
  fromHex,
  deriveMasterKey,
  generateSalt,
  randomBytes,
  randomInt,
  resolveProfile,
  seal as aeadSeal,
  SecretBuffer,
  constantTimeEqual,
  tryOpen,
  utf8Decode,
  utf8Encode,
  toHex,
  uint16,
  uint32,
  zeroize,
  type Argon2Profile,
  type Argon2ProfileName,
  type HybridKeyPair,
  type HybridSigningKeyPair,
} from "@cerbero/crypto";
import {
  DEFAULT_SLOT_COUNT,
  DEFAULT_SLOT_SIZE,
  encodeVaultHeader,
  MAX_SLOT_COUNT,
  MAX_SLOT_SIZE,
  MIN_SLOT_SIZE,
  parseVaultFile,
  replaceSlot,
  slotAad,
  slotBytes,
  slotPlaintextCapacity,
  VAULT_FORMAT_VERSION,
  type ParsedVaultFile,
  type VaultFileInfo,
} from "./format.ts";
import {
  VaultError,
  VaultFullError,
  VaultLockedError,
  VaultUnlockError,
} from "./errors.ts";
import {
  createEnvelope,
  decodeEnvelope,
  deriveSlotKey,
  deriveVaultMasterKey,
  destroyEnvelope,
  encodeEnvelope,
  ENVELOPE_LENGTH,
  envelopeIdentityKeyPair,
  envelopeSigningKeyPair,
  formatId,
  type VaultEnvelope,
} from "./keys.ts";
import {
  ITEM_ID_LENGTH,
  itemRecordLength,
  itemSummary,
  newItemId,
  openVaultItem,
  sealVaultItem,
  type VaultItem,
  type VaultItemDraft,
  type VaultItemSummary,
} from "./items.ts";

/**
 * Cabecera del contenido de una ranura: el sobre, el registro de auditoría y
 * cuántos ítems vienen detrás.
 *
 * El registro vive **dentro** de la ranura y no en un fichero aparte. Un
 * fichero por bóveda revelaría, con solo contarlos, cuántas bóvedas hay en el
 * almacén, que es exactamente lo que el formato se esfuerza en ocultar. Aquí
 * cada bóveda lleva su propio historial y es tan negable como ella misma.
 */
const SLOT_CONTENT_OVERHEAD = ENVELOPE_LENGTH + 2 + 4;

/**
 * Clave reservada del registro de auditoría dentro de los anexos.
 *
 * Los anexos son un diccionario de bloques opacos que la bóveda guarda cifrados
 * sin interpretarlos. Empezaron siendo un campo único para el registro, pero en
 * cuanto hubo un segundo consumidor —la política de recuperación con
 * guardianes— quedó claro que añadir un campo por función obligaría a subir la
 * versión del formato cada vez. Con un diccionario, un módulo nuevo reserva su
 * clave y ya está.
 */
const CLAVE_REGISTRO = "ledger";

/** Longitud máxima de una clave de anexo, en bytes. */
const MAX_CLAVE_ANEXO = 255;

export interface CreateVaultOptions {
  readonly argon2Profile?: Argon2ProfileName | Argon2Profile;
  readonly slotCount?: number;
  readonly slotSize?: number;
  readonly items?: readonly VaultItemDraft[];
  /**
   * Factor físico que se mezcla con la clave maestra.
   *
   * Con él, la contraseña por sí sola deja de abrir el fichero. No se guarda en
   * ninguna parte —ni siquiera un indicio de que exista—, así que el fichero
   * sigue sin delatar nada: quien lo robe no puede saber si le falta algo más
   * que la contraseña.
   */
  readonly hardwareFactor?: Uint8Array | null;
}

export interface AddVaultSlotOptions {
  /** Prueba que la bóveda es tuya y localiza la ranura que no hay que tocar. */
  readonly existingPassword: SecretBuffer;
  readonly newPassword: SecretBuffer;
  /** Ranura destino. Si se omite se elige entre las que se sepan libres. */
  readonly slot?: number;
  /**
   * Contraseñas de otras bóvedas tuyas en este fichero.
   *
   * Cerbero no puede detectar por su cuenta qué ranuras están ocupadas —esa
   * imposibilidad es justo lo que hace el fichero negable—, así que al añadir
   * una tercera bóveda hay que decirle cuáles son las anteriores. Sin esto,
   * elegir ranura al azar puede pisar en silencio una bóveda existente.
   */
  readonly otherPasswords?: readonly SecretBuffer[];
  readonly items?: readonly VaultItemDraft[];
  /** Factor de la bóveda actual, necesario para localizar su ranura. */
  readonly hardwareFactor?: Uint8Array | null;
  /** Factor de la bóveda nueva. Puede ser distinto, o ninguno. */
  readonly newHardwareFactor?: Uint8Array | null;
}

/**
 * Una bóveda abierta en memoria.
 *
 * Mantiene viva la clave de su ranura, de modo que guardar no vuelve a pagar
 * Argon2: el coste alto se paga una vez, al desbloquear, que es donde sirve de
 * algo. La clave maestra, en cambio, ya no está aquí —se destruyó en cuanto
 * produjo la clave de ranura—, así que un volcado de memoria de una bóveda
 * abierta no entrega la contraseña ni el acceso a las demás ranuras.
 */
export class UnlockedVault {
  #envelope: VaultEnvelope | null;
  #slotKey: SecretBuffer;
  #items: Map<string, VaultItem>;
  #extras: Map<string, Uint8Array>;
  #file: Uint8Array;
  readonly #info: VaultFileInfo;
  readonly #slot: number;
  readonly #vaultId: string;

  private constructor(
    envelope: VaultEnvelope,
    slotKey: SecretBuffer,
    items: Map<string, VaultItem>,
    file: Uint8Array,
    info: VaultFileInfo,
    slot: number,
    extras: Map<string, Uint8Array>,
  ) {
    this.#envelope = envelope;
    this.#slotKey = slotKey;
    this.#items = items;
    this.#extras = extras;
    this.#file = file;
    this.#info = info;
    this.#slot = slot;
    this.#vaultId = formatId(envelope.vaultId);
  }

  /** @internal Punto de entrada único desde `createVault` y `unlockVault`. */
  static adopt(
    envelope: VaultEnvelope,
    slotKey: SecretBuffer,
    items: Map<string, VaultItem>,
    file: Uint8Array,
    info: VaultFileInfo,
    slot: number,
    extras: Map<string, Uint8Array> = new Map(),
  ): UnlockedVault {
    return new UnlockedVault(envelope, slotKey, items, file, info, slot, extras);
  }

  /**
   * Lee un anexo. Devuelve `null` si no existe.
   *
   * La bóveda no interpreta su contenido: solo lo guarda cifrado junto al resto.
   * Quien lo entienda es el módulo que reservó la clave, y así el formato de
   * ranura no queda atado a la versión de ningún subsistema.
   */
  getExtra(clave: string): Uint8Array | null {
    this.#assertOpen();
    const valor = this.#extras.get(clave);
    return valor ? Uint8Array.from(valor) : null;
  }

  /** Escribe un anexo, comprobando antes que el resultado sigue cabiendo. */
  setExtra(clave: string, bytes: Uint8Array): void {
    this.#assertOpen();
    if (clave.length === 0 || utf8Encode(clave).length > MAX_CLAVE_ANEXO) {
      throw new VaultError(`clave de anexo no válida: ${clave}`);
    }
    const anterior = this.#extras.get(clave);
    this.#extras.set(clave, Uint8Array.from(bytes));
    if (this.usedBytes > this.capacityBytes) {
      if (anterior) this.#extras.set(clave, anterior);
      else this.#extras.delete(clave);
      throw new VaultFullError(
        `el anexo "${clave}" no cabe en la ranura: haz sitio o crea una bóveda con ranuras mayores`,
      );
    }
  }

  deleteExtra(clave: string): boolean {
    this.#assertOpen();
    return this.#extras.delete(clave);
  }

  extraKeys(): string[] {
    this.#assertOpen();
    return [...this.#extras.keys()];
  }

  /** Atajo para el anexo del registro de auditoría, que es el más usado. */
  get auditLog(): Uint8Array {
    return this.getExtra(CLAVE_REGISTRO) ?? new Uint8Array(0);
  }

  set auditLog(bytes: Uint8Array) {
    this.setExtra(CLAVE_REGISTRO, bytes);
  }

  get vaultId(): string {
    return this.#vaultId;
  }

  /**
   * Ranura que abrió la contraseña.
   *
   * Es información interna, necesaria para reescribir la ranura correcta. Una
   * interfaz **no debe enseñarla**: si quien te coacciona ve "ranura 2" y sabe
   * que la primera bóveda se coloca al azar, deduce que hay más de una. Por eso
   * `createVault` reparte la primera bóveda por todas las ranuras por igual.
   */
  get slot(): number {
    return this.#slot;
  }

  get locked(): boolean {
    return this.#envelope === null;
  }

  get slotCount(): number {
    return this.#info.slotCount;
  }

  get slotSize(): number {
    return this.#info.slotSize;
  }

  /** Bytes ocupados dentro de la ranura, sobre y cabecera incluidos. */
  get usedBytes(): number {
    let total = SLOT_CONTENT_OVERHEAD;
    for (const [clave, valor] of this.#extras) {
      total += 1 + utf8Encode(clave).length + 4 + valor.length;
    }
    for (const item of this.#items.values()) total += itemRecordLength(item);
    return total;
  }

  get capacityBytes(): number {
    return slotPlaintextCapacity(this.#info.slotSize);
  }

  get size(): number {
    return this.#items.size;
  }

  list(): VaultItemSummary[] {
    return [...this.#items.values()]
      .map(itemSummary)
      .sort((a, b) => a.title.localeCompare(b.title, "es"));
  }

  get(id: string): VaultItem | undefined {
    this.#assertOpen();
    return this.#items.get(id);
  }

  add(draft: VaultItemDraft): VaultItem {
    this.#assertOpen();
    const now = Date.now();
    const item = this.#normalize({ ...draft, id: newItemId(), createdAt: now, updatedAt: now });
    this.#items.set(item.id, item);
    this.#assertFits(item.id);
    return item;
  }

  update(id: string, patch: Partial<VaultItemDraft>): VaultItem {
    this.#assertOpen();
    const current = this.#items.get(id);
    if (!current) throw new VaultError(`no existe ningún ítem con el identificador ${id}`);
    const updated = this.#normalize({ ...current, ...patch, id, updatedAt: Date.now() });
    this.#items.set(id, updated);
    this.#assertFits(id, current);
    return updated;
  }

  remove(id: string): boolean {
    this.#assertOpen();
    return this.#items.delete(id);
  }

  /** Búsqueda por título, usuario, dirección, notas y etiquetas. */
  find(query: string): VaultItem[] {
    this.#assertOpen();
    const needle = query.trim().toLocaleLowerCase("es");
    if (needle === "") return [...this.#items.values()];
    return [...this.#items.values()].filter((item) =>
      [item.title, item.username ?? "", item.url ?? "", item.notes ?? "", ...item.tags]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(needle),
    );
  }

  identityKeyPair(): HybridKeyPair {
    return envelopeIdentityKeyPair(this.#requireEnvelope());
  }

  signingKeyPair(): HybridSigningKeyPair {
    return envelopeSigningKeyPair(this.#requireEnvelope());
  }

  /**
   * Devuelve el fichero completo con **solo esta ranura** reescrita.
   *
   * Las demás quedan byte a byte idénticas porque `replaceSlot` copia el
   * fichero y sustituye un tramo de tamaño fijo: no existe ruta de código capaz
   * de tocar una ranura cuya contraseña no se conoce, que es justo lo que hace
   * viable convivir con bóvedas de coacción ajenas a esta sesión.
   */
  serialize(): Uint8Array {
    const envelope = this.#requireEnvelope();
    const parsed = parseVaultFile(this.#file);
    const contents = sealSlotContents(
      this.#slotKey,
      parsed,
      this.#slot,
      envelope,
      [...this.#items.values()],
      this.#vaultId,
      this.#extras,
    );
    this.#file = replaceSlot(this.#file, this.#info, this.#slot, contents);
    return Uint8Array.from(this.#file);
  }

  /**
   * Cambia el factor físico de esta bóveda y devuelve el fichero resellado.
   *
   * Vincular o desvincular una llave no toca las entradas: solo cambia la clave
   * con la que se sella **esta** ranura. Las demás quedan byte a byte idénticas,
   * igual que en cualquier otro guardado, así que vincular una llave no delata
   * cuántas bóvedas hay en el fichero.
   *
   * Antes de sustituir nada se comprueba que la contraseña y el factor actuales
   * reproducen la clave con la que la ranura está sellada ahora mismo. Sin esa
   * comprobación, un error al teclear resellaría la ranura bajo una clave que
   * nadie conoce y la bóveda quedaría perdida en silencio: el peor fallo
   * posible en una operación que existe justo para aumentar la seguridad.
   */
  rebind(
    password: SecretBuffer,
    factorActual: Uint8Array | null,
    factorNuevo: Uint8Array | null,
  ): Uint8Array {
    this.#assertOpen();
    const maestraActual = deriveVaultMasterKey(
      password,
      this.#info.salt,
      this.#info.argon2,
      factorActual,
    );
    let comprobacion: SecretBuffer;
    try {
      comprobacion = deriveSlotKey(maestraActual, this.#slot);
    } finally {
      maestraActual.destroy();
    }
    try {
      if (!constantTimeEqual(comprobacion.bytes, this.#slotKey.bytes)) {
        throw new VaultError(
          "la contraseña o la llave actuales no son las que abren esta bóveda: no se ha cambiado nada",
        );
      }
    } finally {
      comprobacion.destroy();
    }

    const maestraNueva = deriveVaultMasterKey(
      password,
      this.#info.salt,
      this.#info.argon2,
      factorNuevo,
    );
    try {
      const anterior = this.#slotKey;
      this.#slotKey = deriveSlotKey(maestraNueva, this.#slot);
      anterior.destroy();
    } finally {
      maestraNueva.destroy();
    }
    return this.serialize();
  }

  /** Borra de memoria el sobre, la clave de ranura y los ítems descifrados. */
  lock(): void {
    if (this.#envelope) {
      destroyEnvelope(this.#envelope);
      this.#envelope = null;
    }
    this.#slotKey.destroy();
    this.#items.clear();
  }

  #requireEnvelope(): VaultEnvelope {
    if (!this.#envelope) throw new VaultLockedError();
    return this.#envelope;
  }

  #assertOpen(): void {
    this.#requireEnvelope();
  }

  /**
   * Comprueba el hueco *después* de aplicar el cambio y lo revierte si no cabe.
   *
   * Fallar aquí y no al guardar es deliberado: descubrir que la bóveda está
   * llena en el momento de escribir en disco deja al usuario con cambios en
   * memoria que no puede persistir, que es la peor forma de perder datos.
   */
  #assertFits(id: string, previous?: VaultItem): void {
    if (this.usedBytes <= this.capacityBytes) return;
    if (previous) this.#items.set(id, previous);
    else this.#items.delete(id);
    throw new VaultFullError(
      `la bóveda está llena: ${this.usedBytes} bytes no caben en los ${this.capacityBytes} de la ranura. ` +
        "El tamaño de ranura es fijo desde que se creó el fichero, así que hay que borrar entradas o crear una bóveda nueva más grande.",
    );
  }

  #normalize(fields: Omit<VaultItem, "tags"> & { readonly tags?: readonly string[] }): VaultItem {
    const item: VaultItem = {
      id: fields.id,
      type: fields.type,
      title: fields.title,
      tags: [...(fields.tags ?? [])],
      createdAt: fields.createdAt,
      updatedAt: fields.updatedAt,
      ...(fields.username === undefined ? {} : { username: fields.username }),
      ...(fields.secret === undefined ? {} : { secret: fields.secret }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(fields.notes === undefined ? {} : { notes: fields.notes }),
      ...(fields.custom === undefined ? {} : { custom: { ...fields.custom } }),
    };
    if (item.title.trim() === "") {
      throw new VaultError("el título de un ítem no puede estar vacío");
    }
    return item;
  }
}

/**
 * Empaqueta y sella el contenido de una ranura.
 *
 * El texto en claro se rellena **hasta la capacidad exacta** de la ranura antes
 * de cifrar. Que todas midan lo mismo, tengan una bóveda o no, es lo que
 * sostiene la negación plausible: sin ese relleno, el tamaño del criptograma
 * diría cuántos ítems hay dentro y una ranura vacía se distinguiría a simple
 * vista de una llena.
 *
 * El relleno es aleatorio y no ceros: cuesta lo mismo y no deja una zona de
 * texto en claro conocido dentro del criptograma.
 */
function sealSlotContents(
  slotKey: SecretBuffer,
  parsed: ParsedVaultFile,
  slot: number,
  envelope: VaultEnvelope,
  items: readonly VaultItem[],
  vaultId: string,
  extras: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const capacity = slotPlaintextCapacity(parsed.info.slotSize);

  // El sobre es el único trozo con material de clave en claro, y por tanto el
  // único que hay que borrar después. Se separa del resto a propósito: los
  // anexos y los ítems que van en `parts` son buffers de los que somos meros
  // referentes, y borrarlos aquí destruiría en memoria lo que el llamante sigue
  // usando —exactamente el fallo que este comentario existe para evitar—.
  const sobre = encodeEnvelope(envelope);
  const parts: Uint8Array[] = [sobre, uint16(extras.size)];

  // Orden alfabético: el criptograma de dos bóvedas con los mismos anexos no
  // debe depender de en qué orden los escribió el programa.
  for (const clave of [...extras.keys()].sort()) {
    const nombre = utf8Encode(clave);
    const valor = extras.get(clave) as Uint8Array;
    parts.push(new Uint8Array([nombre.length]), nombre, uint32(valor.length), valor);
  }
  parts.push(uint32(items.length));

  for (const item of items) {
    const sealed = sealVaultItem(envelope.dataKey, vaultId, item);
    parts.push(concatBytes(fromHex(item.id), uint32(sealed.length), sealed));
  }

  const body = concatBytes(...parts);
  if (body.length > capacity) {
    zeroize(body, sobre);
    throw new VaultFullError(
      `el contenido ocupa ${body.length} bytes y la ranura solo admite ${capacity}`,
    );
  }

  const plaintext = concatBytes(body, randomBytes(capacity - body.length));
  try {
    return aeadSeal(slotKey, plaintext, slotAad(parsed.header, slot));
  } finally {
    // Solo lo que hemos creado nosotros y contiene claves en claro.
    zeroize(plaintext, body, sobre);
  }
}

/** Lee el contenido ya descifrado de una ranura. */
function parseSlotContents(plaintext: Uint8Array): {
  envelope: VaultEnvelope;
  items: Map<string, VaultItem>;
  extras: Map<string, Uint8Array>;
} {
  const reader = new ByteReader(plaintext);
  const envelope = decodeEnvelope(reader);
  // El identificador de bóveda entra en el `aad` de cada ítem, así que hay que
  // leer el sobre antes que los ítems: no es un orden arbitrario del formato.
  const vaultId = formatId(envelope.vaultId);

  const extras = new Map<string, Uint8Array>();
  const totalExtras = reader.takeUint16();
  for (let i = 0; i < totalExtras; i++) {
    const clave = utf8Decode(reader.take(reader.takeUint8()));
    extras.set(clave, Uint8Array.from(reader.take(reader.takeUint32())));
  }

  const count = reader.takeUint32();
  const items = new Map<string, VaultItem>();
  for (let i = 0; i < count; i++) {
    const itemId = toHex(reader.take(ITEM_ID_LENGTH));
    const sealed = reader.take(reader.takeUint32());
    items.set(itemId, openVaultItem(envelope.dataKey, vaultId, itemId, sealed));
  }
  // Lo que queda es relleno y no se comprueba: comprobarlo obligaría a que
  // tuviera estructura, y una estructura reconocible es exactamente lo que no
  // queremos dentro de una ranura.
  return { envelope, items, extras };
}

/**
 * Rellena todas las ranuras del fichero con bytes aleatorios.
 *
 * Una ranura sin usar y una ranura con una bóveda cuya contraseña no conoces
 * son, byte a byte, igual de aleatorias: la salida de XChaCha20-Poly1305 es
 * indistinguible del ruido. Esa es toda la base de la negación plausible, y por
 * eso el fichero nace lleno en vez de crecer según se añaden bóvedas.
 */
function emptyVaultFile(info: VaultFileInfo): Uint8Array {
  return concatBytes(encodeVaultHeader(info), randomBytes(info.slotCount * info.slotSize));
}

function validateGeometry(slotCount: number, slotSize: number): void {
  if (!Number.isSafeInteger(slotCount) || slotCount < 2 || slotCount > MAX_SLOT_COUNT) {
    throw new VaultError(`el número de ranuras debe estar entre 2 y ${MAX_SLOT_COUNT}`);
  }
  if (!Number.isSafeInteger(slotSize) || slotSize < MIN_SLOT_SIZE || slotSize > MAX_SLOT_SIZE) {
    throw new VaultError(`el tamaño de ranura debe estar entre ${MIN_SLOT_SIZE} y ${MAX_SLOT_SIZE} bytes`);
  }
}

/** Escribe una bóveda nueva en la ranura indicada de un fichero ya existente. */
function writeVaultIntoSlot(
  file: Uint8Array,
  password: SecretBuffer,
  slot: number,
  drafts: readonly VaultItemDraft[],
  hardwareFactor?: Uint8Array | null,
): { file: Uint8Array; vault: UnlockedVault } {
  const parsed = parseVaultFile(file);
  const masterKey = deriveVaultMasterKey(
    password,
    parsed.info.salt,
    parsed.info.argon2,
    hardwareFactor,
  );
  let slotKey: SecretBuffer;
  try {
    slotKey = deriveSlotKey(masterKey, slot);
  } finally {
    // La clave maestra muere aquí: a partir de ahora la sesión solo tiene la
    // clave de esta ranura, y con ella no se llega a las demás.
    masterKey.destroy();
  }

  const envelope = createEnvelope();
  const vault = UnlockedVault.adopt(
    envelope,
    slotKey,
    new Map(),
    file,
    parsed.info,
    slot,
  );
  for (const draft of drafts) vault.add(draft);
  return { file: vault.serialize(), vault };
}

/**
 * Crea un fichero de bóveda nuevo con su primera bóveda dentro.
 *
 * La bóveda se coloca en una ranura **al azar**, no en la primera. Si siempre
 * cayera en la 0, quien te coaccionara y viera que su contraseña abre la 2
 * sabría que existe otra bóveda: el propio índice delataría lo que el formato
 * se esfuerza en ocultar.
 */
export function createVault(
  password: SecretBuffer,
  options: CreateVaultOptions = {},
): { file: Uint8Array; vault: UnlockedVault } {
  const slotCount = options.slotCount ?? DEFAULT_SLOT_COUNT;
  const slotSize = options.slotSize ?? DEFAULT_SLOT_SIZE;
  validateGeometry(slotCount, slotSize);

  const info: VaultFileInfo = {
    version: VAULT_FORMAT_VERSION,
    slotCount,
    slotSize,
    argon2: resolveProfile(options.argon2Profile ?? ARGON2_PROFILES.moderate),
    salt: generateSalt(),
  };

  return writeVaultIntoSlot(
    emptyVaultFile(info),
    password,
    randomInt(slotCount),
    options.items ?? [],
    options.hardwareFactor,
  );
}

/**
 * Abre la bóveda que corresponda a la contraseña.
 *
 * Deriva la clave maestra **una sola vez** y prueba las ranuras con ella: el
 * coste caro es Argon2 y probar cada ranura es una operación AEAD, despreciable
 * al lado. Si desbloquear costara un Argon2 por ranura, el tiempo de apertura
 * crecería con el número de ranuras y esa lentitud delataría la geometría del
 * fichero.
 *
 * Una contraseña incorrecta y una ranura vacía fallan exactamente igual, con el
 * mismo error: cualquier diferencia convertiría el desbloqueo en un oráculo con
 * el que contar bóvedas.
 */
export function unlockVault(
  file: Uint8Array,
  password: SecretBuffer,
  options: { readonly hardwareFactor?: Uint8Array | null } = {},
): UnlockedVault {
  const parsed = parseVaultFile(file);
  const masterKey = deriveVaultMasterKey(
    password,
    parsed.info.salt,
    parsed.info.argon2,
    options.hardwareFactor,
  );

  try {
    for (let slot = 0; slot < parsed.info.slotCount; slot++) {
      const slotKey = deriveSlotKey(masterKey, slot);
      const plaintext = tryOpen(slotKey, slotBytes(parsed, slot), slotAad(parsed.header, slot));
      if (!plaintext) {
        slotKey.destroy();
        continue;
      }
      try {
        const { envelope, items, extras } = parseSlotContents(plaintext);
        return UnlockedVault.adopt(envelope, slotKey, items, file, parsed.info, slot, extras);
      } catch (cause) {
        slotKey.destroy();
        throw new VaultError(
          "la ranura abrió pero su contenido no es válido: el fichero está corrupto",
          { cause },
        );
      } finally {
        zeroize(plaintext);
      }
    }
  } finally {
    masterKey.destroy();
  }

  throw new VaultUnlockError();
}

/**
 * Añade una bóveda independiente bajo otra contraseña (bóveda de coacción).
 *
 * Cerbero **no puede decirte qué ranuras están ocupadas**: distinguir una
 * ranura vacía de una con una bóveda ajena es justo lo que el formato impide, y
 * si pudiera hacerlo el diseño entero no valdría. Por eso la ranura destino la
 * eliges tú y solo se comprueba lo que sí es comprobable: que la contraseña
 * nueva no abre ya una ranura, y que no se pisa la que abre la actual.
 */
export function addVaultSlot(file: Uint8Array, options: AddVaultSlotOptions): Uint8Array {
  const parsed = parseVaultFile(file);

  // Ranuras que sabemos ocupadas: solo las que abren las contraseñas aportadas.
  // Las demás son indistinguibles del ruido, y así debe seguir siendo.
  const ocupadas = new Set<number>();
  for (const clave of [options.existingPassword, ...(options.otherPasswords ?? [])]) {
    const abierta = unlockVault(file, clave, { hardwareFactor: options.hardwareFactor ?? null });
    ocupadas.add(abierta.slot);
    abierta.lock();
  }

  // Reutilizar una contraseña dejaría dos bóvedas indistinguibles para su
  // dueño: la primera que abriera ganaría y la otra sería inalcanzable.
  try {
    const previa = unlockVault(file, options.newPassword, {
      hardwareFactor: options.newHardwareFactor ?? null,
    });
    previa.lock();
    throw new VaultError("esa contraseña ya abre una bóveda de este fichero");
  } catch (fallo) {
    if (fallo instanceof VaultError && !(fallo instanceof VaultUnlockError)) throw fallo;
  }

  const destino = options.slot ?? elegirRanuraLibre(parsed.info.slotCount, ocupadas);
  if (!Number.isSafeInteger(destino) || destino < 0 || destino >= parsed.info.slotCount) {
    throw new VaultError(`ranura fuera de rango: ${destino}`);
  }
  if (ocupadas.has(destino)) {
    throw new VaultError(
      `la ranura ${destino} la ocupa una de las bóvedas cuya contraseña has aportado`,
    );
  }

  const { file: actualizado, vault } = writeVaultIntoSlot(
    file,
    options.newPassword,
    destino,
    options.items ?? [],
    options.newHardwareFactor,
  );
  vault.lock();
  return actualizado;
}

function elegirRanuraLibre(slotCount: number, ocupadas: ReadonlySet<number>): number {
  const candidatas: number[] = [];
  for (let i = 0; i < slotCount; i++) if (!ocupadas.has(i)) candidatas.push(i);
  if (candidatas.length === 0) {
    throw new VaultError(
      "no queda ninguna ranura libre conocida: crea el fichero con más ranuras",
    );
  }
  return candidatas[randomInt(candidatas.length)] as number;
}

/** Comprueba una contraseña sin dejar la bóveda abierta en memoria. */
export function verifyVaultPassword(file: Uint8Array, password: SecretBuffer): boolean {
  try {
    unlockVault(file, password).lock();
    return true;
  } catch {
    return false;
  }
}
