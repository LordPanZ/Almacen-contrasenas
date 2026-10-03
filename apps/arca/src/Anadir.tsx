import { useRef, useState } from "react";
import { prepararArchivo } from "./archivos.ts";
import { carpetaPorDefecto } from "./categorias.ts";
import { formatearBytes } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import { SelectorCarpeta } from "./SelectorCarpeta.tsx";
import type { Biblioteca, Categoria } from "./tipos.ts";

const CLAVE_CATEGORIA = "arca.categoria";

/** La última carpeta elegida, si todavía existe; si no, la de siempre. */
function ultimaCarpeta(categorias: readonly Categoria[]): string {
  try {
    const guardada = localStorage.getItem(CLAVE_CATEGORIA) ?? "";
    if (categorias.some((c) => c.id === guardada)) return guardada;
  } catch {
    /* sin almacenamiento: se usa la de por defecto */
  }
  return carpetaPorDefecto(categorias);
}

interface Resultado {
  readonly nombre: string;
  readonly error?: string;
  readonly aviso?: string;
}

export function Anadir({
  categorias,
  carpetaInicial,
  alCambiar,
  alCerrar,
}: {
  readonly categorias: readonly Categoria[];
  /** Si se añade desde dentro de una carpeta, esa es la carpeta. */
  readonly carpetaInicial: string | undefined;
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [categoria, setCategoria] = useState<string>(carpetaInicial ?? ultimaCarpeta(categorias));
  const [quitarMetadatos, setQuitarMetadatos] = useState(true);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number; actual: string } | null>(null);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const entradaArchivos = useRef<HTMLInputElement>(null);
  const entradaFoto = useRef<HTMLInputElement>(null);

  function sumar(evento: React.ChangeEvent<HTMLInputElement>) {
    const nuevos = Array.from(evento.target.files ?? []);
    // Se vacía para que elegir el mismo archivo dos veces vuelva a disparar el evento.
    evento.target.value = "";
    setResultados(null);
    setArchivos((previos) => [...previos, ...nuevos]);
  }

  async function guardar() {
    try {
      localStorage.setItem(CLAVE_CATEGORIA, categoria);
    } catch {
      /* no pasa nada: solo recuerda la última elección */
    }
    const salida: Resultado[] = [];
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i] as File;
      setProgreso({ hecho: i, total: archivos.length, actual: archivo.name });
      try {
        const preparado = await prepararArchivo(archivo, { quitarMetadatos });
        const biblioteca = await arca.anadir({
          nombre: preparado.nombre,
          mime: preparado.mime,
          categoria,
          notas: "",
          datos: preparado.datos,
        });
        alCambiar(biblioteca);
        salida.push({ nombre: archivo.name, ...(preparado.aviso ? { aviso: preparado.aviso } : {}) });
      } catch (error) {
        salida.push({ nombre: archivo.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    setProgreso(null);
    if (salida.every((r) => !r.error && !r.aviso)) {
      alCerrar();
      return;
    }
    // Si algo falló o hubo un aviso se deja la hoja abierta: cerrarla escondería justo lo que importa.
    setResultados(salida);
    setArchivos([]);
  }

  const ocupado = progreso !== null;
  const total = archivos.reduce((n, a) => n + a.size, 0);

  return (
    <Hoja titulo="Añadir documentos" alCerrar={alCerrar} bloqueada={ocupado}>
      {resultados ? (
        <>
          <ul className="resultados">
            {resultados.map((r, i) => (
              <li key={`${r.nombre}-${i}`} className={r.error ? "mal" : r.aviso ? "aviso-fila" : "bien"}>
                <strong>{r.nombre}</strong>
                <span>{r.error ?? r.aviso ?? "Guardado."}</span>
              </li>
            ))}
          </ul>
          <button className="boton principal ancho" onClick={alCerrar}>
            Hecho
          </button>
        </>
      ) : (
        <>
          <div className="acciones">
            <button className="boton" disabled={ocupado} onClick={() => entradaArchivos.current?.click()}>
              Elegir archivos
            </button>
            <button className="boton" disabled={ocupado} onClick={() => entradaFoto.current?.click()}>
              Hacer una foto
            </button>
          </div>
          <input ref={entradaArchivos} type="file" multiple onChange={sumar} style={{ display: "none" }} />
          <input
            ref={entradaFoto}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={sumar}
            style={{ display: "none" }}
          />

          {archivos.length === 0 ? (
            <p className="texto pequeno">
              PDF, fotos y cualquier otro archivo. Hasta 50 MiB cada uno. Puedes elegir varios a la vez.
            </p>
          ) : (
            <>
              <ul className="seleccion">
                {archivos.map((a, i) => (
                  <li key={`${a.name}-${i}`}>
                    <span className="seleccion-nombre">{a.name}</span>
                    <span className="dato">{formatearBytes(a.size)}</span>
                    {!ocupado && (
                      <button
                        className="enlace"
                        onClick={() => setArchivos(archivos.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${a.name}`}
                      >
                        Quitar
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <SelectorCarpeta
                categorias={categorias}
                valor={categoria}
                alElegir={setCategoria}
                alCambiarBiblioteca={alCambiar}
                deshabilitado={ocupado}
                etiqueta="Guardar en la carpeta"
              />

              <label className="casilla">
                <input
                  type="checkbox"
                  checked={quitarMetadatos}
                  onChange={(e) => setQuitarMetadatos(e.target.checked)}
                  disabled={ocupado}
                />
                <span>
                  Quitar de las fotos la ubicación y los datos del móvil
                  <small>Se re-codifican. Recomendado para un DNI o cualquier documento.</small>
                </span>
              </label>

              {progreso && (
                <div className="progreso" role="status">
                  <div className="medidor">
                    <span style={{ width: `${(progreso.hecho / progreso.total) * 100}%` }} />
                  </div>
                  <div className="dato">
                    Cifrando {progreso.hecho + 1} de {progreso.total} · {progreso.actual}
                  </div>
                </div>
              )}

              <button className="boton principal ancho" disabled={ocupado} onClick={() => void guardar()}>
                {ocupado
                  ? "Cifrando y guardando…"
                  : `Guardar ${archivos.length === 1 ? "1 archivo" : `${archivos.length} archivos`} (${formatearBytes(total)})`}
              </button>
            </>
          )}
        </>
      )}
    </Hoja>
  );
}
