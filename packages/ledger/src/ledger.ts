import {
  ByteReader,
  concatBytes,
  constantTimeEqual,
  HYBRID_SIGNATURE,
  InvalidInputError,
  lengthPrefixed,
  SecretBuffer,
  uint32,
  utf8Encode,
} from "@cerbero/crypto";
import type { HybridSigningKeyPair } from "@cerbero/crypto";
import {
  cloneEntry,
  decodeEntry,
  detailHash,
  encodeEntry,
  entryHash,
  genesisHash,
  isLedgerEventType,
} from "./entry.ts";
import type { LedgerEntry, LedgerEventType } from "./entry.ts";
import { LedgerError } from "./errors.ts";
import {
  consistencyProofFromLeafHashes,
  inclusionProofFromLeafHashes,
  rootFromLeafHashes,
} from "./merkle.ts";
import { signTreeHead } from "./sth.ts";
import type { SignedTreeHead } from "./sth.ts";

const LEDGER_MAGIC = /* @__PURE__ */ utf8Encode("cerbero-ledger");
const LEDGER_FORMAT_VERSION = 1;
const NO_DETAIL = /* @__PURE__ */ new Uint8Array(0);

export interface LedgerEvent {
  readonly type: LedgerEventType;
  /** Se hashea y se descarta: el registro nunca lo almacena. */
  readonly detail?: Uint8Array;
  readonly device?: string;
  /** Solo para relojes controlados y reproducción de registros. */
  readonly timestamp?: number;
}

/**
 * Registro de auditoría append-only.
 *
 * Cada suceso queda anotado dos veces: como hoja de un árbol Merkle RFC 6962 y
 * como eslabón de una cadena de hashes. La cadena hace evidente cualquier
 * alteración local al recargar el fichero; el árbol es lo que permite
 * *demostrárselo a otro* con O(log n) bytes, sin enseñarle el registro entero
 * ni el contenido de la bóveda.
 */
export class AuditLedger {
  readonly #publicKey: Uint8Array;
  readonly #signingKey: SecretBuffer | Uint8Array | undefined;
  readonly #entries: LedgerEntry[] = [];
  readonly #leafHashes: Uint8Array[] = [];
  #cachedRoot: Uint8Array | undefined;

  private constructor(publicKey: Uint8Array, signingKey: SecretBuffer | Uint8Array | undefined) {
    if (publicKey.length !== HYBRID_SIGNATURE.publicKeyLength) {
      throw new InvalidInputError("longitud de clave pública de firma incorrecta");
    }
    this.#publicKey = Uint8Array.from(publicKey);
    this.#signingKey = signingKey;
  }

  /**
   * El registro guarda una *referencia* a la clave privada, no una copia: la
   * vida del material secreto la gobierna quien lo creó, y destruirlo debe
   * dejar el registro sin poder firmar en el acto, no con una copia zombi
   * dentro.
   */
  static create(signingKey: HybridSigningKeyPair): AuditLedger {
    return new AuditLedger(signingKey.publicKey, signingKey.secretKey);
  }

