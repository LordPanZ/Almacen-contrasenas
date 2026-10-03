import { useEffect, useRef, useState } from "react";
import { CombinarCopia } from "./CombinarCopia.tsx";
import { descargarBytes, formatearBytes } from "./formato.ts";
import { MedidorFuerza } from "./Portada.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca, Uso } from "./tipos.ts";

export function Ajustes({
  biblioteca,
  minutos,
  alCambiarMinutos,
  alBloquear,
  alBorrado,
  alCambiarBiblioteca,
}: {
  readonly biblioteca: Biblioteca;
  readonly minutos: number;
  readonly alCambiarMinutos: (minutos: number) => void;
  readonly alBloquear: (aviso: string) => void;
  readonly alBorrado: () => void;
  readonly alCambiarBiblioteca: (biblioteca: Biblioteca) => void;
}) {
  const [uso, setUso] = useState<Uso | null>(null);
  const [protegido, setProtegido] = useState<boolean | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [nota, setNota] = useState<{ tipo: "exito" | "alarma"; texto: string } | null>(null);
  const [copia, setCopia] = useState<File | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [combinando, setCombinando] = useState(false);
  const entradaCopia = useRef<HTMLInputElement>(null);

  async function medir() {
    try {
      setUso(await arca.uso());
    } catch {
      setUso(null);
    }
  }

  useEffect(() => {
    void medir();
    void navigator.storage?.persisted?.().then(setProtegido, () => setProtegido(null));
  }, [biblioteca.documentos.length]);

  async function accion<T>(texto: string, fn: () => Promise<T>, listo?: (r: T) => string) {
    setTrabajando(texto);
    setNota(null);
    try {
      const r = await fn();
      if (listo) setNota({ tipo: "exito", texto: listo(r) });
      return r;
    } catch (error) {
      setNota({ tipo: "alarma", texto: error instanceof Error ? error.message : String(error) });
      return undefined;
    } finally {
      setTrabajando(null);
    }
  }

  const exportar = () =>
    accion(
      "Preparando la copia…",
      async () => {
        const { archivo, nombre, documentos } = await arca.exportar();
        descargarBytes(archivo, nombre, "application/octet-stream");
        return documentos;
      },
      (n) =>
        `Copia con ${n} documento${n === 1 ? "" : "s"} descargada. Va cifrada: sin tu contraseña no se puede leer. Guárdala fuera de este dispositivo.`,
    );

  async function restaurar(archivo: File) {
    setCopia(null);
    const hecho = await accion("Comprobando y restaurando la copia…", () => arca.restaurar(archivo));
    if (hecho) {
      alBloquear(
        `Copia restaurada (${hecho.documentos} documento${hecho.documentos === 1 ? "" : "s"}). Desbloquéala con la contraseña de esa copia.`,
      );
    }
  }

  async function cambiarPassword(evento: React.FormEvent) {
    evento.preventDefault();
    if (nueva !== repetida) {
      setNota({ tipo: "alarma", texto: "Las contraseñas nuevas no coinciden." });
      return;
    }
    const hecho = await accion(
      "Cambiando la contraseña. Argon2 se paga dos veces —comprobar la actual y derivar la nueva—, así que tarda…",
      () => arca.cambiarPassword(actual, nueva),
      () => "Contraseña cambiada. Los documentos no se han tocado; desde ahora se abre con la nueva.",
    );
    if (hecho) {
      setActual("");
      setNueva("");
      setRepetida("");
    }
  }

  const pideProteccion = () =>
    accion(
      "Pidiendo protección…",
      async () => {
        const concedida = (await navigator.storage?.persist?.()) ?? false;
        setProtegido(concedida);
        return concedida;
      },
      (c) =>
        c
          ? "Hecho: el navegador no borrará estos datos por su cuenta."
          : "El navegador no lo concedió. Hazle copias de seguridad con frecuencia.",
    );

  return (
    <div className="ajustes">
      {nota && <div className={`aviso ${nota.tipo}`}>{nota.texto}</div>}
      {trabajando && (
        <div className="derivando" role="status">
          <div className="barra-espera">
            <span />
          </div>
          <p>{trabajando}</p>
        </div>
      )}

      <section className="panel">
        <h2>Esta caja</h2>
        <dl className="datos">
          <dt>Documentos</dt>
          <dd>{uso ? uso.documentos : "—"}</dd>
          <dt>Tamaño original</dt>
          <dd>{uso ? formatearBytes(uso.bytesOriginales) : "—"}</dd>
          <dt>Ocupa en el navegador</dt>
          <dd>{uso ? `${formatearBytes(uso.bytesEnNavegador)} (cifrado y con relleno)` : "—"}</dd>
          <dt>Protección del navegador</dt>
          <dd>
            {protegido === null
              ? "—"
              : protegido
                ? "No los borrará por su cuenta"
                : "Podría borrarlos si falta espacio"}
          </dd>
        </dl>
        {protegido === false && (
          <button className="boton" disabled={trabajando !== null} onClick={() => void pideProteccion()}>
            Pedir protección al navegador
          </button>
        )}
        {uso && uso.huerfanos > 0 && (
          <div className="aviso aviso-suave">
            Hay {uso.huerfanos} criptograma{uso.huerfanos === 1 ? "" : "s"} ({formatearBytes(uso.bytesHuerfanos)}) que
            ningún documento de la lista usa. Suele ser el resto de una operación interrumpida.
            <div className="acciones" style={{ marginTop: 10 }}>
              <button
                className="boton"
                disabled={trabajando !== null}
                onClick={() =>
                  void accion("Liberando espacio…", arca.liberar, () => "Espacio liberado.").then(() => medir())
                }
              >
                Liberar espacio
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Copia de seguridad</h2>
        <p className="texto">
          Los documentos viven solo en este navegador. Si lo limpias, cambias de móvil o se pierde, desaparecen. La
          copia es <strong>un solo fichero</strong> con toda la caja, cifrado: solo se abre con tu contraseña.
        </p>
        {copia ? (
          <>
            <p className="texto">
              Restaurar «{copia.name}» <strong>sustituye</strong> la caja de este navegador. Haz antes una copia de
              la actual si la necesitas.
            </p>
            <div className="acciones">
              <button className="boton peligro" disabled={trabajando !== null} onClick={() => void restaurar(copia)}>
                Sí, reemplazar
              </button>
              <button className="boton" onClick={() => setCopia(null)}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <div className="acciones">
            <button className="boton principal" disabled={trabajando !== null} onClick={() => void exportar()}>
              Descargar copia
            </button>
            <button className="boton" disabled={trabajando !== null} onClick={() => entradaCopia.current?.click()}>
              Restaurar una copia…
            </button>
            <input
              ref={entradaCopia}
              type="file"
              accept=".arca,application/octet-stream"
              onChange={(e) => {
                const elegida = e.target.files?.[0];
                e.target.value = "";
                if (elegida) setCopia(elegida);
              }}
              style={{ display: "none" }}
            />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Varios dispositivos o varias personas</h2>
        <p className="texto">
          Esta caja vive <strong>solo en este navegador</strong>: no hay servidor que la lleve a otro sitio. Para tener
          la misma caja en el móvil de tu pareja o en el ordenador de casa:
        </p>
        <ol className="lista pasos">
          <li>
            <strong>Aquí:</strong> pulsa «Descargar copia» y lleva el fichero <code>.arca</code> al otro dispositivo
            (WhatsApp, correo, un USB…). Va cifrado: sin la contraseña no se abre.
          </li>
          <li>
            <strong>En el otro:</strong> abre Arca en la misma dirección, elige «Restaurar desde una copia…» y
            selecciona el fichero.
          </li>
          <li>
            Desbloquéala con <strong>la misma contraseña</strong>. Díasela en persona, no junto al fichero.
          </li>
        </ol>
        <p className="texto pequeno">
          <strong>Después, cada copia cambia por su lado.</strong> Para ponerlas al día sin pisar nada, descarga una
          copia en un dispositivo y combínala en el otro: suma lo nuevo y no borra nada.
        </p>
        <button className="boton" disabled={trabajando !== null} onClick={() => setCombinando(true)}>
          Combinar con otra copia…
        </button>
        <p className="texto pequeno">
          <strong>Si es un ordenador compartido:</strong> usa un usuario o un perfil de navegador solo para ti, no dejes
          la caja abierta y borra de «Descargas» lo que descargues: un documento descargado queda sin cifrar en el disco.
        </p>
      </section>

      <form className="panel" onSubmit={cambiarPassword}>
        <h2>Cambiar la contraseña</h2>
        <p className="texto pequeno">
          Los documentos no se recifran: solo se reenvuelve la clave que los protege. Las copias anteriores seguirán
          abriéndose con la contraseña que tenían cuando se hicieron.
        </p>
        <label className="campo">
          <span className="etiqueta">Contraseña actual</span>
          <input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="campo">
          <span className="etiqueta">Contraseña nueva</span>
          <input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" />
        </label>
        <MedidorFuerza password={nueva} />
        <label className="campo">
          <span className="etiqueta">Repite la nueva</span>
          <input type="password" value={repetida} onChange={(e) => setRepetida(e.target.value)} autoComplete="new-password" />
        </label>
        <button
          type="submit"
          className="boton"
          disabled={trabajando !== null || actual === "" || nueva === "" || repetida === ""}
        >
          Cambiar contraseña
        </button>
      </form>

      <section className="panel">
        <h2>Bloqueo automático</h2>
        <label className="campo">
          <span className="etiqueta">Bloquear tras</span>
          <select value={minutos} onChange={(e) => alCambiarMinutos(Number(e.target.value))}>
            {[1, 5, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} minuto{m === 1 ? "" : "s"} sin actividad
              </option>
            ))}
          </select>
        </label>
        <p className="texto pequeno">
          Un documento de identidad abierto en un móvil que se queda sobre la mesa es justo el caso. Al bloquear se
          borran las claves de la memoria.
        </p>
      </section>

      <section className="panel peligro-zona">
        <h2>Borrar todo en este navegador</h2>
        <p className="texto pequeno">
          Elimina la caja y todos sus documentos de este dispositivo. No se puede deshacer; solo una copia de
          seguridad lo devuelve.
        </p>
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
          disabled={trabajando !== null || confirmacion.trim().toUpperCase() !== "BORRAR"}
          onClick={() => {
            void accion("Borrando…", arca.borrarTodo).then((hecho) => {
              if (hecho) alBorrado();
            });
          }}
        >
          Borrar la caja y sus documentos
        </button>
      </section>

      <button className="boton ancho" onClick={() => alBloquear("Caja bloqueada.")}>
        Bloquear ahora
      </button>

      {combinando && <CombinarCopia alCambiar={alCambiarBiblioteca} alCerrar={() => setCombinando(false)} />}
    </div>
  );
}
