import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const paquete = (nombre: string) =>
  fileURLToPath(new URL(`../../packages/${nombre}/src/index.ts`, import.meta.url));

/**
 * Compilación del popup y del trabajador de fondo, ambos como módulos ES.
 *
 * La raíz es `src/` para que el HTML del popup salga en la raíz de `dist/` con
 * rutas relativas correctas: el manifiesto lo referencia como `popup.html`, y
 * un HTML colocado dentro de un subdirectorio apuntaría fuera de la extensión.
 *
 * El script de contenido va aparte (`vite.contenido.config.ts`) porque los
 * scripts de contenido de Manifest V3 no admiten módulos: tienen que ser un
 * único fichero autocontenido.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@cerbero/crypto": paquete("crypto"),
      "@cerbero/vault": paquete("vault"),
      "@cerbero/ledger": paquete("ledger"),
      "@cerbero/sentinel": paquete("sentinel"),
    },
  },
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./src/popup.html", import.meta.url)),
        fondo: fileURLToPath(new URL("./src/fondo.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
