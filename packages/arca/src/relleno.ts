import { ByteReader, uint32 } from "@cerbero/crypto";
import { CajaFormatoError } from "./errores.ts";

/**
 * Cubos de relleno, los mismos que usa Cerbero para sus entradas.
 *
 * Sin relleno la longitud del criptograma es la del original, y el tamaño de un
 * PDF delata de qué documento se trata casi tanto como su nombre. Con cubos, un
 * documento de 70 KB y otro de 120 KB pesan lo mismo; por encima del último cubo
 * se sigue en múltiplos suyos, de modo que un archivo grande tampoco revela su
 * tamaño exacto.
 */
export const CUBOS = [256, 1024, 4096, 16 * 1024, 64 * 1024] as const;

/** Cubo en el que cae un bloque de `longitud` bytes ya con su cabecera. */
export function cubo(longitud: number): number {
  for (const c of CUBOS) if (longitud <= c) return c;
  const mayor = CUBOS[CUBOS.length - 1] as number;
  return Math.ceil(longitud / mayor) * mayor;
}

/**
 * Longitud rellenada de un contenido de `longitud` bytes (incluye 4 de cabecera).
 *
 * `minimo` sube el suelo: un contenido pequeño y uno mediano pesan igual hasta
 * ese tamaño. El tamaño cifrado revela siempre el cubo y nada más fino.
 */
export function longitudRellenada(longitud: number, minimo = 0): number {
  return Math.max(cubo(4 + longitud), minimo);
}

/**
 * Rellena con ceros hasta el cubo. La longitud real va delante en cuatro bytes,
 * así que el relleno se quita sin adivinar dónde acaban los datos.
 *
 * Los ceros van *dentro* del cifrado, donde el criptograma ya es
 * indistinguible del ruido: gastar entropía en ellos no compraría nada.
 */
export function rellenar(datos: Uint8Array, minimo = 0): Uint8Array {
  const salida = new Uint8Array(longitudRellenada(datos.length, minimo));
  salida.set(uint32(datos.length), 0);
  salida.set(datos, 4);
  return salida;
}

/** Inverso de `rellenar`. Devuelve una vista sobre `relleno`: cópiala antes de borrarlo. */
export function quitarRelleno(relleno: Uint8Array, minimo = 0): Uint8Array {
  const lector = new ByteReader(relleno);
  const longitud = lector.takeUint32();
  if (longitud > lector.remaining || relleno.length !== longitudRellenada(longitud, minimo)) {
    throw new CajaFormatoError("el relleno de un bloque no es válido");
  }
  return lector.take(longitud);
}
