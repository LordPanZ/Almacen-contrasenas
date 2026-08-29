import { useEffect, useState } from "react";
import { VistaGuardianes } from "./Guardianes.tsx";
import { Portada } from "./Portada.tsx";
import {
  VistaAuditoria,
  VistaCanarios,
  VistaCoaccion,
  VistaEntradas,
  VistaFichero,
  VistaFiltraciones,
  VistaGenerador,
} from "./Vistas.tsx";
import {
  descargar,
  guardarLocal,
  leerLocal,
  nucleo,
  olvidarLocal,
  type FilaEntrada,
  type ResumenBoveda,
} from "./nucleo.ts";

type Vista =
  | "entradas"
  | "generador"
  | "canarios"
  | "filtraciones"
  | "coaccion"
  | "guardianes"
  | "auditoria"
  | "fichero";

const NAV: readonly { vista: Vista; nombre: string; glifo: string; grupo?: string }[] = [
  { vista: "entradas", nombre: "Entradas", glifo: "▤", grupo: "Bóveda" },
  { vista: "generador", nombre: "Generador", glifo: "⚂" },
  { vista: "canarios", nombre: "Trampas", glifo: "◈", grupo: "Protección" },
  { vista: "coaccion", nombre: "Coacción", glifo: "◫" },
  { vista: "guardianes", nombre: "Guardianes", glifo: "◎" },
  { vista: "filtraciones", nombre: "Filtraciones", glifo: "◉" },
  { vista: "auditoria", nombre: "Auditoría", glifo: "⌘", grupo: "Verificación" },
  { vista: "fichero", nombre: "El fichero", glifo: "▣" },
];

export function App() {
  const [resumen, setResumen] = useState<ResumenBoveda | null>(null);
  const [fichero, setFichero] = useState<Uint8Array | null>(null);
  const [guardado, setGuardado] = useState<Uint8Array | null>(null);
  const [password, setPassword] = useState("");
  const [filas, setFilas] = useState<FilaEntrada[]>([]);
  const [vista, setVista] = useState<Vista>("entradas");
  const [cargando, setCargando] = useState(true);
  // `null` mientras no se sabe; `false` en cuanto un guardado falla.
  const [almacenDisponible, setAlmacenDisponible] = useState<boolean | null>(null);

  useEffect(() => {
    void leerLocal().then((encontrado) => {
      setGuardado(encontrado);
      setCargando(false);
    });
  }, []);

  async function abrir(nuevoResumen: ResumenBoveda, nuevoFichero: Uint8Array, clave: string) {
    setResumen(nuevoResumen);
    setFichero(nuevoFichero);
    setPassword(clave);
    setAlmacenDisponible(await guardarLocal(nuevoFichero));
    const { filas: iniciales } = await nucleo.listar();
    setFilas(iniciales);
  }

  async function actualizar(nuevasFilas: FilaEntrada[], nuevoFichero: Uint8Array) {
    setFilas(nuevasFilas);
    setFichero(nuevoFichero);
    setResumen((previo) =>
      previo ? { ...previo, entradas: nuevasFilas.length } : previo,
    );
    setAlmacenDisponible(await guardarLocal(nuevoFichero));
  }

  async function cerrar() {
    await nucleo.cerrar();
    setResumen(null);
    setFichero(null);
    setPassword("");
    setFilas([]);
    setVista("entradas");
    setGuardado(await leerLocal());
  }

  if (cargando) {
    return (
      <div className="portada">
        <div className="etiqueta">Cargando…</div>
      </div>
    );
  }

  if (!resumen) {
    return <Portada ficheroGuardado={guardado} alAbrir={(r, f, p) => void abrir(r, f, p)} />;
  }

  return (
    <div className="marco">
      <nav className="rail">
        <div className="marca">
          <span className="marca-nombre">Cerbero</span>
          <span className="marca-version">v0.1</span>
        </div>

        <div className="nav">
          {NAV.map((elemento) => (
            <div key={elemento.vista}>
              {elemento.grupo && <div className="nav-grupo etiqueta">{elemento.grupo}</div>}
              <button
                className="nav-item"
                aria-current={vista === elemento.vista}
                onClick={() => setVista(elemento.vista)}
              >
                <span className="glifo">{elemento.glifo}</span>
                {elemento.nombre}
              </button>
            </div>
          ))}
        </div>

        <div className="pie-rail">
          <div className="etiqueta" style={{ marginBottom: 10 }}>
            {filas.length} entrada{filas.length === 1 ? "" : "s"}
          </div>
          <button className="boton" style={{ width: "100%", justifyContent: "center" }} onClick={() => void cerrar()}>
            Bloquear
          </button>
        </div>
      </nav>

      <main className="lienzo">
        {almacenDisponible === false && (
          <div className="aviso senal" style={{ marginBottom: 20 }}>
            <span className="glifo">!</span>
            <span>
              Aquí no se puede guardar nada entre sesiones. Al abrir el fichero HTML directamente
              desde el disco, el navegador le da a la página un origen anónimo distinto en cada
              carga, así que lo que se escriba no se vuelve a encontrar. La bóveda funciona con
              normalidad, pero <strong>solo vive en esta pestaña</strong>: descárgala desde{" "}
              <em>El fichero</em> antes de cerrar, o perderás lo que hayas hecho.
            </span>
          </div>
        )}
        <div key={vista} className="aparece">
          {vista === "entradas" && (
            <VistaEntradas filas={filas} alCambiar={(f, b) => void actualizar(f, b)} />
          )}
          {vista === "generador" && <VistaGenerador />}
          {vista === "canarios" && (
            <VistaCanarios filas={filas} alCambiar={(f, b) => void actualizar(f, b)} />
          )}
          {vista === "coaccion" && (
            <VistaCoaccion
              passwordActual={password}
              alActualizarFichero={(b) => {
                setFichero(b);
                void guardarLocal(b).then(setAlmacenDisponible);
              }}
            />
          )}
          {vista === "guardianes" && (
            <VistaGuardianes
              passwordActual={password}
              alActualizarFichero={(b) => {
                setFichero(b);
                void guardarLocal(b);
              }}
            />
          )}
          {vista === "filtraciones" && <VistaFiltraciones />}
          {vista === "auditoria" && <VistaAuditoria />}
          {vista === "fichero" && (
            <VistaFichero
              resumen={resumen}
              fichero={fichero}
              alDescargar={() => fichero && descargar(fichero)}
              alOlvidar={() => void olvidarLocal().then(() => setGuardado(null))}
            />
          )}
        </div>
      </main>
    </div>
  );
}
