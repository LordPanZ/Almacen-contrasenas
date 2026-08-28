/// <reference lib="webworker" />
import {
  SecretBuffer,
  fromBase64Url,
  hybridFingerprint,
  toBase64Url,
  toHex,
  utf8Decode,
  utf8Encode,
} from "@cerbero/crypto";
import {
  applyHeartbeat,
  createDeadManSwitch,
  createInheritancePackage,
  createRecoveryPackage,
  decodeSwitch,
  describeSwitch,
  emitHeartbeat,
  encodeSwitch,
  encodeTimeLock,
  estimateSquaringsPerSecond,
  evaluateSwitch,
  generateGuardianIdentity,
  guardianDecryptShare,
  recoverSecret,
  revokeSwitch,
  squaringsForDuration,
  timeUntilRelease,
  type DeadManSwitch,
  type EncryptedShare,
  type GuardianIdentity,
  type RecoveryPolicy,
} from "@cerbero/guardians";
import { AuditLedger, entryHash, verifyInclusion } from "@cerbero/ledger";
import {
  addVaultSlot,
  createVault,
  unlockVault,
  vaultFileInfo,
  type UnlockedVault,
  type VaultItem,
  type VaultItemDraft,
} from "@cerbero/vault";
import {
  BreachOracle,
  checkPasswordAgainstBreaches,
  createCanarySet,
  estimateStrength,
  generateCanaryKey,
  generatePassphrase,
  generatePassword,
  isCanary,
} from "@cerbero/sentinel";

/**
 * Toda la criptografía vive aquí, en un hilo aparte, por dos razones.
 *
 * La primera es de interfaz: derivar la clave maestra con Argon2id ocupa
 * cientos de MiB y varios segundos. En el hilo principal congelaría la ventana
 * entera y el navegador ofrecería cerrarla.
 *
 * La segunda, y más importante, es de seguridad: la bóveda abierta, su clave de
 * ranura y los secretos descifrados nunca entran en la memoria del hilo que
 * pinta la interfaz. Lo que cruza la frontera son datos ya escogidos, y el
 * secreto de una entrada solo cuando se pide explícitamente.
 */

let boveda: UnlockedVault | null = null;
let registro: AuditLedger | null = null;
let ficheroActual: Uint8Array | null = null;

interface Resumen {
  readonly vaultId: string;
  readonly ranuras: number;
  readonly tamanoRanura: number;
  readonly usados: number;
  readonly capacidad: number;
  readonly entradas: number;
}

function exigirAbierta(): UnlockedVault {
  if (!boveda || boveda.locked) throw new Error("no hay ninguna bóveda abierta");
  return boveda;
}

function resumen(): Resumen {
  const v = exigirAbierta();
  return {
    vaultId: v.vaultId,
    ranuras: v.slotCount,
    tamanoRanura: v.slotSize,
    usados: v.usedBytes,
    capacidad: v.capacityBytes,
    entradas: v.size,
  };
}

function claveCanarios(): SecretBuffer {
  return generateCanaryKey(exigirAbierta().identityKeyPair().publicKey);
}

/** Vista de listado. Nunca incluye el secreto: solo si es trampa y su fuerza. */
function filaDe(item: VaultItem, clave: SecretBuffer) {
  return {
    id: item.id,
    tipo: item.type,
    titulo: item.title,
    usuario: item.username ?? "",
    url: item.url ?? "",
    etiquetas: item.tags,
    actualizado: item.updatedAt,
    trampa: item.secret ? isCanary(item.secret, clave) : false,
    bits: item.secret ? estimateStrength(item.secret).bits : 0,
  };
}

function listar() {
  const v = exigirAbierta();
  const clave = claveCanarios();
  try {
    return v
      .list()
      .map((r) => v.get(r.id))
      .filter((item): item is VaultItem => item !== undefined)
      .map((item) => filaDe(item, clave));
  } finally {
    clave.destroy();
  }
}

function anotar(tipo: Parameters<AuditLedger["append"]>[0]["type"], detalle?: string): void {
  registro?.append({
    type: tipo,
    ...(detalle === undefined ? {} : { detail: new TextEncoder().encode(detalle) }),
  });
}

/** Vuelca el registro dentro de la bóveda y devuelve el fichero completo. */
function serializar(): Uint8Array {
  const v = exigirAbierta();
  if (registro) v.auditLog = registro.serialize();
  ficheroActual = v.serialize();
  return ficheroActual;
}

