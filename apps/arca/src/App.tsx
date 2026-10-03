import { useCallback, useEffect, useRef, useState } from "react";
import { Ajustes } from "./Ajustes.tsx";
import { Biblioteca as VistaBiblioteca } from "./Biblioteca.tsx";
import { Marca } from "./Marca.tsx";
import { Portada } from "./Portada.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca } from "./tipos.ts";

type Vista = "documentos" | "caja";

const CLAVE_MINUTOS = "arca.minutos";
const MINUTOS_POR_DEFECTO = 5;

function leerMinutos(): number {
  try {
    const guardado = Number(localStorage.getItem(CLAVE_MINUTOS));
    return [1, 5, 15, 30].includes(guardado) ? guardado : MINUTOS_POR_DEFECTO;
  } catch {
    return MINUTOS_POR_DEFECTO;
  }
}

export function App() {
  const [fase, setFase] = useState<"cargando" | "portada" | "dentro">("cargando");
  const [existe, setExiste] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [biblioteca, setBiblioteca] = useState<Biblioteca | null>(null);
  const [vista, setVista] = useState<Vista>("documentos");
  const [minutos, setMinutos] = useState(leerMinutos);
  const ultimaActividad = useRef(Date.now());

  useEffect(() => {
    void arca.estado().then(async (estado) => {
      setExiste(estado.existe);
      if (estado.abierta) {
        // Recarga en caliente en desarrollo: el trabajador sigue con la caja abierta.
        setBiblioteca(await arca.listar());
        setFase("dentro");
      } else {
        setFase("portada");
      }
    });
  }, []);

  const bloquear = useCallback(async (aviso?: string) => {
    await arca.cerrar();
    setBiblioteca(null);
    setMensaje(aviso ?? null);
    setExiste(true);
    setFase("portada");
  }, []);

  // Bloqueo por inactividad. Un documento de identidad abierto en un móvil que
  // se queda sobre la mesa es justo el caso. Se mide con marcas de tiempo y no
  // con un temporizador único porque los navegadores congelan los de las pestañas
  // en segundo plano: al volver, lo que cuenta es cuánto pasó de verdad.
  useEffect(() => {
    if (fase !== "dentro") return;
    const tocar = () => {
      ultimaActividad.current = Date.now();
    };
    const comprobar = () => {
      if (Date.now() - ultimaActividad.current > minutos * 60_000) {
        void bloquear(`Caja bloqueada tras ${minutos} min sin actividad.`);
      }
    };
    const eventos = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of eventos) window.addEventListener(e, tocar, { passive: true });
    document.addEventListener("visibilitychange", comprobar);
    const reloj = setInterval(comprobar, 10_000);
    tocar();
    return () => {
      for (const e of eventos) window.removeEventListener(e, tocar);
      document.removeEventListener("visibilitychange", comprobar);
      clearInterval(reloj);
    };
  }, [fase, minutos, bloquear]);

  function cambiarMinutos(nuevos: number) {
    setMinutos(nuevos);
    try {
      localStorage.setItem(CLAVE_MINUTOS, String(nuevos));
    } catch {
      /* sin almacenamiento: vale solo para esta sesión */
    }
  }

  function alEntrar(nueva: Biblioteca) {
    setMensaje(null);
    // Se entra siempre por la lista de documentos, también tras borrar la caja o
    // restaurar una copia desde la pestaña «Caja»: no hay que heredar la anterior.
    setVista("documentos");
    setBiblioteca(nueva);
    setExiste(true);
    setFase("dentro");
    // Pide al navegador que no expulse los datos del sitio cuando falte espacio:
    // sin esto, un móvil justo de memoria puede borrar la caja sin preguntar.
    void navigator.storage?.persist?.().catch(() => undefined);
  }

  if (location.protocol === "file:") {
    return (
      <main className="portada">
        <div className="portada-caja">
          <Marca grande />
          <div className="panel">
            <h2>Ábrela desde su dirección web</h2>
            <p className="texto">
              Abierta como fichero del disco, el navegador no guarda datos entre sesiones y los documentos se
              perderían al cerrar la pestaña. Arca solo funciona desde una dirección https.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (fase === "cargando") {
    return (
      <main className="portada">
        <div className="etiqueta">Cargando…</div>
      </main>
    );
  }

  if (fase === "portada" || !biblioteca) {
    return (
      <Portada
        existe={existe}
        mensaje={mensaje}
        alEntrar={alEntrar}
        alCambiarExistencia={(nuevo, aviso) => {
          setExiste(nuevo);
          setMensaje(aviso ?? null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="barra">
        <Marca />
        <button className="boton chico" onClick={() => void bloquear()}>
          Bloquear
        </button>
      </header>

      <nav className="pestanas" aria-label="Secciones">
        {(
          [
            ["documentos", `Documentos · ${biblioteca.documentos.length}`],
            ["caja", "Caja"],
          ] as const
        ).map(([id, nombre]) => (
          <button key={id} aria-current={vista === id} onClick={() => setVista(id)}>
            {nombre}
          </button>
        ))}
      </nav>

      <main className="contenido">
        {vista === "documentos" ? (
          <VistaBiblioteca biblioteca={biblioteca} alCambiar={setBiblioteca} />
        ) : (
          <Ajustes
            biblioteca={biblioteca}
            minutos={minutos}
            alCambiarMinutos={cambiarMinutos}
            alBloquear={(aviso) => void bloquear(aviso)}
            alCambiarBiblioteca={setBiblioteca}
            alBorrado={() => {
              setBiblioteca(null);
              setExiste(false);
              setMensaje("Caja borrada de este navegador. Puedes crear una nueva.");
              setFase("portada");
            }}
          />
        )}
      </main>
    </div>
  );
}
