import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Script de contenido: un único fichero en formato IIFE.
 *
 * Manifest V3 inyecta los scripts de contenido como scripts clásicos, sin
 * sistema de módulos, así que cualquier `import` en la salida rompería en
 * silencio: el script simplemente no se ejecutaría.
 */
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/contenido.ts", import.meta.url)),
      name: "CerberoContenido",
      formats: ["iife"],
      fileName: () => "contenido.js",
    },
  },
});
