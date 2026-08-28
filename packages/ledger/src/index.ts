/**
 * @cerbero/ledger — registro de auditoría verificable.
 *
 * Ningún gestor de contraseñas te deja demostrar que tu historial no fue
 * reescrito. Este paquete aplica la técnica con la que Certificate Transparency
 * vigila a las autoridades de certificación: un árbol Merkle append-only
 * (RFC 6962), cabeceras firmadas y un monitor cliente con memoria. El resultado
 * es que el retroceso, la bifurcación y la sustitución de la clave de firma
 * dejan de ser invisibles y pasan a ser detectables —y demostrables ante
 * terceros— sin revelar nada del contenido de la bóveda.
 */

export {
  consistencyProof,
  emptyTreeHash,
  inclusionProof,
  leafHash,
  merkleRoot,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from "./merkle.ts";

export {
  cloneEntry,
  decodeEntry,
  detailHash,
  encodeEntry,
  entryHash,
  genesisHash,
  isLedgerEventType,
  LEDGER_EVENT_TYPES,
  verifyDetail,
} from "./entry.ts";
export type { LedgerEntry, LedgerEventType } from "./entry.ts";

export { LedgerError } from "./errors.ts";

export {
  decodeSignedTreeHead,
  encodeSignedTreeHead,
  signTreeHead,
  STH_SIGNATURE_CONTEXT,
  verifySignedTreeHead,
} from "./sth.ts";
export type { SignedTreeHead } from "./sth.ts";

export { AuditLedger } from "./ledger.ts";
export type { LedgerEvent } from "./ledger.ts";

export { LedgerMonitor } from "./monitor.ts";
export type { MonitorVerdict } from "./monitor.ts";
