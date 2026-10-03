import type { Categoria, DocumentoMeta } from "@cerbero/arca";

export type { Categoria, DocumentoMeta };

export interface EstadoCaja {
  /** ¿Hay una caja guardada en este navegador? */
  readonly existe: boolean;
  /** ¿Está abierta ahora mismo en el trabajador? */
  readonly abierta: boolean;
}

export interface Biblioteca {
  /** Las carpetas, en su orden. Cada documento está en una. */
  readonly categorias: readonly Categoria[];
  readonly documentos: readonly DocumentoMeta[];
  /** Documentos que el índice menciona y este navegador no tiene. */
  readonly faltan: readonly string[];
}

export interface Fuerza {
  readonly bits: number;
  readonly veredicto: string;
  readonly avisos: readonly string[];
}

export interface Uso {
  readonly documentos: number;
  readonly bytesOriginales: number;
  readonly bytesEnNavegador: number;
  readonly huerfanos: number;
  readonly bytesHuerfanos: number;
}

export interface NuevoDocumento {
  readonly nombre: string;
  readonly mime: string;
  readonly categoria: string;
  readonly notas: string;
  readonly datos: ArrayBuffer;
}

export type PerfilArgon2 = "interactive" | "moderate" | "paranoid";

/** Un envío cifrado listo para mandar: el fichero y el código que lo abre, que se enseña una sola vez. */
export interface EnvioCreado {
  readonly archivo: Blob;
  readonly nombre: string;
  readonly codigo: string;
  readonly documentos: number;
}

/** Lo que se sabe de un envío recibido antes de tener el código: solo que es uno válido. */
export interface EnvioInspeccion {
  readonly documentos: number;
  readonly bytes: number;
}

/** Lo que hay dentro de un envío, una vez abierto con su código. */
export interface EnvioAbierto {
  readonly creado: number;
  readonly documentos: readonly { readonly nombre: string; readonly mime: string; readonly tam: number }[];
}

/** Lo que traería sumar otra copia de la misma caja a la abierta. */
export interface ResumenFusion {
  readonly nuevos: readonly { readonly nombre: string; readonly tam: number; readonly carpeta: string }[];
  /** Documentos que ya estaban y se editaron más tarde en la otra copia. */
  readonly actualizados: number;
  readonly carpetasNuevas: readonly string[];
  /** Documentos que la copia menciona pero no trae: una copia incompleta. */
  readonly sinContenido: number;
}
