import {
  HYBRID_KEM,
  HYBRID_SIGNATURE,
  SecretBuffer,
  combineShares,
  decodeShare,
  domainHash,
  encodeShare,
  generateHybridKeyPair,
  generateSigningKeyPair,
  hybridOpen,
  hybridSeal,
  hybridSign,
  hybridVerify,
  splitSecret,
  uint32,
  uint64,
  utf8Encode,
} from "@cerbero/crypto";
import type { ShamirShare } from "@cerbero/crypto";
import { RecoveryError } from "./errors.ts";
import { newId } from "./format.ts";

/**
 * Recuperación social: k de n guardianes.
 *
 * El problema que resuelve no es que te rompan la bóveda, sino que pierdas la
 * contraseña maestra y lo pierdas todo. Las alternativas del mercado son
 * confiar en una empresa que guarda una copia de tu clave —y entonces existe
 * una copia que se puede robar, filtrar o entregar por orden judicial— o un
 * papel en un cajón, que se pierde y se quema. Aquí el secreto se reparte entre
 * personas: hacen falta k de ellas para reconstruirlo y ninguna, por sí sola,
 * sabe absolutamente nada.
 */
export interface Guardian {
  readonly id: string;
  readonly nombre: string;
  /** Clave pública del KEM híbrido X-Wing (1216 B). */
  readonly publicKey: Uint8Array;
  readonly añadidoEn: number;
  /**
   * Clave pública de firma híbrida (1984 B). Solo necesaria si el guardián va a
   * emitir atestaciones; sin ella sus aprobaciones no son verificables.
   */
  readonly signingPublicKey?: Uint8Array;
}

export interface RecoveryPolicy {
  readonly policyId: string;
  readonly threshold: number;
  readonly guardians: readonly Guardian[];
  readonly creadaEn: number;
}

/**
 * Fragmento cifrado *para* un guardián concreto.
 *
 * Deliberadamente no lleva la política dentro: un guardián que recibe su sobre
 * no debe poder enumerar a los demás guardianes. Saber quiénes son los otros
 * k-1 convierte un ataque criptográfico imposible en un problema social muy
 * posible (a quién presionar, a quién engañar, a quién sobornar).
 */
export interface EncryptedShare {
  readonly policyId: string;
  readonly guardianId: string;
  readonly shareIndex: number;
  readonly payload: Uint8Array;
}

export interface RecoveryPackage {
  readonly policy: RecoveryPolicy;
  readonly shares: readonly EncryptedShare[];
}

/** Aprobación firmada de un guardián para *una* recuperación concreta. */
export interface GuardianAttestation {
  readonly policyId: string;
  readonly guardianId: string;
  /** Identifica el intento de recuperación: sin esto, una aprobación valdría para siempre. */
  readonly recoveryId: string;
  readonly firmadaEn: number;
  readonly signature: Uint8Array;
}

/**
 * Contexto de firma reservado para las atestaciones.
 *
 * Separar dominios de firma impide que una firma emitida en otro sitio del
 * sistema (una entrada del registro de auditoría, una señal de vida) se
 * presente como la aprobación de un guardián, y viceversa.
 */
export const ATTESTATION_CONTEXT = "guardian-attestation";

/**
 * Datos autenticados del sobre de un fragmento.
 *
 * Atan el criptograma a la política, al guardián y al índice. Sin este atado,
 * el sobre de Ana en la política vieja se podría presentar como el sobre de Ana
 * en la política nueva, o como el sobre de Beto: el mensajero que transporta
 * los fragmentos podría recombinarlos y nadie lo notaría. Con él, cualquier
 * cambio de contexto hace fallar el descifrado.
 */
function shareAad(policyId: string, guardianId: string, shareIndex: number): Uint8Array {
  return domainHash(
    "guardian-share-envelope",
    utf8Encode(policyId),
    utf8Encode(guardianId),
    uint32(shareIndex),
  );
}

function attestationMessage(attestation: Omit<GuardianAttestation, "signature">): Uint8Array {
  return domainHash(
    "guardian-attestation",
    utf8Encode(attestation.policyId),
    utf8Encode(attestation.guardianId),
    utf8Encode(attestation.recoveryId),
    uint64(attestation.firmadaEn),
  );
}

