import type { DocumentoMeta } from "@cerbero/arca";

export type { DocumentoMeta };

export interface EstadoCaja {
  /** ¿Hay una caja guardada en este navegador? */
  readonly existe: boolean;
  /** ¿Está abierta ahora mismo en el trabajador? */
  readonly abierta: boolean;
}

export interface Biblioteca {
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
