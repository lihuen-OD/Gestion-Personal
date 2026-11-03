import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import { manualHoursConflictApiService, type ManualHoursConflict, type ManualHoursDecision } from "../../services/api/manualHoursConflictApiService";
import { approvalStatusLabel } from "../../services/api/timeEntryApiService";
import { formatCalendarDate, formatDateTime, formatInstantTime } from "../../utils/date";
import { formatDurationMinutes } from "../../utils/hours";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

// Revisión de una fichada sobre horas cargadas a mano
// (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md). La decisión la toma el
// backend; acá sólo se muestran sus números y se envía la elección.

export function manualHoursPersonLabel(conflict: Pick<ManualHoursConflict, "employee">) {
  return `${conflict.employee.lastName}, ${conflict.employee.firstName} · Legajo ${conflict.employee.legajo}`;
}

/** "+1 h 18 min" / "−1 h 18 min" / "Sin diferencia": horas fichadas menos horas cargadas. */
export function formatMinutesDifference(minutes: number) {
  if (!minutes) return "Sin diferencia";
  return `${minutes > 0 ? "+" : "−"}${formatDurationMinutes(Math.abs(minutes))}`;
}

export function manualHoursDecisionText(conflict: Pick<ManualHoursConflict, "decision">) {
  if (conflict.decision === "USE_CLOCK") return "Se usaron las horas fichadas.";
  if (conflict.decision === "KEEP_MANUAL") return "Se mantuvo la carga manual.";
  return "Revisión resuelta.";
}

export function ManualHoursConflictDialog({ conflict, close, onResolved }: { conflict: ManualHoursConflict; close: () => void; onResolved: (resolved: ManualHoursConflict) => void }) {
  const [current, setCurrent] = useState(conflict);
  const [pendingDecision, setPendingDecision] = useState<ManualHoursDecision | null>(null);
  const [reasonRequired, setReasonRequired] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [error, setError] = useState("");
  const pending = current.status === "PENDIENTE";
  const multipleDays = current.days.length > 1;

  const { isRunning, run } = useAsyncAction(async (decision: ManualHoursDecision) => {
    setError("");
    setPendingDecision(decision);
    try {
      const resolved = await manualHoursConflictApiService.resolve(current.id, decision, reasonRequired ? correctionReason : undefined);
      setCurrent(resolved);
      onResolved(resolved);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "MANUAL_HOURS_CORRECTION_REASON_REQUIRED") setReasonRequired(true);
      setError(getUserErrorMessage(caught, "No pudimos guardar la decisión. Intentá nuevamente."));
    } finally {
      setPendingDecision(null);
    }
  });

  const resolve = (decision: ManualHoursDecision) => {
    if (reasonRequired && correctionReason.trim().length < 2) {
      setError("Indicá el motivo de la corrección.");
      return;
    }
    void run(decision);
  };

  return (
    <Modal
      title={pending ? "Revisión pendiente" : "Revisión resuelta"}
      subtitle={`${manualHoursPersonLabel(current)} · ${formatCalendarDate(current.operationalDate)}`}
      close={close}
      closeDisabled={isRunning}
    >
      <div className="manual-hours-review">
        <div className="manual-hours-review-lead">
          <Badge tone={pending ? "warning" : "success"}>{pending ? "Revisión pendiente" : "Resuelta"}</Badge>
          <p>Se registró una fichada en una jornada que ya tenía horas cargadas manualmente.</p>
        </div>

        <dl className="manual-hours-review-metrics">
          <div><dt>Horas cargadas</dt><dd>{formatDurationMinutes(current.manualMinutes)}</dd></div>
          <div><dt>Horas fichadas</dt><dd>{formatDurationMinutes(current.clockMinutes)}</dd></div>
          <div><dt>Ingreso</dt><dd>{formatInstantTime(current.shift.startAt)}</dd></div>
          <div><dt>Salida</dt><dd>{current.shift.endAt ? formatInstantTime(current.shift.endAt) : "Sin salida"}</dd></div>
          <div><dt>Diferencia</dt><dd>{formatMinutesDifference(current.differenceMinutes)}</dd></div>
        </dl>

        {multipleDays ? (
          // Jornada que cruza medianoche: una sola revisión, con el detalle por fecha.
          <table className="manual-hours-review-days">
            <thead>
              <tr><th>Fecha</th><th>Cargadas</th><th>Fichadas</th></tr>
            </thead>
            <tbody>
              {current.days.map((day) => (
                <tr key={day.date}>
                  <td>{formatCalendarDate(day.date)}</td>
                  <td>{day.manualMinutes === null ? "Sin carga manual" : formatDurationMinutes(day.manualMinutes)}</td>
                  <td>{day.clockMinutes ? formatDurationMinutes(day.clockMinutes) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {current.days.some((day) => day.manualStatus) ? (
          <p className="manual-hours-review-muted">
            Estado de la carga manual: {[...new Set(current.days.flatMap((day) => (day.manualStatus ? [approvalStatusLabel(day.manualStatus)] : [])))].join(", ")}.
          </p>
        ) : null}

        {pending ? (
          <p className="info-note compact">
            Mientras no se decida, computan las horas cargadas manualmente. La fichada, sus fotos y la jornada quedan guardadas como evidencia con cualquiera de las dos opciones.
          </p>
        ) : (
          <p className="info-note compact" role="status">
            <CheckCircle2 size={14} /> {manualHoursDecisionText(current)}
            {current.resolvedByName ? ` Decidió ${current.resolvedByName}` : ""}
            {current.resolvedAt ? ` el ${formatDateTime(current.resolvedAt)}.` : ""}
          </p>
        )}

        {pending && reasonRequired ? (
          <label className="field">
            <span>Motivo de la corrección *</span>
            <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={600} rows={2} placeholder="Queda registrado en auditoría: el período ya fue enviado o aprobado." />
          </label>
        ) : null}

        {error ? <div className="rule-form-alert-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div> : null}

        <div className="form-actions manual-hours-review-actions">
          {pending ? (
            <>
              <Button variant="subtle" onClick={() => resolve("KEEP_MANUAL")} disabled={isRunning} loading={pendingDecision === "KEEP_MANUAL"}>
                {pendingDecision === "KEEP_MANUAL" ? "Guardando..." : "Mantener carga manual"}
              </Button>
              <Button variant="primary" onClick={() => resolve("USE_CLOCK")} disabled={isRunning} loading={pendingDecision === "USE_CLOCK"}>
                {pendingDecision === "USE_CLOCK" ? "Guardando..." : "Usar horas fichadas"}
              </Button>
            </>
          ) : (
            <Button variant="subtle" onClick={close}>Cerrar</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
