import type { ReactNode } from "react";
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
export function Modal({ title, subtitle, close, children, closeDisabled = false }: { title: string; subtitle?: string; close: () => void; children: ReactNode; closeDisabled?: boolean }) {
  return createPortal(
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-head-text">
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" onClick={close} disabled={closeDisabled} aria-label="Cerrar"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
