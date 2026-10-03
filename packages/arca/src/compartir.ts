import {
  AEAD_OVERHEAD,
  ARGON2_PROFILES,
  ByteReader,
  SALT_LENGTH,
  SecretBuffer,
  concatBytes,
  deriveKey,
  deriveMasterKey,
  domainHash,
  generateSalt,
  open as aeadOpen,
  randomBytes,
  resolveProfile,
  seal as aeadSeal,
  uint16,
  uint32,
  utf8Decode,
  utf8Encode,
  zeroize,
} from "@cerbero/crypto";
import type { Argon2Profile, Argon2ProfileName } from "@cerbero/crypto";
import { abrirDocumento, sellarDocumento, tamanoSellado, MAX_SELLADO, SOBRECARGA_TROZO } from "./documento.ts";
import type { OpcionesTrozo } from "./documento.ts";
import { CompartidoCodigoError, CompartidoFormatoError } from "./errores.ts";
import { argon2Razonable, perfilPara } from "./formato.ts";
import { MAX_DOCUMENTO } from "./indice.ts";
import type { LectorAleatorio } from "./paquete.ts";
import { quitarRelleno, rellenar } from "./relleno.ts";

/**
 * Envíos cifrados: un documento (o varios) para otra persona.
 *
 * Arca no tiene servidor, así que compartir es pasar un fichero por el canal que
 * se quiera —WhatsApp, correo, AirDrop— y el código que lo abre por **otro**
 * distinto. El destinatario no necesita tener una caja: abre el envío en Arca con
 * el código y ve o descarga lo que hay dentro.
 *
 * ```
 * "ARCASHR1" | versión(2) | argon2: t,m,p (12) | sal(32) | envíoId(16)
 * u32 len | manifiesto cifrado
 * { u32 len | documento cifrado } × n
 * ```
 *
 * **El código es de azar, no una contraseña elegida**: 100 bits generados al
 * crear el envío. Un fichero que viaja por una mensajería queda en sus
 * servidores y en las copias de quien lo recibe; con una contraseña humana, esa
 * copia sería un blanco de ataque sin conexión. Con 100 bits no hay nada que
 * adivinar, y Argon2id queda como cinturón y tirantes.
 *
 * Dentro del cifrado van los nombres, los tipos y los tamaños reales. Fuera solo
 * se ve que es un envío de Arca, el coste de derivación, la sal y los tamaños de
 * los documentos, que caen en cubos igual que en la caja.
 *
 * No se puede revocar: quien tenga el fichero y el código lo abrirá siempre. Y
 * quien lo abre puede guardarlo en claro, claro. Lo que esto protege es el
 * camino, no la confianza en el destinatario.
 */

export const COMPARTIDO_MAGIC = /* @__PURE__ */ utf8Encode("ARCASHR1");
export const COMPARTIDO_VERSION = 1;
export const ENVIO_ID_LENGTH = 16;

/** Documentos por envío. No es un límite de seguridad: es el que cabe cómodamente en un móvil. */
export const MAX_COMPARTIDO_DOCUMENTOS = 50;

/** Suma de los tamaños originales de un envío. */
export const MAX_COMPARTIDO_BYTES = 200 * 1024 * 1024;

/** El manifiesto es JSON de nombres; una cota holgada basta y evita reservar memoria por un tamaño falso. */
const MAX_MANIFIESTO_SELLADO = 1024 * 1024;
const SUELO_MANIFIESTO = 4096;

/** `magic(8) | versión(2) | argon2(12) | sal(32) | envíoId(16)`. */
const CABECERA_COMPARTIDO = COMPARTIDO_MAGIC.length + 2 + 12 + SALT_LENGTH + ENVIO_ID_LENGTH;

// ─── El código ───────────────────────────────────────────────────────────

/**
 * Alfabeto de Crockford: sin I, L, O ni U, que se confunden entre sí o con 1 y 0
 * al dictar un código por teléfono.
 */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Símbolos del código; a 5 bits cada uno son 100 bits de azar. */
export const LONGITUD_CODIGO = 20;
const GRUPO = 5;

