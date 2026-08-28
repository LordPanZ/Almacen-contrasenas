/**
 * @cerbero/guardians — recuperación sin custodio, cerradura temporal y herencia.
 *
 * El punto débil real de los gestores de contraseñas no es que los rompan: es
 * que pierdes la contraseña maestra y lo pierdes todo, o que mueres y tu
 * familia no puede acceder a nada. Las soluciones existentes obligan a confiar
 * en una empresa que guarda una copia de tu clave, o en un papel en un cajón.
 * Aquí no hay empresa en la que confiar.
 */

export { GuardianError, RecoveryError, SwitchError, TimeLockError } from "./errors.ts";

export {
  ATTESTATION_CONTEXT,
  countValidAttestations,
  createGuardian,
  createGuardianAttestation,
  createRecoveryPackage,
  generateGuardianIdentity,
  guardianDecryptShare,
  hasAttestationQuorum,
  recoverSecret,
  verifyGuardianAttestation,
} from "./recovery.ts";
export type {
  EncryptedShare,
  Guardian,
  GuardianAttestation,
  GuardianIdentity,
  RecoveryPackage,
  RecoveryPolicy,
} from "./recovery.ts";

export {
  MODULUS_BITS_POR_DEFECTO,
  createTimeLock,
  decodeTimeLock,
  encodeTimeLock,
  estimateSquaringsPerSecond,
  openTimeLockWithTrapdoor,
  solveTimeLock,
  squaringsForDuration,
} from "./timelock.ts";
export type { CreateTimeLockOptions, TimeLockPuzzle } from "./timelock.ts";

export {
  HEARTBEAT_CONTEXT,
  applyHeartbeat,
  claimInheritance,
  createDeadManSwitch,
  createInheritancePackage,
  decodeHeartbeat,
  decodeSwitch,
  describeSwitch,
  emitHeartbeat,
  encodeHeartbeat,
  encodeSwitch,
  evaluateSwitch,
  revokeSwitch,
  timeUntilRelease,
} from "./deadman.ts";
export type {
  ClaimInheritanceOptions,
  CreateInheritanceOptions,
  CreateSwitchOptions,
  DeadManSwitch,
  Heartbeat,
  InheritancePackage,
  SwitchEstado,
} from "./deadman.ts";
