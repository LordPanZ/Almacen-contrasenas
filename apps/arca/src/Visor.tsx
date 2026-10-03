import { useState } from "react";

/**
 * Visor de una imagen descifrada.
 *
 * La imagen viene como una URL de objeto que **revoca quien la creó** al cerrarlo
 * y al salir: así no se queda en memoria más de lo que se está mirando. No se
 * revoca aquí, en un efecto, porque el modo estricto de React monta y desmonta
 * dos veces en desarrollo y dejaría la imagen sin su URL nada más abrirla.
 */
export function Visor({
  url,
  nombre,
  alCerrar,
}: {
  readonly url: string;
  readonly nombre: string;
  readonly alCerrar: () => void;
}) {
  const [ampliado, setAmpliado] = useState(false);

  return (
    <div className={`visor${ampliado ? " ampliado" : ""}`} role="dialog" aria-modal="true" aria-label={nombre}>
      <div className="visor-barra">
        <span className="dato">{nombre}</span>
        <span className="acciones">
          <button className="boton chico" onClick={() => setAmpliado(!ampliado)}>
            {ampliado ? "Ajustar" : "Ampliar"}
          </button>
          <button className="boton chico" onClick={alCerrar}>
            Cerrar
          </button>
        </span>
      </div>
      <div className="visor-lienzo">
        <img src={url} alt={nombre} />
      </div>
    </div>
  );
}
