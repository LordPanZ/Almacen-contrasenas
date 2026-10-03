import { useEffect, useRef, useState } from "react";
import { carpetaPorDefecto } from "./categorias.ts";
import { descargarBytes, esImagen, etiquetaTipo, claseTipo, formatearBytes, formatearFechaHora } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import { SelectorCarpeta } from "./SelectorCarpeta.tsx";
import type { Biblioteca, Categoria, EnvioAbierto, EnvioInspeccion } from "./tipos.ts";
import { Visor } from "./Visor.tsx";

/**
 * Abrir un envío cifrado que te han mandado.
 *
 * No hace falta tener una caja: con el fichero y el código basta para ver y
 * descargar lo que trae. Si la caja está abierta, además se puede guardar en
 * ella, en la carpeta que se elija.
 */
export function AbrirEnvio({
  categorias,
  alCambiarBiblioteca,
  alCerrar,
}: {
  /** Presentes solo con la caja abierta: sin ellas no se ofrece guardar. */
  readonly categorias?: readonly Categoria[];
  readonly alCambiarBiblioteca?: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const puedeGuardar = categorias !== undefined && alCambiarBiblioteca !== undefined;
  const entrada = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<EnvioInspeccion | null>(null);
  const [nombreFichero, setNombreFichero] = useState("");
  const [codigo, setCodigo] = useState("");
  const [abierto, setAbierto] = useState<EnvioAbierto | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [carpeta, setCarpeta] = useState(categorias ? carpetaPorDefecto(categorias) : "");
  const [guardados, setGuardados] = useState<ReadonlySet<number>>(new Set());
  const [visor, setVisor] = useState<{ url: string; nombre: string } | null>(null);

  // La imagen que se está viendo, para revocar su URL al salir aunque el visor siga abierto.
  const urlVisor = useRef<string | null>(null);

  // La clave del envío vive en el trabajador y la imagen en una URL de objeto:
  // al cerrar la hoja se borran las dos.
  useEffect(
    () => () => {
      void arca.envioCerrar().catch(() => undefined);
      if (urlVisor.current) URL.revokeObjectURL(urlVisor.current);
    },
    [],
  );

  function cerrarVisor() {
    if (urlVisor.current) URL.revokeObjectURL(urlVisor.current);
    urlVisor.current = null;
    setVisor(null);
  }

  function contar(error: unknown) {
    setFallo(error instanceof Error ? error.message : String(error));
  }

  async function elegir(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!archivo) return;
    setFallo(null);
    setNota(null);
    setAbierto(null);
    setCodigo("");
    setGuardados(new Set());
    setTrabajando("Comprobando el fichero…");
    try {
      setInfo(await arca.envioInspeccionar(archivo));
      setNombreFichero(archivo.name);
    } catch (error) {
      setInfo(null);
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function abrir(evento: React.FormEvent) {
    evento.preventDefault();
    if (codigo.trim() === "") return;
    setFallo(null);
    setNota(null);
    setTrabajando("Comprobando el código. Se deriva la clave con Argon2, así que tarda unos segundos…");
    try {
      setAbierto(await arca.envioAbrir(codigo));
      setCodigo("");
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function descargar(posicion: number) {
    setFallo(null);
    setTrabajando("Descifrando…");
    try {
      const { meta, datos } = await arca.envioLeer(posicion);
      descargarBytes(datos, meta.nombre, meta.mime);
      new Uint8Array(datos).fill(0);
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function ver(posicion: number) {
    setFallo(null);
    setTrabajando("Descifrando…");
    try {
      const { meta, datos } = await arca.envioLeer(posicion);
      const url = URL.createObjectURL(new Blob([datos], { type: meta.mime }));
      new Uint8Array(datos).fill(0);
      urlVisor.current = url;
      setVisor({ url, nombre: meta.nombre });
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function guardar(posiciones: readonly number[]) {
    if (!alCambiarBiblioteca || !abierto) return;
    setFallo(null);
    setNota(null);
    const hechos = new Set(guardados);
    try {
      for (const posicion of posiciones) {
        setTrabajando(`Guardando ${hechos.size + 1} de ${posiciones.length + guardados.size}…`);
        alCambiarBiblioteca(await arca.envioGuardar(posicion, carpeta));
        hechos.add(posicion);
        setGuardados(new Set(hechos));
      }
      setNota(
        posiciones.length === 1
          ? "Guardado en tu caja."
          : `${posiciones.length} documentos guardados en tu caja.`,
      );
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  const pendientes = abierto ? abierto.documentos.map((_, i) => i).filter((i) => !guardados.has(i)) : [];

  return (
    <>
      <Hoja titulo="Abrir un envío cifrado" alCerrar={alCerrar} bloqueada={trabajando !== null || visor !== null}>
        {fallo && <div className="aviso alarma">{fallo}</div>}
        {nota && <div className="aviso exito">{nota}</div>}

        {trabajando && (
          <div className="derivando" role="status">
            <div className="barra-espera">
              <span />
            </div>
            <p>{trabajando}</p>
          </div>
        )}

        {!abierto && (
          <>
            {!info ? (
              <p className="texto pequeno">
                Un envío cifrado es un fichero que termina en <strong>.arcashare</strong> y que se abre con un
                código de 20 letras y números. Elige el fichero que te han mandado; el código te lo habrán dado por
                otro medio.
              </p>
            ) : (
              <p className="texto">
                <strong>{nombreFichero}</strong>
                <br />
                Es un envío de Arca con {info.documentos === 1 ? "1 documento" : `${info.documentos} documentos`} (
                {formatearBytes(info.bytes)}). Escribe el código para abrirlo.
              </p>
            )}

            <div className="acciones">
              <button className="boton" disabled={trabajando !== null} onClick={() => entrada.current?.click()}>
                {info ? "Elegir otro fichero" : "Elegir el fichero"}
              </button>
              <input ref={entrada} type="file" onChange={(e) => void elegir(e)} style={{ display: "none" }} />
            </div>

            {info && (
              <form className="formulario-carpeta" onSubmit={(e) => void abrir(e)}>
                <label className="campo">
                  <span className="etiqueta">Código</span>
                  <input
                    type="text"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="entrada-codigo"
                    autoFocus
                  />
                </label>
                <button type="submit" className="boton principal" disabled={trabajando !== null || codigo.trim() === ""}>
                  Abrir el envío
                </button>
              </form>
            )}
          </>
        )}

        {abierto && (
          <>
            <p className="texto pequeno">
              Enviado el {formatearFechaHora(abierto.creado)}.{" "}
              {puedeGuardar
                ? "Puedes verlo, descargarlo o guardarlo en tu caja."
                : "Puedes verlo o descargarlo. Para guardarlo en una caja, desbloquéala primero y abre el envío desde ahí."}
            </p>

            <ul className="filas">
              {abierto.documentos.map((d, i) => (
                <li key={`${d.nombre}-${i}`} className="fila-envio">
                  <span className={`tipo ${claseTipo(d)}`} aria-hidden="true">
                    <span>{etiquetaTipo(d)}</span>
                  </span>
                  <span className="fila-cuerpo">
                    <span className="fila-titulo">{d.nombre}</span>
                    <span className="fila-sub">
                      {formatearBytes(d.tam)}
                      {guardados.has(i) && <span className="guardado"> · guardado en tu caja</span>}
                    </span>
                  </span>
                  <span className="acciones">
                    {esImagen(d.mime) && (
                      <button className="boton chico" disabled={trabajando !== null} onClick={() => void ver(i)}>
                        Ver
                      </button>
                    )}
                    <button className="boton chico" disabled={trabajando !== null} onClick={() => void descargar(i)}>
                      Descargar
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            {puedeGuardar && categorias && alCambiarBiblioteca && (
              <section className="opcion">
                <SelectorCarpeta
                  categorias={categorias}
                  valor={carpeta}
                  alElegir={setCarpeta}
                  alCambiarBiblioteca={alCambiarBiblioteca}
                  deshabilitado={trabajando !== null}
                  etiqueta="Guardar en la carpeta"
                />
                <div className="acciones">
                  {abierto.documentos.length > 1 ? (
                    <button
                      className="boton principal"
                      disabled={trabajando !== null || pendientes.length === 0}
                      onClick={() => void guardar(pendientes)}
                    >
                      {pendientes.length === 0 ? "Todo guardado" : `Guardar ${pendientes.length === 1 ? "el que falta" : `los ${pendientes.length}`} en mi caja`}
                    </button>
                  ) : (
                    <button
                      className="boton principal"
                      disabled={trabajando !== null || guardados.has(0)}
                      onClick={() => void guardar([0])}
                    >
                      {guardados.has(0) ? "Guardado" : "Guardar en mi caja"}
                    </button>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </Hoja>

      {visor && <Visor url={visor.url} nombre={visor.nombre} alCerrar={cerrarVisor} />}
    </>
  );
}
