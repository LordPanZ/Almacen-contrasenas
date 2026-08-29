import { fromBase64Url, toBase64Url } from "@cerbero/crypto";

/**
 * Llave de seguridad como segundo factor de la bóveda.
 *
 * Usa la extensión `prf` de WebAuthn: el autenticador evalúa una función
 * pseudoaleatoria con un secreto que **nunca sale de él** y devuelve 32 bytes
 * deterministas. Esos bytes se mezclan con la clave maestra, de modo que un
 * fichero robado no se abre ni conociendo la contraseña.
 *
 * En un móvil ese secreto lo custodia el Secure Enclave o el TEE/StrongBox, que
 * es lo más cerca que una página web puede estar de un entorno de ejecución
 * confiable. En un portátil puede ser una llave física USB.
 *
 * Nada de esto se guarda en el fichero de la bóveda: ni la credencial, ni un
 * indicio de que exista. La sal que se le pide evaluar al autenticador se
 * deriva de la sal pública del fichero, así que se recalcula al abrir y la
 * misma llave produce un factor distinto en cada bóveda.
 */

/** Nombre con el que la llave aparecerá en el gestor de contraseñas del sistema. */
const RP_NOMBRE = "Cerbero";

/** Etiqueta que verá el usuario al elegir la credencial. */
const USUARIO_NOMBRE = "Bóveda de Cerbero";

export class LlaveError extends Error {}

/**
 * ¿Puede este navegador hacer de llave?
 *
 * Solo comprueba que la API exista. Que además soporte `prf` no se sabe hasta
 * intentarlo, y por eso el alta verifica el resultado antes de dar nada por
 * bueno: prometer una protección que luego no está sería peor que no ofrecerla.
 */
export function soportaLlave(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    window.isSecureContext
  );
}

/** Convierte el factor a texto para que el usuario pueda apuntarlo. */
export function factorATexto(factor: Uint8Array): string {
  const base = toBase64Url(factor);
  // En grupos de seis: copiar a mano 43 caracteres seguidos es una fuente de
  // erratas, y este código es la única salida si se pierde la llave.
  return (base.match(/.{1,6}/g) ?? []).join(" ");
}

/** Inverso de `factorATexto`, tolerante con los espacios que el usuario meta. */
export function textoAFactor(texto: string): Uint8Array {
  const limpio = texto.replace(/\s+/g, "");
  const bytes = fromBase64Url(limpio);
  if (bytes.length !== 32) {
    throw new LlaveError("ese código de recuperación no tiene la longitud correcta");
  }
  return bytes;
}

function comoBuffer(bytes: Uint8Array): ArrayBuffer {
  // Copia sobre un ArrayBuffer propio: el que llega puede estar respaldado por
  // un buffer compartido, que la API de credenciales no acepta.
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  return copia.buffer;
}

function leerPrf(credencial: PublicKeyCredential): Uint8Array | null {
  const extensiones = credencial.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const primero = extensiones.prf?.results?.first;
  return primero ? new Uint8Array(primero) : null;
}

/**
 * Da de alta una credencial nueva y devuelve el factor que produce.
 *
 * Se pide una credencial *detectable* (`residentKey: "required"`) para que al
 * desbloquear no haga falta guardar ningún identificador: el propio sistema
 * ofrece la llave que corresponde a este sitio. Así el fichero de la bóveda
 * sigue sin contener una sola referencia a ella.
 */
export async function registrarLlave(salPrf: Uint8Array): Promise<Uint8Array> {
  if (!soportaLlave()) {
    throw new LlaveError("este navegador no puede usar llaves de seguridad");
  }

  const reto = crypto.getRandomValues(new Uint8Array(32));
  const idUsuario = crypto.getRandomValues(new Uint8Array(16));

  let credencial: PublicKeyCredential | null;
  try {
    credencial = (await navigator.credentials.create({
      publicKey: {
        challenge: comoBuffer(reto),
        rp: { name: RP_NOMBRE },
        user: { id: comoBuffer(idUsuario), name: USUARIO_NOMBRE, displayName: USUARIO_NOMBRE },
        // ES256 y RS256: entre las dos cubren cualquier autenticador actual.
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        extensions: { prf: { eval: { first: comoBuffer(salPrf) } } },
      },
    })) as PublicKeyCredential | null;
  } catch (fallo) {
    throw new LlaveError(descripcion(fallo));
  }
  if (!credencial) throw new LlaveError("no se creó ninguna llave");

  const extensiones = credencial.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  if (extensiones.prf?.enabled === false) {
    throw new LlaveError(
      "esta llave no admite la extensión necesaria para derivar claves; prueba con otra o usa el móvil",
    );
  }

  // Algunos autenticadores devuelven el PRF ya en el alta y otros no. Cuando no
  // lo hacen, se pide acto seguido: es lo que hará el desbloqueo cada vez, así
  // que ejecutarlo ahora también sirve para comprobar que de verdad funciona
  // antes de vincular nada.
  const enAlta = leerPrf(credencial);
  if (enAlta) return enAlta;
  return obtenerFactor(salPrf);
}

/**
 * Pide a la llave que evalúe la sal y devuelve el factor.
 *
 * `allowCredentials` va vacío a propósito: la credencial es detectable y la
 * elige el sistema. No guardamos su identificador en ningún sitio, de forma que
 * ni el fichero ni el almacenamiento del navegador delatan que exista.
 */
export async function obtenerFactor(salPrf: Uint8Array): Promise<Uint8Array> {
  if (!soportaLlave()) {
    throw new LlaveError("este navegador no puede usar llaves de seguridad");
  }

  const reto = crypto.getRandomValues(new Uint8Array(32));
  let credencial: PublicKeyCredential | null;
  try {
    credencial = (await navigator.credentials.get({
      publicKey: {
        challenge: comoBuffer(reto),
        userVerification: "required",
        extensions: { prf: { eval: { first: comoBuffer(salPrf) } } },
      },
    })) as PublicKeyCredential | null;
  } catch (fallo) {
    throw new LlaveError(descripcion(fallo));
  }
  if (!credencial) throw new LlaveError("no se obtuvo ninguna llave");

  const factor = leerPrf(credencial);
  if (!factor) {
    throw new LlaveError(
      "la llave respondió pero no entregó el material de clave: puede que no sea la de esta bóveda",
    );
  }
  return factor;
}

/** Traduce los fallos de la API a algo que se pueda leer sin ser criptógrafo. */
function descripcion(fallo: unknown): string {
  if (!(fallo instanceof Error)) return String(fallo);
  switch (fallo.name) {
    case "NotAllowedError":
      return "se canceló la operación o se agotó el tiempo de espera";
    case "InvalidStateError":
      return "esta llave ya está registrada en este dispositivo";
    case "NotSupportedError":
      return "el dispositivo no admite el tipo de llave que hace falta";
    case "SecurityError":
      return "el origen de la página no permite usar llaves de seguridad";
    default:
      return fallo.message || fallo.name;
  }
}
