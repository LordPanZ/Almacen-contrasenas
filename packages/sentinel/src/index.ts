/**
 * @cerbero/sentinel — detección de intrusión y consultas de conocimiento cero.
 *
 * Los dos huecos que cubre: ningún gestor de contraseñas te avisa de que
 * alguien ha entrado en tu bóveda, y comprobar si una contraseña está filtrada
 * se la revela, en parte, a un tercero.
 */

export {
  LONGITUD_ID_CANARIO,
  LONGITUD_MARCA,
  LONGITUD_MINIMA_CANARIO,
  SEVERIDAD_POR_ORIGEN,
  canaryMark,
  createCanary,
  createCanarySet,
  generateCanaryKey,
  isCanary,
  raiseCanaryAlarm,
  verifyCanary,
} from "./canarios.ts";
export type {
  CanaryAlarm,
  CanaryContext,
  CanaryCredential,
  CanaryOptions,
  CanaryOrigin,
  CanarySeverity,
} from "./canarios.ts";

export {
  BreachClient,
  BreachOracle,
  BreachProofError,
  checkPasswordAgainstBreaches,
  checkPasswordsAgainstBreaches,
  decoyQueries,
} from "./filtraciones.ts";
export type {
  BreachQuery,
  BreachResponse,
  BreachResult,
  BreachedSet,
  PreparedBreachQuery,
} from "./filtraciones.ts";

export {
  CARACTERES_AMBIGUOS,
  CLASES_CARACTERES,
  LONGITUD_POR_DEFECTO,
  PALABRAS_POR_DEFECTO,
  entropiaFrase,
  generatePassphrase,
  generatePassword,
  tamanoAlfabeto,
} from "./generador.ts";
export type { ClaseCaracteres, PassphraseOptions, PasswordOptions } from "./generador.ts";

export { cardinalAlfabeto, estimateStrength } from "./fortaleza.ts";
export type { StrengthReport, Veredicto } from "./fortaleza.ts";

export { FUENTE_SISTEMA, FlujoDeterminista } from "./flujo.ts";
export type { FuenteAleatoria } from "./flujo.ts";
