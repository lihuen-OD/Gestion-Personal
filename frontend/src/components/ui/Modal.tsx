import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, close, children, closeDisabled = false }: { title: string; close: () => void; children: ReactNode; closeDisabled?: boolean }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={close} disabled={closeDisabled} aria-label="Cerrar"><X /></button></div><div className="modal-body">{children}</div></div></div>;
}
