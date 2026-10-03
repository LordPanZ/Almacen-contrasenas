import {
  AEAD_OVERHEAD,
  ARGON2_PROFILES,
  ByteReader,
  SALT_LENGTH,
  concatBytes,
  domainHash,
  uint16,
  uint32,
  utf8Encode,
} from "@cerbero/crypto";
import type { Argon2Profile } from "@cerbero/crypto";
import { CajaFormatoError } from "./errores.ts";

/** Ocho bytes ASCII al principio del fichero de cabecera. */
export const ARCA_MAGIC = /* @__PURE__ */ utf8Encode("ARCAFILE");

export const ARCA_VERSION = 1;
export const CAJA_ID_LENGTH = 16;
export const CLAVE_DATOS_LENGTH = 32;

/** `nonce(24) | clave de datos cifrada(32) | etiqueta(16)`. */
export const SOBRE_LENGTH = AEAD_OVERHEAD + CLAVE_DATOS_LENGTH;

/** `magic(8) | versión(2) | cajaId(16) | argon2(12) | sal(32)` — lo que va antes del sobre. */
const PREFIJO_LENGTH = ARCA_MAGIC.length + 2 + CAJA_ID_LENGTH + 12 + SALT_LENGTH;

export const CABECERA_LENGTH = PREFIJO_LENGTH + SOBRE_LENGTH;

// Cotas de cordura sobre los parámetros de Argon2 que trae el fichero. Sin ellas
// bastarían dos bytes alterados para que desbloquear intentara reservar
// terabytes de memoria: una denegación de servicio gratuita.
const MAX_TIME_COST = 64;
const MIN_MEMORY_KIB = 8;
const MAX_MEMORY_KIB = 1024 * 1024;
const MAX_PARALLELISM = 64;

/**
 * Lo que revela una caja sin conocer la contraseña: que es una caja de Arca, qué
 * coste de derivación usa y una sal aleatoria. Nada del contenido.
 */
export interface Cabecera {
  readonly version: number;
  readonly cajaId: Uint8Array;
  readonly argon2: Argon2Profile;
  readonly sal: Uint8Array;
  /** Clave de datos cifrada con la que sale de la contraseña. */
  readonly sobre: Uint8Array;
}

/**
 * ¿Son razonables los parámetros de Argon2 que trae un fichero? Se comprueba
 * antes de gastar un solo byte en ellos. Lo usan también los envíos cifrados.
 */
export function argon2Razonable(timeCost: number, memoryKiB: number, parallelism: number): boolean {
  return (
    timeCost >= 1 &&
    timeCost <= MAX_TIME_COST &&
    memoryKiB >= MIN_MEMORY_KIB &&
    memoryKiB <= MAX_MEMORY_KIB &&
    parallelism >= 1 &&
    parallelism <= MAX_PARALLELISM
  );
}

export function perfilPara(timeCost: number, memoryKiB: number, parallelism: number): Argon2Profile {
  for (const candidato of Object.values(ARGON2_PROFILES)) {
    if (
      candidato.timeCost === timeCost &&
      candidato.memoryKiB === memoryKiB &&
      candidato.parallelism === parallelism
    ) {
      return candidato;
    }
  }
  return { name: "personalizado", timeCost, memoryKiB, parallelism };
}

/** Bytes de la cabecera que el sobre autentica: todo salvo el propio sobre. */
export function prefijoCabecera(cabecera: Omit<Cabecera, "sobre">): Uint8Array {
  if (cabecera.sal.length !== SALT_LENGTH) {
    throw new CajaFormatoError(`la sal debe tener ${SALT_LENGTH} bytes`);
  }
  if (cabecera.cajaId.length !== CAJA_ID_LENGTH) {
    throw new CajaFormatoError(`el identificador de caja debe tener ${CAJA_ID_LENGTH} bytes`);
  }
  return concatBytes(
    ARCA_MAGIC,
    uint16(cabecera.version),
    cabecera.cajaId,
    uint32(cabecera.argon2.timeCost),
    uint32(cabecera.argon2.memoryKiB),
    uint32(cabecera.argon2.parallelism),
    cabecera.sal,
  );
}

export function codificarCabecera(cabecera: Cabecera): Uint8Array {
  if (cabecera.sobre.length !== SOBRE_LENGTH) {
    throw new CajaFormatoError("el sobre de la cabecera tiene una longitud incorrecta");
  }
  return concatBytes(prefijoCabecera(cabecera), cabecera.sobre);
}

/**
 * Lee y valida una cabecera. Exige la longitud exacta: una cabecera recortada o
 * con bytes de más se rechaza aquí, antes de gastar un Argon2 en ella.
 */
export function leerCabecera(bytes: Uint8Array): Cabecera {
  if (bytes.length !== CABECERA_LENGTH) {
    throw new CajaFormatoError();
  }
  const lector = new ByteReader(bytes);
  const magic = lector.take(ARCA_MAGIC.length);
  for (let i = 0; i < ARCA_MAGIC.length; i++) {
    if (magic[i] !== ARCA_MAGIC[i]) throw new CajaFormatoError();
  }
  const version = lector.takeUint16();
  if (version !== ARCA_VERSION) {
    throw new CajaFormatoError(`versión de caja no soportada: ${version}`);
  }
  const cajaId = Uint8Array.from(lector.take(CAJA_ID_LENGTH));
  const timeCost = lector.takeUint32();
  const memoryKiB = lector.takeUint32();
  const parallelism = lector.takeUint32();
  if (!argon2Razonable(timeCost, memoryKiB, parallelism)) {
    throw new CajaFormatoError("parámetros de Argon2 fuera de rango");
  }
  const sal = Uint8Array.from(lector.take(SALT_LENGTH));
  const sobre = Uint8Array.from(lector.take(SOBRE_LENGTH));
  return { version, cajaId, argon2: perfilPara(timeCost, memoryKiB, parallelism), sal, sobre };
}

/** Datos autenticados del sobre: atan la clave de datos a esta cabecera concreta. */
export function aadSobre(cabecera: Omit<Cabecera, "sobre">): Uint8Array {
  return domainHash("arca-header", prefijoCabecera(cabecera));
}
