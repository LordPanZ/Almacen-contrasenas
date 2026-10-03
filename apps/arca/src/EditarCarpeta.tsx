import { useState } from "react";
import { textoDocumentos } from "./categorias.ts";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca, Categoria } from "./tipos.ts";

/**
 * Renombrar o borrar una carpeta.
 *
 * Borrar una carpeta nunca borra documentos: si los tiene, se elige a qué otra
 * carpeta pasan, y la operación entera es un solo guardado del índice.
 */
export function EditarCarpeta({
  carpeta,
  categorias,
  documentos,
  alCambiar,
  alCerrar,
}: {
  readonly carpeta: Categoria;
  readonly categorias: readonly Categoria[];
  readonly documentos: number;
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const otras = categorias.filter((c) => c.id !== carpeta.id);
  const [nombre, setNombre] = useState(carpeta.nombre);
  const [destino, setDestino] = useState(otras[0]?.id ?? "");
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const cambiado = nombre.trim() !== "" && nombre.trim() !== carpeta.nombre;

  async function ejecutar(accion: () => Promise<Biblioteca>, alTerminar: () => void) {
    setTrabajando(true);
    setFallo(null);
    try {
      alCambiar(await accion());
      alTerminar();
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(false);
    }
  }

  return (
    <Hoja titulo="Editar carpeta" alCerrar={alCerrar} bloqueada={trabajando}>
      <form
        className="formulario-carpeta"
        onSubmit={(e) => {
          e.preventDefault();
          if (cambiado && !trabajando) void ejecutar(() => arca.renombrarCategoria(carpeta.id, nombre), alCerrar);
        }}
      >
        <label className="campo">
          <span className="etiqueta">Nombre</span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={60}
            autoCapitalize="sentences"
          />
        </label>
        <button type="submit" className="boton principal" disabled={!cambiado || trabajando}>
          Guardar el nombre
        </button>
      </form>

      <div className="separador" />

      <section className="zona-borrar">
        <h2>Eliminar la carpeta</h2>
        {otras.length === 0 ? (
          <p className="texto pequeno">Es la única carpeta: tiene que quedar al menos una.</p>
        ) : (
          <>
            {documentos > 0 ? (
              <>
                <p className="texto pequeno">
                  Tiene {textoDocumentos(documentos)}. <strong>No se borra ninguno</strong>: pasan a la carpeta que
                  elijas.
                </p>
                <label className="campo">
                  <span className="etiqueta">Mover los documentos a</span>
                  <select value={destino} onChange={(e) => setDestino(e.target.value)} disabled={trabajando}>
                    {otras.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="texto pequeno">Está vacía, así que no se pierde nada.</p>
            )}
            {confirmando ? (
              <div className="acciones">
                <button
                  className="boton peligro"
                  disabled={trabajando}
                  onClick={() =>
                    void ejecutar(() => arca.borrarCategoria(carpeta.id, documentos > 0 ? destino : undefined), alCerrar)
                  }
                >
                  {documentos > 0 ? "Sí, mover y eliminar" : "Sí, eliminar"}
                </button>
                <button className="boton" disabled={trabajando} onClick={() => setConfirmando(false)}>
                  No
                </button>
              </div>
            ) : (
              <button className="boton peligro" disabled={trabajando} onClick={() => setConfirmando(true)}>
                Eliminar la carpeta
              </button>
            )}
          </>
        )}
      </section>

      {fallo && <div className="aviso alarma">{fallo}</div>}
    </Hoja>
  );
}
