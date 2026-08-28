import { PALABRAS_DEBILES, SECUENCIAS_PREDECIBLES } from "./listas.ts";

export type Veredicto = "muy débil" | "débil" | "aceptable" | "fuerte" | "excelente";

export interface StrengthReport {
  /** Bits de entropía estimados tras descontar los patrones detectados. */
  readonly bits: number;
  readonly veredicto: Veredicto;
  /** Qué se ha encontrado que abarata el ataque. */
  readonly avisos: readonly string[];
  /** Qué hacer al respecto. */
  readonly consejos: readonly string[];
}

const PUNTUACION_ASCII = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~ ";

/**
 * Sustituciones "leet" más habituales. Cambiar `a` por `4` multiplica por dos
 * el trabajo del atacante, no por el tamaño del alfabeto: los diccionarios de
 * ataque llevan estas variantes incorporadas desde hace veinte años.
 */
const SUSTITUCIONES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
  "+": "t",
};

const LONGITUD_MIN_PALABRA = 4;
const PALABRAS = new Set(PALABRAS_DEBILES);
const LONGITUD_MAX_PALABRA = PALABRAS_DEBILES.reduce((m, p) => Math.max(m, p.length), 0);

type TipoPatron = "azar" | "repeticion" | "secuencia" | "palabra" | "anio";

interface Segmento {
  readonly inicio: number;
  readonly longitud: number;
  readonly tipo: TipoPatron;
  readonly coste: number;
  readonly texto: string;
}

/**
 * Tamaño del alfabeto que un atacante deduciría al ver la contraseña.
 *
 * Es lo que de verdad importa: quien ataca por fuerza bruta observa qué clases
 * aparecen y ajusta el espacio de búsqueda, así que la entropía real depende de
 * las clases *usadas*, no de las que el generador tenía disponibles.
 */
export function cardinalAlfabeto(password: string): number {
  let cardinal = 0;
  const caracteres = [...password];
  if (caracteres.some((c) => c >= "a" && c <= "z")) cardinal += 26;
  if (caracteres.some((c) => c >= "A" && c <= "Z")) cardinal += 26;
  if (caracteres.some((c) => c >= "0" && c <= "9")) cardinal += 10;
  if (caracteres.some((c) => PUNTUACION_ASCII.includes(c))) cardinal += PUNTUACION_ASCII.length;
  if (caracteres.some((c) => (c.codePointAt(0) ?? 0) > 126)) cardinal += 100;
  return Math.max(cardinal, 2);
}

/** Variantes normalizadas donde deshacer las sustituciones leet. */
function normalizar(password: string): readonly string[] {
  const bajo = password.toLowerCase();
  const principal = [...bajo].map((c) => SUSTITUCIONES[c] ?? c).join("");
  // "1" se usa tanto por "i" como por "l"; probar ambas evita que «he1lo` pase
  // por aleatorio solo porque elegimos la lectura equivocada.
  const alterna = [...bajo].map((c) => (c === "1" ? "l" : (SUSTITUCIONES[c] ?? c))).join("");
  return principal === alterna ? [principal] : [principal, alterna];
}

/** Longitud del recorrido predecible que empieza en `inicio`, si lo hay. */
function secuenciaEn(bajo: string, inicio: number): number {
  let mejor = 0;
  for (const secuencia of SECUENCIAS_PREDECIBLES) {
    for (const paso of [1, -1]) {
      let indice = secuencia.indexOf(bajo[inicio] as string);
      if (indice < 0) continue;
      let k = 1;
      while (inicio + k < bajo.length) {
        const siguiente = secuencia.indexOf(bajo[inicio + k] as string);
        if (siguiente < 0 || siguiente !== indice + paso) break;
        indice = siguiente;
        k += 1;
      }
      if (k >= 3 && k > mejor) mejor = k;
    }
  }
  return mejor;
}

function esAnio(trozo: string): boolean {
  if (trozo.length !== 4) return false;
  if (![...trozo].every((c) => c >= "0" && c <= "9")) return false;
  const valor = Number(trozo);
  return valor >= 1900 && valor <= 2039;
}

/** Todos los patrones que empiezan en `inicio`, con su coste en bits. */
function candidatos(password: string, inicio: number, cardinal: number): Segmento[] {
  const bits = Math.log2(cardinal);
  const bajo = password.toLowerCase();
  const variantes = normalizar(password);
  const salida: Segmento[] = [
    { inicio, longitud: 1, tipo: "azar", coste: bits, texto: password[inicio] as string },
  ];

  // Repetición del mismo carácter: solo se paga el carácter y la longitud.
  let repeticion = 1;
  while (inicio + repeticion < password.length && password[inicio + repeticion] === password[inicio]) {
    repeticion += 1;
  }
  if (repeticion >= 3) {
    salida.push({
      inicio,
      longitud: repeticion,
      tipo: "repeticion",
      coste: bits + Math.log2(repeticion),
      texto: password.slice(inicio, inicio + repeticion),
    });
  }

  const largoSecuencia = secuenciaEn(bajo, inicio);
  if (largoSecuencia >= 3) {
    // El atacante elige recorrido y sentido: eso es todo lo que le cuesta.
    salida.push({
      inicio,
      longitud: largoSecuencia,
      tipo: "secuencia",
      coste: Math.log2(SECUENCIAS_PREDECIBLES.length * 2) + Math.log2(largoSecuencia),
      texto: password.slice(inicio, inicio + largoSecuencia),
    });
  }

  if (esAnio(password.slice(inicio, inicio + 4))) {
    salida.push({
      inicio,
      longitud: 4,
      tipo: "anio",
      coste: Math.log2(140),
      texto: password.slice(inicio, inicio + 4),
    });
  }

  const maxPalabra = Math.min(LONGITUD_MAX_PALABRA, password.length - inicio);
  for (let largo = maxPalabra; largo >= LONGITUD_MIN_PALABRA; largo--) {
    const encontrada = variantes.some((v) => PALABRAS.has(v.slice(inicio, inicio + largo)));
    if (!encontrada) continue;
    const trozo = password.slice(inicio, inicio + largo);
    // Un bit por la variante de mayúsculas y otro por la variante leet: es lo
    // que cuesta probar las dos formas, no una clase de caracteres entera.
    const extraMayusculas = trozo !== trozo.toLowerCase() ? 1 : 0;
    const extraLeet = trozo.toLowerCase() !== variantes[0]?.slice(inicio, inicio + largo) ? 1 : 0;
    salida.push({
      inicio,
      longitud: largo,
      tipo: "palabra",
      coste: Math.log2(PALABRAS.size) + extraMayusculas + extraLeet,
      texto: trozo,
    });
    break;
  }

  return salida;
}

