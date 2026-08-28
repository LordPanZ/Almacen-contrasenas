import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AuditLedger } from "@cerbero/ledger";
import type { SecretBuffer } from "@cerbero/crypto";
import { unlockVault, type UnlockedVault } from "@cerbero/vault";

/** Ruta por defecto de la bóveda, sobreescribible con CERBERO_VAULT. */
export function rutaPorDefecto(): string {
  const desdeEntorno = process.env["CERBERO_VAULT"];
  if (desdeEntorno) return resolve(desdeEntorno);
  return join(homedir(), ".cerbero", "boveda.cerbero");
}

export async function existe(ruta: string): Promise<boolean> {
  try {
    await readFile(ruta);
    return true;
  } catch {
    return false;
  }
}

export async function leerFichero(ruta: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(ruta));
}

/**
 * Escribe de forma atómica: primero a un temporal, luego `rename`.
 *
 * `rename` dentro del mismo sistema de ficheros es atómico, así que un corte de
 * luz a mitad de guardado deja la bóveda anterior intacta en vez de un fichero
 * a medio escribir. Para un almacén de contraseñas, un guardado truncado y una
 * pérdida total son lo mismo.
 */
export async function escribirAtomico(ruta: string, datos: Uint8Array): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, datos, { mode: 0o600 });
  await rename(temporal, ruta);
  // Solo el propietario: el fichero está cifrado, pero no hay razón para
  // dejarlo legible por otras cuentas de la máquina.
  await chmod(ruta, 0o600);
}

export interface SesionAbierta {
  readonly vault: UnlockedVault;
  readonly ruta: string;
  readonly registro: AuditLedger;
}

/**
 * Abre la bóveda y carga (o crea) su registro de auditoría.
 *
 * El registro viaja dentro de la ranura, no en un fichero aparte: un fichero
 * por bóveda revelaría cuántas hay con solo contarlos, y eso echaría abajo la
 * negación plausible que sostiene todo el diseño. Cada bóveda —incluida la de
 * coacción— tiene así su propio historial, y ninguna sabe de las demás.
 */
export async function abrirSesion(ruta: string, password: SecretBuffer): Promise<SesionAbierta> {
  const vault = unlockVault(await leerFichero(ruta), password);
  // La clave de firma se deriva de la propia bóveda, así que reanudar el
  // registro no exige guardar ningún fichero de claves aparte.
  const clave = vault.signingKeyPair();
  const guardado = vault.auditLog;
  const registro =
    guardado.length > 0 ? AuditLedger.deserialize(guardado, clave) : AuditLedger.create(clave);
  return { vault, ruta, registro };
}

/** Vuelca el registro dentro de la bóveda y escribe el fichero. */
export async function guardarSesion(sesion: SesionAbierta): Promise<void> {
  sesion.vault.auditLog = sesion.registro.serialize();
  await escribirAtomico(sesion.ruta, sesion.vault.serialize());
}
