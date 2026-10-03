import { useEffect, useRef, useState } from "react";
import { Compartir } from "./Compartir.tsx";
import { descargarBytes, esImagen, etiquetaTipo, formatearBytes, formatearFechaHora } from "./formato.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import { SelectorCarpeta } from "./SelectorCarpeta.tsx";
import type { Biblioteca, Categoria, DocumentoMeta } from "./tipos.ts";
import { Visor } from "./Visor.tsx";

export function Ficha({
  documento,
  categorias,
  falta,
  alCambiar,
  alCerrar,
}: {
  readonly documento: DocumentoMeta;
  readonly categorias: readonly Categoria[];
  readonly falta: boolean;
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const [nombre, setNombre] = useState(documento.nombre);
  const [categoria, setCategoria] = useState<string>(documento.categoria);
  const [notas, setNotas] = useState(documento.notas);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [compartiendo, setCompartiendo] = useState(false);
  const [visor, setVisor] = useState<string | null>(null);
  // La URL de la imagen que se mira, para revocarla al salir aunque el visor siga abierto.
  const urlVisor = useRef<string | null>(null);

  const cambiado =
    nombre.trim() !== documento.nombre || categoria !== documento.categoria || notas !== documento.notas;

  useEffect(
    () => () => {
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
      urlVisor.current = url;
      setVisor(url);
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
      <Hoja titulo={documento.nombre} alCerrar={alCerrar} bloqueada={trabajando !== null || compartiendo}>
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

        <SelectorCarpeta
          categorias={categorias}
          valor={categoria}
          alElegir={setCategoria}
          alCambiarBiblioteca={alCambiar}
          deshabilitado={trabajando !== null}
        />

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
          <button className="boton" disabled={trabajando !== null || falta} onClick={() => setCompartiendo(true)}>
            Compartir
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

      {compartiendo && <Compartir documentos={[documento]} alCerrar={() => setCompartiendo(false)} />}

      {visor && <Visor url={visor} nombre={documento.nombre} alCerrar={cerrarVisor} />}
    </>
  );
}
