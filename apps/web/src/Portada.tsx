import { useEffect, useRef, useState } from "react";
import { nucleo, type InfoFichero, type ResumenBoveda } from "./nucleo.ts";

interface Props {
  readonly ficheroGuardado: Uint8Array | null;
  readonly alAbrir: (resumen: ResumenBoveda, fichero: Uint8Array, password: string) => void;
}

type Modo = "abrir" | "crear";

/** Descripción legible del coste de Argon2, para enseñar qué se está pagando. */
const PERFILES: Record<string, { titulo: string; coste: string }> = {
  interactive: { titulo: "Interactivo", coste: "64 MiB · ~2 s" },
  moderate: { titulo: "Moderado", coste: "256 MiB · ~10 s" },
  paranoid: { titulo: "Paranoico", coste: "512 MiB · ~25 s" },
};

export function Portada({ ficheroGuardado, alAbrir }: Props) {
  const [modo, setModo] = useState<Modo>(ficheroGuardado ? "abrir" : "crear");
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [perfil, setPerfil] = useState("moderate");
  const [fichero, setFichero] = useState<Uint8Array | null>(ficheroGuardado);
  const [nombreFichero, setNombreFichero] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoFichero | null>(null);
  const [fuerza, setFuerza] = useState<{ bits: number; veredicto: string; avisos: readonly string[] } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const entradaFichero = useRef<HTMLInputElement>(null);

  /**
   * Se revisa el fichero nada más elegirlo, y se dice en voz alta si no vale.
   *
   * Antes el fallo se tragaba aquí y el rótulo seguía diciendo «cargado», así
   * que el único aviso llegaba tras escribir la contraseña y pulsar
   * desbloquear. En el móvil el selector de ficheros ignora a menudo el
   * `accept`, de modo que elegir el fichero equivocado —el propio cerbero.html,
   * sin ir más lejos— es fácil, y el usuario se quedaba mirando un formulario
   * que parecía correcto.
   */
  useEffect(() => {
    if (!fichero) {
      setInfo(null);
      return;
    }
    let vigente = true;
    void nucleo.inspeccionar(fichero).then(
      (inspeccionado) => {
        if (!vigente) return;
        setInfo(inspeccionado);
        setFallo(null);
      },
      () => {
        if (!vigente) return;
        setInfo(null);
        setFallo(
          `${nombreFichero ? `«${nombreFichero}»` : "Ese fichero"} no es una bóveda de Cerbero. ` +
            "El fichero de una bóveda acaba en .cerbero y lo descargas desde «El fichero» con la " +
            "bóveda abierta. Si todavía no tienes ninguna, usa «Crear una nueva».",
        );
      },
    );
    return () => {
      vigente = false;
    };
  }, [fichero, nombreFichero]);

  useEffect(() => {
    if (modo !== "crear" || password.length === 0) {
      setFuerza(null);
      return;
    }
    let vigente = true;
    void nucleo.evaluar(password).then(({ fuerza: f }) => {
      if (vigente) setFuerza(f);
    });
    return () => {
      vigente = false;
    };
  }, [password, modo]);

  async function importar(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0];
    if (!elegido) return;
    setNombreFichero(elegido.name);
    setFichero(new Uint8Array(await elegido.arrayBuffer()));
    setModo("abrir");
    setFallo(null);
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setFallo(null);

    if (modo === "crear" && password !== repetida) {
      setFallo("Las contraseñas no coinciden.");
      return;
    }
    if (modo === "abrir" && !fichero) {
      setFallo("Elige primero un fichero de bóveda.");
      return;
    }

    setTrabajando(true);
    try {
      if (modo === "crear") {
        const { resumen, fichero: nuevo } = await nucleo.crear(password, perfil, 4);
        alAbrir(resumen, nuevo, password);
      } else {
        const { resumen } = await nucleo.abrir(fichero as Uint8Array, password);
        alAbrir(resumen, fichero as Uint8Array, password);
      }
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(false);
    }
  }

  const costeActual = PERFILES[modo === "crear" ? perfil : "moderate"];

  return (
    <div className="portada">
      <div className="portada-caja">
        <div className="aparece" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="portada-marca">Cerbero</div>
          <p className="portada-lema">
            El servidor nunca puede abrir tu bóveda, y tú puedes demostrarlo.
          </p>
        </div>

        {/* La tira de ranuras: todas idénticas, porque así es el fichero. */}
        <div className="aparece" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="tira" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ranura" style={{ "--i": i } as React.CSSProperties} />
            ))}
          </div>
          <p className="etiqueta" style={{ marginBottom: 26 }}>
            Cuatro ranuras · ninguna revela si contiene una bóveda
          </p>
        </div>

        {trabajando ? (
          <div className="derivando aparece">
            <div className="etiqueta">Derivando la clave maestra</div>
            <div className="derivando-barra">
              <span />
            </div>
            <p className="prosa" style={{ fontSize: 14 }}>
              Argon2id está ocupando <strong>{costeActual?.coste}</strong> de memoria. Esta espera
              no es lentitud: es exactamente lo que le cuesta a alguien cada intento si te roba el
              fichero e intenta adivinar la contraseña sin conexión.
            </p>
          </div>
        ) : (
          <form onSubmit={enviar} className="aparece" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="barra-acciones" style={{ marginBottom: 20 }}>
              <button
                type="button"
                className="boton"
                aria-pressed={modo === "abrir"}
                style={modo === "abrir" ? { borderColor: "var(--senal)" } : undefined}
                onClick={() => setModo("abrir")}
              >
                Abrir bóveda
              </button>
              <button
                type="button"
                className="boton"
                aria-pressed={modo === "crear"}
                style={modo === "crear" ? { borderColor: "var(--senal)" } : undefined}
                onClick={() => setModo("crear")}
              >
                Crear una nueva
              </button>
            </div>

            {/*
              Los dos botones se parecen demasiado para quien llega por primera
              vez, y el que no necesita —abrir— es el que pide un fichero: se
              queda atascado buscando qué elegir cuando lo que le toca es crear.
            */}
            {!ficheroGuardado && (
              <p className="prosa" style={{ fontSize: 13.5, marginBottom: 20 }}>
                {modo === "abrir" ? (
                  <>
                    <strong>Abrir</strong> es para un fichero <em>.cerbero</em> que ya tengas. Si es
                    tu primera vez aquí, lo que necesitas es <strong>Crear una nueva</strong>.
                  </>
                ) : (
                  <>
                    Elige una contraseña maestra y ya está: la bóveda se queda en este navegador. No
                    hace falta ningún fichero para empezar.
                  </>
                )}
              </p>
            )}

            {modo === "abrir" && (
              <div className="campo">
                <span className="etiqueta">Fichero</span>
                <div className="barra-acciones">
                  <button
                    type="button"
                    className="boton"
                    onClick={() => entradaFichero.current?.click()}
                  >
                    Elegir fichero…
                  </button>
                  <span
                    className="dato"
                    style={{
                      color: fichero && !info ? "var(--alarma)" : "var(--texto-tenue)",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {info
                      ? `${info.ranuras} ranuras · ${(info.bytes / 1024).toFixed(0)} KiB`
                      : fichero
                        ? // Nunca «cargado» a secas: si no se ha podido leer, el
                          // rótulo tiene que delatarlo, no dar por bueno el paso.
                          `${nombreFichero ?? "el fichero"} · no vale`
                        : ficheroGuardado
                          ? "guardado en este navegador"
                          : "ninguno"}
                  </span>
                </div>
                <input
                  ref={entradaFichero}
                  type="file"
                  accept=".cerbero,application/octet-stream"
                  onChange={importar}
                  style={{ display: "none" }}
                />
              </div>
            )}

            <label className="campo">
              <span className="etiqueta">Contraseña maestra</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="off"
                placeholder={modo === "crear" ? "una frase larga que recuerdes" : ""}
              />
            </label>

            {modo === "crear" && (
              <>
                <label className="campo">
                  <span className="etiqueta">Repítela</span>
                  <input
                    type="password"
                    value={repetida}
                    onChange={(e) => setRepetida(e.target.value)}
                    autoComplete="off"
                  />
                </label>

                {fuerza && (
                  <div style={{ marginBottom: 15 }}>
                    <div className="medidor">
                      <span
                        style={{
                          width: `${Math.min(100, (fuerza.bits / 128) * 100)}%`,
                          background:
                            fuerza.bits >= 90
                              ? "var(--jade)"
                              : fuerza.bits >= 60
                                ? "var(--senal)"
                                : "var(--alarma)",
                        }}
                      />
                    </div>
                    <div className="dato" style={{ marginTop: 6, color: "var(--texto-medio)" }}>
                      {fuerza.bits} bits · {fuerza.veredicto}
                    </div>
                    {fuerza.avisos.slice(0, 2).map((texto) => (
                      <div key={texto} className="dato" style={{ color: "var(--senal)", marginTop: 3 }}>
                        {texto}
                      </div>
                    ))}
                  </div>
                )}

                <label className="campo">
                  <span className="etiqueta">Coste de derivación</span>
                  <select value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                    {Object.entries(PERFILES).map(([clave, { titulo, coste }]) => (
                      <option key={clave} value={clave}>
                        {titulo} — {coste}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {fallo && (
              <div className="aviso alarma">
                <span className="glifo">!</span>
                <span>{fallo}</span>
              </div>
            )}

            <button
              type="submit"
              className="boton principal"
              disabled={password.length === 0}
              style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
            >
              {modo === "crear" ? "Crear bóveda" : "Desbloquear"}
            </button>

            {modo === "crear" && (
              <p className="prosa" style={{ fontSize: 13.5, marginTop: 18 }}>
                No hay recuperación por correo ni empresa que guarde una copia de tu clave. Si
                pierdes esta contraseña y no has configurado guardianes, la bóveda se pierde. Es el
                precio de que nadie más pueda abrirla.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
