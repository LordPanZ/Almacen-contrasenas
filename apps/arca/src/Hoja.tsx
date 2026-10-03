import { useEffect, useRef } from "react";

/**
 * Hoja deslizante: sube desde abajo en el móvil y es un cuadro centrado en
 * pantallas anchas. Es la única superficie modal de la app.
 */
export function Hoja({
  titulo,
  alCerrar,
  children,
  bloqueada = false,
}: {
  readonly titulo: string;
  readonly alCerrar: () => void;
  readonly children: React.ReactNode;
  /** Mientras trabaja no se debe poder cerrar: se perdería el progreso. */
  readonly bloqueada?: boolean;
}) {
  const hoja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const desbordePrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    hoja.current?.focus();
    return () => {
      document.body.style.overflow = desbordePrevio;
      previo?.focus?.();
    };
  }, []);

  useEffect(() => {
    function alPulsar(evento: KeyboardEvent) {
      if (evento.key === "Escape" && !bloqueada) alCerrar();
    }
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [alCerrar, bloqueada]);

  return (
    <div
      className="velo"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !bloqueada) alCerrar();
      }}
    >
      <div ref={hoja} className="hoja" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}>
        <div className="hoja-cabecera">
          <h2>{titulo}</h2>
          <button className="boton chico" onClick={alCerrar} disabled={bloqueada} aria-label="Cerrar">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