function cargarRegistro(v: UnlockedVault): void {
  const clave = v.signingKeyPair();
  const guardado = v.auditLog;
  registro = guardado.length > 0 ? AuditLedger.deserialize(guardado, clave) : AuditLedger.create(clave);
}

/* ─── Guardianes, hombre muerto y herencia ─────────────────────────────── */

/**
 * Anexos reservados.
 *
 * Dentro de la bóveda entra solo la parte **pública** de la política: quiénes
 * son los guardianes, sus claves públicas, el umbral y la fecha. Los fragmentos
 * cifrados no, y no por ahorrar sitio: para leerlos habría que abrir la bóveda,
 * y quien pueda abrirla no necesita recuperarla. Su sitio es fuera, en manos de
 * cada guardián.
 */
const ANEXO_RECUPERACION = "recovery";
const ANEXO_INTERRUPTOR = "deadman";

const DIA_MS = 86_400_000;

/** El puzzle serializa sus elevaciones en 32 bits: ese es el techo del formato. */
const TOPE_ELEVACIONES = 0xffffffff;

const FORMATO_SOBRE = "cerbero-sobre-guardian";
const FORMATO_SOBRE_LEGADO = "cerbero-sobre-legado";
const FORMATO_LEGADO = "cerbero-legado";

interface GuardianGuardado {
  readonly id: string;
  readonly nombre: string;
  readonly publicKey: string;
  readonly signingPublicKey: string;
  readonly anadidoEn: number;
}

interface PoliticaGuardada {
  readonly policyId: string;
  readonly umbral: number;
  readonly creadaEn: number;
  readonly guardianes: readonly GuardianGuardado[];
}

/**
 * Sobre de un guardián: su par de claves y su fragmento cifrado.
 *
 * No lleva la lista de guardianes, y esa ausencia es deliberada: quien recibe
 * un sobre no debe poder enumerar a los demás. Saber a quién más habría que
 * convencer convierte un ataque criptográfico imposible en un problema social
 * muy posible.
 */
interface SobreSerializado {
  readonly formato: string;
  readonly version: number;
  readonly policyId: string;
  readonly umbral: number;
  readonly creadoEn: number;
  readonly guardian: {
    readonly id: string;
    readonly nombre: string;
    readonly publicKey: string;
    readonly signingPublicKey: string;
  };
  readonly kemSecretKey: string;
  readonly signingSecretKey: string;
  readonly fragmento: { readonly indice: number; readonly payload: string };
}

interface Sobre {
  readonly nombre: string;
  readonly huella: string;
  readonly fichero: string;
  readonly bytes: Uint8Array;
}

/** Nombre de fichero legible a partir del del guardián. */
function sanear(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return limpio.length > 0 ? limpio : "guardian";
}

function guardarPolitica(v: UnlockedVault, politica: RecoveryPolicy): PoliticaGuardada {
  const guardada: PoliticaGuardada = {
    policyId: politica.policyId,
    umbral: politica.threshold,
    creadaEn: politica.creadaEn,
    guardianes: politica.guardians.map((guardian) => ({
      id: guardian.id,
      nombre: guardian.nombre,
      publicKey: toBase64Url(guardian.publicKey),
      signingPublicKey: guardian.signingPublicKey ? toBase64Url(guardian.signingPublicKey) : "",
      anadidoEn: guardian.añadidoEn,
    })),
  };
  v.setExtra(ANEXO_RECUPERACION, utf8Encode(JSON.stringify(guardada)));
  return guardada;
}

function leerPolitica(v: UnlockedVault): PoliticaGuardada | null {
  const bytes = v.getExtra(ANEXO_RECUPERACION);
  return bytes ? (JSON.parse(utf8Decode(bytes)) as PoliticaGuardada) : null;
}

/** Lo que ve la interfaz: la huella se calcula aquí, no allí. */
function vistaPolitica(guardada: PoliticaGuardada) {
  return {
    policyId: guardada.policyId,
    umbral: guardada.umbral,
    creadaEn: guardada.creadaEn,
    guardianes: guardada.guardianes.map((guardian) => ({
      id: guardian.id,
      nombre: guardian.nombre,
      huella: hybridFingerprint(fromBase64Url(guardian.publicKey)),
      anadidoEn: guardian.anadidoEn,
    })),
  };
}

