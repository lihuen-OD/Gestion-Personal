import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, subtitle, close, children, closeDisabled = false }: { title: string; subtitle?: string; close: () => void; children: ReactNode; closeDisabled?: boolean }) {
  return (
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
    </div>
  );
}
