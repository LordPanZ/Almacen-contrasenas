import { useEffect, useState } from "react";
import {
  CATEGORIAS,
  comoCategoria,
  formatearBytes,
  formatearFecha,
  nombreCategoria,
  nucleo,
  type Categoria,
  type DetalleEntrada,
  type EntradaAuditoria,
  type FilaEntrada,
  type FilaFiltracion,
  type ResumenBoveda,
  type VaultItemType,
} from "./nucleo.ts";

const TIPOS: readonly { valor: VaultItemType; nombre: string }[] = [
  { valor: "login", nombre: "Credencial" },
  { valor: "note", nombre: "Nota" },
  { valor: "card", nombre: "Tarjeta" },
  { valor: "identity", nombre: "Identidad" },
  { valor: "key", nombre: "Clave" },
];

function colorPorBits(bits: number): string {
  if (bits >= 90) return "var(--jade)";
  if (bits >= 60) return "var(--senal)";
  return "var(--alarma)";
}

/* ─── Entradas ────────────────────────────────────────────────────────── */

export function VistaEntradas({
  filas,
  alCambiar,
}: {
  readonly filas: readonly FilaEntrada[];
  readonly alCambiar: (filas: FilaEntrada[], fichero: Uint8Array) => void;
}) {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetalleEntrada | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Categoria | "todas">("todas");
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(false);

  async function cargarDetalle(id: string) {
    try {
      setDetalle(await nucleo.obtener(id));
    } catch {
      setDetalle(null);
    }
  }

  useEffect(() => {
    if (!seleccion) {
      setDetalle(null);
      return;
    }
    setEditando(false);
    void cargarDetalle(seleccion);
  }, [seleccion]);

  const aguja = busqueda.trim().toLocaleLowerCase("es");
  const visibles = filas.filter((fila) => {
    if (filtro !== "todas" && fila.categoria !== filtro) return false;
    if (aguja === "") return true;
    return [fila.titulo, fila.usuario, fila.url, nombreCategoria(fila.categoria), ...fila.etiquetas]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(aguja);
  });

  // Solo se ofrecen los filtros que tienen algo detrás: un chip que siempre
  // deja la lista vacía es ruido, y en un móvil ocupa una fila entera.
  const presentes = CATEGORIAS.filter((c) => filas.some((f) => f.categoria === c.valor));

  async function borrar(id: string) {
    const { filas: nuevas, fichero } = await nucleo.borrar(id);
    setSeleccion(null);
    alCambiar(nuevas, fichero);
  }

  return (
    <>
      <div className="cabecera-vista">
        <h1>Entradas</h1>
        <p className="prosa">
          Los títulos, usuarios, direcciones y categorías que ves aquí viajan{" "}
          <strong>dentro</strong> del cifrado. Fuera del fichero solo queda un identificador
          aleatorio sin significado.
        </p>
      </div>

      <div className="buscador">
        <div className="buscador-caja">
          <span className="buscador-glifo" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, usuario o web…"
            aria-label="Buscar entradas"
          />
          {busqueda !== "" && (
            <button
              type="button"
              className="buscador-limpiar"
              onClick={() => setBusqueda("")}
              aria-label="Limpiar la búsqueda"
            >
              ✕
            </button>
          )}
        </div>
        <button className="boton principal nueva" onClick={() => setCreando(true)}>
          + Nueva entrada
        </button>
      </div>

      {presentes.length > 1 && (
        <div className="chips" role="group" aria-label="Filtrar por categoría">
          <button
            className="chip"
            aria-pressed={filtro === "todas"}
            onClick={() => setFiltro("todas")}
          >
            Todas <span className="chip-cuenta">{filas.length}</span>
          </button>
          {presentes.map((categoria) => (
            <button
              key={categoria.valor}
              className="chip"
              aria-pressed={filtro === categoria.valor}
              onClick={() => setFiltro(filtro === categoria.valor ? "todas" : categoria.valor)}
            >
              <span aria-hidden="true">{categoria.glifo}</span> {categoria.nombre}{" "}
              <span className="chip-cuenta">
                {filas.filter((f) => f.categoria === categoria.valor).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {creando && (
        <Formulario
          alCerrar={() => setCreando(false)}
          alGuardar={(nuevas, fichero) => {
            setCreando(false);
            alCambiar(nuevas, fichero);
          }}
        />
      )}

      {visibles.length === 0 ? (
        <div className="vacio">
          {filas.length === 0
            ? "La bóveda está vacía. Crea tu primera entrada."
            : "Nada coincide con esa búsqueda."}
        </div>
      ) : (
        <>
          {(aguja !== "" || filtro !== "todas") && (
            <div className="etiqueta recuento">
              {visibles.length} de {filas.length}
            </div>
          )}
          <div className="lista-entradas">
            {visibles.map((fila) => (
              <div key={fila.id} className="entrada-bloque">
                <button
                  className="entrada"
                  aria-expanded={seleccion === fila.id}
                  onClick={() => setSeleccion(seleccion === fila.id ? null : fila.id)}
                >
                  <span className="entrada-glifo" aria-hidden="true">
                    {CATEGORIAS.find((c) => c.valor === fila.categoria)?.glifo ?? "·"}
                  </span>
                  <span className="entrada-cuerpo">
                    <span className="entrada-titulo">
                      {fila.titulo}
                      {fila.trampa && <span className="distintivo senal">trampa</span>}
                    </span>
                    <span className="entrada-sub dato">
                      {fila.usuario || fila.url || nombreCategoria(fila.categoria)}
                    </span>
                  </span>
                  <span className="entrada-cola">
                    {fila.bits > 0 && (
                      <span className="dato" style={{ color: colorPorBits(fila.bits) }}>
                        {fila.bits} bits
                      </span>
                    )}
                    <span className="entrada-flecha" aria-hidden="true">
                      {seleccion === fila.id ? "▴" : "▾"}
                    </span>
                  </span>
                </button>

                {seleccion === fila.id && detalle && detalle.item.id === fila.id && (
                  <>
                    {editando ? (
                      <Formulario
                        entrada={detalle}
                        alCerrar={() => setEditando(false)}
                        alGuardar={(nuevas, fichero) => {
                          setEditando(false);
                          void cargarDetalle(fila.id);
                          alCambiar(nuevas, fichero);
                        }}
                      />
                    ) : (
                      <Detalle
                        detalle={detalle}
                        alEditar={() => setEditando(true)}
                        alBorrar={() => void borrar(detalle.item.id)}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Ficha abierta de una entrada, con el secreto tapado hasta que se pide. */
function Detalle({
  detalle,
  alEditar,
  alBorrar,
}: {
  readonly detalle: DetalleEntrada;
  readonly alEditar: () => void;
  readonly alBorrar: () => void;
}) {
  const [revelado, setRevelado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const { item } = detalle;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(item.secret);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Sin portapapeles —contexto no seguro, permiso denegado— revelar es lo
      // único que queda: peor callar y que el usuario pegue lo que hubiera antes.
      setRevelado(true);
    }
  }

  return (
    <div className="ficha aparece">
      {detalle.trampa && (
        <div className="aviso senal">
          <span className="glifo">!</span>
          <span>
            Esta es una <strong>credencial trampa</strong>. Tú nunca la usas, así que cualquier uso
            suyo significa que alguien ha entrado en tu bóveda.
          </span>
        </div>
      )}

      {item.secret && (
        <div className="campo">
          <span className="etiqueta">Contraseña</span>
          <div className="secreto">
            <div className={`secreto-valor${revelado ? "" : " oculto"}`}>
              {revelado ? item.secret : "•".repeat(18)}
            </div>
            <div className="barra-acciones">
              <button className="boton" onClick={() => setRevelado(!revelado)}>
                {revelado ? "Ocultar" : "Revelar"}
              </button>
              <button className="boton" onClick={() => void copiar()}>
                {copiado ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
          </div>
          {detalle.fuerza && (
            <>
              <div className="medidor">
                <span
                  style={{
                    width: `${Math.min(100, (detalle.fuerza.bits / 128) * 100)}%`,
                    background: colorPorBits(detalle.fuerza.bits),
                  }}
                />
              </div>
              <div className="dato" style={{ marginTop: 6, color: "var(--texto-tenue)" }}>
                {detalle.fuerza.bits} bits · {detalle.fuerza.veredicto}
              </div>
            </>
          )}
        </div>
      )}

      <div className="rejilla-datos">
        <span className="etiqueta">Categoría</span>
        <span>{nombreCategoria(item.custom["categoria"] ?? "")}</span>

        <span className="etiqueta">Tipo</span>
        <span>{TIPOS.find((t) => t.valor === item.type)?.nombre ?? item.type}</span>

        {item.username && (
          <>
            <span className="etiqueta">Usuario</span>
            <span className="dato copiable">{item.username}</span>
          </>
        )}

        {item.url && (
          <>
            <span className="etiqueta">Dirección</span>
            <span className="dato copiable">{item.url}</span>
          </>
        )}

        {item.notes && (
          <>
            <span className="etiqueta">Notas</span>
            <span style={{ whiteSpace: "pre-wrap" }}>{item.notes}</span>
          </>
        )}

        {item.tags.length > 0 && (
          <>
            <span className="etiqueta">Etiquetas</span>
            <span>{item.tags.join(", ")}</span>
          </>
        )}

        <span className="etiqueta">Actualizada</span>
        <span className="dato" style={{ color: "var(--texto-tenue)" }}>
          {formatearFecha(item.updatedAt)}
        </span>
      </div>

      <div className="barra-acciones ficha-pie">
        <button className="boton principal" onClick={alEditar}>
          Editar
        </button>
        {confirmando ? (
          <>
            <button className="boton peligro" onClick={alBorrar}>
              Sí, borrar
            </button>
            <button className="boton" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button className="boton peligro" onClick={() => setConfirmando(true)}>
            Borrar
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Alta y edición comparten formulario.
 *
 * Con `entrada` edita esa entrada; sin ella, crea una nueva. Tenerlo en un solo
 * sitio evita que los dos caminos se separen: cualquier campo que se añada
 * aparece en ambos, que es justo donde suelen quedarse los datos a medias.
 */
function Formulario({
  entrada,
  alCerrar,
  alGuardar,
}: {
  readonly entrada?: DetalleEntrada;
  readonly alCerrar: () => void;
  readonly alGuardar: (filas: FilaEntrada[], fichero: Uint8Array) => void;
}) {
  const previo = entrada?.item;
  const [tipo, setTipo] = useState<VaultItemType>(previo?.type ?? "login");
  const [categoria, setCategoria] = useState<Categoria>(comoCategoria(previo?.custom["categoria"]));
  const [titulo, setTitulo] = useState(previo?.title ?? "");
  const [usuario, setUsuario] = useState(previo?.username ?? "");
  const [url, setUrl] = useState(previo?.url ?? "");
  const [secreto, setSecreto] = useState(previo?.secret ?? "");
  const [verSecreto, setVerSecreto] = useState(previo === undefined);
  const [notas, setNotas] = useState(previo?.notes ?? "");
  const [etiquetas, setEtiquetas] = useState(previo?.tags.join(", ") ?? "");
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function generar() {
    const { valor } = await nucleo.generar(false, 20, 7);
    setSecreto(valor);
    setVerSecreto(true);
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    setGuardando(true);
    setFallo(null);
    try {
      // Los campos vacíos se mandan como cadena vacía en vez de omitirse: al
      // editar, omitir un campo conserva el valor anterior, así que borrar un
      // usuario sería imposible.
      const draft = {
        type: tipo,
        title: titulo.trim(),
        username: usuario,
        url,
        secret: secreto,
        notes: notas,
        tags: etiquetas
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0),
        custom: { ...previo?.custom, categoria },
      };
      const { filas, fichero } = previo
        ? await nucleo.actualizar(previo.id, draft)
        : await nucleo.anadir(draft);
      alGuardar(filas, fichero);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setGuardando(false);
    }
  }

  return (
    <form className="panel formulario aparece" onSubmit={guardar}>
      <div className="panel-titulo">
        <h2 style={{ fontSize: 17 }}>{previo ? "Editar entrada" : "Nueva entrada"}</h2>
        <button type="button" className="boton" onClick={alCerrar}>
          Cancelar
        </button>
      </div>

      <label className="campo">
        <span className="etiqueta">Nombre</span>
        <input
          type="text"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Netflix"
          required
          autoFocus={previo === undefined}
        />
      </label>

      <div className="rejilla-campos">
        <label className="campo">
          <span className="etiqueta">Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="etiqueta">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as VaultItemType)}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="etiqueta">Usuario</span>
          <input
            type="text"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="tucorreo@ejemplo.com"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label className="campo">
          <span className="etiqueta">Dirección</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="netflix.com"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
        </label>
      </div>

      <div className="campo">
        <span className="etiqueta">Contraseña</span>
        <input
          type={verSecreto ? "text" : "password"}
          value={secreto}
          onChange={(e) => setSecreto(e.target.value)}
          aria-label="Contraseña"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="barra-acciones" style={{ marginTop: 8 }}>
          <button type="button" className="boton" onClick={() => setVerSecreto(!verSecreto)}>
            {verSecreto ? "Ocultar" : "Ver"}
          </button>
          <button type="button" className="boton" onClick={() => void generar()}>
            Generar una segura
          </button>
        </div>
      </div>

      <label className="campo">
        <span className="etiqueta">Notas</span>
        <textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </label>

      <label className="campo">
        <span className="etiqueta">Etiquetas (separadas por comas)</span>
        <input type="text" value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} />
      </label>

      {fallo && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>{fallo}</span>
        </div>
      )}

      <button
        type="submit"
        className="boton principal ancho"
        disabled={guardando || titulo.trim() === ""}
      >
        {guardando ? "Guardando…" : previo ? "Guardar cambios" : "Guardar"}
      </button>
    </form>
  );
}

/* ─── Credenciales trampa ─────────────────────────────────────────────── */

export function VistaCanarios({
  filas,
  alCambiar,
}: {
  readonly filas: readonly FilaEntrada[];
  readonly alCambiar: (filas: FilaEntrada[], fichero: Uint8Array) => void;
}) {
  const [cantidad, setCantidad] = useState(3);
  const [trabajando, setTrabajando] = useState(false);
  const trampas = filas.filter((f) => f.trampa);

  async function sembrar() {
    setTrabajando(true);
    try {
      const { filas: nuevas, fichero } = await nucleo.sembrarCanarios(cantidad);
      alCambiar(nuevas, fichero);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="cabecera-vista">
        <h1>Credenciales trampa</h1>
        <p className="prosa">
          Entradas señuelo indistinguibles de las reales para quien robe la bóveda, pero que
          Cerbero reconoce. Tú nunca las usas, así que{" "}
          <strong>cualquier uso suyo es prueba de que alguien ha entrado</strong>. Ningún gestor de
          contraseñas actual detecta que han accedido a tu bóveda.
        </p>
      </div>

      <div className="panel">
        <div className="barra-acciones">
          <label className="etiqueta">Cuántas sembrar</label>
          <input
            type="number"
            min={1}
            max={20}
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <button className="boton principal" onClick={() => void sembrar()} disabled={trabajando}>
            {trabajando ? "Sembrando…" : "Sembrar"}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>Sembradas</h2>
          <span className="dato" style={{ color: "var(--texto-tenue)" }}>
            {trampas.length}
          </span>
        </div>
        {trampas.length === 0 ? (
          <div className="vacio">Todavía no has sembrado ninguna.</div>
        ) : (
          <div className="tabla-marco">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Servicio</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {trampas.map((fila) => (
                  <tr key={fila.id} style={{ cursor: "default" }}>
                    <td>{fila.titulo}</td>
                    <td className="dato" style={{ color: "var(--texto-medio)" }}>
                      {fila.usuario}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Filtraciones ────────────────────────────────────────────────────── */

export function VistaFiltraciones() {
  const [datos, setDatos] = useState<{ filas: FilaFiltracion[]; corpus: number } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function comprobar() {
    setTrabajando(true);
    try {
      setDatos(await nucleo.filtraciones());
    } finally {
      setTrabajando(false);
    }
  }

  const filtradas = datos?.filas.filter((f) => f.filtrada).length ?? 0;

  return (
    <>
      <div className="cabecera-vista">
        <h1>Filtraciones</h1>
        <p className="prosa">
          Comprobar esto normalmente significa enviarle a un tercero un prefijo del hash de tu
          contraseña. Aquí el servidor evalúa sobre un punto <strong>cegado</strong>: no aprende la
          contraseña, ni su hash, ni un prefijo, ni puede saber si dos consultas fueron de la misma.
          Y como la comparación ocurre en tu dispositivo, tampoco se entera de si el resultado fue
          positivo.
        </p>
      </div>

      <div className="panel">
        <div className="barra-acciones">
          <button className="boton principal" onClick={() => void comprobar()} disabled={trabajando}>
            {trabajando ? "Consultando…" : "Comprobar todas"}
          </button>
          {datos && (
            <span className="dato" style={{ color: "var(--texto-tenue)" }}>
              corpus de {datos.corpus} contraseñas conocidas
            </span>
          )}
        </div>
      </div>

      {datos && (
        <>
          {filtradas > 0 ? (
            <div className="aviso alarma">
              <span className="glifo">!</span>
              <span>
                {filtradas} {filtradas === 1 ? "contraseña aparece" : "contraseñas aparecen"} en
                filtraciones conocidas. Cámbia{filtradas === 1 ? "la" : "las"} cuanto antes.
              </span>
            </div>
          ) : (
            <div className="aviso jade">
              <span className="glifo">✓</span>
              <span>Ninguna de tus contraseñas aparece en el corpus consultado.</span>
            </div>
          )}

          <div className="panel">
            <div className="tabla-marco">
              <table className="tabla">
                <thead>
                  <tr>
                    <th style={{ width: "40%" }}>Entrada</th>
                    <th>Filtración</th>
                    <th>Entropía</th>
                    <th>Veredicto</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((fila) => (
                    <tr key={fila.id} style={{ cursor: "default" }}>
                      <td>{fila.titulo}</td>
                      <td>
                        <span className={`distintivo ${fila.filtrada ? "alarma" : "jade"}`}>
                          {fila.filtrada ? "filtrada" : "limpia"}
                        </span>
                      </td>
                      <td className="dato" style={{ color: colorPorBits(fila.bits) }}>
                        {fila.bits} bits
                      </td>
                      <td className="dato" style={{ color: "var(--texto-medio)" }}>
                        {fila.veredicto}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ─── Auditoría ───────────────────────────────────────────────────────── */

export function VistaAuditoria() {
  const [datos, setDatos] = useState<{
    tamano: number;
    raiz: string;
    entradas: EntradaAuditoria[];
  } | null>(null);
  const [verificacion, setVerificacion] = useState<{ verificadas: number; fallos: number[] } | null>(
    null,
  );
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    void nucleo.auditoria().then(setDatos).catch(() => setDatos(null));
  }, []);

  async function verificar() {
    setTrabajando(true);
    try {
      setVerificacion(await nucleo.verificarAuditoria());
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="cabecera-vista">
        <h1>Auditoría</h1>
        <p className="prosa">
          Cada suceso queda anotado como hoja de un árbol Merkle. Un servidor que borrara o alterara
          una entrada pasada <strong>no podría producir pruebas válidas</strong>, así que la
          reescritura del historial deja de ser cuestión de confianza y pasa a ser comprobable.
          Las entradas guardan hashes de los detalles, nunca los detalles: este registro puede
          enseñarse a un auditor sin revelar una sola contraseña.
        </p>
      </div>

      {datos && (
        <>
          <div className="panel">
            <div className="rejilla-datos">
              <span className="etiqueta">Entradas</span>
              <span className="dato">{datos.tamano}</span>
              <span className="etiqueta">Raíz Merkle</span>
              <span className="lista-hashes">{datos.raiz}</span>
            </div>
            <div className="barra-acciones" style={{ marginTop: 16 }}>
              <button className="boton principal" onClick={() => void verificar()} disabled={trabajando}>
                {trabajando ? "Verificando…" : "Verificar integridad"}
              </button>
            </div>
          </div>

          {verificacion && (
            <div className={`aviso ${verificacion.fallos.length === 0 ? "jade" : "alarma"}`}>
              <span className="glifo">{verificacion.fallos.length === 0 ? "✓" : "!"}</span>
              <span>
                {verificacion.fallos.length === 0
                  ? `Las ${verificacion.verificadas} entradas superan su prueba de inclusión: el historial no ha sido reescrito.`
                  : `Fallan las pruebas de las entradas ${verificacion.fallos.join(", ")}. El registro ha sido manipulado.`}
              </span>
            </div>
          )}

          <div className="panel">
            <div className="tabla-marco">
              <table className="tabla">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>#</th>
                    <th style={{ width: 220 }}>Momento</th>
                    <th>Suceso</th>
                  </tr>
                </thead>
                <tbody>
                  {[...datos.entradas].reverse().map((entrada) => (
                    <tr key={entrada.indice} style={{ cursor: "default" }}>
                      <td className="dato" style={{ color: "var(--texto-tenue)" }}>
                        {entrada.indice}
                      </td>
                      <td className="dato" style={{ color: "var(--texto-medio)" }}>
                        {formatearFecha(entrada.momento)}
                      </td>
                      <td className="dato">{entrada.tipo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ─── Coacción ────────────────────────────────────────────────────────── */

export function VistaCoaccion({
  passwordActual,
  alActualizarFichero,
}: {
  readonly passwordActual: string;
  readonly alActualizarFichero: (fichero: Uint8Array) => void;
}) {
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [anteriores, setAnteriores] = useState<string[]>([]);
  const [otra, setOtra] = useState("");
  const [estado, setEstado] = useState<{ tipo: "jade" | "alarma"; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    if (nueva !== repetida) {
      setEstado({ tipo: "alarma", texto: "Las contraseñas no coinciden." });
      return;
    }
    setTrabajando(true);
    setEstado(null);
    try {
      const { fichero } = await nucleo.coaccion(passwordActual, nueva, anteriores);
      alActualizarFichero(fichero);
      setEstado({
        tipo: "jade",
        texto:
          "Bóveda de coacción creada. El fichero pesa exactamente lo mismo que antes y su cabecera no ha cambiado.",
      });
      setNueva("");
      setRepetida("");
    } catch (error) {
      setEstado({ tipo: "alarma", texto: error instanceof Error ? error.message : String(error) });
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="cabecera-vista">
        <h1>Bóveda de coacción</h1>
        <p className="prosa">
          Una segunda bóveda que se abre con <strong>otra contraseña</strong>: la que darías si
          alguien te obliga. Todas las ranuras del fichero miden lo mismo y las no usadas contienen
          ruido indistinguible de un criptograma, así que{" "}
          <strong>nadie puede demostrar que exista más de una</strong>. No es un "PIN de pánico"
          que el propio formato delata.
        </p>
      </div>

      <form className="panel" onSubmit={crear}>
        <label className="campo">
          <span className="etiqueta">Contraseña de coacción</span>
          <input
            type="password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="distinta, y que puedas recordar bajo presión"
            autoComplete="off"
          />
        </label>
        <label className="campo">
          <span className="etiqueta">Repítela</span>
          <input
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div className="campo">
          <span className="etiqueta">Bóvedas de coacción que ya tengas</span>
          <p className="prosa" style={{ fontSize: 13.5, marginBottom: 8 }}>
            Cerbero no puede detectar qué ranuras están ocupadas —esa imposibilidad es justo lo que
            hace negable el fichero—, así que si ya creaste otra, decláratela aquí o la nueva podría
            caer encima y borrarla.
          </p>
          <div className="barra-acciones">
            <input
              type="password"
              value={otra}
              onChange={(e) => setOtra(e.target.value)}
              placeholder="contraseña de otra bóveda tuya"
              autoComplete="off"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="boton"
              disabled={otra.length === 0}
              onClick={() => {
                setAnteriores([...anteriores, otra]);
                setOtra("");
              }}
            >
              Añadir
            </button>
          </div>
          {anteriores.length > 0 && (
            <div className="dato" style={{ marginTop: 8, color: "var(--texto-tenue)" }}>
              {anteriores.length} declarada{anteriores.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {estado && (
          <div className={`aviso ${estado.tipo}`}>
            <span className="glifo">{estado.tipo === "jade" ? "✓" : "!"}</span>
            <span>{estado.texto}</span>
          </div>
        )}

        <button type="submit" className="boton principal" disabled={trabajando || nueva.length === 0}>
          {trabajando ? "Creando…" : "Crear bóveda de coacción"}
        </button>
      </form>
    </>
  );
}

/* ─── Fichero ─────────────────────────────────────────────────────────── */

export function VistaFichero({
  resumen,
  fichero,
  alDescargar,
  alOlvidar,
}: {
  readonly resumen: ResumenBoveda;
  readonly fichero: Uint8Array | null;
  readonly alDescargar: () => void;
  readonly alOlvidar: () => void;
}) {
  const ocupacion = (resumen.usados / resumen.capacidad) * 100;

  return (
    <>
      <div className="cabecera-vista">
        <h1>El fichero</h1>
        <p className="prosa">
          Esto es <strong>todo</strong> lo que revela tu bóveda a quien la tenga en la mano. No dice
          cuántas bóvedas contiene, ni cuántas entradas hay, ni de qué servicios.
        </p>
      </div>

      <div className="panel">
        <div className="tira" aria-hidden="true">
          {Array.from({ length: resumen.ranuras }, (_, i) => (
            <div key={i} className="ranura" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
        <p className="etiqueta">
          {resumen.ranuras} ranuras de {formatearBytes(resumen.tamanoRanura)} · indistinguibles
          entre sí
        </p>
      </div>

      <div className="panel">
        <div className="rejilla-datos">
          <span className="etiqueta">Identificador</span>
          <span className="dato">{resumen.vaultId}</span>
          <span className="etiqueta">Entradas</span>
          <span className="dato">{resumen.entradas}</span>
          <span className="etiqueta">Ocupación de la ranura</span>
          <div>
            <span className="dato">
              {formatearBytes(resumen.usados)} de {formatearBytes(resumen.capacidad)} ·{" "}
              {ocupacion.toFixed(1)}%
            </span>
            <div className="medidor">
              <span
                style={{
                  width: `${Math.min(100, ocupacion)}%`,
                  background: ocupacion > 85 ? "var(--alarma)" : "var(--senal)",
                }}
              />
            </div>
          </div>
          <span className="etiqueta">Tamaño en disco</span>
          <span className="dato">{fichero ? formatearBytes(fichero.length) : "—"}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>Copia de seguridad</h2>
        </div>
        <p className="prosa" style={{ marginBottom: 14 }}>
          El navegador guarda el fichero cifrado por comodidad, pero limpiar los datos del sitio lo
          borra. La copia de verdad es la que descargas tú.
        </p>
        <div className="barra-acciones">
          <button className="boton principal" onClick={alDescargar}>
            Descargar la bóveda
          </button>
          <button className="boton peligro" onClick={alOlvidar}>
            Olvidar en este navegador
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Generador ───────────────────────────────────────────────────────── */

export function VistaGenerador() {
  const [frase, setFrase] = useState(false);
  const [longitud, setLongitud] = useState(20);
  const [palabras, setPalabras] = useState(7);
  const [resultados, setResultados] = useState<{ valor: string; bits: number; veredicto: string }[]>(
    [],
  );

  async function generar() {
    const nuevos = [];
    for (let i = 0; i < 5; i++) {
      const { valor, fuerza } = await nucleo.generar(frase, longitud, palabras);
      nuevos.push({ valor, bits: fuerza.bits, veredicto: fuerza.veredicto });
    }
    setResultados(nuevos);
  }

  useEffect(() => {
    void generar();
    // Regenerar al cambiar los parámetros es lo que el usuario espera aquí.
  }, [frase, longitud, palabras]);

  return (
    <>
      <div className="cabecera-vista">
        <h1>Generador</h1>
        <p className="prosa">
          Muestreo con rechazo sobre el generador del sistema, sin sesgo modular. Las clases
          exigidas se garantizan barajando, no sustituyendo posiciones fijas: sustituir recorta la
          entropía real por debajo de la que se anuncia.
        </p>
      </div>

      <div className="panel">
        <div className="barra-acciones">
          <button
            className="boton"
            style={!frase ? { borderColor: "var(--senal)" } : undefined}
            onClick={() => setFrase(false)}
          >
            Contraseña
          </button>
          <button
            className="boton"
            style={frase ? { borderColor: "var(--senal)" } : undefined}
            onClick={() => setFrase(true)}
          >
            Frase
          </button>
          {frase ? (
            <>
              <span className="etiqueta">Palabras</span>
              <input
                type="number"
                min={4}
                max={12}
                value={palabras}
                onChange={(e) => setPalabras(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </>
          ) : (
            <>
              <span className="etiqueta">Longitud</span>
              <input
                type="number"
                min={8}
                max={64}
                value={longitud}
                onChange={(e) => setLongitud(Number(e.target.value))}
                style={{ width: 80 }}
              />
            </>
          )}
          <button className="boton principal" onClick={() => void generar()}>
            Regenerar
          </button>
        </div>
      </div>

      <div className="panel">
        {resultados.map((resultado) => (
          <div
            key={resultado.valor}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--linea)",
            }}
          >
            <code className="dato" style={{ flex: 1, wordBreak: "break-all" }}>
              {resultado.valor}
            </code>
            <span className="dato" style={{ color: colorPorBits(resultado.bits), minWidth: 78 }}>
              {resultado.bits} bits
            </span>
            <button
              className="boton"
              onClick={() => void navigator.clipboard?.writeText(resultado.valor)}
            >
              Copiar
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