/** Un código nuevo, en grupos para dictarlo: `7QMX2-D9RPH-T4WVF-8N3CB`. */
export function generarCodigo(): string {
  const azar = randomBytes(LONGITUD_CODIGO);
  try {
    // 256 es múltiplo de 32: tomar los 5 bits bajos no sesga ningún símbolo.
    const simbolos = Array.from(azar, (b) => ALFABETO[b & 31] as string);
    const grupos: string[] = [];
    for (let i = 0; i < simbolos.length; i += GRUPO) grupos.push(simbolos.slice(i, i + GRUPO).join(""));
    return grupos.join("-");
  } finally {
    zeroize(azar);
  }
}

/**
 * Deja un código como lo escribiría quien lo recibe en su forma canónica:
 * mayúsculas, sin espacios ni guiones, y con las confusiones habituales
 * resueltas como hace Crockford (I y L son 1, O es 0).
 */
export function normalizarCodigo(texto: string): string {
  const canonico = texto
    .toUpperCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (canonico.length !== LONGITUD_CODIGO || ![...canonico].every((c) => ALFABETO.includes(c))) {
    throw new CompartidoFormatoError(
      `el código tiene ${LONGITUD_CODIGO} letras y números, en grupos de ${GRUPO}: revisa que lo hayas copiado entero`,
    );
  }
  return canonico;
}

// ─── Claves ──────────────────────────────────────────────────────────────

function claveEnvio(codigoCanonico: string, sal: Uint8Array, perfil: Argon2Profile): SecretBuffer {
  const secreto = SecretBuffer.fromText(codigoCanonico);
  try {
    const maestra = deriveMasterKey(secreto, sal, perfil);
    try {
      return deriveKey(maestra.bytes, "arca-share-key");
    } finally {
      maestra.destroy();
    }
  } finally {
    secreto.destroy();
  }
}

function claveManifiesto(clave: SecretBuffer): SecretBuffer {
  return deriveKey(clave.bytes, "arca-share-manifest-key");
}

/** El manifiesto va atado a toda la cabecera: tocar un parámetro, la sal o el identificador lo invalida. */
function aadManifiesto(cabecera: Uint8Array): Uint8Array {
  return domainHash("arca-share-manifest", cabecera);
}

/** Los documentos de un envío se numeran: el orden va en la clave y en los datos autenticados. */
function idDocumento(posicion: number): string {
  return posicion.toString(16).padStart(32, "0");
}

// ─── Manifiesto ──────────────────────────────────────────────────────────

export interface DocumentoCompartido {
  readonly nombre: string;
  readonly mime: string;
  readonly tam: number;
}

export interface Manifiesto {
  readonly version: 1;
  readonly creado: number;
  readonly documentos: readonly DocumentoCompartido[];
}

function leerManifiesto(json: string): Manifiesto {
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    throw new CompartidoFormatoError("el contenido del envío no es válido");
  }
  if (typeof bruto !== "object" || bruto === null) throw new CompartidoFormatoError("el contenido del envío no es válido");
  const r = bruto as Record<string, unknown>;
  if (r["version"] !== 1) throw new CompartidoFormatoError("versión de envío no soportada");
  const creado = r["creado"];
  if (typeof creado !== "number" || !Number.isFinite(creado) || creado < 0) {
    throw new CompartidoFormatoError("el contenido del envío no es válido");
  }
  const lista = r["documentos"];
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_COMPARTIDO_DOCUMENTOS) {
    throw new CompartidoFormatoError("el envío no trae un número válido de documentos");
  }
  let total = 0;
  const documentos = lista.map((candidato: unknown): DocumentoCompartido => {
    if (typeof candidato !== "object" || candidato === null) {
      throw new CompartidoFormatoError("un documento del envío no es válido");
    }
    const d = candidato as Record<string, unknown>;
    const nombre = d["nombre"];
    const mime = d["mime"];
    const tam = d["tam"];
    if (
      typeof nombre !== "string" ||
      nombre === "" ||
      nombre.length > 255 ||
      typeof mime !== "string" ||
      mime.length > 127 ||
      typeof tam !== "number" ||
      !Number.isSafeInteger(tam) ||
      tam < 1 ||
      tam > MAX_DOCUMENTO
    ) {
      throw new CompartidoFormatoError("un documento del envío no es válido");
    }
    total += tam;
    return { nombre, mime, tam };
  });
  if (total > MAX_COMPARTIDO_BYTES) throw new CompartidoFormatoError("el envío declara más datos de los permitidos");
  return { version: 1, creado, documentos };
}

// ─── Crear ───────────────────────────────────────────────────────────────

