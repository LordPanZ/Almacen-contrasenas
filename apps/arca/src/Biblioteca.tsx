import { useMemo, useState } from "react";
import { Anadir } from "./Anadir.tsx";
import { CATEGORIAS, nombreCategoria } from "./categorias.ts";
import { Ficha } from "./Ficha.tsx";
import { claseTipo, etiquetaTipo, formatearBytes, formatearFecha } from "./formato.ts";
import type { Biblioteca as TipoBiblioteca } from "./tipos.ts";

export function Biblioteca({
  biblioteca,
  alCambiar,
}: {
  readonly biblioteca: TipoBiblioteca;
  readonly alCambiar: (biblioteca: TipoBiblioteca) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<string>("todas");
  const [anadiendo, setAnadiendo] = useState(false);
  const [seleccion, setSeleccion] = useState<string | null>(null);

  const { documentos, faltan } = biblioteca;
  const faltantes = useMemo(() => new Set(faltan), [faltan]);

  const aguja = busqueda.trim().toLocaleLowerCase("es");
  const visibles = useMemo(
    () =>
      [...documentos]
        .sort((a, b) => b.creado - a.creado)
        .filter((d) => {
          if (filtro !== "todas" && d.categoria !== filtro) return false;
          if (aguja === "") return true;
          return [d.nombre, nombreCategoria(d.categoria), d.notas, etiquetaTipo(d)]
            .join(" ")
            .toLocaleLowerCase("es")
            .includes(aguja);
        }),
    [documentos, filtro, aguja],
  );

  // Solo se ofrecen las categorías que tienen algo detrás: un chip que siempre
  // deja la lista vacía es ruido, y en un móvil ocupa sitio.
  const presentes = CATEGORIAS.filter((c) => documentos.some((d) => d.categoria === c.valor));
  const actual = documentos.find((d) => d.id === seleccion) ?? null;

  return (
    <>
      {faltan.length > 0 && (
        <div className="aviso alarma">
          {faltan.length === 1 ? "Un documento aparece en la lista pero no está" : `${faltan.length} documentos aparecen en la lista pero no están`}{" "}
          en este navegador. Suele pasar al restaurar una copia incompleta. Ábrelos para ver qué ocurre.
        </div>
      )}

      <div className="busqueda">
        <span aria-hidden="true" className="busqueda-lupa">
          ⌕
        </span>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, categoría o notas…"
          aria-label="Buscar documentos"
        />
        {busqueda !== "" && (
          <button className="busqueda-borrar" onClick={() => setBusqueda("")} aria-label="Limpiar la búsqueda">
            ✕
          </button>
        )}
      </div>

      {presentes.length > 1 && (
        <div className="chips" role="group" aria-label="Filtrar por categoría">
          <button className="chip" aria-pressed={filtro === "todas"} onClick={() => setFiltro("todas")}>
            Todas <span className="chip-cuenta">{documentos.length}</span>
          </button>
          {presentes.map((c) => (
            <button
              key={c.valor}
              className="chip"
              aria-pressed={filtro === c.valor}
              onClick={() => setFiltro(filtro === c.valor ? "todas" : c.valor)}
            >
              {c.nombre}{" "}
              <span className="chip-cuenta">{documentos.filter((d) => d.categoria === c.valor).length}</span>
            </button>
          ))}
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="vacio">
          {documentos.length === 0 ? (
            <>
              <strong>La caja está vacía.</strong>
              <span>Añade tu primer documento: un DNI, una escritura, un seguro.</span>
            </>
          ) : (
            "Nada coincide con esa búsqueda."
          )}
        </div>
      ) : (
        <>
          {(aguja !== "" || filtro !== "todas") && (
            <div className="etiqueta recuento">
              {visibles.length} de {documentos.length}
            </div>
          )}
          <ul className="filas">
            {visibles.map((d) => (
              <li key={d.id}>
                <button className="fila" onClick={() => setSeleccion(d.id)}>
                  <span className={`tipo ${claseTipo(d)}`} aria-hidden="true">
                    <span>{etiquetaTipo(d)}</span>
                  </span>
                  <span className="fila-cuerpo">
                    <span className="fila-titulo">{d.nombre}</span>
                    <span className="fila-sub">
                      {nombreCategoria(d.categoria)} · {formatearBytes(d.tam)} · {formatearFecha(d.creado)}
                      {faltantes.has(d.id) && <span className="falta"> · no está en este navegador</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="fab" onClick={() => setAnadiendo(true)}>
        <span aria-hidden="true">+</span> Añadir
      </button>

      {anadiendo && (
        <Anadir
          categoriaInicial={filtro !== "todas" ? filtro : undefined}
          alCambiar={alCambiar}
          alCerrar={() => setAnadiendo(false)}
        />
      )}

      {actual && (
        <Ficha
          documento={actual}
          falta={faltantes.has(actual.id)}
          alCambiar={alCambiar}
          alCerrar={() => setSeleccion(null)}
        />
      )}
    </>
  );
}
