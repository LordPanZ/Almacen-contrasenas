import { SecretBuffer } from "@cerbero/crypto";

// Secuencia de escape ANSI, escrita explicitamente: un caracter de control
// literal en el fuente sobrevive mal a editores, parches y copiar y pegar.
const CSI = "\u001b[";
const soportaColor =
  process.stdout.isTTY === true &&
  process.env["NO_COLOR"] === undefined &&
  process.env["TERM"] !== "dumb";

function pintar(codigo: string, texto: string): string {
  return soportaColor ? `${CSI}${codigo}m${texto}${CSI}0m` : texto;
}

export const color = {
  negrita: (t: string) => pintar("1", t),
  tenue: (t: string) => pintar("2", t),
  rojo: (t: string) => pintar("31", t),
  verde: (t: string) => pintar("32", t),
  amarillo: (t: string) => pintar("33", t),
  azul: (t: string) => pintar("34", t),
  cian: (t: string) => pintar("36", t),
};

export function escribir(linea = ""): void {
  process.stdout.write(`${linea}\n`);
}

export function error(mensaje: string): void {
  process.stderr.write(`${color.rojo("✗")} ${mensaje}\n`);
}

export function aviso(mensaje: string): void {
  process.stderr.write(`${color.amarillo("!")} ${mensaje}\n`);
}

export function exito(mensaje: string): void {
  escribir(`${color.verde("✓")} ${mensaje}`);
}

export function titulo(texto: string): void {
  escribir();
  escribir(color.negrita(texto));
  escribir(color.tenue("─".repeat(Math.min(texto.length, 60))));
}

/** Tabla alineada; trunca las celdas largas para no romper el ancho del terminal. */
export function tabla(cabeceras: readonly string[], filas: readonly (readonly string[])[]): void {
  if (filas.length === 0) {
    escribir(color.tenue("  (sin resultados)"));
    return;
  }
  const anchos = cabeceras.map((cabecera, columna) =>
    Math.min(40, Math.max(cabecera.length, ...filas.map((fila) => (fila[columna] ?? "").length))),
  );
  const recortar = (texto: string, ancho: number) =>
    texto.length > ancho ? `${texto.slice(0, ancho - 1)}…` : texto.padEnd(ancho);

  escribir(
    `  ${cabeceras.map((c, i) => color.negrita(recortar(c, anchos[i] as number))).join("  ")}`,
  );
  escribir(`  ${anchos.map((ancho) => color.tenue("─".repeat(ancho))).join("  ")}`);
  for (const fila of filas) {
    escribir(`  ${anchos.map((ancho, i) => recortar(fila[i] ?? "", ancho)).join("  ")}`);
  }
}

async function leerLinea(mensaje: string): Promise<string> {
  process.stdout.write(mensaje);
  return await new Promise((resolve) => {
    const alRecibir = (datos: Buffer) => {
      process.stdin.pause();
      process.stdin.off("data", alRecibir);
      resolve(datos.toString("utf8").replace(/\r?\n$/, ""));
    };
    process.stdin.resume();
    process.stdin.on("data", alRecibir);
  });
}

export async function preguntar(mensaje: string, porDefecto?: string): Promise<string> {
  const sufijo = porDefecto === undefined ? "" : color.tenue(` [${porDefecto}]`);
  const respuesta = (await leerLinea(`${mensaje}${sufijo}: `)).trim();
  return respuesta.length > 0 ? respuesta : (porDefecto ?? "");
}

export async function confirmar(mensaje: string, porDefecto = false): Promise<boolean> {
  const opciones = porDefecto ? "S/n" : "s/N";
  const respuesta = (await leerLinea(`${mensaje} ${color.tenue(`(${opciones})`)}: `))
    .trim()
    .toLowerCase();
  if (respuesta === "") return porDefecto;
  return respuesta === "s" || respuesta === "si" || respuesta === "sí" || respuesta === "y";
}

/**
 * Lee una contraseña sin eco y **sin construir nunca un `string`**.
 *
 * Las cadenas de JavaScript son inmutables: una contraseña que pase por un
 * `string` no se puede sobrescribir y puede quedarse en memoria hasta que el
 * recolector decida otra cosa. Aquí acumulamos los bytes que llegan del
 * terminal directamente en un buffer mutable que sí podemos borrar, de modo que
 * la contraseña maestra nunca llega a existir como cadena en su recorrido.
 */
export async function pedirContrasena(mensaje: string): Promise<SecretBuffer> {
  const entrada = process.stdin;

  // Sin terminal interactivo (tuberías, tests, scripts) leemos de la entrada
  // estándar tal cual: ahí no hay eco que ocultar.
  if (!entrada.isTTY) {
    return SecretBuffer.fromText(await leerLinea(""));
  }

  process.stdout.write(`${mensaje}: `);
  entrada.setRawMode(true);
  entrada.resume();

  const bytes: number[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const alRecibir = (datos: Buffer) => {
        for (const byte of datos) {
          if (byte === 0x03) {
            // Ctrl-C: abortar sin dejar rastro de lo que se hubiera tecleado.
            bytes.fill(0);
            entrada.off("data", alRecibir);
            reject(new Error("cancelado"));
            return;
          }
          if (byte === 0x0d || byte === 0x0a) {
            entrada.off("data", alRecibir);
            resolve();
            return;
          }
          if (byte === 0x7f || byte === 0x08) {
            if (bytes.length > 0) {
              bytes[bytes.length - 1] = 0;
              bytes.pop();
              process.stdout.write("\b \b");
            }
            continue;
          }
          if (byte === 0x15) {
            // Ctrl-U: borrar la línea entera.
            process.stdout.write("\b \b".repeat(bytes.length));
            bytes.fill(0);
            bytes.length = 0;
            continue;
          }
          bytes.push(byte);
          process.stdout.write("*");
        }
      };
      entrada.on("data", alRecibir);
    });
  } finally {
    entrada.setRawMode(false);
    entrada.pause();
    process.stdout.write("\n");
  }

  const secreto = SecretBuffer.wrap(Uint8Array.from(bytes));
  bytes.fill(0);
  return secreto;
}

/** Pide una contraseña dos veces y comprueba que coinciden antes de aceptarla. */
export async function pedirContrasenaNueva(
  mensaje = "Contraseña maestra",
): Promise<SecretBuffer> {
  for (;;) {
    const primera = await pedirContrasena(mensaje);
    const segunda = await pedirContrasena("Repítela");
    const iguales =
      primera.length === segunda.length &&
      primera.bytes.every((byte, i) => byte === (segunda.bytes[i] as number));
    segunda.destroy();
    if (iguales) return primera;
    primera.destroy();
    error("Las contraseñas no coinciden. Inténtalo otra vez.");
  }
}
