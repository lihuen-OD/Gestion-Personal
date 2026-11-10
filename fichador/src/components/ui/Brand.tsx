/** Marca del fichador: isotipo de reloj + "Fichador · Los O'Dwyer". */
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      </span>
      <span className="brand-text">
        <span className="brand-name">Fichador</span>
        <span className="brand-org">Los O&apos;Dwyer</span>
      </span>
    </div>
  );
}