export interface OpcionesEnvio extends OpcionesTrozo {
  /** Por defecto, `interactive`: el código ya es de azar, así que el coste es de pura prudencia. */
  readonly perfil?: Argon2ProfileName | Argon2Profile;
  /** Solo para tests: fija el código en vez de generarlo. */
  readonly codigo?: string;
}

export interface ArchivoParaEnviar {
  readonly nombre: string;
  readonly mime: string;
  readonly datos: Uint8Array;
}

/**
 * Construye un envío documento a documento: cada uno se cifra al añadirlo y no se
 * guarda más que su criptograma, de modo que no hay que tener todos los
 * originales en memoria a la vez.
 */
export class ConstructorEnvio {
  readonly codigo: string;
  #clave: SecretBuffer | null;
  readonly #cabecera: Uint8Array;
  readonly #envioId: Uint8Array;
  readonly #cifrados: Uint8Array[] = [];
  readonly #meta: DocumentoCompartido[] = [];
  readonly #opciones: OpcionesTrozo;
  #total = 0;

  private constructor(
    codigo: string,
    clave: SecretBuffer,
    cabecera: Uint8Array,
    envioId: Uint8Array,
    opciones: OpcionesTrozo,
  ) {
    this.codigo = codigo;
    this.#clave = clave;
    this.#cabecera = cabecera;
    this.#envioId = envioId;
    this.#opciones = opciones;
  }

  /** Genera el código, deriva la clave (aquí se paga Argon2) y prepara la cabecera. */
  static crear(opciones: OpcionesEnvio = {}): ConstructorEnvio {
    const perfil = resolveProfile(opciones.perfil ?? ARGON2_PROFILES.interactive);
    if (!argon2Razonable(perfil.timeCost, perfil.memoryKiB, perfil.parallelism)) {
      throw new CompartidoFormatoError("parámetros de Argon2 fuera de rango");
    }
    const codigo = opciones.codigo ?? generarCodigo();
    const canonico = normalizarCodigo(codigo);
    const sal = generateSalt();
    const envioId = randomBytes(ENVIO_ID_LENGTH);
    const cabecera = concatBytes(
      COMPARTIDO_MAGIC,
      uint16(COMPARTIDO_VERSION),
      uint32(perfil.timeCost),
      uint32(perfil.memoryKiB),
      uint32(perfil.parallelism),
      sal,
      envioId,
    );
    const clave = claveEnvio(canonico, sal, perfil);
    return new ConstructorEnvio(
      codigo,
      clave,
      cabecera,
      envioId,
      opciones.trozo === undefined ? {} : { trozo: opciones.trozo },
    );
  }

  #exigir(): SecretBuffer {
    if (!this.#clave) throw new CompartidoFormatoError("el envío ya está terminado o cancelado");
    return this.#clave;
  }

