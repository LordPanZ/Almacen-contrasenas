/**
 * Analizador de argumentos mínimo.
 *
 * Sin dependencias externas a propósito: en una herramienta que maneja
 * contraseñas, cada paquete de terceros es superficie de ataque de cadena de
 * suministro. Para lo poco que necesitamos aquí, cien líneas propias salen más
 * baratas que una dependencia que hay que vigilar para siempre.
 */
export interface ArgumentosAnalizados {
  readonly comando: string;
  readonly posicionales: readonly string[];
  readonly opciones: Readonly<Record<string, string | boolean>>;
}

export function analizarArgumentos(argv: readonly string[]): ArgumentosAnalizados {
  const posicionales: string[] = [];
  const opciones: Record<string, string | boolean> = {};
  let soloPosicionales = false;

  for (let i = 0; i < argv.length; i++) {
    const argumento = argv[i] as string;

    if (soloPosicionales) {
      posicionales.push(argumento);
      continue;
    }
    if (argumento === "--") {
      soloPosicionales = true;
      continue;
    }

    if (argumento.startsWith("--")) {
      const cuerpo = argumento.slice(2);
      const igual = cuerpo.indexOf("=");
      if (igual >= 0) {
        opciones[cuerpo.slice(0, igual)] = cuerpo.slice(igual + 1);
        continue;
      }
      const siguiente = argv[i + 1];
      // Una opción seguida de algo que no empieza por guion toma ese valor;
      // si no, es un interruptor booleano.
      if (siguiente !== undefined && !siguiente.startsWith("-")) {
        opciones[cuerpo] = siguiente;
        i++;
      } else {
        opciones[cuerpo] = true;
      }
      continue;
    }

    if (argumento.startsWith("-") && argumento.length > 1) {
      // Banderas cortas agrupadas: -abc equivale a -a -b -c.
      for (const letra of argumento.slice(1)) opciones[letra] = true;
      continue;
    }

    posicionales.push(argumento);
  }

  const [comando = "", ...resto] = posicionales;
  return { comando, posicionales: resto, opciones };
}

export function opcionTexto(
  args: ArgumentosAnalizados,
  nombre: string,
): string | undefined {
  const valor = args.opciones[nombre];
  return typeof valor === "string" ? valor : undefined;
}

export function opcionNumero(
  args: ArgumentosAnalizados,
  nombre: string,
  porDefecto: number,
): number {
  const valor = args.opciones[nombre];
  if (typeof valor !== "string") return porDefecto;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : porDefecto;
}

export function opcionBooleana(args: ArgumentosAnalizados, nombre: string): boolean {
  return args.opciones[nombre] === true || args.opciones[nombre] === "true";
}
