/**
 * Referencias a documentos y preparación de archivos.
 *
 * Una entrada no contiene el documento, solo su referencia: identificador,
 * nombre, tipo y tamaño. Va en `custom.adjuntos` como JSON, que viaja cifrado
 * dentro de la ranura como el resto de la entrada. El contenido cifrado vive
 * aparte, en el almacén del navegador, indexado por ese identificador.
 */

export interface Adjunto {
  readonly id: string;
  readonly nombre: string;
  readonly mime: string;
  readonly tam: number;
  readonly creado: number;
}

/** Tope por documento; el mismo que aplica el núcleo al cifrar. */
export const MAX_ADJUNTO = 20 * 1024 * 1024;

/** Lado mayor al que se reduce una foto. Un DNI sigue leyéndose de sobra. */
const LADO_MAXIMO = 2400;

export function leerAdjuntos(custom: Readonly<Record<string, string>> | undefined): Adjunto[] {
  const texto = custom?.["adjuntos"];
  if (!texto) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  const salida: Adjunto[] = [];
  for (const candidato of bruto) {
    const a = candidato as Partial<Record<keyof Adjunto, unknown>> | null;
    if (
      a &&
      typeof a.id === "string" &&
      /^[0-9a-f]{32}$/.test(a.id) &&
      typeof a.nombre === "string" &&
      typeof a.mime === "string" &&
      typeof a.tam === "number" &&
      typeof a.creado === "number"
    ) {
      salida.push({ id: a.id, nombre: a.nombre, mime: a.mime, tam: a.tam, creado: a.creado });
    }
  }
  return salida;
}

export function escribirAdjuntos(adjuntos: readonly Adjunto[]): string {
  return JSON.stringify(adjuntos);
}

export function esImagen(mime: string): boolean {
  return mime.startsWith("image/");
}

export interface ArchivoPreparado {
  readonly bytes: Uint8Array;
  readonly nombre: string;
  readonly mime: string;
  /** Algo que el usuario debería saber sobre lo que se va a guardar. */
  readonly aviso?: string;
}

function cambiarExtension(nombre: string, extension: string): string {
  const base = nombre.replace(/\.[^./\\]+$/, "");
  return `${base || "documento"}.${extension}`;
}

/**
 * Deja un archivo listo para cifrar.
 *
 * Los PDF pasan tal cual. Las fotos se re-codifican como JPEG: el lienzo no
 * arrastra los metadatos, y una foto de móvil trae coordenadas GPS, modelo del
 * aparato y hora exacta. En un documento de identidad es justo lo que sobra.
 */
export async function prepararArchivo(archivo: File): Promise<ArchivoPreparado> {
  const esPdf = archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
  if (esPdf) {
    return finalizar(new Uint8Array(await archivo.arrayBuffer()), archivo.name, "application/pdf");
  }
  if (!esImagen(archivo.type) || archivo.type === "image/svg+xml") {
    throw new Error("Solo se pueden guardar PDF y fotos.");
  }

  try {
    const mapa = await createImageBitmap(archivo);
    try {
      const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.max(1, Math.round(mapa.width * escala));
      lienzo.height = Math.max(1, Math.round(mapa.height * escala));
      const ctx = lienzo.getContext("2d");
      if (!ctx) throw new Error("sin lienzo");
      // JPEG no tiene transparencia: sin fondo, un PNG con alfa saldría negro.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", 0.9));
      if (!blob) throw new Error("sin codificación");
      return finalizar(
        new Uint8Array(await blob.arrayBuffer()),
        cambiarExtension(archivo.name, "jpg"),
        "image/jpeg",
      );
    } finally {
      mapa.close();
    }
  } catch (fallo) {
    if (fallo instanceof Error && fallo.message.startsWith("El archivo")) throw fallo;
    // Formato que este navegador no sabe decodificar (HEIC, por ejemplo): se
    // guarda tal cual y se dice, porque conservará sus metadatos.
    return finalizar(
      new Uint8Array(await archivo.arrayBuffer()),
      archivo.name,
      archivo.type || "application/octet-stream",
      "Este navegador no pudo re-codificar la foto, así que se guardó tal cual: conserva sus metadatos (ubicación, fecha).",
    );
  }
}

function finalizar(
  bytes: Uint8Array,
  nombre: string,
  mime: string,
  aviso?: string,
): ArchivoPreparado {
  if (bytes.length === 0) throw new Error("El archivo está vacío.");
  if (bytes.length > MAX_ADJUNTO) {
    throw new Error(
      `El archivo pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MiB y el máximo es ${MAX_ADJUNTO / 1024 / 1024} MiB.`,
    );
  }
  return { bytes, nombre, mime, ...(aviso ? { aviso } : {}) };
}
