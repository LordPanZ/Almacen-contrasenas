import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Veredicto } from "./origen.ts";
import "./popup.css";

/** Envía una operación al trabajador de fondo, que es quien tiene la bóveda. */
function pedir<T>(operacion: string, carga: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ operacion, carga }, (respuesta) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const r = respuesta as { ok: boolean; resultado?: T; error?: string };
      if (r.ok) resolve(r.resultado as T);
      else reject(new Error(r.error ?? "fallo desconocido"));
    });
  });
}

interface Candidata {
  readonly id: string;
  readonly titulo: string;
  readonly usuario: string;
  readonly url: string;
  readonly veredicto: Veredicto;
  readonly trampa: boolean;
}

interface Imitacion {
  readonly hostActual: string;
  readonly hostImitado: string;
  readonly descodificado: string;
}

interface Engano {
  readonly hostActual: string;
  readonly hostSuplantado: string;
}

interface Estado {
  readonly tieneBoveda: boolean;
  readonly desbloqueada: boolean;
  readonly entradas: number;
  readonly alarmas: number;
  readonly ajustes: { minutosBloqueo: number; subdominiosPermitidos: string[] };
}

function Popup() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [password, setPassword] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [candidatas, setCandidatas] = useState<Candidata[]>([]);
  const [imitacion, setImitacion] = useState<Imitacion | null>(null);
  const [engano, setEngano] = useState<Engano | null>(null);
  const [host, setHost] = useState("");
  const [tabId, setTabId] = useState<number | null>(null);
  const entradaFichero = useRef<HTMLInputElement>(null);

  async function refrescar() {
    const nuevo = await pedir<Estado>("estado");
    setEstado(nuevo);
    if (!nuevo.desbloqueada) return;

    const [pestana] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!pestana?.url || pestana.id === undefined) return;
    setTabId(pestana.id);
    const datos = await pedir<{
      candidatas: Candidata[];
      imitacion: Imitacion | null;
      engano: Engano | null;
      host: string;
    }>("paraOrigen", { url: pestana.url });
    setCandidatas(datos.candidatas);
    setImitacion(datos.imitacion);
    setEngano(datos.engano);
    setHost(datos.host);
  }

  useEffect(() => {
    void refrescar().catch((e: Error) => setFallo(e.message));
  }, []);

  async function desbloquear(evento: React.FormEvent) {
    evento.preventDefault();
    setTrabajando(true);
    setFallo(null);
    try {
      await pedir("desbloquear", { password });
      setPassword("");
      await refrescar();
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    } finally {
      setTrabajando(false);
    }
  }

  async function importar(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0];
    if (!elegido) return;
    const bytes = new Uint8Array(await elegido.arrayBuffer());
    let base64 = "";
    for (const byte of bytes) base64 += String.fromCharCode(byte);
    // btoa clásico y luego a alfabeto URL-safe, que es el que espera el fondo.
    const urlSafe = btoa(base64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await pedir("importar", { base64: urlSafe });
    await refrescar();
  }

  async function rellenar(candidata: Candidata) {
    if (tabId === null) return;
    setFallo(null);
    setNota(null);
    try {
      const resultado = await pedir<{ relleno: boolean; trampa: boolean }>("rellenar", {
        id: candidata.id,
        tabId,
      });
      if (resultado.trampa) {
        setFallo(
          "Acabas de usar una CREDENCIAL TRAMPA. Si no has sido tú a propósito, alguien tiene acceso a tu bóveda.",
        );
      } else if (resultado.relleno) {
        setNota("Rellenado.");
        setTimeout(() => window.close(), 550);
      } else {
        setFallo("No se encontró ningún formulario de acceso en esta página.");
      }
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    }
  }

  async function copiar(candidata: Candidata) {
    try {
      const { secreto } = await pedir<{ secreto: string }>("copiar", { id: candidata.id });
      await navigator.clipboard.writeText(secreto);
      setNota("Copiado al portapapeles.");
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    }
  }

  async function autorizarSubdominios(candidata: Candidata) {
    await pedir("permitirSubdominios", { id: candidata.id, permitir: true });
    await refrescar();
  }

  if (!estado) {
    return (
      <div className="caja">
        <div className="etiqueta">Cargando…</div>
      </div>
    );
  }

  if (!estado.tieneBoveda) {
    return (
      <div className="caja">
        <Marca />
        <p className="prosa">
          Importa el fichero de tu bóveda. Se guarda cifrado en el almacenamiento de la extensión,
          exactamente igual que en disco: sin clave no lo abre nadie.
        </p>
        <button className="boton principal ancho" onClick={() => entradaFichero.current?.click()}>
          Importar bóveda…
        </button>
        <input
          ref={entradaFichero}
          type="file"
          accept=".cerbero,application/octet-stream"
          onChange={(e) => void importar(e)}
          style={{ display: "none" }}
        />
      </div>
    );
  }

  if (!estado.desbloqueada) {
    return (
      <div className="caja">
        <Marca />
        <form onSubmit={desbloquear}>
          <label className="campo">
            <span className="etiqueta">Contraseña maestra</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </label>
          {trabajando && (
            <div className="derivando">
              <div className="barra">
                <span />
              </div>
              <span className="etiqueta">Derivando con Argon2id…</span>
            </div>
          )}
          {fallo && <div className="aviso alarma">{fallo}</div>}
          <button
            type="submit"
            className="boton principal ancho"
            disabled={trabajando || password.length === 0}
          >
            Desbloquear
          </button>
        </form>
      </div>
    );
  }

  const permitidas = candidatas.filter((c) => c.veredicto.permitido);
  const rechazadas = candidatas.filter((c) => !c.veredicto.permitido);

  return (
    <div className="caja">
      <div className="cabecera">
        <Marca />
        <button className="boton menudo" onClick={() => void pedir("bloquear").then(refrescar)}>
          Bloquear
        </button>
      </div>

      <div className="host">
        <span className="etiqueta">Estás en</span>
        <span className="dato">{host || "—"}</span>
      </div>

      {imitacion && (
        <div className="aviso alarma">
          <strong>Este dominio imita a uno que tienes guardado.</strong> Se lee «
          {imitacion.descodificado}» pero no es <span className="dato">{imitacion.hostImitado}</span>:
          usa caracteres de otro alfabeto que se dibujan igual. No escribas aquí tu contraseña.
        </div>
      )}

      {engano && (
        <div className="aviso alarma">
          <strong>Este dominio no es {engano.hostSuplantado}.</strong> Lo lleva al principio para que
          lo parezca, pero el sitio pertenece a quien registró{" "}
          <span className="dato">{engano.hostActual}</span>. No escribas aquí tu contraseña.
        </div>
      )}

      {estado.alarmas > 0 && (
        <div className="aviso alarma">
          {estado.alarmas} alarma{estado.alarmas === 1 ? "" : "s"} de credencial trampa. Alguien ha
          usado una entrada señuelo.
        </div>
      )}

      {fallo && <div className="aviso alarma">{fallo}</div>}
      {nota && <div className="aviso jade">{nota}</div>}

      {permitidas.length === 0 && rechazadas.length === 0 && (
        <div className="vacio">Ninguna credencial guardada para este sitio.</div>
      )}

      {permitidas.map((candidata) => (
        <div key={candidata.id} className="fila">
          <div className="fila-texto">
            <div className="fila-titulo">
              {candidata.titulo}
              {candidata.trampa && <span className="distintivo senal">trampa</span>}
            </div>
            <div className="dato tenue">{candidata.usuario || "sin usuario"}</div>
          </div>
          <button className="boton menudo" onClick={() => void copiar(candidata)}>
            Copiar
          </button>
          <button className="boton principal menudo" onClick={() => void rellenar(candidata)}>
            Rellenar
          </button>
        </div>
      ))}

      {rechazadas.length > 0 && (
        <>
          <div className="separador etiqueta">No se ofrecen aquí</div>
          {rechazadas.map((candidata) => (
            <div key={candidata.id} className="fila rechazada">
              <div className="fila-texto">
                <div className="fila-titulo">{candidata.titulo}</div>
                <div className="motivo">{candidata.veredicto.explicacion}</div>
              </div>
              {candidata.veredicto.motivo === "subdominio-no-autorizado" && (
                <button className="boton menudo" onClick={() => void autorizarSubdominios(candidata)}>
                  Autorizar
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Marca() {
  return (
    <div className="marca">
      <span className="marca-nombre">Cerbero</span>
    </div>
  );
}

const raiz = document.getElementById("raiz");
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