/** Comprueba una ficha de guardián suelta: nombre, identificador y claves. */
function checkGuardian(guardian: Guardian): void {
  if (guardian.id.length === 0 || guardian.nombre.length === 0) {
    throw new RecoveryError("todo guardián necesita identificador y nombre");
  }
  if (guardian.publicKey.length !== HYBRID_KEM.publicKeyLength) {
    throw new RecoveryError(`la clave pública de ${guardian.nombre} no es una clave KEM híbrida`);
  }
  if (
    guardian.signingPublicKey !== undefined &&
    guardian.signingPublicKey.length !== HYBRID_SIGNATURE.publicKeyLength
  ) {
    throw new RecoveryError(`la clave de firma de ${guardian.nombre} no tiene el tamaño esperado`);
  }
}

/**
 * Comprueba el conjunto de guardianes y su umbral.
 *
 * Va aparte de `checkGuardian` porque son dos preguntas distintas: si una ficha
 * concreta está bien formada, y si el grupo entero tiene sentido como política.
 * Mezclarlas hacía que dar de alta a un guardián exigiera que ese guardián
 * solo ya alcanzara el umbral, cosa imposible.
 */
function checkGuardians(guardians: readonly Guardian[], threshold: number): void {
  if (!Number.isSafeInteger(threshold) || threshold < 2) {
    throw new RecoveryError("el umbral debe ser de al menos 2 guardianes");
  }
  if (guardians.length < threshold) {
    throw new RecoveryError(
      `hacen falta al menos ${threshold} guardianes y solo se aportaron ${guardians.length}`,
    );
  }
  if (guardians.length > 255) {
    throw new RecoveryError("no se admiten más de 255 guardianes");
  }
  const ids = new Set<string>();
  for (const guardian of guardians) {
    checkGuardian(guardian);
    if (ids.has(guardian.id)) {
      throw new RecoveryError(`identificador de guardián duplicado: ${guardian.id}`);
    }
    ids.add(guardian.id);
  }
}

export function createGuardian(
  nombre: string,
  publicKey: Uint8Array,
  options: {
    readonly id?: string;
    readonly signingPublicKey?: Uint8Array;
    readonly ahora?: number;
  } = {},
): Guardian {
  const guardian: Guardian = {
    id: options.id ?? newId("gua"),
    nombre,
    publicKey,
    añadidoEn: options.ahora ?? Date.now(),
    ...(options.signingPublicKey ? { signingPublicKey: options.signingPublicKey } : {}),
  };
  checkGuardian(guardian);
  return guardian;
}

export interface GuardianIdentity {
  readonly guardian: Guardian;
  /** Con esta clave el guardián abre su sobre. Nunca sale de su dispositivo. */
  readonly kemSecretKey: SecretBuffer;
  /** Con esta clave firma que aprueba una recuperación. */
  readonly signingSecretKey: SecretBuffer;
}

/** Genera el par de claves de un guardián nuevo junto a su ficha pública. */
export function generateGuardianIdentity(
  nombre: string,
  options: { readonly ahora?: number } = {},
): GuardianIdentity {
  const kem = generateHybridKeyPair();
  const signing = generateSigningKeyPair();
  return {
    guardian: createGuardian(nombre, kem.publicKey, {
      signingPublicKey: signing.publicKey,
      ...(options.ahora === undefined ? {} : { ahora: options.ahora }),
    }),
    kemSecretKey: kem.secretKey,
    signingSecretKey: signing.secretKey,
  };
}

/**
 * Reparte `secret` entre los guardianes y cifra cada fragmento con la clave
 * pública de su destinatario.
 *
 * El cifrado por destinatario es lo que hace segura la *entrega*: los sobres
 * pueden viajar por correo, por un servidor o en una nota, porque quien los
 * transporta no puede leerlos y un guardián que reciba de más solo puede abrir
 * el suyo. Sin ese paso, el conjunto de fragmentos en tránsito sería el secreto
 * entero circulando en claro.
 */
export function createRecoveryPackage(
  secret: SecretBuffer | Uint8Array,
  guardians: readonly Guardian[],
  threshold: number,
  options: { readonly ahora?: number } = {},
): RecoveryPackage {
  checkGuardians(guardians, threshold);

  const policyId = newId("pol");
  const policy: RecoveryPolicy = {
    policyId,
    threshold,
    guardians: [...guardians],
    creadaEn: options.ahora ?? Date.now(),
  };

  const shares = splitSecret(secret, { threshold, shares: guardians.length });
  const envelopes: EncryptedShare[] = [];
  for (let i = 0; i < guardians.length; i++) {
    const guardian = guardians[i] as Guardian;
    const share = shares[i] as ShamirShare;
    const encoded = encodeShare(share);
    envelopes.push({
      policyId,
      guardianId: guardian.id,
      shareIndex: share.index,
      payload: hybridSeal(
        guardian.publicKey,
        encoded,
        shareAad(policyId, guardian.id, share.index),
      ),
    });
    encoded.fill(0);
    share.data.fill(0);
  }
  return { policy, shares: envelopes };
}

