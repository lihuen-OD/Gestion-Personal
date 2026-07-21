import { useEffect, useState } from "react";
import { APP_DIALOG_EVENT, type AppDialogRequest } from "../../services/appDialog";
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

  return (
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
          <button type="button" className="button subtle" onClick={() => finish(request.kind === "confirm" ? false : null)}>
            {request.cancelLabel}
          </button>
          <button type="button" className={`button ${request.tone}`} onClick={confirm} disabled={request.kind === "prompt" && !value.trim()}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
