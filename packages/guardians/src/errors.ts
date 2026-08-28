import { CerberoError } from "@cerbero/crypto";

/**
 * Errores propios de la capa de guardianes.
 *
 * Cuelgan de `CerberoError` para poder atraparlos todos juntos, pero se
 * distinguen del núcleo por una razón práctica: aquí los fallos son de
 * *contrato* (umbral insuficiente, trampilla que no corresponde, interruptor
 * aún no vencido) y conviene que expliquen qué falta.
 *
 * Regla que no se rompe: cuando lo que falla es un descifrado, el error que
 * sale es el `AeadError` del núcleo, opaco e idéntico para clave equivocada,
 * datos manipulados o `aad` que no encaja. Distinguir esos tres casos es
 * exactamente el oráculo que un atacante necesita, así que ningún error de este
 * paquete envuelve un fallo criptográfico con más información de la que ya hay.
 */
export class GuardianError extends CerberoError {}

/** Recuperación social: umbral, política o fragmento que no cuadran. */
export class RecoveryError extends GuardianError {}

/** Cerradura temporal: parámetros imposibles o trampilla ajena al puzzle. */
export class TimeLockError extends GuardianError {}

/** Interruptor de hombre muerto: señal inválida, orden temporal o estado. */
export class SwitchError extends GuardianError {}