  /** Cifra un documento y lo añade. Los bytes originales siguen siendo del llamante: bórralos tú. */
  anadir(archivo: ArchivoParaEnviar): void {
    const clave = this.#exigir();
    if (this.#meta.length >= MAX_COMPARTIDO_DOCUMENTOS) {
      throw new CompartidoFormatoError(`un envío admite hasta ${MAX_COMPARTIDO_DOCUMENTOS} documentos`);
    }
    if (this.#total + archivo.datos.length > MAX_COMPARTIDO_BYTES) {
      throw new CompartidoFormatoError(
        `un envío admite hasta ${MAX_COMPARTIDO_BYTES / 1024 / 1024} MiB en total: envíalo en partes`,
      );
    }
    const posicion = this.#meta.length;
    const cifrado = sellarDocumento(clave, this.#envioId, idDocumento(posicion), archivo.datos, this.#opciones);
    this.#cifrados.push(cifrado);
    this.#meta.push({
      nombre: archivo.nombre.slice(0, 255) || "documento",
      mime: archivo.mime.slice(0, 127) || "application/octet-stream",
      tam: archivo.datos.length,
    });
    this.#total += archivo.datos.length;
  }

  /**
   * Cierra el envío y devuelve sus piezas, en orden, para concatenarlas o
   * pasarlas a un `Blob`. Borra la clave: un constructor no se reutiliza.
   */
  terminar(ahora: number = Date.now()): Uint8Array[] {
    const clave = this.#exigir();
    if (this.#meta.length === 0) throw new CompartidoFormatoError("un envío necesita al menos un documento");
    const claveMan = claveManifiesto(clave);
    try {
      const json = utf8Encode(
        JSON.stringify({ version: 1, creado: ahora, documentos: this.#meta } satisfies Manifiesto),
      );
      const relleno = rellenar(json, SUELO_MANIFIESTO);
      let manifiesto: Uint8Array;
      try {
        manifiesto = aeadSeal(claveMan, relleno, aadManifiesto(this.#cabecera));
      } finally {
        zeroize(json, relleno);
      }
      const piezas: Uint8Array[] = [this.#cabecera, uint32(manifiesto.length), manifiesto];
      for (const cifrado of this.#cifrados) piezas.push(uint32(cifrado.length), cifrado);
      return piezas;
    } finally {
      claveMan.destroy();
      this.cancelar();
    }
  }

  /** Borra la clave y suelta lo cifrado. */
  cancelar(): void {
    this.#clave?.destroy();
    this.#clave = null;
    this.#cifrados.length = 0;
  }
}

// ─── Leer ────────────────────────────────────────────────────────────────

export interface RegistroEnvio {
  readonly desde: number;
  readonly tam: number;
}

export interface EnvioInspeccionado {
  readonly cabecera: Uint8Array;
  readonly argon2: Argon2Profile;
  readonly sal: Uint8Array;
  readonly envioId: Uint8Array;
  readonly manifiesto: Uint8Array;
  readonly documentos: readonly RegistroEnvio[];
}

/**
 * Recorre el envío validando su estructura **sin necesitar el código**: solo los
 * prefijos de longitud, saltando el contenido. Así un fichero que no es un
 * envío, o está cortado, se rechaza al elegirlo y antes de pedir el código.
 */
export async function inspeccionarEnvio(fuente: LectorAleatorio): Promise<EnvioInspeccionado> {
  let posicion = 0;
  const tomar = async (cuantos: number): Promise<Uint8Array> => {
    if (cuantos < 0 || posicion + cuantos > fuente.tamano) {
      throw new CompartidoFormatoError("el envío está cortado o corrupto");
    }
    const bytes = await fuente.leer(posicion, cuantos);
    if (bytes.length !== cuantos) throw new CompartidoFormatoError("el envío está cortado o corrupto");
    posicion += cuantos;
    return bytes;
  };
  const u32 = async (): Promise<number> => {
    const b = await tomar(4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
  };

  if (fuente.tamano < CABECERA_COMPARTIDO + 4) {
    throw new CompartidoFormatoError("el fichero es demasiado corto para ser un envío de Arca");
  }
  const cabecera = Uint8Array.from(await tomar(CABECERA_COMPARTIDO));
  const lector = new ByteReader(cabecera);
  const magic = lector.take(COMPARTIDO_MAGIC.length);
  for (let i = 0; i < COMPARTIDO_MAGIC.length; i++) {
    if (magic[i] !== COMPARTIDO_MAGIC[i]) throw new CompartidoFormatoError("no es un envío de Arca");
  }
  const version = lector.takeUint16();
  if (version !== COMPARTIDO_VERSION) throw new CompartidoFormatoError(`versión de envío no soportada: ${version}`);
  const timeCost = lector.takeUint32();
  const memoryKiB = lector.takeUint32();
  const parallelism = lector.takeUint32();
  if (!argon2Razonable(timeCost, memoryKiB, parallelism)) {
    throw new CompartidoFormatoError("parámetros de Argon2 fuera de rango");
  }
  const sal = Uint8Array.from(lector.take(SALT_LENGTH));
  const envioId = Uint8Array.from(lector.take(ENVIO_ID_LENGTH));

  const longitudManifiesto = await u32();
  if (longitudManifiesto <= AEAD_OVERHEAD || longitudManifiesto > MAX_MANIFIESTO_SELLADO) {
    throw new CompartidoFormatoError("el contenido del envío no es válido");
  }
  const manifiesto = Uint8Array.from(await tomar(longitudManifiesto));

  const documentos: RegistroEnvio[] = [];
  while (posicion < fuente.tamano) {
    if (documentos.length >= MAX_COMPARTIDO_DOCUMENTOS) {
      throw new CompartidoFormatoError("el envío trae más documentos de los permitidos");
    }
    const tam = await u32();
    if (tam <= SOBRECARGA_TROZO || tam > MAX_SELLADO) {
      throw new CompartidoFormatoError("el tamaño de un documento del envío no es válido");
    }
    if (posicion + tam > fuente.tamano) throw new CompartidoFormatoError("el envío está cortado o corrupto");
    documentos.push({ desde: posicion, tam });
    posicion += tam;
  }
  if (documentos.length === 0) throw new CompartidoFormatoError("el envío no trae ningún documento");
  return { cabecera, argon2: perfilPara(timeCost, memoryKiB, parallelism), sal, envioId, manifiesto, documentos };
}

/** Un envío abierto: guarda su clave y nada más. */
export class Envio {
  #clave: SecretBuffer | null;
  readonly #envioId: Uint8Array;
  readonly #registros: readonly RegistroEnvio[];
  readonly #opciones: OpcionesTrozo;
  readonly manifiesto: Manifiesto;

  /** @internal Se obtiene con `abrirEnvio`. */
  constructor(
    clave: SecretBuffer,
    envioId: Uint8Array,
    manifiesto: Manifiesto,
    registros: readonly RegistroEnvio[],
    opciones: OpcionesTrozo,
  ) {
    this.#clave = clave;
    this.#envioId = envioId;
    this.manifiesto = manifiesto;
    this.#registros = registros;
    this.#opciones = opciones;
  }

  get cerrado(): boolean {
    return this.#clave === null;
  }

  /** Dónde está el documento `posicion` dentro del fichero, para leerlo sin cargarlo todo. */
  registro(posicion: number): RegistroEnvio {
    const r = this.#registros[posicion];
    if (!r) throw new CompartidoFormatoError("ese documento no está en el envío");
    return r;
  }

  /** Descifra un documento. Lanza `AeadError` ante cualquier alteración. */
  abrirDocumento(posicion: number, cifrado: Uint8Array): Uint8Array {
    if (!this.#clave) throw new CompartidoFormatoError("el envío está cerrado");
    const meta = this.manifiesto.documentos[posicion];
    if (!meta) throw new CompartidoFormatoError("ese documento no está en el envío");
    const datos = abrirDocumento(this.#clave, this.#envioId, idDocumento(posicion), cifrado, this.#opciones);
    if (datos.length !== meta.tam) {
      zeroize(datos);
      throw new CompartidoFormatoError("un documento del envío no coincide con lo que anuncia");
    }
    return datos;
  }

  /** Borra la clave de memoria. */
  cerrar(): void {
    this.#clave?.destroy();
    this.#clave = null;
  }
}

/**
 * Abre un envío con su código. Aquí se paga el Argon2.
 *
 * Código equivocado y fichero alterado fallan igual, con el mismo mensaje. Si el
 * código es bueno pero el fichero tiene documentos de más o de menos que los que
 * anuncia el manifiesto —que va autenticado—, es que lo recortaron o le añadieron
 * algo, y se dice.
 */
export function abrirEnvio(
  inspeccion: EnvioInspeccionado,
  codigo: string,
  opciones: OpcionesTrozo = {},
): Envio {
  const canonico = normalizarCodigo(codigo);
  const clave = claveEnvio(canonico, inspeccion.sal, inspeccion.argon2);
  let exito = false;
  try {
    const claveMan = claveManifiesto(clave);
    let plano: Uint8Array;
    try {
      plano = aeadOpen(claveMan, inspeccion.manifiesto, aadManifiesto(inspeccion.cabecera));
    } catch {
      throw new CompartidoCodigoError();
    } finally {
      claveMan.destroy();
    }
    let manifiesto: Manifiesto;
    try {
      manifiesto = leerManifiesto(utf8Decode(quitarRelleno(plano, SUELO_MANIFIESTO)));
    } finally {
      zeroize(plano);
    }
    if (manifiesto.documentos.length !== inspeccion.documentos.length) {
      throw new CompartidoFormatoError("el envío está incompleto o tiene datos de más");
    }
    manifiesto.documentos.forEach((d, i) => {
      const registro = inspeccion.documentos[i] as RegistroEnvio;
      if (registro.tam !== tamanoSellado(d.tam, opciones)) {
        throw new CompartidoFormatoError("un documento del envío no mide lo que anuncia");
      }
    });
    exito = true;
    return new Envio(clave, inspeccion.envioId, manifiesto, inspeccion.documentos, opciones);
  } finally {
    if (!exito) clave.destroy();
  }
}
