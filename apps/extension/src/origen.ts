/**
 * Vinculación al origen: la única razón de peso para instalar una extensión.
 *
 * Un gestor de contraseñas en el navegador no vale por ahorrarte teclear, sino
 * por **negarse a escribir** donde no debe. Tú puedes caer en una página que
 * parece tu banco; el que compara cadenas, no. Por eso aquí la coincidencia es
 * estricta por defecto y cada negativa se explica: el usuario tiene que
 * entender que se le acaba de evitar una entrega de credenciales, no pensar que
 * la extensión está rota.
 */

export type MotivoPermitido = "exacto" | "subdominio";

export type MotivoNegado =
  | "url-invalida"
  | "sin-cifrado"
  | "host-distinto"
  | "subdominio-no-autorizado"
  | "marco-ajeno";

export type Veredicto =
  | { readonly permitido: true; readonly motivo: MotivoPermitido; readonly explicacion: string }
  | { readonly permitido: false; readonly motivo: MotivoNegado; readonly explicacion: string };

export interface OpcionesOrigen {
  /** Permite que `cuentas.banco.es` abra una entrada guardada para `banco.es`. */
  readonly permitirSubdominios?: boolean;
  /** El documento a rellenar es un marco de origen distinto al de la pestaña. */
  readonly marcoAjeno?: boolean;
}

function normalizarHost(host: string): string {
  // Los puntos finales son válidos en DNS ("banco.es.") y designan el mismo
  // nombre. Sin normalizarlos, "banco.es." burlaría una comparación exacta.
  return host.toLowerCase().replace(/\.+$/, "");
}

