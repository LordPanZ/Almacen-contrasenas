/// <reference lib="webworker" />
import { SecretBuffer, toHex } from "@cerbero/crypto";
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
