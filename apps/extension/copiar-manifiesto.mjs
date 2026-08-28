import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL(".", import.meta.url));
await copyFile(`${raiz}manifest.json`, `${raiz}dist/manifest.json`);
console.log("manifiesto copiado a dist/");