  /** Clave pública con la que se verifican las cabeceras de este registro. */
  get publicKey(): Uint8Array {
    return Uint8Array.from(this.#publicKey);
  }

  get size(): number {
    return this.#entries.length;
  }

  get rootHash(): Uint8Array {
    this.#cachedRoot ??= rootFromLeafHashes(this.#leafHashes);
    return Uint8Array.from(this.#cachedRoot);
  }

  /** `true` si el registro se cargó sin clave privada (modo solo verificación). */
  get readOnly(): boolean {
    return this.#signingKey === undefined;
  }

  append(event: LedgerEvent): LedgerEntry {
    const signingKey = this.#signingKey;
    if (signingKey === undefined) {
      throw new LedgerError(
        "este registro se cargó sin clave de firma: solo permite verificación",
      );
    }
    if (!isLedgerEventType(event.type)) {
      throw new InvalidInputError(`tipo de suceso desconocido: ${String(event.type)}`);
    }
    const timestamp = event.timestamp ?? Date.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new InvalidInputError("la marca de tiempo debe ser un entero no negativo");
    }
    const index = this.#entries.length;
    const previousHash =
      index === 0
        ? genesisHash(this.#publicKey)
        : Uint8Array.from(this.#leafHashes[index - 1] as Uint8Array);

    const entry: LedgerEntry = {
      index,
      timestamp,
      type: event.type,
      detailHash: detailHash(event.detail ?? NO_DETAIL),
      ...(event.device === undefined ? {} : { device: event.device }),
      previousHash,
    };

    this.#entries.push(entry);
    this.#leafHashes.push(entryHash(entry));
    this.#cachedRoot = undefined;
    return cloneEntry(entry);
  }

  entries(): readonly LedgerEntry[] {
    return this.#entries.map((entry) => cloneEntry(entry));
  }

  /** La entrada `index`, o `undefined` si está fuera del registro. */
  entryAt(index: number): LedgerEntry | undefined {
    const entry = this.#entries[index];
    return entry === undefined ? undefined : cloneEntry(entry);
  }

  /** Raíz que tenía el registro cuando tenía `size` entradas. */
  rootAt(size: number): Uint8Array {
    this.#requireSize(size, "tamaño");
    if (size === this.#entries.length) return this.rootHash;
    return rootFromLeafHashes(this.#leafHashes.slice(0, size));
  }

  signedTreeHead(timestamp?: number): SignedTreeHead {
    const signingKey = this.#signingKey;
    if (signingKey === undefined) {
      throw new LedgerError(
        "este registro se cargó sin clave de firma: solo permite verificación",
      );
    }
    return signTreeHead(signingKey, this.size, this.rootHash, timestamp ?? Date.now());
  }

  inclusionProof(index: number): Uint8Array[] {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#entries.length) {
      throw new InvalidInputError(
        `índice ${index} fuera de un registro de ${this.#entries.length} entradas`,
      );
    }
    return inclusionProofFromLeafHashes(this.#leafHashes, index);
  }

  consistencyProof(fromSize: number, toSize: number): Uint8Array[] {
    this.#requireSize(fromSize, "tamaño de origen");
    this.#requireSize(toSize, "tamaño de destino");
    if (fromSize > toSize) {
      throw new InvalidInputError(
        `una prueba de consistencia no puede ir hacia atrás: ${fromSize} -> ${toSize}`,
      );
    }
    return consistencyProofFromLeafHashes(this.#leafHashes, fromSize, toSize);
  }

  #requireSize(size: number, what: string): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.#entries.length) {
      throw new InvalidInputError(
        `${what} ${size} fuera de un registro de ${this.#entries.length} entradas`,
      );
    }
  }

  /**
   * Formato: magia || versión || clavePública || nº entradas || entradas.
   *
   * Solo salen los hashes de detalle, nunca los detalles: el fichero
   * serializado puede subirse a un servidor o entregarse a un auditor tal cual.
   * La clave privada tampoco viaja aquí, de ahí que `deserialize` devuelva un
   * registro que verifica pero no puede firmar ni añadir.
   */
  serialize(): Uint8Array {
    const parts: Uint8Array[] = [
      LEDGER_MAGIC,
      new Uint8Array([LEDGER_FORMAT_VERSION]),
      lengthPrefixed(this.#publicKey),
      uint32(this.#entries.length),
    ];
    for (const entry of this.#entries) {
      parts.push(lengthPrefixed(encodeEntry(entry)));
    }
    return concatBytes(...parts);
  }

  /**
   * Recarga un registro y **revalida la cadena entera** por el camino: índices
   * consecutivos y cada `previousHash` igual al hash de hoja de la entrada
   * anterior. Un fichero al que le hayan borrado, insertado o alterado una
   * entrada falla aquí, antes de que nadie pueda apoyarse en su raíz.
   */
  static deserialize(bytes: Uint8Array, signingKey?: HybridSigningKeyPair): AuditLedger {
    const reader = new ByteReader(bytes);
    const magic = reader.take(LEDGER_MAGIC.length);
    if (!constantTimeEqual(magic, LEDGER_MAGIC)) {
      throw new InvalidInputError("estos bytes no son un registro de auditoría de Cerbero");
    }
    const version = reader.takeUint8();
    if (version !== LEDGER_FORMAT_VERSION) {
      throw new InvalidInputError(`versión de registro no soportada: ${version}`);
    }
    const publicKey = Uint8Array.from(reader.takeLengthPrefixed());
    const count = reader.takeUint32();

    // Reanudar un registro exige demostrar que la clave es la suya. Aceptar
    // otra permitiría continuar el historial de alguien con una clave propia,
    // que es justo la sustitución de clave que el génesis atado impide.
    if (signingKey !== undefined && !constantTimeEqual(signingKey.publicKey, publicKey)) {
      throw new LedgerError("esa clave de firma no es la del registro: no puede continuarlo");
    }
    const ledger = new AuditLedger(publicKey, signingKey?.secretKey);
    for (let i = 0; i < count; i++) {
      const entry = decodeEntry(Uint8Array.from(reader.takeLengthPrefixed()));
      if (entry.index !== i) {
        throw new LedgerError(`entrada ${i} declara el índice ${entry.index}: el registro está alterado`);
      }
      const expectedPrevious =
        i === 0 ? genesisHash(publicKey) : (ledger.#leafHashes[i - 1] as Uint8Array);
      if (!constantTimeEqual(entry.previousHash, expectedPrevious)) {
        throw new LedgerError(`la cadena se rompe en la entrada ${i}: el registro está alterado`);
      }
      ledger.#entries.push(entry);
      ledger.#leafHashes.push(entryHash(entry));
    }
    reader.expectEnd();
    return ledger;
  }
}
