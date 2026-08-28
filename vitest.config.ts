import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Los tests corren contra el código fuente: no hace falta compilar antes.
    alias: {
      "@cerbero/crypto": pkg("crypto"),
      "@cerbero/vault": pkg("vault"),
      "@cerbero/ledger": pkg("ledger"),
      "@cerbero/guardians": pkg("guardians"),
      "@cerbero/sentinel": pkg("sentinel"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
