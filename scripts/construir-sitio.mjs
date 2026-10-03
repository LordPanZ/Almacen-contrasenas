import { spawnSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Prepara la carpeta que publica Netlify para UNA de las dos aplicaciones.
 *
 * Cerbero y Arca son independientes: cada una tiene su propia dirección web y,
 * por eso, su propio origen. El navegador aísla por origen el almacenamiento, de
 * modo que ninguna puede leer lo que guarda la otra. Este guion permite
 * publicarlas desde el mismo repositorio como dos sitios distintos.
 *
 * Cuál se construye se decide con la variable `APP_PUBLICAR` (`cerbero` o `arca`)
 * o con el primer argumento. Sin ninguna, `cerbero`: así un sitio que ya estaba
 * enlazado antes de existir Arca sigue publicando lo mismo sin tocar nada.
 *
 * No compila por su cuenta: invoca el empaquetador de la app y coloca el
 * resultado como `index.html` junto a sus cabeceras. Así lo que se sirve por la
 * web y lo que se descarga a mano son, byte a byte, el mismo fichero.
 */

const APPS = {
  cerbero: { carpeta: "apps/web", html: "cerbero.html" },
  arca: { carpeta: "apps/arca", html: "arca.html" },
};

const raiz = fileURLToPath(new URL("../", import.meta.url));
const nombre = process.argv[2] ?? process.env["APP_PUBLICAR"] ?? "cerbero";
const app = APPS[nombre];
if (!app) {
  console.error(`APP_PUBLICAR debe ser ${Object.keys(APPS).join(" o ")}; llegó «${nombre}».`);
  process.exit(1);
}

console.log(`Publicando: ${nombre}\n`);
const compilado = spawnSync(process.execPath, [`${raiz}${app.carpeta}/construir-suelto.mjs`], {
  stdio: "inherit",
  cwd: `${raiz}${app.carpeta}`,
});
if (compilado.status !== 0) process.exit(compilado.status ?? 1);

const destino = `${raiz}dist-sitio`;
await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });
await copyFile(`${raiz}${app.carpeta}/${app.html}`, `${destino}/index.html`);
await copyFile(`${raiz}${app.carpeta}/netlify/_headers`, `${destino}/_headers`);

console.log(`\nListo para publicar: ${destino}`);
