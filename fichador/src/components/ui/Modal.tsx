import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Copia de frontend/src/components/ui/Modal.tsx (mismo markup y clases). El
// portal a document.body se conserva: el backdrop `position: fixed` cubre
// todo el viewport sin depender de los contenedores de la página.
export function Modal({ title, subtitle, close, children, closeDisabled = false }: { title: string; subtitle?: string; close: () => void; children: ReactNode; closeDisabled?: boolean }) {
  return createPortal(
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
