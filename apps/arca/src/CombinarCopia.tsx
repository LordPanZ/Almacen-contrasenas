import { useEffect, useRef, useState } from "react";
import { formatearBytes } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca, ResumenFusion } from "./tipos.ts";

const VISIBLES = 8;

/**
 * Sumar a esta caja lo que haya en otra copia **de la misma caja**.
 *
 * Es lo que permite tener la caja en varios sitios sin que restaurar una copia
 * pise lo que se hizo en otro. No borra nada de lo que ya hay, y antes de aplicar
 * enseña exactamente qué va a entrar.
 */
export function CombinarCopia({
  alCambiar,
  alCerrar,
}: {
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [nombreCopia, setNombreCopia] = useState("");
  const [resumen, setResumen] = useState<ResumenFusion | null>(null);
  const [hecho, setHecho] = useState<ResumenFusion | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  // Lo que se descifró de la copia vive en el trabajador: al cerrar la hoja se suelta.
  useEffect(
    () => () => {
      void arca.combinarCancelar().catch(() => undefined);
    },
    [],
  );

  async function elegir(evento: React.ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!archivo) return;
    setFallo(null);
    setResumen(null);
    setTrabajando("Comprobando la copia…");
    try {
      setResumen(await arca.combinarInspeccionar(archivo));
      setNombreCopia(archivo.name);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    } finally {
      setTrabajando(null);
    }
  }

  async function aplicar() {
    if (!resumen) return;
    setFallo(null);
    setTrabajando("Añadiendo a tu caja…");
    try {
      alCambiar(await arca.combinarAplicar());
      setHecho(resumen);
      setResumen(null);
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    } finally {
      setTrabajando(null);
    }
  }

  const trae = resumen ? resumen.nuevos.length + resumen.actualizados + resumen.carpetasNuevas.length : 0;

  return (
    <Hoja titulo="Combinar con otra copia" alCerrar={alCerrar} bloqueada={trabajando !== null}>
      {fallo && <div className="aviso alarma">{fallo}</div>}

      {trabajando && (
        <div className="derivando" role="status">
          <div className="barra-espera">
            <span />
          </div>
          <p>{trabajando}</p>
        </div>
      )}

      {hecho ? (
        <>
          <div className="aviso exito">
            Hecho.{" "}
            {hecho.nuevos.length > 0 &&
              `Se añadieron ${hecho.nuevos.length === 1 ? "1 documento" : `${hecho.nuevos.length} documentos`}. `}
            {hecho.carpetasNuevas.length > 0 &&
              `Carpetas nuevas: ${hecho.carpetasNuevas.join(", ")}. `}
            {hecho.actualizados > 0 && `${hecho.actualizados} con cambios más recientes. `}
            No se quitó nada de lo que ya tenías.
          </div>
          <button className="boton principal ancho" onClick={alCerrar}>
            Cerrar
          </button>
        </>
      ) : (
        <>
          {!resumen && (
            <p className="texto pequeno">
              Suma a esta caja lo que haya en otra copia <strong>de esta misma caja</strong> —la del móvil de tu pareja,
              la del ordenador de casa— sin borrar nada de lo que ya tienes. En el otro dispositivo, descarga una copia
              desde la pestaña «Caja» y elígela aquí.
            </p>
          )}

          {resumen && (
            <>
              <p className="texto">
                <strong>{nombreCopia}</strong>
              </p>

              {trae === 0 ? (
                <div className="aviso exito">Esta copia no trae nada que no tengas ya.</div>
              ) : (
                <section className="opcion">
                  {resumen.nuevos.length > 0 && (
                    <>
                      <span className="etiqueta">
                        {resumen.nuevos.length === 1 ? "1 documento que no tienes" : `${resumen.nuevos.length} documentos que no tienes`}
                      </span>
                      <ul className="seleccion">
                        {resumen.nuevos.slice(0, VISIBLES).map((d, i) => (
                          <li key={`${d.nombre}-${i}`}>
                            <span className="seleccion-nombre">{d.nombre}</span>
                            <span className="dato">
                              {d.carpeta} · {formatearBytes(d.tam)}
                            </span>
                          </li>
                        ))}
                        {resumen.nuevos.length > VISIBLES && (
                          <li>
                            <span className="seleccion-nombre">… y {resumen.nuevos.length - VISIBLES} más</span>
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                  {resumen.carpetasNuevas.length > 0 && (
                    <p className="texto pequeno">
                      <strong>Carpetas nuevas:</strong> {resumen.carpetasNuevas.join(", ")}
                    </p>
                  )}
                  {resumen.actualizados > 0 && (
                    <p className="texto pequeno">
                      <strong>{resumen.actualizados === 1 ? "1 documento" : `${resumen.actualizados} documentos`}</strong>{" "}
                      que ya tienes se tocaron más tarde en la otra copia: se quedan su nombre, carpeta y notas.
                    </p>
                  )}
                </section>
              )}

              {resumen.sinContenido > 0 && (
                <div className="aviso aviso-suave">
                  La copia menciona {resumen.sinContenido === 1 ? "1 documento" : `${resumen.sinContenido} documentos`} que
                  no trae —es una copia incompleta— y no se añaden.
                </div>
              )}

              {trae > 0 && (
                <div className="aviso aviso-suave">
                  <strong>Borrar no se propaga.</strong> Si borraste aquí algo que sigue en la otra copia, volverá a
                  aparecer. Mira la lista antes de añadir.
                </div>
              )}
            </>
          )}

          <div className="acciones">
            {resumen && trae > 0 && (
              <button className="boton principal" disabled={trabajando !== null} onClick={() => void aplicar()}>
                Añadir a mi caja
              </button>
            )}
            <button className="boton" disabled={trabajando !== null} onClick={() => entrada.current?.click()}>
              {resumen ? "Elegir otra copia" : "Elegir la copia…"}
            </button>
            {resumen && trae === 0 && (
              <button className="boton" onClick={alCerrar}>
                Cerrar
              </button>
            )}
            <input ref={entrada} type="file" onChange={(e) => void elegir(e)} style={{ display: "none" }} />
          </div>
        </>
      )}
    </Hoja>
  );
}
