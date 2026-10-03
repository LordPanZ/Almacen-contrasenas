/**
 * Preparación de archivos antes de cifrarlos.
 *
 * Las fotos se re-codifican, no se guardan tal cual: el lienzo no arrastra los
 * metadatos, y una foto de móvil trae coordenadas GPS, modelo del aparato y hora
 * exacta. En un documento de identidad es justo lo que sobra. Los PDF y el resto
 * de archivos pasan sin tocar.
 */

/** Tope por documento. El núcleo lo vuelve a comprobar al cifrar. */
export const LIMITE_BYTES = 50 * 1024 * 1024;

/** Lado mayor al que se reduce una foto. Un DNI sigue leyéndose de sobra. */
const LADO_MAXIMO = 2400;

const MIME_POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

function mimeDe(archivo: File): string {
  if (archivo.type) return archivo.type;
  const extension = /\.([A-Za-z0-9]+)$/.exec(archivo.name)?.[1]?.toLowerCase() ?? "";
  return MIME_POR_EXTENSION[extension] ?? "application/octet-stream";
}

function cambiarExtension(nombre: string, extension: string): string {
  const base = nombre.replace(/\.[^./\\]+$/, "");
  return `${base || "documento"}.${extension}`;
}

export interface ArchivoPreparado {
  readonly datos: ArrayBuffer;
  readonly nombre: string;
  readonly mime: string;
  /** Algo que el usuario debería saber sobre lo que se va a guardar. */
  readonly aviso?: string;
}

export async function prepararArchivo(
  archivo: File,
  opciones: { quitarMetadatos: boolean },
): Promise<ArchivoPreparado> {
  const mime = mimeDe(archivo);
  const esFoto = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/gif";

  if (esFoto && opciones.quitarMetadatos) {
    try {
      const mapa = await createImageBitmap(archivo);
      try {
        const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.max(1, Math.round(mapa.width * escala));
        lienzo.height = Math.max(1, Math.round(mapa.height * escala));
        const ctx = lienzo.getContext("2d");
        if (!ctx) throw new Error("sin lienzo");
        // Un PNG conserva su formato y su transparencia; el resto pasa a JPEG, que
        // no la tiene, así que se pinta antes un fondo blanco.
        const conservaPng = mime === "image/png";
        if (!conservaPng) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        }
        ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
        const salida = conservaPng ? "image/png" : "image/jpeg";
        const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, salida, 0.9));
        if (!blob) throw new Error("sin codificación");
        return comprobar(
          await blob.arrayBuffer(),
          cambiarExtension(archivo.name, conservaPng ? "png" : "jpg"),
          salida,
        );
      } finally {
        mapa.close();
      }
    } catch (fallo) {
      if (fallo instanceof LimiteError) throw fallo;
      // Un formato que este navegador no sabe decodificar (HEIC, por ejemplo) se
      // guarda tal cual, y se dice, porque conservará sus metadatos.
      return comprobar(
        await archivo.arrayBuffer(),
        archivo.name,
        mime,
        "Este navegador no pudo quitarle los metadatos a la foto, así que se guardó tal cual: puede conservar la ubicación y la fecha.",
      );
    }
  }
  return comprobar(await archivo.arrayBuffer(), archivo.name, mime);
}

export class LimiteError extends Error {}

function comprobar(datos: ArrayBuffer, nombre: string, mime: string, aviso?: string): ArchivoPreparado {
  if (datos.byteLength === 0) throw new LimiteError("El archivo está vacío.");
  if (datos.byteLength > LIMITE_BYTES) {
    throw new LimiteError(
      `Pesa ${(datos.byteLength / 1024 / 1024).toFixed(1)} MiB y el máximo es ${LIMITE_BYTES / 1024 / 1024} MiB.`,
    );
  }
  return { datos, nombre, mime, ...(aviso ? { aviso } : {}) };
}
