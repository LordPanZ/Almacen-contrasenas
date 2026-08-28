import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const paquete = (nombre: string) =>
  fileURLToPath(new URL(`../../packages/${nombre}/src/index.ts`, import.meta.url));

export default defineConfig({
  // La app se sirve como ficheros estáticos: no hay servidor que pueda ver
  // nada, porque no hay servidor. Todo el cifrado ocurre en el navegador.
  base: "./",
  resolve: {
    alias: {
      "@cerbero/crypto": paquete("crypto"),
      "@cerbero/vault": paquete("vault"),
      "@cerbero/ledger": paquete("ledger"),
      "@cerbero/guardians": paquete("guardians"),
      "@cerbero/sentinel": paquete("sentinel"),
    },
  },
  build: { target: "es2022", outDir: "dist" },
});