function armarSobre(
  formato: string,
  policyId: string,
  umbral: number,
  identidad: GuardianIdentity,
  fragmento: EncryptedShare,
): Sobre {
  const sobre: SobreSerializado = {
    formato,
    version: 1,
    policyId,
    umbral,
    creadoEn: Date.now(),
    guardian: {
      id: identidad.guardian.id,
      nombre: identidad.guardian.nombre,
      publicKey: toBase64Url(identidad.guardian.publicKey),
      signingPublicKey: identidad.guardian.signingPublicKey
        ? toBase64Url(identidad.guardian.signingPublicKey)
        : "",
    },
    kemSecretKey: toBase64Url(identidad.kemSecretKey.bytes),
    signingSecretKey: toBase64Url(identidad.signingSecretKey.bytes),
    fragmento: { indice: fragmento.shareIndex, payload: toBase64Url(fragmento.payload) },
  };
  return {
    nombre: identidad.guardian.nombre,
    huella: hybridFingerprint(identidad.guardian.publicKey),
    fichero: `sobre-${sanear(identidad.guardian.nombre)}.cerbero.json`,
    bytes: utf8Encode(JSON.stringify(sobre, null, 2)),
  };
}

/**
 * Interpreta un sobre subido por el usuario.
 *
 * Distingue el sobre de recuperación del de un legado porque sus fragmentos
 * reconstruyen cosas distintas: los del legado dan el secreto enmascarado con
 * la clave de la cerradura temporal, no la contraseña. Combinarlos aquí
 * "funcionaría" —la suma de comprobación cuadra— y devolvería basura con
 * aspecto de contraseña recuperada, que es la peor forma posible de fallar.
 */
function leerSobre(fichero: string, bytes: Uint8Array, formato: string): SobreSerializado {
  let sobre: SobreSerializado;
  try {
    sobre = JSON.parse(utf8Decode(bytes)) as SobreSerializado;
  } catch {
    throw new Error(`«${fichero}» no es un sobre de guardián`);
  }
  if (sobre?.formato === FORMATO_SOBRE_LEGADO && formato === FORMATO_SOBRE) {
    throw new Error(
      `«${fichero}» es el sobre de un legado: su fragmento solo sirve junto a la cerradura temporal, no para recuperar la contraseña`,
    );
  }
  if (sobre?.formato !== formato || typeof sobre.kemSecretKey !== "string") {
    throw new Error(`«${fichero}» no es un sobre de guardián`);
  }
  return sobre;
}

function leerInterruptor(v: UnlockedVault): DeadManSwitch | null {
  const bytes = v.getExtra(ANEXO_INTERRUPTOR);
  return bytes ? decodeSwitch(bytes) : null;
}

function vistaInterruptor(estado: DeadManSwitch) {
  const ahora = Date.now();
  return {
    id: estado.id,
    creadoEn: estado.creadoEn,
    intervaloDias: Math.round(estado.intervaloSenalMs / DIA_MS),
    graciaDias: Math.round(estado.periodoGraciaMs / DIA_MS),
    ultimaSenal: estado.ultimaSenal,
    revocado: estado.revocado,
    estado: evaluateSwitch(estado, ahora),
    descripcion: describeSwitch(estado, ahora),
    restanteMs: timeUntilRelease(estado, ahora),
  };
}

function exigirDias(valor: number, que: string): number {
  if (!Number.isFinite(valor) || valor <= 0) throw new Error(`${que} debe ser de al menos un día`);
  return Math.round(valor) * DIA_MS;
}