/**
 * Descompone la contraseña en el conjunto de patrones *más barato* de adivinar.
 *
 * Se hace por programación dinámica y no de izquierda a derecha con el patrón
 * más largo: el atacante siempre tomará la ruta más barata, y estimar por
 * cualquier otra ruta produce una cifra de entropía optimista, que es
 * exactamente el error que hace que una contraseña mala parezca buena.
 */
function descomponer(password: string, cardinal: number): Segmento[] {
  const n = password.length;
  const coste = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const origen = new Array<Segmento | null>(n + 1).fill(null);
  coste[0] = 0;
  for (let i = 0; i < n; i++) {
    const acumulado = coste[i] as number;
    if (!Number.isFinite(acumulado)) continue;
    for (const segmento of candidatos(password, i, cardinal)) {
      const fin = i + segmento.longitud;
      const total = acumulado + segmento.coste;
      if (total < (coste[fin] as number)) {
        coste[fin] = total;
        origen[fin] = segmento;
      }
    }
  }
  const camino: Segmento[] = [];
  let posicion = n;
  while (posicion > 0) {
    const segmento = origen[posicion];
    if (!segmento) break;
    camino.push(segmento);
    posicion -= segmento.longitud;
  }
  return camino.reverse();
}

function veredictoDe(bits: number): Veredicto {
  if (bits < 28) return "muy débil";
  if (bits < 40) return "débil";
  if (bits < 60) return "aceptable";
  if (bits < 80) return "fuerte";
  return "excelente";
}

/**
 * Estima la fortaleza real de una contraseña.
 *
 * No cuenta "reglas cumplidas" (una mayúscula, un número, un símbolo): esas
 * reglas son justamente las que producen `Password1!`, que cumple todas y cae
 * en el primer segundo de un ataque por diccionario.
 */
export function estimateStrength(password: string): StrengthReport {
  if (password.length === 0) {
    return {
      bits: 0,
      veredicto: "muy débil",
      avisos: ["la contraseña está vacía"],
      consejos: ["genera una contraseña aleatoria de al menos 16 caracteres"],
    };
  }

  const cardinal = cardinalAlfabeto(password);
  const segmentos = descomponer(password, cardinal);
  const bits = Math.round(segmentos.reduce((total, s) => total + s.coste, 0) * 10) / 10;

  const avisos: string[] = [];
  const tipos = new Set<TipoPatron>(segmentos.map((s) => s.tipo));
  for (const segmento of segmentos) {
    if (segmento.tipo === "repeticion") {
      avisos.push(`repite «${segmento.texto[0] as string}» ${segmento.longitud} veces seguidas`);
    } else if (segmento.tipo === "secuencia") {
      avisos.push(`contiene el recorrido predecible «${segmento.texto}»`);
    } else if (segmento.tipo === "palabra") {
      avisos.push(`contiene la palabra común «${segmento.texto}»`);
    } else if (segmento.tipo === "anio") {
      avisos.push(`contiene el año «${segmento.texto}»`);
    }
  }
  if (password.length < 12) {
    avisos.push(`solo tiene ${password.length} caracteres`);
  }
  const clases = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    [...password].some((c) => PUNTUACION_ASCII.includes(c)),
  ].filter(Boolean).length;
  if (clases <= 1) avisos.push("usa una sola clase de caracteres");

  const consejos: string[] = [];
  if (tipos.has("palabra")) {
    consejos.push("no partas de palabras de diccionario: cambiar «a» por «4» no engaña a un atacante");
  }
  if (tipos.has("secuencia")) {
    consejos.push("evita recorridos del teclado como «qwerty» o «12345»");
  }
  if (tipos.has("repeticion")) {
    consejos.push("repetir un carácter alarga la contraseña sin añadir entropía");
  }
  if (tipos.has("anio")) {
    consejos.push("quita el año: todos los años plausibles caben en menos de 8 bits");
  }
  if (password.length < 16) {
    consejos.push("alarga la contraseña: cada carácter aleatorio añade unos 6 bits");
  }
  if (clases <= 2) {
    consejos.push("mezcla minúsculas, mayúsculas, dígitos y símbolos");
  }
  if (bits < 60) {
    consejos.push("usa el generador: 20 caracteres aleatorios o una frase de 7 palabras");
  } else {
    consejos.push("guárdala en el gestor y no la reutilices en ningún otro servicio");
  }

  return { bits, veredicto: veredictoDe(bits), avisos, consejos };
}
