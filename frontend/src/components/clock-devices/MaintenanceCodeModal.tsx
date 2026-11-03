import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { Modal } from "../ui/Modal";

/**
 * Modo mantenimiento del fichador (docs/decisions/FICHADOR_MAINTENANCE_MODE.md).
 * RRHH ve el código una sola vez: vive en memoria de este modal y desaparece
 * al cerrarlo. La cuenta regresiva parte de `expiresInSeconds` del backend,
 * medida con el reloj de esta pantalla (no con la hora absoluta del servidor).
 */
export type MaintenanceCodeState =
  | { status: "loading" }
  | { status: "ready"; code: string; deadline: number }
  | { status: "error"; message: string };

function useSecondsLeft(deadline: number | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deadline) return undefined;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)) : 0;
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MaintenanceCodeModal({ deviceName, state, onRegenerate, close }: { deviceName: string; state: MaintenanceCodeState; onRegenerate: () => void; close: () => void }) {
  const secondsLeft = useSecondsLeft(state.status === "ready" ? state.deadline : undefined);
  const loading = state.status === "loading";
  const expired = state.status === "ready" && secondsLeft === 0;

  return <Modal title="Acceso de mantenimiento" subtitle={deviceName} close={close}>
    <div className="form-stack maintenance-code-form">
      <div className={`maintenance-code-card${expired ? " expired" : ""}`} role="status" aria-live="polite">
        <small>Código de mantenimiento</small>
        {state.status === "ready" && !expired ? <>
          <strong aria-label={`Código ${state.code.split("").join(" ")}`}>{state.code}</strong>
          <span>Vence en {formatCountdown(secondsLeft)} · un solo uso</span>
        </> : null}
        {expired ? <><strong>Vencido</strong><span>Generá uno nuevo si todavía lo necesitás.</span></> : null}
        {loading ? <><strong aria-hidden="true">······</strong><span>Generando código…</span></> : null}
        {state.status === "error" ? <><strong aria-hidden="true">—</strong><span>Sin código</span></> : null}
      </div>
      <div className="info-note compact maintenance-code-help">
        <b>Cómo usarlo</b>
        <ol>
          <li>En el fichador, mantené presionado el título <b>“Fichador de personal”</b> durante 5 segundos.</li>
          <li>Escribí este código en “Acceso de mantenimiento”.</li>
        </ol>
        <p>Sirve una sola vez y sólo en este dispositivo. Al generar otro, este deja de valer. El modo mantenimiento se cierra solo a los 10 minutos.</p>
      </div>
      {state.status === "error" ? <p className="error" role="alert">{state.message}</p> : null}
      <FormActions>
        <Button icon={RefreshCw} loading={loading} onClick={onRegenerate}>Generar nuevo código</Button>
        <Button variant="primary" onClick={close}>Listo</Button>
      </FormActions>
    </div>
  </Modal>;
}
