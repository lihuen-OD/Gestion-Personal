import { LogIn, LogOut } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import type { ClockGuidance } from "../../services/api/clockGuidance";
import { formatTime } from "../../utils/date";
import { useIdleTimeout } from "./useIdleTimeout";

/** Sin respuesta, el diálogo se cierra solo: un kiosco compartido nunca queda bloqueado. */
export const EXIT_DECISION_IDLE_MS = 45_000;

/** "12 h 02 min" / "45 min": la duración que quedaría registrada. */
export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${String(rest).padStart(2, "0")} min` : `${rest} min`;
}

export type ExitDecisionAction = "entry" | "exit";

/**
 * R4.4 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.6): la persona apretó
 * SALIDA justo cuando empieza otro de sus turnos y el turno anterior ya había
 * terminado (posible olvido de salida), o la salida superó el máximo de la
 * jornada. Nada se registró todavía: elige qué quiso hacer. Registrar ENTRADA
 * es la opción recomendada (foco inicial). Las horas siempre las decide el
 * servidor con las fichadas reales; confirmar no saltea ningún límite.
 */
export function ExitDecisionDialog({ guidance, busy, error, onChoose, onCancel }: {
  guidance: ClockGuidance;
  busy: ExitDecisionAction | null;
  /** Error de la última elección (p. ej. la jornada cambió): se muestra sin cerrar el diálogo. */
  error?: string;
  onChoose: (action: ExitDecisionAction) => void;
  onCancel: () => void;
}) {
  useIdleTimeout(!busy, EXIT_DECISION_IDLE_MS, onCancel);
  const previousEnd = formatTime(guidance.previousBlock.endAt);
  const nextStart = guidance.nextBlock ? formatTime(guidance.nextBlock.startAt) : null;
  const limit = guidance.kind === "SHIFT_LIMIT_EXCEEDED";
  const title = limit ? "No pudimos registrar la salida" : `¿Estás ingresando a tu turno de las ${nextStart}?`;
  const subtitle = limit
    ? "Tu jornada anterior superó el máximo permitido y quedó para revisión de tu encargado."
    : `Tu turno anterior terminó a las ${previousEnd} y ahora tenés otro turno programado a las ${nextStart}.`;

  return (
    <Modal title={title} subtitle={subtitle} close={onCancel} closeDisabled={Boolean(busy)} className="exit-decision-modal">
      <div className="exit-decision" aria-busy={busy ? true : undefined}>
        {nextStart ? (
          <div className="exit-decision-option">
            <Button variant="primary" className="kiosk-action is-entry" icon={LogIn} data-autofocus disabled={Boolean(busy)} onClick={() => onChoose("entry")}>
              {busy === "entry" ? <><span className="kiosk-spinner" aria-hidden="true" />Registrando…</> : "Registrar ENTRADA"}
            </Button>
            <p className="exit-decision-hint">{limit ? `Ingresás a tu turno de las ${nextStart}.` : "Recomendado si estás empezando tu turno."}</p>
          </div>
        ) : null}
        {limit ? null : (
          <div className="exit-decision-option">
            <Button variant="primary" className="kiosk-action is-exit" icon={LogOut} disabled={Boolean(busy)} onClick={() => onChoose("exit")}>
              {busy === "exit" ? <><span className="kiosk-spinner" aria-hidden="true" />Registrando…</> : "Confirmar SALIDA anterior"}
            </Button>
            <p className="exit-decision-hint">
              Tu jornada quedará de {formatTime(guidance.openShiftStartAt)} a {formatTime(guidance.exitAt)} <span className="exit-decision-nowrap">({formatDuration(guidance.exitDurationMinutes)})</span>.
            </p>
          </div>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <Button type="button" variant="ghost" className="exit-decision-cancel" onClick={onCancel} disabled={Boolean(busy)}>
          {limit ? "Volver" : "Cancelar"}
        </Button>
      </div>
    </Modal>
  );
}
