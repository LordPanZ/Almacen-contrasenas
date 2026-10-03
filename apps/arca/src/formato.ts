import type { DocumentoMeta } from "./tipos.ts";

export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatearFecha(momento: number): string {
  return new Date(momento).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export function formatearFechaHora(momento: number): string {
  return new Date(momento).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function esImagen(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

/** Etiqueta corta para el icono del documento: PDF, JPG, PNG… */
export function etiquetaTipo(doc: Pick<DocumentoMeta, "nombre" | "mime">): string {
  if (doc.mime === "application/pdf") return "PDF";
  if (doc.mime === "image/jpeg") return "JPG";
  if (doc.mime === "image/png") return "PNG";
  const extension = /\.([A-Za-z0-9]{1,4})$/.exec(doc.nombre)?.[1];
  if (extension) return extension.toUpperCase();
  return doc.mime.startsWith("image/") ? "IMG" : "ARCH";
}

export type ClaseTipo = "pdf" | "imagen" | "otro";

export function claseTipo(doc: Pick<DocumentoMeta, "mime">): ClaseTipo {
  if (doc.mime === "application/pdf") return "pdf";
  if (doc.mime.startsWith("image/")) return "imagen";
  return "otro";
}

/** Descarga unos bytes con un nombre. Los bytes siguen siendo del llamante. */
export function descargarBytes(datos: ArrayBuffer | Blob, nombre: string, mime: string): void {
  const blob = datos instanceof Blob ? datos : new Blob([datos], { type: mime });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Revocar en el mismo instante cancela la descarga en algunos móviles.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
