import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { APP_DIALOG_EVENT, type AppDialogRequest } from "../../services/appDialog";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function AppDialogHost() {
  const [request, setRequest] = useState<AppDialogRequest | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent<AppDialogRequest>).detail;
      setRequest(next);
      setValue(next.defaultValue || "");
    };
    window.addEventListener(APP_DIALOG_EVENT, receive);
    return () => window.removeEventListener(APP_DIALOG_EVENT, receive);
  }, []);

  if (!request) return null;

  const finish = (result: boolean | string | null) => {
    request.resolve(result);
    setRequest(null);
    setValue("");
  };

  const confirm = () => {
    if (request.kind === "prompt") {
      const trimmed = value.trim();
      if (!trimmed) return;
      finish(trimmed);
      return;
    }
    finish(true);
  };

  // Etapa 13J.3: si esta confirmación se dispara desde DENTRO de otro modal
  // (ej. "Finalizar vigencia" en el modal de Régimen Laboral), sin portal
  // este <Modal> renderiza en el lugar del árbol donde vive <AppDialogHost/>
  // (montado en main.tsx, ANTES que <App/>) — como ambos .modal-backdrop
  // comparten el mismo z-index, gana el que está más tarde en el DOM (el
  // modal que ya estaba abierto), y la confirmación queda tapada e
  // inutilizable (no se puede ni ver ni tocar "Finalizar vigencia"). Un
  // portal a document.body lo saca de ese árbol y lo inserta como el último
  // hijo del body en el momento en que se abre, así siempre queda arriba.
  return createPortal(
    <Modal title={request.title} close={() => finish(request.kind === "confirm" ? false : null)}>
      <div className="app-dialog-content">
        <p>{request.message}</p>
        {request.kind === "prompt" ? (
          <label className="field">
            <span>{request.inputLabel}</span>
            <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} rows={3} />
          </label>
        ) : null}
        <div className="form-actions">
          <Button type="button" variant="subtle" onClick={() => finish(request.kind === "confirm" ? false : null)}>
            {request.cancelLabel}
          </Button>
          <Button type="button" variant={request.tone} onClick={confirm} disabled={request.kind === "prompt" && !value.trim()}>
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