function analizar(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** `true` si el esquema protege lo que se escriba en la página. */
function esquemaSeguro(url: URL): boolean {
  if (url.protocol === "https:") return true;
  // Desarrollo local: sin red que espiar, y sin ella no habría forma de probar.
  const host = normalizarHost(url.hostname);
  return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

/** `true` si `candidato` es subdominio de `base` en un límite de etiqueta. */
export function esSubdominioDe(candidato: string, base: string): boolean {
  const a = normalizarHost(candidato);
  const b = normalizarHost(base);
  if (a === b) return false;
  if (!a.endsWith(`.${b}`)) return false;
  // Un sufijo público como "co.uk" no es un dominio de nadie: aceptarlo
  // convertiría a cualquier sitio británico en subdominio de todos los demás.
  return !esSufijoPublico(b);
}

/**
 * Sufijos bajo los que cualquiera puede registrar un dominio.
 *
 * Lista corta a propósito: la completa son miles de entradas y cientos de KiB,
 * y aquí solo se usa para decidir si una regla de subdominio —que ya es
 * opcional y hay que activar entrada por entrada— sería absurda. Fallar por
 * exceso de celo aquí solo obliga a guardar el host completo, que es lo
 * recomendable de todas formas.
 */
const SUFIJOS_PUBLICOS = new Set([
  "com", "org", "net", "edu", "gov", "mil", "int", "io", "co", "es", "eu", "dev", "app",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "or.jp", "ne.jp", "com.au", "net.au",
  "org.au", "com.br", "com.mx", "com.ar", "com.tr", "co.nz", "co.za", "com.cn",
  "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev",
  "herokuapp.com", "azurewebsites.net", "web.app", "firebaseapp.com",
]);

export function esSufijoPublico(host: string): boolean {
  const limpio = normalizarHost(host);
  if (SUFIJOS_PUBLICOS.has(limpio)) return true;
  // Un host de una sola etiqueta ("com", "localhost") tampoco es de nadie.
  return !limpio.includes(".");
}

/**
 * Decide si una credencial guardada puede usarse en la página actual.
 *
 * Reglas, en orden:
 * 1. Ambas direcciones deben ser analizables.
 * 2. La página debe ir cifrada (o ser local).
 * 3. Los nombres de host deben coincidir **exactamente**.
 * 4. Un subdominio solo vale si la entrada lo autoriza expresamente.
 * 5. Nunca dentro de un marco de origen distinto al de la pestaña.
 *
 * La regla 5 cierra un agujero que la mayoría de gestores deja abierto: una
 * página cualquiera puede incrustar un `iframe` con aspecto de formulario de
 * acceso, y si la extensión rellena mirando solo el origen del marco, entrega
 * la contraseña a quien incrustó el marco.
 */
export function evaluarOrigen(
  urlGuardada: string,
  urlActual: string,
  opciones: OpcionesOrigen = {},
): Veredicto {
  const guardada = analizar(urlGuardada);
  const actual = analizar(urlActual);

  if (!guardada || !actual) {
    return {
      permitido: false,
      motivo: "url-invalida",
      explicacion: "No se puede interpretar una de las dos direcciones.",
    };
  }

  if (!esquemaSeguro(actual)) {
    return {
      permitido: false,
      motivo: "sin-cifrado",
      explicacion:
        "Esta página no va cifrada. Escribir aquí una contraseña la expone a cualquiera que observe la red.",
    };
  }

  if (opciones.marcoAjeno) {
    return {
      permitido: false,
      motivo: "marco-ajeno",
      explicacion:
        "El formulario está dentro de un marco de otro sitio. Quien incrustó el marco recibiría la contraseña.",
    };
  }

  const hostGuardado = normalizarHost(guardada.hostname);
  const hostActual = normalizarHost(actual.hostname);

  if (hostGuardado === hostActual) {
    return {
      permitido: true,
      motivo: "exacto",
      explicacion: `El dominio coincide exactamente con ${hostGuardado}.`,
    };
  }

  if (esSubdominioDe(hostActual, hostGuardado)) {
    if (opciones.permitirSubdominios) {
      return {
        permitido: true,
        motivo: "subdominio",
        explicacion: `${hostActual} es subdominio de ${hostGuardado}, y la entrada lo autoriza.`,
      };
    }
    return {
      permitido: false,
      motivo: "subdominio-no-autorizado",
      explicacion: `${hostActual} es subdominio de ${hostGuardado}, pero esta entrada no autoriza subdominios.`,
    };
  }

  return {
    permitido: false,
    motivo: "host-distinto",
    explicacion: `Guardaste esta credencial para ${hostGuardado} y estás en ${hostActual}.`,
  };
}

/* ─── Detección de dominios que imitan a otros ─────────────────────────── */

/**
 * Decodifica una etiqueta punycode (RFC 3492).
 *
 * Hace falta porque el navegador entrega los dominios internacionalizados en su
 * forma `xn--…`, y para saber si un dominio *se parece* a otro hay que ver los
 * caracteres reales. Con la forma codificada, `xn--pple-43d.com` y `apple.com`
 * no se parecen en nada; descodificada, son «аpple.com» y «apple.com».
 */
function decodificarPunycode(etiqueta: string): string {
  if (!etiqueta.startsWith("xn--")) return etiqueta;
  const codificada = etiqueta.slice(4);
  const BASE = 36;
  const TMIN = 1;
  const TMAX = 26;
  const SESGO_INICIAL = 72;
  const N_INICIAL = 128;
  const DAMP = 700;
  const SKEW = 38;

  const adaptar = (delta: number, puntos: number, primera: boolean): number => {
    let d = primera ? Math.floor(delta / DAMP) : delta >> 1;
    d += Math.floor(d / puntos);
    let k = 0;
    while (d > ((BASE - TMIN) * TMAX) >> 1) {
      d = Math.floor(d / (BASE - TMIN));
      k += BASE;
    }
    return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
  };

  const ultimoGuion = codificada.lastIndexOf("-");
  const salida: number[] = [];
  let inicio = 0;
  if (ultimoGuion > 0) {
    for (let i = 0; i < ultimoGuion; i++) salida.push(codificada.charCodeAt(i));
    inicio = ultimoGuion + 1;
  }

  let n = N_INICIAL;
  let i = 0;
  let sesgo = SESGO_INICIAL;

  for (let pos = inicio; pos < codificada.length; ) {
    const anterior = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (pos >= codificada.length) return etiqueta;
      const codigo = codificada.charCodeAt(pos++);
      let digito: number;
      if (codigo >= 0x30 && codigo <= 0x39) digito = codigo - 0x30 + 26;
      else if (codigo >= 0x61 && codigo <= 0x7a) digito = codigo - 0x61;
      else if (codigo >= 0x41 && codigo <= 0x5a) digito = codigo - 0x41;
      else return etiqueta;

      i += digito * w;
      const t = k <= sesgo ? TMIN : k >= sesgo + TMAX ? TMAX : k - sesgo;
      if (digito < t) break;
      w *= BASE - t;
    }
    const longitud = salida.length + 1;
    sesgo = adaptar(i - anterior, longitud, anterior === 0);
    n += Math.floor(i / longitud);
    i %= longitud;
    salida.splice(i++, 0, n);
  }

  try {
    return String.fromCodePoint(...salida);
  } catch {
    return etiqueta;
  }
}

export function decodificarHost(host: string): string {
  return normalizarHost(host).split(".").map(decodificarPunycode).join(".");
}

/**
 * Caracteres de otros alfabetos que se dibujan igual que una letra latina.
 *
 * Es el material con el que se construyen los dominios trampa: «раypal.com» con
 * la «р» cirílica es, para el ojo, idéntico al auténtico, y para el navegador
 * un dominio completamente distinto.
 */
const CONFUNDIBLES: Readonly<Record<string, string>> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", ѕ: "s", і: "i", ј: "j",
  һ: "h", ԁ: "d", ɡ: "g", ᴏ: "o", ο: "o", ρ: "p", ν: "v", τ: "t", α: "a", ε: "e",
  ı: "i", ł: "l", ø: "o", ǀ: "l", "０": "0", "１": "1", rn: "m", vv: "w",
};

