/**
 * El emblema de Arca: un cofre visto de frente, con la tapa, la banda y la
 * cerradura. Sin degradados ni sombras: tiene que leerse a 20 px.
 */
export function Marca({ grande = false }: { readonly grande?: boolean }) {
  return (
    <div className={`marca${grande ? " grande" : ""}`}>
      <svg viewBox="0 0 32 32" width={grande ? 44 : 24} height={grande ? 44 : 24} aria-hidden="true">
        <rect x="3" y="9" width="26" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M3 14h26" stroke="currentColor" strokeWidth="2" />
        <path d="M5 9a11 5 0 0 1 22 0" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="13.5" y="12" width="5" height="6" rx="1.2" fill="var(--acento)" />
        <circle cx="16" cy="15" r="0.9" fill="var(--fondo)" />
      </svg>
      <span className="marca-nombre">Arca</span>
    </div>
  );
}
