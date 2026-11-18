import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Etapa 15M.14: portal a document.body, mismo motivo ya documentado en
// AppDialogHost (Etapa 13J.3) -- sin portal, este modal queda anidado
// dentro del árbol de la página que lo abre. Eso importa por dos razones
// distintas: (1) stacking de dos modales a la vez (el caso original de
// AppDialogHost) y (2) `.page-wrap` (el único dueño del scroll vertical,
// ver docs/PROJECT_UI_CONTEXT.md "Política de scroll") necesita
// `contain: layout` para evitar que el contenido interno de una página
// (grids con columnas `auto`, ver Etapa 15M.14) infle el scroll del
// documento -- pero `contain: layout` en un ancestro convierte a ese
// ancestro en el containing block de cualquier descendiente
// `position: fixed`. Sin este portal, `.modal-backdrop` (fixed, pensado
// para cubrir todo el viewport) quedaría contenido dentro de `.page-wrap`
// en vez de cubrir sidebar/topbar.
export function Modal({ title, subtitle, close, children, closeDisabled = false, size = "default" }: { title: string; subtitle?: string; close: () => void; children: ReactNode; closeDisabled?: boolean; size?: "default" | "wide" }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-modal-initial-focus]");
    (preferred || closeButtonRef.current)?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !closeDisabled) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div ref={dialogRef} className={size === "wide" ? "modal modal-wide" : "modal"} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <div className="modal-head">
          <div className="modal-head-text">
            <h3 id={titleId}>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button ref={closeButtonRef} className="icon-button" onClick={close} disabled={closeDisabled} aria-label="Cerrar"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
