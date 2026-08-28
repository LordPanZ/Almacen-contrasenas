import { SecretBuffer, fromBase64Url, toBase64Url, utf8Encode } from "@cerbero/crypto";
import { AuditLedger } from "@cerbero/ledger";
import { unlockVault, type UnlockedVault, type VaultItem } from "@cerbero/vault";
import { generateCanaryKey, isCanary, raiseCanaryAlarm } from "@cerbero/sentinel";
import {
  detectarEngano,
  detectarImitacion,
  evaluarOrigen,
  hostDe,
  type Veredicto,
} from "./origen.ts";

/**
 * Trabajador de fondo: el único sitio donde vive la bóveda abierta.
 *
 * Ni el popup ni los scripts de contenido reciben nunca la bóveda. El popup
 * pide acciones y el secreto viaja directamente de aquí a la pestaña, sin pasar
 * por la interfaz. Así, una vulnerabilidad en el popup —que es una página web
 * corriente y por tanto la superficie más expuesta— no entrega el almacén.
 */

const CLAVE_FICHERO = "boveda";
const CLAVE_AJUSTES = "ajustes";
const ALARMA_BLOQUEO = "cerbero-autobloqueo";

interface Ajustes {
  /** Minutos de inactividad tras los que se bloquea sola. */
  readonly minutosBloqueo: number;
  /** Entradas para las que se aceptan subdominios, por identificador. */
  readonly subdominiosPermitidos: readonly string[];
}

const AJUSTES_POR_DEFECTO: Ajustes = { minutosBloqueo: 10, subdominiosPermitidos: [] };

interface Alarma {
  readonly momento: number;
  readonly titulo: string;
  readonly host: string;
  readonly mensaje: string;
}

let boveda: UnlockedVault | null = null;
let registro: AuditLedger | null = null;
let ultimaActividad = 0;
const alarmas: Alarma[] = [];

async function leerAjustes(): Promise<Ajustes> {
  const guardado = await chrome.storage.local.get(CLAVE_AJUSTES);
  return { ...AJUSTES_POR_DEFECTO, ...(guardado[CLAVE_AJUSTES] as Partial<Ajustes> | undefined) };
}

async function leerFichero(): Promise<Uint8Array | null> {
  const guardado = await chrome.storage.local.get(CLAVE_FICHERO);
  const texto = guardado[CLAVE_FICHERO] as string | undefined;
  return texto ? fromBase64Url(texto) : null;
}

async function escribirFichero(fichero: Uint8Array): Promise<void> {
  await chrome.storage.local.set({ [CLAVE_FICHERO]: toBase64Url(fichero) });
}

/**
 * Persiste la bóveda con su registro al día.
 *
 * El registro crece con cada lectura de credencial, así que hay que volcarlo:
 * de nada sirve un historial a prueba de manipulación si los accesos desde el
 * navegador —los más frecuentes— no llegan a anotarse.
 */
async function persistir(): Promise<void> {
  if (!boveda || boveda.locked) return;
  if (registro) boveda.auditLog = registro.serialize();
  await escribirFichero(boveda.serialize());
}

function tocar(): void {
  ultimaActividad = Date.now();
}

function bloquear(): void {
  boveda?.lock();
  boveda = null;
  registro = null;
  ultimaActividad = 0;
}

function exigirAbierta(): UnlockedVault {
  if (!boveda || boveda.locked) throw new Error("la bóveda está bloqueada");
  tocar();
  return boveda;
}

function claveCanarios(): SecretBuffer {
  return generateCanaryKey(exigirAbierta().identityKeyPair().publicKey);
}

/**
 * El autobloqueo por inactividad no es un adorno.
 *
 * Un navegador se queda abierto días. Sin plazo, la bóveda seguiría descifrada
 * en memoria mientras el equipo pasa de mano en mano, se suspende o se
 * comparte. El trabajador de fondo de Manifest V3 además se descarta solo al
 * cabo de un rato de inactividad, así que este temporizador hace explícito y
 * predecible algo que si no ocurriría de forma arbitraria.
 */
chrome.alarms.create(ALARMA_BLOQUEO, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarma) => {
  if (alarma.name !== ALARMA_BLOQUEO || !boveda) return;
  const { minutosBloqueo } = await leerAjustes();
  if (Date.now() - ultimaActividad > minutosBloqueo * 60_000) {
    await persistir();
    bloquear();
  }
});

