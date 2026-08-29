import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/**
 * Empaqueta Cerbero en un único fichero HTML autocontenido.
 *
 * La motivación es el propio modelo de amenazas del proyecto: un almacén que
 * presume de que ningún servidor puede abrir tu bóveda queda mejor demostrado
 * si además no hace falta ningún servidor para usarlo. Un solo fichero cabe en
 * una memoria USB, se abre con doble clic y se puede auditar leyéndolo entero.
 *
 * Todo va dentro: el código, los estilos, el trabajador criptográfico —como
 * blob, vía `?worker&inline`— y las tipografías en base64, para que la
 * apariencia no dependa de tener conexión.
 */

const raiz = fileURLToPath(new URL(".", import.meta.url));
const salida = `${raiz}dist-suelto`;

/** Familias y pesos que la interfaz usa de verdad. */
const FUENTES =
  "family=Archivo:wght@400;500;600;700;800" +
  "&family=Martian+Mono:wght@400;500;600" +
  "&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500";

/**
 * Descarga las tipografías y las incrusta como URI de datos.
 *
 * Se pide con un `User-Agent` de navegador moderno para que Google Fonts
 * devuelva woff2 y no formatos antiguos, que pesan varias veces más.
 */
async function incrustarFuentes() {
  const respuesta = await fetch(`https://fonts.googleapis.com/css2?${FUENTES}&display=swap`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!respuesta.ok) throw new Error(`Google Fonts respondió ${respuesta.status}`);
  let css = await respuesta.text();

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  let bytes = 0;

  for (const url of urls) {
    const fuente = await fetch(url);
    if (!fuente.ok) continue;
    const datos = Buffer.from(await fuente.arrayBuffer());
    bytes += datos.length;
    css = css.replaceAll(url, `data:font/woff2;base64,${datos.toString("base64")}`);
  }

  console.log(`  tipografías: ${urls.length} ficheros, ${(bytes / 1024).toFixed(0)} KiB`);
  return css;
}

/** Escapa lo que rompería el analizador de HTML al ir dentro de <script>. */
function paraScript(codigo) {
  return codigo.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");
}

/**
 * Sustituye una etiqueta por contenido literal.
 *
 * El reemplazo va como función y no como cadena a propósito: `String.replace`
 * interpreta `$&`, `` $` `` y `$\'` dentro del texto de reemplazo, y un bundle
 * minificado está lleno de esas secuencias. Con la forma de cadena, cada `$&`
 * reinsertaba la etiqueta original dentro del código y lo dejaba sintácticamente
 * roto, con el añadido de que el `<script src>` volvía a aparecer y el fichero
 * dejaba de ser autocontenido sin que nada lo delatara.
 */
function sustituir(html, etiqueta, contenido) {
  return html.replace(etiqueta, () => contenido);
}

console.log("Compilando…");
await rm(salida, { recursive: true, force: true });
await build({
  configFile: `${raiz}vite.config.ts`,
  // Vite tomaría `process.cwd()` como raíz, así que el guion solo funcionaba
  // si se lanzaba desde `apps/web`. Fijarla aquí lo hace invocable desde
  // cualquier sitio, que es lo que necesita el build de Netlify.
  root: raiz,
  build: {
    outDir: salida,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  logLevel: "warn",
});

console.log("Incrustando…");
let html = await readFile(`${salida}/index.html`, "utf8");

// El CSS del propio proyecto.
for (const [etiqueta, ruta] of [...html.matchAll(/<link[^>]+href="\.?\/?([^"]+\.css)"[^>]*>/g)]) {
  const css = await readFile(`${salida}/${ruta}`, "utf8");
  html = sustituir(html, etiqueta, `<style>\n${css}\n</style>`);
}

// El bundle, trabajador incluido.
for (const [etiqueta, ruta] of [...html.matchAll(/<script[^>]+src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g)]) {
  const js = await readFile(`${salida}/${ruta}`, "utf8");
  html = sustituir(html, etiqueta, `<script type="module">\n${paraScript(js)}\n</script>`);
}

// Las tipografías sustituyen al enlace externo.
const fuentes = await incrustarFuentes();
html = html
  .replace(/<link rel="preconnect"[^>]*>\s*/g, "")
  .replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, () => `<style>\n${fuentes}\n</style>`);

const pendientes = [...html.matchAll(/(?:src|href)="(?!data:)[^"]+"/g)].map((m) => m[0]);
if (pendientes.length > 0) {
  throw new Error(
    `quedan referencias externas, el fichero no sería autocontenido:\n  ${pendientes.join("\n  ")}`,
  );
}

const destino = `${raiz}cerbero.html`;
await writeFile(destino, html, "utf8");
await rm(salida, { recursive: true, force: true });

console.log(`\nListo: ${destino}`);
console.log(`  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB, sin una sola petición a la red`);
