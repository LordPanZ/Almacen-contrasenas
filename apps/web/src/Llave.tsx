import { useEffect, useState } from "react";
import { LlaveError, factorATexto, obtenerFactor, registrarLlave, soportaLlave } from "./llave.ts";
import { nucleo } from "./nucleo.ts";

/**
 * Vincular una llave de seguridad a la bóveda.
 *
 * El flujo tiene un paso que no se puede saltar: enseñar el código de
 * recuperación y exigir que el usuario confirme haberlo guardado antes de
 * activar nada. Sin la llave y sin ese código, la bóveda se pierde para
 * siempre, y una función pensada para aumentar la seguridad no puede ser la
 * causa de perderlo todo.
 */
export function VistaLlave({
  passwordActual,
  alActualizarFichero,
}: {
  readonly passwordActual: string;
  readonly alActualizarFichero: (fichero: Uint8Array) => void;
}) {
  const [vinculada, setVinculada] = useState<boolean | null>(null);
  const [paso, setPaso] = useState<"reposo" | "codigo">("reposo");
  const [factorNuevo, setFactorNuevo] = useState<Uint8Array | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);

  useEffect(() => {
    void nucleo.estadoLlave().then((e) => setVinculada(e.vinculada));
  }, []);

  function contar(error: unknown) {
    setFallo(error instanceof LlaveError || error instanceof Error ? error.message : String(error));
  }

  /** Paso 1: dar de alta la credencial y obtener el factor, sin activarlo aún. */
  async function registrar() {
    setTrabajando(true);
    setFallo(null);
    setNota(null);
    try {
      const { sal } = await nucleo.salLlave();
      const factor = await registrarLlave(sal);
      setFactorNuevo(factor);
      setPaso("codigo");
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(false);
    }
  }

  /** Paso 2: ya con el código a la vista y confirmado, resellar la ranura. */
  async function activar() {
    if (!factorNuevo) return;
    setTrabajando(true);
    setFallo(null);
    try {
      const { fichero, vinculada: ahora } = await nucleo.vincularLlave(passwordActual, factorNuevo);
      alActualizarFichero(fichero);
      setVinculada(ahora);
      setPaso("reposo");
      setFactorNuevo(null);
      setGuardado(false);
      setNota("Llave vinculada. Desde ahora la contraseña sola no abre esta bóveda.");
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(false);
    }
  }

  /** Quitarla exige demostrar que la tienes: si no, cualquiera la desactivaría. */
  async function desvincular() {
    setTrabajando(true);
    setFallo(null);
    setNota(null);
    try {
      const { sal } = await nucleo.salLlave();
      await obtenerFactor(sal);
      const { fichero, vinculada: ahora } = await nucleo.vincularLlave(passwordActual, null);
      alActualizarFichero(fichero);
      setVinculada(ahora);
      setNota("Llave desvinculada. La bóveda vuelve a abrirse solo con la contraseña.");
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <div className="cabecera-vista">
        <h1>Llave de seguridad</h1>
        <p className="prosa">
          Un segundo factor que no se puede copiar. El secreto vive dentro del chip seguro del
          dispositivo —Secure Enclave, o el TEE del móvil— y <strong>nunca sale de él</strong>: la
          llave se limita a responder a una pregunta concreta de esta bóveda. Con ella vinculada,
          quien te robe el fichero <strong>no lo abre ni sabiendo tu contraseña</strong>.
        </p>
      </div>

      {!soportaLlave() && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>
            Este navegador no puede usar llaves de seguridad. Hace falta una conexión segura
            (https) y un navegador actual; abriendo el fichero directamente desde el disco no
            funciona.
          </span>
        </div>
      )}

      {fallo && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>{fallo}</span>
        </div>
      )}
      {nota && (
        <div className="aviso jade">
          <span className="glifo">✓</span>
          <span>{nota}</span>
        </div>
      )}

      {paso === "codigo" && factorNuevo ? (
        <div className="panel">
          <div className="panel-titulo">
            <h2 style={{ fontSize: 17 }}>Apunta esto antes de continuar</h2>
          </div>
          <p className="prosa" style={{ fontSize: 14.5, marginBottom: 14 }}>
            Al vincular, Cerbero vuelve a derivar la clave dos veces con Argon2 —una para comprobar
            que la contraseña es la correcta y otra para resellar la ranura—, así que tardará unos
            segundos. Esa comprobación es lo que impide que un despiste te deje fuera de tu bóveda.
          </p>
          <p className="prosa" style={{ fontSize: 14.5, marginBottom: 14 }}>
            Este es tu <strong>código de recuperación</strong>. Es la única forma de abrir la bóveda
            si pierdes el dispositivo o la llave deja de funcionar. Cópialo a mano en papel y
            guárdalo lejos del ordenador: quien lo tenga junto a tu contraseña puede abrir la
            bóveda, así que no lo guardes en el propio ordenador ni en la nube.
          </p>
          <div className="secreto-valor" style={{ marginBottom: 14, lineHeight: 1.9 }}>
            {factorATexto(factorNuevo)}
          </div>
          <label
            className="barra-acciones"
            style={{ marginBottom: 16, cursor: "pointer", flexWrap: "nowrap" }}
          >
            <input
              type="checkbox"
              checked={guardado}
              onChange={(e) => setGuardado(e.target.checked)}
              style={{ width: 18, height: 18, flexShrink: 0 }}
            />
            <span>Lo he copiado y guardado en un sitio seguro</span>
          </label>
          <div className="barra-acciones">
            <button
              className="boton principal"
              disabled={!guardado || trabajando}
              onClick={() => void activar()}
            >
              {trabajando ? "Vinculando… (tarda un poco)" : "Vincular la llave"}
            </button>
            <button
              className="boton"
              disabled={trabajando}
              onClick={() => {
                setPaso("reposo");
                setFactorNuevo(null);
                setGuardado(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-titulo">
            <h2 style={{ fontSize: 17 }}>Estado</h2>
            <span className={`distintivo ${vinculada ? "jade" : "neutro"}`}>
              {vinculada === null ? "…" : vinculada ? "vinculada" : "sin llave"}
            </span>
          </div>

          {vinculada ? (
            <>
              <p className="prosa" style={{ fontSize: 14.5, marginBottom: 16 }}>
                Esta bóveda exige la llave además de la contraseña. Al desbloquear desde otro
                dispositivo, primero fallará con la contraseña sola y entonces te ofrecerá usar la
                llave o el código de recuperación.
              </p>
              <button className="boton peligro" disabled={trabajando} onClick={() => void desvincular()}>
                {trabajando ? "Comprobando la llave…" : "Desvincular la llave"}
              </button>
            </>
          ) : (
            <>
              <p className="prosa" style={{ fontSize: 14.5, marginBottom: 16 }}>
                Ahora mismo basta con la contraseña. Vincular una llave añade un factor que no viaja
                con el fichero y que no se puede copiar ni adivinar.
              </p>
              <button
                className="boton principal"
                disabled={trabajando || !soportaLlave()}
                onClick={() => void registrar()}
              >
                {trabajando ? "Esperando a la llave…" : "Vincular una llave"}
              </button>
            </>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-titulo">
          <h2 style={{ fontSize: 17 }}>Qué cambia en el fichero</h2>
        </div>
        <p className="prosa" style={{ fontSize: 14.5 }}>
          <strong>Nada visible.</strong> La llave no se guarda ni se menciona: el fichero mantiene
          exactamente el mismo formato y el mismo tamaño, y no contiene ningún indicio de que haga
          falta. Lo único que cambia es la clave con la que se sella tu ranura, y las demás quedan
          byte a byte idénticas. Quien robe el fichero no puede saber si le falta una llave o si
          simplemente no acierta la contraseña, que es justo lo que sostiene la negación plausible
          del resto del diseño.
        </p>
      </div>
    </>
  );
}
