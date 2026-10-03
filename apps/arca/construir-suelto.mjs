import { fileURLToPath } from "node:url";
import { build } from "vite";
import { empaquetarSuelto } from "../../scripts/empaquetar-suelto.mjs";

/** Arca en un único fichero HTML: `arca.html`. La mecánica vive en el empaquetador compartido. */
await empaquetarSuelto({
  build,
  raiz: fileURLToPath(new URL(".", import.meta.url)),
  destino: "arca.html",
  fuentes: "family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600",
  // Solo el español: el cirílico y el griego de Plex no los va a ver nadie aquí.
  subconjuntos: ["latin", "latin-ext"],
});
