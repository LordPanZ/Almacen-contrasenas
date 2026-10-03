import { useEffect, useState } from "react";
import { CATEGORIAS, comoCategoria } from "./categorias.ts";
import { descargarBytes, esImagen, etiquetaTipo, formatearBytes, formatearFechaHora } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca, DocumentoMeta } from "./tipos.ts";

export function Ficha({
  documento,
  falta,
  alCambiar,
  alCerrar,
}: {
  readonly documento: DocumentoMeta;
  readonly falta: boolean;
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(documento.nombre);
  const [categoria, setCategoria] = useState<string>(comoCategoria(documento.categoria));
  const [notas, setNotas] = useState(documento.notas);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [visor, setVisor] = useState<{ url: string; ampliado: boolean } | null>(null);

  const cambiado =
    nombre.trim() !== documento.nombre ||
    categoria !== comoCategoria(documento.categoria) ||
    notas !== documento.notas;

  // El visor usa una URL de objeto: se revoca al cerrarlo y al salir, para que la
  // imagen descifrada no se quede en memoria más de lo que se está mirando.
  useEffect(
    () => () => {
      if (visor) URL.revokeObjectURL(visor.url);
    },
    [visor],
  );

  function contar(error: unknown) {
    setFallo(error instanceof Error ? error.message : String(error));
  }

  async function guardar() {
    setTrabajando("Guardando…");
    setFallo(null);
    setNota(null);
    try {
      alCambiar(await arca.editar(documento.id, { nombre, categoria, notas }));
      setNota("Cambios guardados.");
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function descifrar(): Promise<{ meta: DocumentoMeta; datos: ArrayBuffer }> {
    return arca.leer(documento.id);
  }

  async function descargar() {
    setTrabajando("Descifrando…");
    setFallo(null);
    try {
      const { meta, datos } = await descifrar();
      descargarBytes(datos, meta.nombre, meta.mime);
      // El `Blob` ya tiene su copia: la nuestra no hace falta ni un instante más.
      new Uint8Array(datos).fill(0);
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function ver() {
    setTrabajando("Descifrando…");
    setFallo(null);
    try {
      const { meta, datos } = await descifrar();
      const url = URL.createObjectURL(new Blob([datos], { type: meta.mime }));
      new Uint8Array(datos).fill(0);
      setVisor({ url, ampliado: false });
    } catch (error) {
      contar(error);
    } finally {
      setTrabajando(null);
    }
  }

  async function borrar() {
    setTrabajando("Borrando…");
    setFallo(null);
    try {
      alCambiar(await arca.borrar(documento.id));
      alCerrar();
    } catch (error) {
      contar(error);
      setTrabajando(null);
    }
  }

  return (
    <>
      <Hoja titulo={documento.nombre} alCerrar={alCerrar} bloqueada={trabajando !== null}>
        {falta && (
          <div className="aviso alarma">
            Este documento figura en la lista pero no está en este navegador. Si restauraste una copia, comprueba que
            sea la completa.
          </div>
        )}

        <label className="campo">
          <span className="etiqueta">Nombre</span>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoCapitalize="none" />
        </label>

        <label className="campo">
          <span className="etiqueta">Categoría</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          <span className="etiqueta">Notas</span>
          <textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Por ejemplo: caduca en 2031" />
        </label>

        <dl className="datos">
          <dt>Tipo</dt>
          <dd>
            {etiquetaTipo(documento)} · {documento.mime}
          </dd>
          <dt>Tamaño</dt>
          <dd>{formatearBytes(documento.tam)}</dd>
          <dt>Añadido</dt>
          <dd>{formatearFechaHora(documento.creado)}</dd>
        </dl>

        {fallo && <div className="aviso alarma">{fallo}</div>}
        {nota && <div className="aviso exito">{nota}</div>}
        {trabajando && <div className="etiqueta">{trabajando}</div>}

        <div className="acciones">
          {cambiado && (
            <button className="boton principal" disabled={trabajando !== null || nombre.trim() === ""} onClick={() => void guardar()}>
              Guardar cambios
            </button>
          )}
          {esImagen(documento.mime) && (
            <button className="boton" disabled={trabajando !== null || falta} onClick={() => void ver()}>
              Ver
            </button>
          )}
          <button className="boton" disabled={trabajando !== null || falta} onClick={() => void descargar()}>
            Descargar
          </button>
          {confirmando ? (
            <>
              <button className="boton peligro" disabled={trabajando !== null} onClick={() => void borrar()}>
                Sí, borrar
              </button>
              <button className="boton" onClick={() => setConfirmando(false)}>
                No
              </button>
            </>
          ) : (
            <button className="boton peligro" disabled={trabajando !== null} onClick={() => setConfirmando(true)}>
              Borrar
            </button>
          )}
        </div>
      </Hoja>

      {visor && (
        <div className={`visor${visor.ampliado ? " ampliado" : ""}`} role="dialog" aria-modal="true" aria-label={documento.nombre}>
          <div className="visor-barra">
            <span className="dato">{documento.nombre}</span>
            <span className="acciones">
              <button className="boton chico" onClick={() => setVisor({ ...visor, ampliado: !visor.ampliado })}>
                {visor.ampliado ? "Ajustar" : "Ampliar"}
              </button>
              <button
                className="boton chico"
                onClick={() => {
                  URL.revokeObjectURL(visor.url);
                  setVisor(null);
                }}
              >
                Cerrar
              </button>
            </span>
          </div>
          <div className="visor-lienzo">
            <img src={visor.url} alt={documento.nombre} />
          </div>
        </div>
      )}
    </>
  );
}