interface Candidata {
  readonly id: string;
  readonly titulo: string;
  readonly usuario: string;
  readonly url: string;
  readonly veredicto: Veredicto;
  readonly trampa: boolean;
}

/** Entradas que mencionan este origen, cada una con su veredicto razonado. */
function candidatasPara(url: string, ajustes: Ajustes): Candidata[] {
  const v = exigirAbierta();
  const clave = claveCanarios();
  try {
    return v
      .list()
      .map((resumen) => v.get(resumen.id))
      .filter((item): item is VaultItem => item?.url !== undefined && item.url !== "")
      .map((item) => ({
        id: item.id,
        titulo: item.title,
        usuario: item.username ?? "",
        url: item.url as string,
        veredicto: evaluarOrigen(item.url as string, url, {
          permitirSubdominios: ajustes.subdominiosPermitidos.includes(item.id),
        }),
        trampa: item.secret ? isCanary(item.secret, clave) : false,
      }))
      .filter((candidata) => {
        // Se muestran las que coinciden y las que casi: enseñar por qué se
        // rechaza una es tan útil como rellenar la correcta.
        const hostGuardado = hostDe(candidata.url);
        const hostActual = hostDe(url);
        return (
          candidata.veredicto.permitido ||
          hostGuardado.endsWith(hostActual) ||
          hostActual.endsWith(hostGuardado) ||
          // El dominio trampa cuelga el tuyo como prefijo: hay que enseñar la
          // entrada precisamente para poder explicar por qué NO se ofrece.
          hostActual.includes(hostGuardado)
        );
      });
  } finally {
    clave.destroy();
  }
}

/** Todos los hosts guardados, para detectar páginas que los imitan. */
function hostsGuardados(): string[] {
  const v = exigirAbierta();
  return v
    .list()
    .map((resumen) => v.get(resumen.id))
    .map((item) => (item?.url ? hostDe(item.url) : ""))
    .filter((host) => host.length > 0);
}

