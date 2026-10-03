import { useState } from "react";
import { arca } from "./puente.ts";
import type { Biblioteca, Categoria } from "./tipos.ts";

const NUEVA = "__nueva__";

/**
 * Elegir una carpeta, con la opción de crear una nueva sin salir de donde se
 * está: al subir un documento que no encaja en ninguna, interrumpir lo que se
 * hace para ir a crear la carpeta y volver sería justo la fricción que hace que
 * todo acabe en «Otros».
 */
export function SelectorCarpeta({
  categorias,
  valor,
  alElegir,
  alCambiarBiblioteca,
  deshabilitado = false,
  etiqueta = "Carpeta",
}: {
  readonly categorias: readonly Categoria[];
  readonly valor: string;
  readonly alElegir: (id: string) => void;
  /** Crear una carpeta cambia la biblioteca: quien la tiene debe enterarse. */
  readonly alCambiarBiblioteca: (biblioteca: Biblioteca) => void;
  readonly deshabilitado?: boolean;
  readonly etiqueta?: string;
}) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function crear() {
    setTrabajando(true);
    setFallo(null);
    try {
      const { biblioteca, categoria } = await arca.crearCategoria(nombre);
      alCambiarBiblioteca(biblioteca);
      alElegir(categoria.id);
      setCreando(false);
      setNombre("");
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="selector-carpeta">
      <label className="campo">
        <span className="etiqueta">{etiqueta}</span>
        <select
          value={creando ? NUEVA : valor}
          disabled={deshabilitado}
          onChange={(e) => {
            if (e.target.value === NUEVA) {
              setCreando(true);
              setFallo(null);
            } else {
              setCreando(false);
              alElegir(e.target.value);
            }
          }}
        >
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
          <option value={NUEVA}>＋ Nueva carpeta…</option>
        </select>
      </label>

      {creando && (
        <div className="nueva-carpeta">
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nombre.trim() !== "" && !trabajando) {
                e.preventDefault();
                void crear();
              }
            }}
            placeholder="Nombre de la carpeta"
            aria-label="Nombre de la carpeta nueva"
            maxLength={60}
            autoFocus
          />
          <div className="acciones">
            <button
              type="button"
              className="boton principal chico"
              disabled={trabajando || nombre.trim() === ""}
              onClick={() => void crear()}
            >
              Crear carpeta
            </button>
            <button
              type="button"
              className="boton chico"
              disabled={trabajando}
              onClick={() => {
                setCreando(false);
                setNombre("");
                setFallo(null);
              }}
            >
              Cancelar
            </button>
          </div>
          {fallo && <div className="aviso alarma">{fallo}</div>}
        </div>
      )}
    </div>
  );
}
