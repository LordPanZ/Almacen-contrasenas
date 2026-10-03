import { fileURLToPath } from "node:url";
import { build } from "vite";
import { empaquetarSuelto } from "../../scripts/empaquetar-suelto.mjs";

/** Cerbero en un único fichero HTML: `cerbero.html`. La mecánica vive en el empaquetador compartido. */
await empaquetarSuelto({
  build,
  raiz: fileURLToPath(new URL(".", import.meta.url)),
  destino: "cerbero.html",
  // Familias y pesos que la interfaz usa de verdad.
  fuentes:
    "family=Archivo:wght@400;500;600;700;800" +
    "&family=Martian+Mono:wght@400;500;600" +
    "&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500",
});