const operaciones: Record<string, (carga: never) => Promise<unknown> | unknown> = {
  estado: async () => ({
    tieneBoveda: (await leerFichero()) !== null,
    desbloqueada: boveda !== null && !boveda.locked,
    entradas: boveda && !boveda.locked ? boveda.size : 0,
    alarmas: alarmas.length,
    ajustes: await leerAjustes(),
  }),

  importar: async ({ base64 }: { base64: string }) => {
    await escribirFichero(fromBase64Url(base64));
    bloquear();
    return { importada: true };
  },

  olvidar: async () => {
    bloquear();
    await chrome.storage.local.remove(CLAVE_FICHERO);
    return { olvidada: true };
  },

  desbloquear: async ({ password }: { password: string }) => {
    const fichero = await leerFichero();
    if (!fichero) throw new Error("no hay ninguna bóveda importada en esta extensión");
    const clave = SecretBuffer.fromText(password);
    try {
      boveda = unlockVault(fichero, clave);
    } finally {
      clave.destroy();
    }
    const firma = boveda.signingKeyPair();
    const guardado = boveda.auditLog;
    registro =
      guardado.length > 0 ? AuditLedger.deserialize(guardado, firma) : AuditLedger.create(firma);
    registro.append({ type: "vault-unlocked", device: "extensión" });
    tocar();
    await persistir();
    return { desbloqueada: true, entradas: boveda.size };
  },

  bloquear: async () => {
    await persistir();
    bloquear();
    return { bloqueada: true };
  },

  /** Qué puede ofrecerse en esta página, y por qué se rechaza lo demás. */
  paraOrigen: async ({ url }: { url: string }) => {
    const ajustes = await leerAjustes();
    const host = hostDe(url);
    const hosts = hostsGuardados();
    return {
      candidatas: candidatasPara(url, ajustes),
      // Dos formas distintas de parecerse a un sitio tuyo: escribirlo con
      // caracteres de otro alfabeto, o colgarlo como prefijo del dominio propio.
      imitacion: detectarImitacion(host, hosts),
      engano: detectarEngano(host, hosts),
      host,
    };
  },

  /**
   * Rellena la pestaña con una credencial.
   *
   * El secreto va de aquí directamente a la pestaña: no pasa por el popup. Y
   * antes se vuelve a comprobar el origen contra la URL **que reporta la
   * pestaña**, no contra la que dijera quien pide la operación: si la
   * comprobación se hiciera solo al listar, bastaría una redirección entre el
   * listado y el clic para escribir la contraseña en otro sitio.
   */
  rellenar: async ({ id, tabId }: { id: string; tabId: number }) => {
    const v = exigirAbierta();
    const item = v.get(id);
    if (!item?.secret) throw new Error("esa entrada no tiene ninguna credencial");

    const pestana = await chrome.tabs.get(tabId);
    const urlActual = pestana.url ?? "";
    const ajustes = await leerAjustes();
    const veredicto = evaluarOrigen(item.url ?? "", urlActual, {
      permitirSubdominios: ajustes.subdominiosPermitidos.includes(id),
    });
    if (!veredicto.permitido) {
      registro?.append({ type: "unlock-failed", detail: utf8Encode(`relleno-negado:${id}`) });
      await persistir();
      throw new Error(veredicto.explicacion);
    }

    const clave = claveCanarios();
    const esTrampa = isCanary(item.secret, clave);
    clave.destroy();

    if (esTrampa) {
      // Una credencial trampa no la usa nunca su dueño. Que se rellene una
      // significa que alguien con acceso a la bóveda la está empleando.
      const aviso = raiseCanaryAlarm(
        {
          id: item.id,
          servicio: item.title,
          usuario: item.username ?? "",
          secret: item.secret,
          creadoEn: item.createdAt,
          marca: "",
        },
        { origen: "uso", detalle: `relleno en ${hostDe(urlActual)}` },
      );
      alarmas.unshift({
        momento: Date.now(),
        titulo: item.title,
        host: hostDe(urlActual),
        mensaje: aviso.mensaje,
      });
      registro?.append({ type: "canary-triggered", detail: utf8Encode(item.id) });
    }

    const respuesta = await chrome.tabs.sendMessage(tabId, {
      accion: "rellenar",
      usuario: item.username ?? "",
      secreto: item.secret,
    });

    registro?.append({ type: "item-read", detail: utf8Encode(id), device: "extensión" });
    await persistir();
    return { relleno: respuesta?.relleno ?? false, trampa: esTrampa, veredicto };
  },

  /** Copia al portapapeles pasa por aquí para que quede anotada igual. */
  copiar: async ({ id }: { id: string }) => {
    const v = exigirAbierta();
    const item = v.get(id);
    if (!item?.secret) throw new Error("esa entrada no tiene ninguna credencial");
    registro?.append({ type: "item-read", detail: utf8Encode(id), device: "extensión" });
    await persistir();
    return { secreto: item.secret };
  },

  alarmas: () => ({ alarmas }),

  descartarAlarmas: () => {
    alarmas.length = 0;
    return { descartadas: true };
  },

  ajustar: async ({ cambios }: { cambios: Partial<Ajustes> }) => {
    const ajustes = { ...(await leerAjustes()), ...cambios };
    await chrome.storage.local.set({ [CLAVE_AJUSTES]: ajustes });
    return { ajustes };
  },

  permitirSubdominios: async ({ id, permitir }: { id: string; permitir: boolean }) => {
    const ajustes = await leerAjustes();
    const conjunto = new Set(ajustes.subdominiosPermitidos);
    if (permitir) conjunto.add(id);
    else conjunto.delete(id);
    const nuevos = { ...ajustes, subdominiosPermitidos: [...conjunto] };
    await chrome.storage.local.set({ [CLAVE_AJUSTES]: nuevos });
    return { ajustes: nuevos };
  },
};

chrome.runtime.onMessage.addListener((mensaje, _emisor, responder) => {
  const { operacion, carga } = mensaje as { operacion: string; carga: unknown };
  const fn = operaciones[operacion];
  if (!fn) {
    responder({ ok: false, error: `operación desconocida: ${operacion}` });
    return false;
  }
  Promise.resolve(fn(carga as never))
    .then((resultado) => responder({ ok: true, resultado }))
    .catch((fallo: unknown) =>
      responder({ ok: false, error: fallo instanceof Error ? fallo.message : String(fallo) }),
    );
  // `true` mantiene abierto el canal hasta que la promesa termine.
  return true;
});