const operaciones: Record<string, (carga: never) => unknown> = {
  crear: ({ password, perfil, ranuras }: { password: string; perfil: string; ranuras: number }) => {
    const clave = SecretBuffer.fromText(password);
    const { file, vault } = createVault(clave, {
      argon2Profile: perfil as "interactive" | "moderate" | "paranoid",
      slotCount: ranuras,
    });
    clave.destroy();
    boveda = vault;
    cargarRegistro(vault);
    anotar("vault-created");
    ficheroActual = serializar();
    return { resumen: resumen(), fichero: ficheroActual };
  },

  abrir: ({ fichero, password }: { fichero: Uint8Array; password: string }) => {
    const clave = SecretBuffer.fromText(password);
    try {
      boveda = unlockVault(fichero, clave);
    } finally {
      clave.destroy();
    }
    ficheroActual = fichero;
    cargarRegistro(boveda);
    anotar("vault-unlocked");
    return { resumen: resumen() };
  },

  inspeccionar: ({ fichero }: { fichero: Uint8Array }) => {
    const info = vaultFileInfo(fichero);
    return {
      version: info.version,
      ranuras: info.slotCount,
      tamanoRanura: info.slotSize,
      argon2: info.argon2,
      sal: toHex(info.salt),
      bytes: fichero.length,
    };
  },

  listar: () => ({ filas: listar() }),

  obtener: ({ id }: { id: string }) => {
    const item = exigirAbierta().get(id);
    if (!item) throw new Error("esa entrada ya no existe");
    anotar("item-read", id);
    const clave = claveCanarios();
    try {
      return {
        item: {
          ...item,
          secret: item.secret ?? "",
          notes: item.notes ?? "",
          username: item.username ?? "",
          url: item.url ?? "",
        },
        trampa: item.secret ? isCanary(item.secret, clave) : false,
        fuerza: item.secret ? estimateStrength(item.secret) : null,
      };
    } finally {
      clave.destroy();
    }
  },

  anadir: ({ draft }: { draft: VaultItemDraft }) => {
    const item = exigirAbierta().add(draft);
    anotar("item-added", item.id);
    return { fichero: serializar(), filas: listar(), id: item.id };
  },

  actualizar: ({ id, patch }: { id: string; patch: Partial<VaultItemDraft> }) => {
    exigirAbierta().update(id, patch);
    anotar("item-updated", id);
    return { fichero: serializar(), filas: listar() };
  },

  borrar: ({ id }: { id: string }) => {
    exigirAbierta().remove(id);
    anotar("item-removed", id);
    return { fichero: serializar(), filas: listar() };
  },

  sembrarCanarios: ({ cantidad }: { cantidad: number }) => {
    const v = exigirAbierta();
    const clave = claveCanarios();
    try {
      for (const canario of createCanarySet(clave, cantidad)) {
        v.add({
          type: "login",
          title: canario.servicio,
          username: canario.usuario,
          secret: canario.secret,
        });
      }
    } finally {
      clave.destroy();
    }
    anotar("policy-changed", `canarios:${cantidad}`);
    return { fichero: serializar(), filas: listar() };
  },

  coaccion: ({
    actual,
    nueva,
    anteriores,
  }: {
    actual: string;
    nueva: string;
    anteriores: readonly string[];
  }) => {
    if (!ficheroActual) throw new Error("no hay ningún fichero cargado");
    const claveActual = SecretBuffer.fromText(actual);
    const claveNueva = SecretBuffer.fromText(nueva);
    const otras = anteriores.map((p) => SecretBuffer.fromText(p));
    try {
      ficheroActual = addVaultSlot(ficheroActual, {
        existingPassword: claveActual,
        newPassword: claveNueva,
        otherPasswords: otras,
        items: [
          { type: "login", title: "Correo personal", username: "usuario@ejemplo.com", secret: generatePassword() },
          { type: "login", title: "Tienda en línea", username: "usuario@ejemplo.com", secret: generatePassword() },
          { type: "note", title: "Wifi de casa", notes: `Clave: ${generatePassword({ longitud: 14 })}` },
        ],
      });
      return { fichero: ficheroActual };
    } finally {
      claveActual.destroy();
      claveNueva.destroy();
      for (const clave of otras) clave.destroy();
    }
  },

  filtraciones: () => {
    const v = exigirAbierta();
    // Corpus de demostración. En producción el índice lo publica un servicio y
    // se descarga; el protocolo, y lo que el servidor aprende (nada), es igual.
    const oracle = BreachOracle.create();
    const indice = oracle.indexBreachedPasswords([
      "123456", "password", "qwerty", "111111", "123123", "abc123", "1234567890",
      "iloveyou", "admin", "welcome", "monkey", "dragon", "letmein", "football",
      "verano2024", "contraseña", "hola123", "madrid", "barcelona", "12345678",
      "princess", "sunshine", "master", "shadow", "querty", "1q2w3e4r",
    ]);
    try {
      const filas = v
        .list()
        .map((r) => v.get(r.id))
        .filter((item): item is VaultItem => item?.secret !== undefined)
        .map((item) => {
          const fuerza = estimateStrength(item.secret as string);
          return {
            id: item.id,
            titulo: item.title,
            filtrada: checkPasswordAgainstBreaches(oracle, indice, item.secret as string).filtrada,
            bits: fuerza.bits,
            veredicto: fuerza.veredicto,
            avisos: fuerza.avisos,
          };
        });
      return { filas, corpus: indice.size };
    } finally {
      oracle.destroy();
    }
  },

  auditoria: () => {
    if (!registro) throw new Error("no hay registro cargado");
    const entradas = registro.entries();
    return {
      tamano: registro.size,
      raiz: toHex(registro.rootHash),
      entradas: entradas.map((e) => ({
        indice: e.index,
        momento: e.timestamp,
        tipo: e.type,
      })),
    };
  },

  verificarAuditoria: () => {
    if (!registro) throw new Error("no hay registro cargado");
    const entradas = registro.entries();
    const fallos: number[] = [];
    for (let i = 0; i < registro.size; i++) {
      const ok = verifyInclusion(
        registro.rootHash,
        entryHash(entradas[i] as (typeof entradas)[number]),
        i,
        registro.size,
        registro.inclusionProof(i),
      );
      if (!ok) fallos.push(i);
    }
    return { verificadas: registro.size, fallos };
  },

  generar: ({ frase, longitud, palabras }: { frase: boolean; longitud: number; palabras: number }) => {
    const valor = frase ? generatePassphrase({ palabras }) : generatePassword({ longitud });
    return { valor, fuerza: estimateStrength(valor) };
  },

  evaluar: ({ password }: { password: string }) => ({ fuerza: estimateStrength(password) }),

  politicaGuardianes: () => {
    const guardada = leerPolitica(exigirAbierta());
    return { politica: guardada ? vistaPolitica(guardada) : null };
  },

  /**
   * Reparte la contraseña maestra entre los guardianes.
   *
   * Las identidades se generan aquí por comodidad de la demostración, pero sus
   * claves privadas se destruyen en cuanto entran en el sobre: la app se queda
   * solo con la parte pública, así que ni recomponiendo la bóveda podría
   * reunir el umbral por su cuenta.
   */
  configurarGuardianes: ({
    password,
    nombres,
    umbral,
  }: {
    password: string;
    nombres: readonly string[];
    umbral: number;
  }) => {
    const v = exigirAbierta();
    if (nombres.length < 2 || nombres.length > 8) {
      throw new Error("hacen falta entre 2 y 8 guardianes");
    }
    const identidades = nombres.map((nombre) => generateGuardianIdentity(nombre));
    const maestra = SecretBuffer.fromText(password);
    try {
      const paquete = createRecoveryPackage(
        maestra,
        identidades.map((identidad) => identidad.guardian),
        umbral,
      );
      // Primero la política: si el anexo no cabe en la ranura, no se reparten
      // sobres de una política que la bóveda no llegó a registrar.
      const guardada = guardarPolitica(v, paquete.policy);
      const sobres = identidades.map((identidad, i) =>
        armarSobre(
          FORMATO_SOBRE,
          paquete.policy.policyId,
          umbral,
          identidad,
          paquete.shares[i] as EncryptedShare,
        ),
      );
      anotar("guardian-added", `${nombres.length} guardianes, umbral ${umbral}`);
      return { fichero: serializar(), politica: vistaPolitica(guardada), sobres };
    } finally {
      maestra.destroy();
      for (const identidad of identidades) {
        identidad.kemSecretKey.destroy();
        identidad.signingSecretKey.destroy();
      }
    }
  },

  revocarGuardianes: () => {
    const v = exigirAbierta();
    if (!v.deleteExtra(ANEXO_RECUPERACION)) throw new Error("no hay ninguna política configurada");
    anotar("guardian-removed", "política revocada");
    // Los sobres ya repartidos siguen ahí fuera: borrar la política solo deja
    // de reconocerlos, no los desactiva. Cambia la contraseña maestra si eso
    // es lo que pretendías.
    return { fichero: serializar() };
  },

  recuperarConSobres: ({
    sobres,
  }: {
    sobres: readonly { nombre: string; bytes: Uint8Array }[];
  }) => {
    if (sobres.length === 0) throw new Error("no has aportado ningún sobre");
    const leidos = sobres.map((s) => leerSobre(s.nombre, s.bytes, FORMATO_SOBRE));
    const primero = leidos[0] as SobreSerializado;

    const distinta = leidos.find((sobre) => sobre.policyId !== primero.policyId);
    if (distinta) {
      throw new Error(
        `los sobres no son de la misma política: el de ${distinta.guardian.nombre} pertenece a otra`,
      );
    }
    const vistos = new Set<string>();
    for (const sobre of leidos) {
      if (vistos.has(sobre.guardian.id)) {
        throw new Error(`has aportado dos veces el sobre de ${sobre.guardian.nombre}`);
      }
      vistos.add(sobre.guardian.id);
    }
    if (leidos.length < primero.umbral) {
      throw new Error(
        `esta política exige ${primero.umbral} sobres y solo has aportado ${leidos.length}`,
      );
    }

    const fragmentos = leidos.map((sobre) =>
      guardianDecryptShare(fromBase64Url(sobre.kemSecretKey), {
        policyId: sobre.policyId,
        guardianId: sobre.guardian.id,
        shareIndex: sobre.fragmento.indice,
        payload: fromBase64Url(sobre.fragmento.payload),
      }),
    );
    // La política se reconstruye desde los sobres porque `recoverSecret` solo
    // mira el umbral, y los sobres —a propósito— no traen el censo de
    // guardianes. Recuperar no debe exigir tener ya la bóveda delante.
    const politica: RecoveryPolicy = {
      policyId: primero.policyId,
      threshold: primero.umbral,
      guardians: [],
      creadaEn: primero.creadoEn,
    };
    const secreto = recoverSecret(fragmentos, politica);
    try {
      return {
        password: utf8Decode(secreto.bytes),
        aportados: leidos.length,
        umbral: primero.umbral,
        nombres: leidos.map((sobre) => sobre.guardian.nombre),
      };
    } finally {
      secreto.destroy();
      for (const fragmento of fragmentos) fragmento.data.fill(0);
    }
  },

  estadoInterruptor: () => {
    const estado = leerInterruptor(exigirAbierta());
    return { interruptor: estado ? vistaInterruptor(estado) : null };
  },

  crearInterruptor: ({
    intervaloDias,
    graciaDias,
  }: {
    intervaloDias: number;
    graciaDias: number;
  }) => {
    const v = exigirAbierta();
    // El interruptor se firma con la identidad de la propia bóveda: así no hay
    // un segundo fichero de claves que perder, y cualquier copia de la bóveda
    // sabe emitir señales válidas para este interruptor.
    const clave = v.signingKeyPair();
    try {
      const estado = createDeadManSwitch(clave, {
        intervaloSenalMs: exigirDias(intervaloDias, "el intervalo entre señales"),
        periodoGraciaMs: exigirDias(graciaDias, "el periodo de gracia"),
      });
      v.setExtra(ANEXO_INTERRUPTOR, encodeSwitch(estado));
      anotar("policy-changed", `interruptor ${estado.id}`);
      return { fichero: serializar(), interruptor: vistaInterruptor(estado) };
    } finally {
      clave.secretKey.destroy();
    }
  },

  /**
   * Emite la señal y la aplica en el mismo paso.
   *
   * Verificar aquí una firma que acabamos de producir parece redundante, pero la
   * señal no está pensada para nosotros: viaja con el estado del interruptor
   * hacia quien lo custodie. Si no fuera verificable, quien pudiera escribir en
   * ese almacén fabricaría señales para siempre.
   */
  senalDeVida: () => {
    const v = exigirAbierta();
    const estado = leerInterruptor(v);
    if (!estado) throw new Error("no hay ningún interruptor configurado");
    const clave = v.signingKeyPair();
    try {
      const actualizado = applyHeartbeat(estado, emitHeartbeat(estado, clave.secretKey));
      v.setExtra(ANEXO_INTERRUPTOR, encodeSwitch(actualizado));
      return { fichero: serializar(), interruptor: vistaInterruptor(actualizado) };
    } finally {
      clave.secretKey.destroy();
    }
  },

  revocarInterruptor: () => {
    const v = exigirAbierta();
    const estado = leerInterruptor(v);
    if (!estado) throw new Error("no hay ningún interruptor configurado");
    const revocado = revokeSwitch(estado);
    v.setExtra(ANEXO_INTERRUPTOR, encodeSwitch(revocado));
    anotar("policy-changed", `interruptor revocado ${estado.id}`);
    return { fichero: serializar(), interruptor: vistaInterruptor(revocado) };
  },

  crearHerencia: ({
    password,
    nombres,
    umbral,
    plazoDias,
    intervaloDias,
    graciaDias,
  }: {
    password: string;
    nombres: readonly string[];
    umbral: number;
    plazoDias: number;
    intervaloDias: number;
    graciaDias: number;
  }) => {
    const v = exigirAbierta();
    if (nombres.length < 2 || nombres.length > 8) {
      throw new Error("hacen falta entre 2 y 8 beneficiarios");
    }
    const velocidad = estimateSquaringsPerSecond();
    const pedidas = squaringsForDuration(exigirDias(plazoDias, "el plazo"), velocidad);
    const elevaciones = Math.min(pedidas, TOPE_ELEVACIONES);

    const identidades = nombres.map((nombre) => generateGuardianIdentity(nombre));
    const maestra = SecretBuffer.fromText(password);
    const clave = v.signingKeyPair();
    try {
      const { paquete, trapdoor } = createInheritancePackage(maestra, {
        beneficiarios: identidades.map((identidad) => identidad.guardian),
        umbral,
        signingKey: clave,
        intervaloSenalMs: exigirDias(intervaloDias, "el intervalo entre señales"),
        periodoGraciaMs: exigirDias(graciaDias, "el periodo de gracia"),
        squarings: elevaciones,
        // AVISO: 1024 bits solo por la interfaz. La cerradura se apoya en que
        // nadie factorice N, y a este tamaño quien la abre es un factorizador,
        // no el paso del tiempo. En producción, 2048 bits o más; aquí generar
        // esos primos en JavaScript puro deja la ventana colgada demasiado rato.
        modulusBits: 1024,
      });
      // La trampilla abre la cerradura al instante. Conservarla sería dejar la
      // llave puesta al lado del candado, y el titular no la necesita: ya tiene
      // la contraseña maestra.
      trapdoor.destroy();

      const legado = {
        formato: FORMATO_LEGADO,
        version: 1,
        id: paquete.id,
        creadoEn: paquete.creadoEn,
        policyId: paquete.recovery.policy.policyId,
        umbral,
        elevaciones,
        interruptor: toBase64Url(encodeSwitch(paquete.deadManSwitch)),
        cerraduraTemporal: toBase64Url(encodeTimeLock(paquete.timeLock)),
        beneficiarios: paquete.recovery.policy.guardians.map((guardian) => ({
          id: guardian.id,
          nombre: guardian.nombre,
          huella: hybridFingerprint(guardian.publicKey),
        })),
        fragmentos: paquete.recovery.shares.map((share) => ({
          guardianId: share.guardianId,
          indice: share.shareIndex,
          payload: toBase64Url(share.payload),
        })),
      };

      const sobres = identidades.map((identidad, i) =>
        armarSobre(
          FORMATO_SOBRE_LEGADO,
          paquete.recovery.policy.policyId,
          umbral,
          identidad,
          paquete.recovery.shares[i] as EncryptedShare,
        ),
      );
      anotar("policy-changed", `legado ${paquete.id}`);

      return {
        legado: {
          fichero: `legado-${sanear(paquete.id)}.cerbero.json`,
          bytes: utf8Encode(JSON.stringify(legado, null, 2)),
        },
        sobres,
        elevaciones,
        velocidad,
        recortado: pedidas > TOPE_ELEVACIONES,
        duracionEfectivaMs: Math.round((elevaciones / velocidad) * 1000),
      };
    } finally {
      maestra.destroy();
      clave.secretKey.destroy();
      for (const identidad of identidades) {
        identidad.kemSecretKey.destroy();
        identidad.signingSecretKey.destroy();
      }
    }
  },

  cerrar: () => {
    boveda?.lock();
    boveda = null;
    registro = null;
    ficheroActual = null;
    return { cerrada: true };
  },
};

self.addEventListener("message", (evento: MessageEvent) => {
  const { id, operacion, carga } = evento.data as {
    id: number;
    operacion: string;
    carga: unknown;
  };
  try {
    const fn = operaciones[operacion];
    if (!fn) throw new Error(`operación desconocida: ${operacion}`);
    self.postMessage({ id, ok: true, resultado: fn(carga as never) });
  } catch (fallo) {
    // El mensaje viaja tal cual: los errores del núcleo ya están redactados
    // para no distinguir "contraseña incorrecta" de "ranura vacía".
    self.postMessage({
      id,
      ok: false,
      error: fallo instanceof Error ? fallo.message : String(fallo),
    });
  }
});
