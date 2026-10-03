import { useMemo, useState } from "react";
import { AbrirEnvio } from "./AbrirEnvio.tsx";
import { Anadir } from "./Anadir.tsx";
import { nombreCarpeta, textoDocumentos } from "./categorias.ts";
import { Compartir } from "./Compartir.tsx";
import { EditarCarpeta } from "./EditarCarpeta.tsx";
import { Ficha } from "./Ficha.tsx";
import { claseTipo, etiquetaTipo, formatearBytes, formatearFecha } from "./formato.ts";
import { NuevaCarpeta } from "./NuevaCarpeta.tsx";
import type { Biblioteca as TipoBiblioteca, DocumentoMeta } from "./tipos.ts";

function IconoCarpeta() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  );
}

/**
 * La caja como carpetas.
 *
 * Tres vistas según dónde se esté: la lista de carpetas, el interior de una
 * carpeta y los resultados de buscar, que atraviesan todas. Cada documento está
 * en exactamente una carpeta; las carpetas las pone el usuario.
 */
export function Biblioteca({
  biblioteca,
  alCambiar,
}: {
  readonly biblioteca: TipoBiblioteca;
  readonly alCambiar: (biblioteca: TipoBiblioteca) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState(false);
  const [ficha, setFicha] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [editando, setEditando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [compartiendo, setCompartiendo] = useState(false);
  const [abriendoEnvio, setAbriendoEnvio] = useState(false);

  const { categorias, documentos, faltan } = biblioteca;
  const faltantes = useMemo(() => new Set(faltan), [faltan]);
  // Si la carpeta abierta se borra (desde aquí o desde otra pestaña), se vuelve a la lista.
  const carpeta = categorias.find((c) => c.id === abierta) ?? null;

  const ordenados = useMemo(() => [...documentos].sort((a, b) => b.creado - a.creado), [documentos]);
  const porCarpeta = useMemo(() => {
    const mapa = new Map<string, DocumentoMeta[]>();
    for (const d of ordenados) {
      const lista = mapa.get(d.categoria);
      if (lista) lista.push(d);
      else mapa.set(d.categoria, [d]);
    }
    return mapa;
  }, [ordenados]);

  const aguja = busqueda.trim().toLocaleLowerCase("es");
  const resultados = useMemo(
    () =>
      aguja === ""
        ? []
        : ordenados.filter((d) =>
            [d.nombre, nombreCarpeta(categorias, d.categoria), d.notas, etiquetaTipo(d)]
              .join(" ")
              .toLocaleLowerCase("es")
              .includes(aguja),
          ),
    [ordenados, categorias, aguja],
  );

  const dentro = carpeta ? (porCarpeta.get(carpeta.id) ?? []) : [];
  const visibles = aguja !== "" ? resultados : dentro;
  const actual = documentos.find((d) => d.id === ficha) ?? null;
  const elegidos = documentos.filter((d) => marcados.has(d.id));

  function salirDeMarcar() {
    setMarcando(false);
    setMarcados(new Set());
  }

  function alternar(id: string) {
    setMarcados((previos) => {
      const nuevos = new Set(previos);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });
  }

  function irA(id: string | null) {
    salirDeMarcar();
    setAbierta(id);
  }

  function fila(d: DocumentoMeta, conCarpeta: boolean) {
    const marcado = marcados.has(d.id);
    return (
      <li key={d.id}>
        <button
          className="fila"
          onClick={() => (marcando ? alternar(d.id) : setFicha(d.id))}
          {...(marcando ? { role: "checkbox", "aria-checked": marcado } : {})}
        >
          {marcando && (
            <span className={`casilla-fila${marcado ? " marcada" : ""}`} aria-hidden="true">
              {marcado ? "✓" : ""}
            </span>
          )}
          <span className={`tipo ${claseTipo(d)}`} aria-hidden="true">
            <span>{etiquetaTipo(d)}</span>
          </span>
          <span className="fila-cuerpo">
            <span className="fila-titulo">{d.nombre}</span>
            <span className="fila-sub">
              {conCarpeta && `${nombreCarpeta(categorias, d.categoria)} · `}
              {formatearBytes(d.tam)} · {formatearFecha(d.creado)}
              {faltantes.has(d.id) && <span className="falta"> · no está en este navegador</span>}
            </span>
          </span>
        </button>
      </li>
    );
  }

  const barraSeleccion = (
    <div className="cabecera-seccion">
      <span className="etiqueta">
        {visibles.length === 1 ? "1 documento" : `${visibles.length} documentos`}
        {aguja !== "" && ` de ${documentos.length}`}
      </span>
      {visibles.length > 0 && (
        <button className="boton chico" onClick={() => (marcando ? salirDeMarcar() : setMarcando(true))}>
          {marcando ? "Cancelar" : "Seleccionar"}
        </button>
      )}
    </div>
  );

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
          onChange={(e) => {
            if (marcando) salirDeMarcar();
            setBusqueda(e.target.value);
          }}
          placeholder="Buscar en todas las carpetas…"
          aria-label="Buscar documentos"
        />
        {busqueda !== "" && (
          <button
            className="busqueda-borrar"
            onClick={() => {
              if (marcando) salirDeMarcar();
              setBusqueda("");
            }}
            aria-label="Limpiar la búsqueda"
          >
            ✕
          </button>
        )}
      </div>

      {aguja !== "" ? (
        resultados.length === 0 ? (
          <div className="vacio">Nada coincide con esa búsqueda.</div>
        ) : (
          <>
            {barraSeleccion}
            <ul className="filas">{resultados.map((d) => fila(d, true))}</ul>
          </>
        )
      ) : carpeta ? (
        <>
          <div className="cabecera-carpeta">
            <button className="boton chico" onClick={() => irA(null)} aria-label="Volver a la lista de carpetas">
              ‹ Carpetas
            </button>
            <h2 className="carpeta-titulo">{carpeta.nombre}</h2>
            <button className="boton chico" onClick={() => setEditando(true)}>
              Editar
            </button>
          </div>
          {dentro.length === 0 ? (
            <div className="vacio">
              <strong>Esta carpeta está vacía.</strong>
              <span>Pulsa «Añadir» para guardar aquí un documento.</span>
            </div>
          ) : (
            <>
              {barraSeleccion}
              <ul className="filas">{dentro.map((d) => fila(d, false))}</ul>
            </>
          )}
        </>
      ) : (
        <>
          <div className="cabecera-seccion">
            <span className="etiqueta">Carpetas · {categorias.length}</span>
            <span className="acciones">
              <button className="boton chico" onClick={() => setCreando(true)}>
                ＋ Nueva carpeta
              </button>
              <button className="boton chico" onClick={() => setAbriendoEnvio(true)}>
                Abrir envío
              </button>
            </span>
          </div>
          {documentos.length === 0 && (
            <p className="texto pequeno">La caja está vacía. Abre una carpeta y pulsa «Añadir» para guardar tu primer documento.</p>
          )}
          <ul className="filas">
            {categorias.map((c) => {
              const n = porCarpeta.get(c.id)?.length ?? 0;
              return (
                <li key={c.id}>
                  <button className="fila carpeta" onClick={() => irA(c.id)}>
                    <span className="icono-carpeta">
                      <IconoCarpeta />
                    </span>
                    <span className="fila-cuerpo">
                      <span className="fila-titulo">{c.nombre}</span>
                      <span className="fila-sub">{textoDocumentos(n)}</span>
                    </span>
                    <span className="chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {marcando ? (
        <div className="barra-seleccion">
          <button className="boton" onClick={salirDeMarcar}>
            Cancelar
          </button>
          <button className="boton" onClick={() => setMarcados(new Set(visibles.map((d) => d.id)))}>
            Todos
          </button>
          <button className="boton principal" disabled={elegidos.length === 0} onClick={() => setCompartiendo(true)}>
            Compartir ({elegidos.length})
          </button>
        </div>
      ) : (
        <button className="fab" onClick={() => setAnadiendo(true)}>
          <span aria-hidden="true">+</span> Añadir
        </button>
      )}

      {anadiendo && (
        <Anadir
          categorias={categorias}
          carpetaInicial={carpeta?.id}
          alCambiar={alCambiar}
          alCerrar={() => setAnadiendo(false)}
        />
      )}

      {actual && (
        <Ficha
          documento={actual}
          categorias={categorias}
          falta={faltantes.has(actual.id)}
          alCambiar={alCambiar}
          alCerrar={() => setFicha(null)}
        />
      )}

      {creando && <NuevaCarpeta alCambiar={alCambiar} alCerrar={() => setCreando(false)} />}

      {editando && carpeta && (
        <EditarCarpeta
          carpeta={carpeta}
          categorias={categorias}
          documentos={dentro.length}
          alCambiar={(b) => {
            alCambiar(b);
          }}
          alCerrar={() => setEditando(false)}
        />
      )}

      {compartiendo && elegidos.length > 0 && (
        <Compartir
          documentos={elegidos}
          alCerrar={() => {
            setCompartiendo(false);
            salirDeMarcar();
          }}
        />
      )}

      {abriendoEnvio && (
        <AbrirEnvio categorias={categorias} alCambiarBiblioteca={alCambiar} alCerrar={() => setAbriendoEnvio(false)} />
      )}
    </>
  );
}
