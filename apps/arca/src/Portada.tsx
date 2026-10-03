import { useEffect, useRef, useState } from "react";
import { arca } from "./puente.ts";
import type { Biblioteca, Fuerza, PerfilArgon2 } from "./tipos.ts";
import { Marca } from "./Marca.tsx";

/** Qué cuesta cada perfil de derivación, dicho en la unidad que entiende quien espera. */
const PERFILES: Record<PerfilArgon2, { titulo: string; coste: string }> = {
  interactive: { titulo: "Rápido", coste: "64 MiB · ~2 s" },
  moderate: { titulo: "Recomendado", coste: "256 MiB · ~10 s" },
  paranoid: { titulo: "Máxima protección", coste: "512 MiB · ~25 s" },
};

function colorFuerza(bits: number): string {
  if (bits >= 90) return "var(--acento)";
  if (bits >= 60) return "var(--aviso)";
  return "var(--alarma)";
}

export function MedidorFuerza({ password }: { readonly password: string }) {
  const [fuerza, setFuerza] = useState<Fuerza | null>(null);

  useEffect(() => {
    if (password.length === 0) {
      setFuerza(null);
      return;
    }
    let vigente = true;
    void arca.evaluar(password).then(({ fuerza: f }) => {
      if (vigente) setFuerza(f);
    });
    return () => {
      vigente = false;
    };
  }, [password]);

  if (!fuerza) return null;
  return (
    <div className="fuerza" aria-live="polite">
      <div className="medidor">
        <span style={{ width: `${Math.min(100, (fuerza.bits / 128) * 100)}%`, background: colorFuerza(fuerza.bits) }} />
      </div>
      <div className="dato">
        {fuerza.bits} bits · {fuerza.veredicto}
      </div>
      {fuerza.avisos.slice(0, 2).map((aviso) => (
        <div key={aviso} className="dato" style={{ color: "var(--aviso)" }}>
          {aviso}
        </div>
      ))}
    </div>
  );
}

