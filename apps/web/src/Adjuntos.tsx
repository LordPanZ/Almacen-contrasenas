import { useRef, useState } from "react";
import { esImagen, leerAdjuntos, prepararArchivo, type Adjunto } from "./adjuntos.ts";
import {
  almacenAdjuntos,
  almacenamientoPersistente,
  descargar,
  formatearBytes,
  nucleo,
  type DetalleEntrada,
  type FilaEntrada,
} from "./nucleo.ts";

/**
 * Documentos de una entrada: PDF y fotos (DNI, escrituras…).
 *
 * El contenido va cifrado aparte y la entrada solo guarda su referencia. Esta
 * sección hace de puente: cifra en el trabajador, guarda en el navegador y
 * anota la referencia, en ese orden.
 */
export function Adjuntos({
  item,
  alCambiar,
  alRefrescar,
}: {
  readonly item: DetalleEntrada["item"];
  readonly alCambiar: (filas: FilaEntrada[], fichero: Uint8Array) => void;
  readonly alRefrescar: () => void;
}) {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [visor, setVisor] = useState<{ nombre: string; url: string } | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const entradaFoto = useRef<HTMLInputElement>(null);

  const adjuntos = leerAdjuntos(item.custom);
  const disponible = almacenamientoPersistente();

  function contar(error: unknown) {
    setFallo(error instanceof Error ? error.message : String(error));
  }

  async function anadir(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    // Se vacía para que elegir dos veces el mismo archivo vuelva a disparar el evento.
    evento.target.value = "";
    if (!archivo) return;
    setFallo(null);
    setAviso(null);
    setTrabajando("Cifrando y guardando…");
    let idGuardado: string | null = null;
    try {
      const preparado = await prepararArchivo(archivo);
      if (preparado.aviso) setAviso(preparado.aviso);
      // Sin esto, un móvil con poco espacio puede borrar los datos del sitio y
      // con ellos los documentos, sin preguntar.
      void almacenAdjuntos.pedirPersistencia();

      const { id, sealed } = await nucleo.prepararAdjunto(preparado.bytes);
      await almacenAdjuntos.guardar(id, sealed);
      idGuardado = id;
      const referencia: Adjunto = {
        id,
        nombre: preparado.nombre,
        mime: preparado.mime,
        tam: preparado.bytes.length,
        creado: Date.now(),
      };
      const { filas, fichero } = await nucleo.registrarAdjunto(item.id, referencia);
      idGuardado = null;
      alCambiar(filas, fichero);
      alRefrescar();
    } catch (error) {
      // Si el documento llegó a guardarse pero la entrada no lo anotó, se
      // retira: un criptograma que nada referencia solo ocupa espacio.
      if (idGuardado) await almacenAdjuntos.borrar(idGuardado).catch(() => undefined);
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  /** Descifra un documento. Los bytes son del llamante, que debe borrarlos. */
  async function abrir(adjunto: Adjunto): Promise<Uint8Array> {
    const sellado = await almacenAdjuntos.leer(adjunto.id);
    if (!sellado) {
      throw new Error(
        "Este documento no está en este navegador. Si restauraste la bóveda desde un fichero, restaura también la copia de los documentos desde «El fichero».",
      );
    }
    return (await nucleo.abrirAdjunto(adjunto.id, sellado)).bytes;
  }

  async function ver(adjunto: Adjunto) {
    setFallo(null);
    setTrabajando("Descifrando…");
    try {
      const bytes = await abrir(adjunto);
      try {
        // Como URI de datos y no como blob: la política de seguridad de la
        // página solo admite imágenes de datos. La cadena resultante no se puede
        // borrar de memoria, cosa a tener presente con un documento de identidad.
        const url = await new Promise<string>((ok, ko) => {
          const lector = new FileReader();
          lector.onload = () => ok(String(lector.result));
          lector.onerror = () => ko(lector.error ?? new Error("no se pudo leer"));
          lector.readAsDataURL(new Blob([Uint8Array.from(bytes)], { type: adjunto.mime }));
        });
        setVisor({ nombre: adjunto.nombre, url });
      } finally {
        bytes.fill(0);
      }
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function bajar(adjunto: Adjunto) {
    setFallo(null);
    setTrabajando("Descifrando…");
    try {
      const bytes = await abrir(adjunto);
      try {
        descargar(bytes, adjunto.nombre, adjunto.mime);
      } finally {
        bytes.fill(0);
      }
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function quitar(adjunto: Adjunto) {
    setFallo(null);
    setTrabajando("Quitando…");
    try {
      const { filas, fichero } = await nucleo.quitarAdjunto(item.id, adjunto.id);
      alCambiar(filas, fichero);
      await almacenAdjuntos.borrar(adjunto.id).catch(() => undefined);
      setQuitando(null);
      if (visor) setVisor(null);
      alRefrescar();
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <div className="adjuntos">
      <div className="etiqueta">Documentos</div>

      {adjuntos.length === 0 ? (
        <p className="adjuntos-vacio">Ninguno. Añade un PDF o una foto (DNI, escritura…).</p>
      ) : (
        <ul className="adjuntos-lista">
          {adjuntos.map((a) => (
            <li key={a.id} className="adjunto">
              <div className="adjunto-cuerpo">
                <span className="adjunto-nombre">{a.nombre}</span>
                <span className="dato adjunto-meta">
                  {esImagen(a.mime) ? "foto" : "pdf"} · {formatearBytes(a.tam)}
                </span>
              </div>
              <div className="barra-acciones">
                {esImagen(a.mime) && (
                  <button className="boton" disabled={!!trabajando} onClick={() => void ver(a)}>
                    Ver
                  </button>
                )}
                <button className="boton" disabled={!!trabajando} onClick={() => void bajar(a)}>
                  Descargar
                </button>
                {quitando === a.id ? (
                  <>
                    <button
                      className="boton peligro"
                      disabled={!!trabajando}
                      onClick={() => void quitar(a)}
                    >
                      Sí, quitar
                    </button>
                    <button className="boton" onClick={() => setQuitando(null)}>
                      No
                    </button>
                  </>
                ) : (
                  <button
                    className="boton peligro"
                    disabled={!!trabajando}
                    onClick={() => setQuitando(a.id)}
                  >
                    Quitar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {visor && (
        <div className="visor">
          <div className="barra-acciones" style={{ justifyContent: "space-between" }}>
            <span className="dato">{visor.nombre}</span>
            <button className="boton" onClick={() => setVisor(null)}>
              Cerrar
            </button>
          </div>
          <img src={visor.url} alt={visor.nombre} />
        </div>
      )}

      {fallo && (
        <div className="aviso alarma">
          <span className="glifo">!</span>
          <span>{fallo}</span>
        </div>
      )}
      {aviso && (
        <div className="aviso senal">
          <span className="glifo">!</span>
          <span>{aviso}</span>
        </div>
      )}
      {trabajando && <div className="etiqueta">{trabajando}</div>}

      {disponible ? (
        <div className="barra-acciones">
          <button
            className="boton"
            disabled={!!trabajando}
            onClick={() => entradaArchivo.current?.click()}
          >
            Añadir PDF o foto
          </button>
          <button
            className="boton"
            disabled={!!trabajando}
            onClick={() => entradaFoto.current?.click()}
          >
            Hacer una foto
          </button>
          <input
            ref={entradaArchivo}
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => void anadir(e)}
            style={{ display: "none" }}
          />
          <input
            ref={entradaFoto}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void anadir(e)}
            style={{ display: "none" }}
          />
        </div>
      ) : (
        <p className="adjuntos-vacio">
          Abierto desde un fichero local el navegador no guarda documentos. Usa la dirección web de
          Cerbero para adjuntarlos.
        </p>
      )}
    </div>
  );
}
