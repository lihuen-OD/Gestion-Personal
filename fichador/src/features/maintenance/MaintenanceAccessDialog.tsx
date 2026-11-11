import { useEffect, useId, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ApiError } from "../../services/api/apiClient";
import { clockMaintenanceApiService, type ClockMaintenanceDevice } from "../../services/api/clockMaintenanceApiService";
import { isClockDeviceAuthFailure } from "../../services/api/clockDeviceSession";

/** Sin actividad en el diálogo, vuelve solo al fichador: no deja el kiosco bloqueado. */
export const MAINTENANCE_ACCESS_IDLE_MS = 60_000;
const CODE_LENGTH = 6;

export const INVALID_CODE_MESSAGE = "El código no es válido o ya venció.";
export const CONNECTION_MESSAGE = "No se pudo verificar el acceso. Revisá la conexión.";
export const TOO_MANY_ATTEMPTS_MESSAGE = "Hay demasiados intentos. Esperá unos minutos y volvé a intentar.";

export type GrantedMaintenance = { token: string; deadline: number; device: ClockMaintenanceDevice; verifiedAt: number };

function failureMessage(error: unknown) {
  if (error instanceof ApiError && (error.code === "CLOCK_MAINTENANCE_CODE_INVALID" || error.code === "VALIDATION_ERROR")) return INVALID_CODE_MESSAGE;
  if (error instanceof ApiError && error.status === 429) return TOO_MANY_ATTEMPTS_MESSAGE;
  // Sin red, timeout, 5xx o cualquier otra respuesta: nunca un detalle técnico.
  return CONNECTION_MESSAGE;
}

/**
 * Las casillas muestran el código en orden: un cursor (invisible) que quedó a
 * mitad del código —por un toque o una flecha— vuelve al final. Una selección
 * (seleccionar todo para reemplazar o pegar) se respeta.
 */
function keepCaretAtEnd(event: SyntheticEvent<HTMLInputElement>) {
  const field = event.currentTarget;
  const end = field.value.length;
  if (field.selectionStart === field.selectionEnd && field.selectionStart !== end) field.setSelectionRange(end, end);
}

/**
 * "Acceso de mantenimiento" (docs/decisions/FICHADOR_MAINTENANCE_MODE.md). Sólo
 * pide el código que generó RRHH: sin pistas, sin ids y con el mismo mensaje
 * para cualquier código que no sirve. El backend decide; acá no hay PIN.
 *
 * Presentación (Etapa 5): un único campo numérico real, transparente, sobre
 * seis casillas que lo muestran. El campo conserva la etiqueta, el teclado
 * numérico, el pegado y la validación; las casillas son sólo visuales.
 */
export function MaintenanceAccessDialog({ onCancel, onGranted }: { onCancel: () => void; onGranted: (access: GrantedMaintenance) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const inputId = useId();

  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  // Foco (sólo presentación): tras un error el campo se vuelve a habilitar en
  // el render siguiente; recién ahí puede recibir el foco otra vez.
  useEffect(() => {
    if (error && !busy) input.current?.focus();
  }, [error, busy]);

  // Cada tecla reinicia la espera; mientras se verifica no se cierra.
  useEffect(() => {
    if (busy) return undefined;
    const timer = window.setTimeout(onCancel, MAINTENANCE_ACCESS_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [code, busy, error, onCancel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || code.length !== CODE_LENGTH) return;
    if (!navigator.onLine) {
      setError(CONNECTION_MESSAGE);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const session = await clockMaintenanceApiService.open(code);
      if (!alive.current) return;
      const now = Date.now();
      onGranted({ token: session.token, deadline: now + session.expiresInSeconds * 1_000, device: session.device, verifiedAt: now });
    } catch (openError) {
      // Revocado o sin credencial: el Gate ya bloqueó el equipo y desmonta esto.
      if (!alive.current || isClockDeviceAuthFailure(openError)) return;
      setError(failureMessage(openError));
      setCode("");
      setBusy(false);
    }
  };

  const current = Math.min(code.length, CODE_LENGTH - 1);
  const codeState = busy ? " is-busy" : error ? " is-invalid" : "";

  return (
    <Modal title="Acceso de mantenimiento" subtitle="Ingresá el código de 6 dígitos que generó RRHH." close={onCancel} closeDisabled={busy}>
      <form className="maintenance-access" onSubmit={(event) => void submit(event)}>
        <div className="maintenance-code-field">
          <label htmlFor={inputId}>Código</label>
          <div className={`maintenance-code${codeState}`}>
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <span key={index} className={`maintenance-code-cell${index === current ? " is-current" : ""}`} aria-hidden="true">{code[index] ?? null}</span>
            ))}
            <input
              ref={input}
              id={inputId}
              data-autofocus=""
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
                setError("");
              }}
              onSelect={keepCaretAtEnd}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              disabled={busy}
              aria-invalid={error ? true : undefined}
            />
          </div>
        </div>
        {error ? <p className="error has-icon" role="alert"><AlertCircle size={20} strokeWidth={2} aria-hidden="true" /><span>{error}</span></p> : null}
        <div className="form-actions">
          <Button type="button" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={busy} aria-busy={busy || undefined} disabled={code.length !== CODE_LENGTH}>
            {busy ? <><span className="kiosk-spinner" aria-hidden="true" />Verificando…</> : "Ingresar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