export function Portada({
  existe,
  mensaje,
  alEntrar,
  alCambiarExistencia,
}: {
  readonly existe: boolean;
  readonly mensaje: string | null;
  readonly alEntrar: (biblioteca: Biblioteca) => void;
  readonly alCambiarExistencia: (existe: boolean, mensaje?: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [perfil, setPerfil] = useState<PerfilArgon2>("moderate");
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [olvido, setOlvido] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [copia, setCopia] = useState<File | null>(null);
  const entradaCopia = useRef<HTMLInputElement>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setFallo(null);
    if (!existe && password !== repetida) {
      setFallo("Las contraseñas no coinciden.");
      return;
    }
    setTrabajando(
      existe
        ? "Derivando la clave. Es lo que le cuesta a cualquiera que te robe los datos cada intento de adivinar tu contraseña."
        : "Creando la caja…",
    );
    try {
      const biblioteca = existe ? await arca.abrir(password) : await arca.crear(password, perfil);
      setPassword("");
      setRepetida("");
      alEntrar(biblioteca);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(null);
    }
  }

  function elegirCopia(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegida = evento.target.files?.[0];
    evento.target.value = "";
    if (!elegida) return;
    setFallo(null);
    if (existe) setCopia(elegida);
    else void restaurar(elegida);
  }

  async function restaurar(archivo: File) {
    setCopia(null);
    setFallo(null);
    setTrabajando("Comprobando y restaurando la copia…");
    try {
      const { documentos } = await arca.restaurar(archivo);
      setTrabajando(null);
      alCambiarExistencia(
        true,
        `Copia restaurada (${documentos} documento${documentos === 1 ? "" : "s"}). Desbloquéala con la contraseña de esa copia.`,
      );
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(null);
    }
  }

  async function borrarTodo() {
    setTrabajando("Borrando…");
    try {
      await arca.borrarTodo();
      setOlvido(false);
      setConfirmacion("");
      setTrabajando(null);
      alCambiarExistencia(false, "Caja borrada de este navegador. Puedes crear una nueva.");
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(null);
    }
  }

  return (
    <main className="portada">
      <div className="portada-caja">
        <Marca grande />
        <p className="lema">Tus documentos, cifrados en este dispositivo. Nadie más que tú puede abrirlos.</p>

        {mensaje && <div className="aviso exito">{mensaje}</div>}

        {trabajando ? (
          <div className="derivando" role="status">
            <div className="barra-espera">
              <span />
            </div>
            <p>{trabajando}</p>
          </div>
        ) : copia ? (
          <div className="panel">
            <h2>¿Reemplazar la caja de este navegador?</h2>
            <p className="texto">
              Restaurar «{copia.name}» <strong>sustituye</strong> la caja que hay ahora. Si no tienes una copia de
              la actual, sus documentos se perderán.
            </p>
            <div className="acciones">
              <button className="boton peligro" onClick={() => void restaurar(copia)}>
                Sí, reemplazar
              </button>
              <button className="boton" onClick={() => setCopia(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} className="panel">
            <h2>{existe ? "Desbloquear" : "Crea tu caja"}</h2>

            <label className="campo">
              <span className="etiqueta">{existe ? "Contraseña" : "Elige una contraseña"}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete={existe ? "current-password" : "new-password"}
                placeholder={existe ? "" : "una frase larga que recuerdes"}
              />
            </label>

            {!existe && (
              <>
                <label className="campo">
                  <span className="etiqueta">Repítela</span>
                  <input
                    type="password"
                    value={repetida}
                    onChange={(e) => setRepetida(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <MedidorFuerza password={password} />
                <label className="campo">
                  <span className="etiqueta">Protección frente a quien te robe los datos</span>
                  <select value={perfil} onChange={(e) => setPerfil(e.target.value as PerfilArgon2)}>
                    {Object.entries(PERFILES).map(([clave, { titulo, coste }]) => (
                      <option key={clave} value={clave}>
                        {titulo} — {coste}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {fallo && <div className="aviso alarma">{fallo}</div>}

            <button type="submit" className="boton principal ancho" disabled={password.length === 0}>
              {existe ? "Desbloquear" : "Crear caja"}
            </button>

            {!existe && (
              <p className="texto pequeno">
                No hay recuperación por correo ni empresa que guarde una copia de tu clave. Si pierdes esta
                contraseña y no tienes una copia de seguridad, los documentos se pierden. Es el precio de que nadie
                más pueda abrirlos.
              </p>
            )}
          </form>
        )}

        {!trabajando && !copia && (
          <div className="pie-portada">
            <button className="enlace" onClick={() => entradaCopia.current?.click()}>
              Restaurar desde una copia…
            </button>
            {existe && (
              <button className="enlace" onClick={() => setOlvido(!olvido)} aria-expanded={olvido}>
                He olvidado la contraseña
              </button>
            )}
            <input
              ref={entradaCopia}
              type="file"
              accept=".arca,application/octet-stream"
              onChange={elegirCopia}
              style={{ display: "none" }}
            />
          </div>
        )}

        {olvido && !trabajando && !copia && (
          <div className="panel">
            <h2>Sin la contraseña no hay forma de abrirla</h2>
            <p className="texto">
              Es así a propósito: nadie puede abrir tu caja sin ella, tampoco nosotros. Tienes dos salidas:
            </p>
            <ul className="texto lista">
              <li>
                Si tienes una <strong>copia de seguridad</strong> y recuerdas la contraseña que tenía, restáurala
                con el enlace de arriba.
              </li>
              <li>
                Si no, solo queda <strong>borrar la caja de este navegador y empezar de cero</strong>. Los
                documentos que contiene se pierden.
              </li>
            </ul>
            <label className="campo">
              <span className="etiqueta">Escribe BORRAR para confirmar</span>
              <input
                type="text"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              className="boton peligro"
              disabled={confirmacion.trim().toUpperCase() !== "BORRAR"}
              onClick={() => void borrarTodo()}
            >
              Borrar la caja y empezar de cero
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