/** Reduce un nombre a su "esqueleto" latino, para comparar por parecido. */
export function esqueleto(host: string): string {
  let texto = decodificarHost(host).normalize("NFKD").replace(/[̀-ͯ]/g, "");
  for (const [confundible, latino] of Object.entries(CONFUNDIBLES)) {
    texto = texto.split(confundible).join(latino);
  }
  return texto;
}

export interface AvisoImitacion {
  readonly hostActual: string;
  readonly hostImitado: string;
  readonly descodificado: string;
}

/**
 * Detecta que la página imita visualmente a un sitio que sí tienes guardado.
 *
 * La coincidencia exacta ya impide rellenar en el dominio trampa, así que la
 * contraseña no se escapa sola. Lo que esto añade es **decirle al usuario por
 * qué** no aparece su credencial: sin el aviso, la conclusión natural es «vaya,
 * la extensión falla» y se teclea la contraseña a mano, que es exactamente lo
 * que el atacante espera.
 */
export function detectarImitacion(
  hostActual: string,
  hostsGuardados: readonly string[],
): AvisoImitacion | null {
  const actual = normalizarHost(hostActual);
  const esqueletoActual = esqueleto(actual);

  for (const guardado of hostsGuardados) {
    const limpio = normalizarHost(guardado);
    if (limpio === actual) return null;
    if (esqueleto(limpio) === esqueletoActual) {
      return { hostActual: actual, hostImitado: limpio, descodificado: decodificarHost(actual) };
    }
  }
  return null;
}

export interface AvisoEngano {
  readonly hostActual: string;
  readonly hostSuplantado: string;
}

/**
 * Detecta el engaño más común y más barato de montar: colgar el dominio de la
 * víctima como prefijo del propio, `banco.es.atacante.com`.
 *
 * Quien mira la barra de direcciones con prisa lee «banco.es» al principio y da
 * por bueno el resto. Para el navegador, en cambio, el dueño del sitio es
 * `atacante.com`, así que la comparación exacta ya impide que se rellene nada.
 * Lo que falta es **decirlo**: sin aviso, el usuario ve que su gestor no le
 * ofrece la contraseña, concluye que falla y la teclea a mano.
 */
export function detectarEngano(
  hostActual: string,
  hostsGuardados: readonly string[],
): AvisoEngano | null {
  const actual = normalizarHost(hostActual);
  for (const guardado of hostsGuardados) {
    const limpio = normalizarHost(guardado);
    if (limpio.length === 0 || actual === limpio) continue;
    // Aparece como secuencia de etiquetas dentro del host, pero el sitio no
    // pertenece a ese dominio: es decoración, no propiedad.
    const incrustado = actual.startsWith(`${limpio}.`) || actual.includes(`.${limpio}.`);
    if (incrustado && !esSubdominioDe(actual, limpio)) {
      return { hostActual: actual, hostSuplantado: limpio };
    }
  }
  return null;
}

/** Host de una dirección, o cadena vacía si no se puede interpretar. */
export function hostDe(url: string): string {
  const analizada = analizar(url);
  return analizada ? normalizarHost(analizada.hostname) : "";
}