/**
 * Abre el sobre de un guardián. Falla —con el error opaco del núcleo— si la
 * clave no es la suya o si el sobre se movió a otra política, a otro guardián o
 * a otro índice.
 */
export function guardianDecryptShare(
  guardianSecretKey: SecretBuffer | Uint8Array,
  encryptedShare: EncryptedShare,
): ShamirShare {
  const plaintext = hybridOpen(
    guardianSecretKey,
    encryptedShare.payload,
    shareAad(encryptedShare.policyId, encryptedShare.guardianId, encryptedShare.shareIndex),
  );
  const share = decodeShare(plaintext);
  plaintext.fill(0);
  if (share.index !== encryptedShare.shareIndex) {
    throw new RecoveryError("el índice del fragmento no coincide con el del sobre");
  }
  return share;
}

/** Reconstruye el secreto a partir de al menos `policy.threshold` fragmentos. */
export function recoverSecret(
  shares: readonly ShamirShare[],
  policy: RecoveryPolicy,
): SecretBuffer {
  if (shares.length < policy.threshold) {
    throw new RecoveryError(
      `la política exige ${policy.threshold} fragmentos y solo se aportaron ${shares.length}`,
    );
  }
  for (const share of shares) {
    if (share.threshold !== policy.threshold) {
      throw new RecoveryError("hay fragmentos que no pertenecen a esta política");
    }
  }
  return combineShares(shares);
}

/**
 * El guardián firma que aprueba *esta* recuperación.
 *
 * La firma cubre el identificador del intento, así que una aprobación no se
 * puede guardar y reutilizar meses después en otra recuperación —ni la que
 * concedió a su amigo sirve para la que pide un impostor—. Es lo que convierte
 * el proceso en auditable: queda constancia verificable de quién aprobó qué.
 */
export function createGuardianAttestation(
  signingKey: SecretBuffer | Uint8Array,
  request: {
    readonly policyId: string;
    readonly guardianId: string;
    readonly recoveryId: string;
    readonly ahora?: number;
  },
): GuardianAttestation {
  const unsigned = {
    policyId: request.policyId,
    guardianId: request.guardianId,
    recoveryId: request.recoveryId,
    firmadaEn: request.ahora ?? Date.now(),
  };
  return {
    ...unsigned,
    signature: hybridSign(signingKey, attestationMessage(unsigned), ATTESTATION_CONTEXT),
  };
}

/**
 * Verifica una atestación contra la política y el intento de recuperación en
 * curso. Devuelve `false` ante cualquier discrepancia —guardián desconocido,
 * sin clave de firma registrada, otra política, otra recuperación o firma que
 * no cuadra— porque para quien decide si sigue adelante todos esos casos
 * significan lo mismo: esta aprobación no cuenta.
 */
export function verifyGuardianAttestation(
  attestation: GuardianAttestation,
  policy: RecoveryPolicy,
  recoveryId: string,
): boolean {
  if (attestation.policyId !== policy.policyId) return false;
  if (attestation.recoveryId !== recoveryId) return false;
  const guardian = policy.guardians.find((candidate) => candidate.id === attestation.guardianId);
  if (!guardian?.signingPublicKey) return false;
  const { signature, ...unsigned } = attestation;
  return hybridVerify(
    guardian.signingPublicKey,
    attestationMessage(unsigned),
    signature,
    ATTESTATION_CONTEXT,
  );
}

/**
 * Cuenta guardianes distintos con atestación válida. Se cuenta por guardián y
 * no por atestación: si no, presentar diez copias de la aprobación de uno solo
 * bastaría para simular un quórum.
 */
export function countValidAttestations(
  attestations: readonly GuardianAttestation[],
  policy: RecoveryPolicy,
  recoveryId: string,
): number {
  const approved = new Set<string>();
  for (const attestation of attestations) {
    if (verifyGuardianAttestation(attestation, policy, recoveryId)) {
      approved.add(attestation.guardianId);
    }
  }
  return approved.size;
}

export function hasAttestationQuorum(
  attestations: readonly GuardianAttestation[],
  policy: RecoveryPolicy,
  recoveryId: string,
): boolean {
  return countValidAttestations(attestations, policy, recoveryId) >= policy.threshold;
}
