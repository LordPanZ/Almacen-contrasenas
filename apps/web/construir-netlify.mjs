import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Prepara el directorio que publica Netlify.
 *
 * No compila nada por su cuenta: toma el fichero suelto que ya genera
 * `construir-suelto.mjs` y lo coloca como `index.html` junto a las cabeceras.
 * Así lo que se sirve por la web y lo que se descarga a mano son byte a byte
 * el mismo fichero, y no hay una segunda variante que pueda divergir.
 */

const raiz = fileURLToPath(new URL(".", import.meta.url));
const destino = `${raiz}dist-netlify`;

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });
await cp(`${raiz}cerbero.html`, `${destino}/index.html`);
await cp(`${raiz}netlify/_headers`, `${destino}/_headers`);

console.log(`Listo para publicar: ${destino}`);
