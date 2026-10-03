import { useState } from "react";
import { Hoja } from "./Hoja.tsx";
import { arca } from "./puente.ts";
import type { Biblioteca } from "./tipos.ts";

/** Crear una carpeta desde la lista de carpetas. */
export function NuevaCarpeta({
  alCambiar,
  alCerrar,
}: {
  readonly alCambiar: (biblioteca: Biblioteca) => void;
  readonly alCerrar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    if (nombre.trim() === "" || trabajando) return;
    setTrabajando(true);
    setFallo(null);
    try {
      const { biblioteca } = await arca.crearCategoria(nombre);
      alCambiar(biblioteca);
      alCerrar();
    } catch (error) {
      setFallo(error instanceof Error ? error.message : String(error));
      setTrabajando(false);
    }
  }

  return (
    <Hoja titulo="Nueva carpeta" alCerrar={alCerrar} bloqueada={trabajando}>
      <form className="formulario-carpeta" onSubmit={(e) => void crear(e)}>
        <label className="campo">
          <span className="etiqueta">Nombre de la carpeta</span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Por ejemplo: Coche, Herencia, Estudios"
            maxLength={60}
            autoCapitalize="sentences"
            autoFocus
          />
        </label>
        {fallo && <div className="aviso alarma">{fallo}</div>}
        <button type="submit" className="boton principal" disabled={trabajando || nombre.trim() === ""}>
          Crear carpeta
        </button>
      </form>
    </Hoja>
  );
}
