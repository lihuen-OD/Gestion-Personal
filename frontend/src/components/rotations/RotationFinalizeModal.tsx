import { AlertTriangle, Info, XCircle } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FormActions } from "../ui/FormControls";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { LoadingState } from "../ui/LoadingState";
import { shiftRotationApiService, type FinalizePreview, type ShiftRotation } from "../../services/api/shiftRotationApiService";
import { addDaysKey } from "../../utils/shiftRotationDraft";
import { formatCalendarDate } from "../../utils/date";
import { formatDurationMinutes } from "../../utils/hours";
import { describeLifecycleError, finalizeHasChanges, finalizeImpactSignature, stalePreviewOf, type LifecycleError } from "../../utils/shiftRotationLifecycle";
import { humanizeRotationMessage } from "../../utils/shiftRotation";

function rangeText(from: string, to: string | null) {
  return to ? `del ${formatCalendarDate(from)} al ${formatCalendarDate(to)}` : `desde el ${formatCalendarDate(from)}`;
}

function ImpactList({ title, empty, children, count, tone = "neutral" }: { title: string; empty: string; children: ReactNode; count: number; tone?: "neutral" | "warning" | "danger" }) {
  return (
    <section className={`rotation-finalize-impact is-${tone}`} aria-label={title}>
      <h4>{title} <span className="rotation-finalize-count">{count}</span></h4>
      {count ? <ul>{children}</ul> : <p className="rotation-finalize-empty">{empty}</p>}
    </section>
  );
}

/**
 * Finalización de una rotación (R4.8E, sólo RRHH): 1) último día, 2) vista
 * previa real del backend con todo lo que cambia, 3) confirmación explícita
 * con el `confirmationToken` de esa vista previa. Si la rotación cambió entre
 * la vista previa y la confirmación (`ROTATION_FINALIZE_STALE`), se muestra la
 * vista previa nueva y se exige confirmar otra vez. Cambiar la fecha invalida
 * la vista previa. Nada histórico se modifica: el backend cierra en el último
 * día y cancela sólo lo que nunca rigió.
 */
export function RotationFinalizeModal({ rotation, todayKey, close, onFinalized }: { rotation: ShiftRotation; todayKey: string; close: () => void; onFinalized: (result: { rotation: ShiftRotation; applied: FinalizePreview }) => void }) {
  const [lastDay, setLastDay] = useState(todayKey);
  const [preview, setPreview] = useState<FinalizePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LifecycleError | null>(null);
  const [staleNotice, setStaleNotice] = useState("");
  const baseId = useId();
  const ids = { lastDay: `${baseId}-last-day`, confirm: `${baseId}-confirm` };
  const dateError = lastDay && lastDay < todayKey ? `Elegí hoy (${formatCalendarDate(todayKey)}) o una fecha posterior: la finalización nunca rige sobre días pasados.` : !lastDay ? "Indicá el último día de vigencia." : undefined;
  const dateMessages = { hint: dateError ? undefined : `La rotación rige hasta ese día inclusive (los turnos nocturnos que empiezan ese día se conservan completos). Desde el ${lastDay ? formatCalendarDate(addDaysKey(lastDay, 1)) : "día siguiente"} deja de regir.`, error: dateError };
  const overlaps = preview?.transitionOverlaps.length ?? 0;

  const changeDate = (value: string) => {
    setLastDay(value);
    setPreview(null);
    setConfirmed(false);
    setFailure(null);
    setStaleNotice("");
  };

  const loadPreview = async () => {
    if (dateError || loading) return;
    setLoading(true);
    setFailure(null);
    setStaleNotice("");
    setConfirmed(false);
    try {
      setPreview(await shiftRotationApiService.finalizePreview(rotation.id, lastDay));
    } catch (reason) {
      setFailure(describeLifecycleError(reason, "No pudimos calcular el impacto de la finalización."));
    } finally {
      setLoading(false);
    }
  };

  const finalize = async () => {
    if (!preview || !confirmed || busy || overlaps) return;
    setBusy(true);
    setFailure(null);
    try {
      onFinalized(await shiftRotationApiService.finalize(rotation.id, preview.lastDay, preview.confirmationToken));
    } catch (reason) {
      const fresh = stalePreviewOf(reason);
      if (fresh) {
        const changed = finalizeImpactSignature(fresh) !== finalizeImpactSignature(preview);
        setPreview(fresh);
        setConfirmed(false);
        setStaleNotice(changed
          ? "La rotación cambió mientras revisabas y el impacto es distinto. Esta es la vista previa actualizada: revisala y confirmá de nuevo."
          : "La rotación se modificó mientras revisabas (el impacto no cambió). Por seguridad, confirmá de nuevo sobre los datos actuales.");
      } else {
        setFailure(describeLifecycleError(reason, "No pudimos finalizar la rotación. Revisá el impacto y volvé a intentar."));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Finalizar rotación" subtitle={`${rotation.name} · Las fechas anteriores y el historial no se modifican.`} close={close} closeDisabled={busy} size="wide">
      <div className="rotation-finalize">
        <div className="rotation-finalize-date">
          <div className="field-stack">
            <label htmlFor={ids.lastDay}>Último día de vigencia *</label>
            <input id={ids.lastDay} type="date" min={todayKey} value={lastDay} disabled={busy} data-modal-initial-focus aria-invalid={dateError ? true : undefined} aria-describedby={describedBy(ids.lastDay, dateMessages)} onChange={(event) => changeDate(event.target.value)} />
            <FieldMessages id={ids.lastDay} {...dateMessages} />
          </div>
          <Button type="button" variant="subtle" loading={loading} disabled={Boolean(dateError) || loading || busy} onClick={() => void loadPreview()}>{loading ? "Calculando..." : preview ? "Volver a calcular" : "Ver impacto"}</Button>
        </div>

        {staleNotice ? <div className="info-note warning rotation-grid-note" role="alert"><p><b>{staleNotice}</b></p></div> : null}
        {failure ? (
          <div className="rotation-save-error" role="alert">
            <p className="rotation-save-error-title"><AlertTriangle size={16} aria-hidden="true" />{failure.message}</p>
            {failure.details.length ? <ul>{failure.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          </div>
        ) : null}

        {loading && !preview ? <LoadingState text="Calculando el impacto..." /> : null}
        {!preview && !loading ? <p className="rotation-modal-lead">Elegí el último día y revisá el impacto antes de confirmar. Nada se modifica hasta la confirmación.</p> : null}

        {preview ? (
          <div className="rotation-finalize-preview" aria-live="polite">
            <p className="rotation-finalize-summary">
              Con último día <b>{formatCalendarDate(preview.lastDay)}</b>{finalizeHasChanges(preview) ? ", esto es lo que cambia:" : ": no hay pertenencias ni versiones que cambiar."}
            </p>
            <ImpactList title="Pertenencias que terminan ese día" count={preview.closeMembers.length} empty="Ninguna.">
              {preview.closeMembers.map((row) => <li key={row.id}><b>{row.employee}</b> · {row.crew} · {rangeText(row.effectiveFrom, row.effectiveTo)} → hasta el {formatCalendarDate(preview.lastDay)}</li>)}
            </ImpactList>
            <ImpactList title="Altas futuras que se cancelan" count={preview.cancelMembers.length} empty="Ninguna." tone={preview.cancelMembers.length ? "warning" : "neutral"}>
              {preview.cancelMembers.map((row) => <li key={row.id}><b>{row.employee}</b> · {row.crew} · {rangeText(row.effectiveFrom, row.effectiveTo)} (nunca rigió)</li>)}
            </ImpactList>
            <ImpactList title="Versiones de la grilla" count={preview.closeVersions.length + preview.deleteVersions.length} empty="Ninguna cambia.">
              {preview.closeVersions.map((row) => <li key={row.id}>Versión {rangeText(row.effectiveFrom, row.effectiveTo)} → termina el {formatCalendarDate(preview.lastDay)}</li>)}
              {preview.deleteVersions.map((row) => <li key={row.id}>Versión futura {rangeText(row.effectiveFrom, row.effectiveTo)} → se cancela (nunca rigió)</li>)}
            </ImpactList>
            <ImpactList title="Personas que quedan sin turno asignado" count={preview.withoutFixedShiftAfter.length} empty="Todas tienen un turno fijo u otra rotación después." tone={preview.withoutFixedShiftAfter.length ? "warning" : "neutral"}>
              {preview.withoutFixedShiftAfter.map((row) => <li key={row.employeeId}><b>{row.employee}</b> · sin turno fijo ni otra rotación desde el {formatCalendarDate(row.from)}</li>)}
            </ImpactList>
            {overlaps ? (
              <ImpactList title="Superposiciones con el turno siguiente" count={overlaps} empty="" tone="danger">
                {preview.transitionOverlaps.map((row, index) => <li key={`${row.employeeId}-${index}`}><b>{row.employee}</b> · {humanizeRotationMessage(`${row.outgoing} se superpone con ${row.incoming}`)}</li>)}
              </ImpactList>
            ) : null}
            {preview.restsAtTransition.length ? (
              <section className="rotation-finalize-impact is-info" aria-label="Descansos informados">
                <h4><Info size={14} aria-hidden="true" /> Descanso hasta el turno siguiente <span className="rotation-finalize-count">{preview.restsAtTransition.length}</span></h4>
                <ul>{preview.restsAtTransition.map((row) => <li key={row.employeeId}><b>{row.employee}</b> · {formatDurationMinutes(row.restMinutes)}</li>)}</ul>
                <p className="field-hint">Dato informativo: no hay un mínimo de descanso definido, así que no se marca como problema.</p>
              </section>
            ) : null}

            {overlaps ? (
              <p className="rotation-finalize-blocked" role="alert"><XCircle size={16} aria-hidden="true" />No se puede finalizar con este último día: el último turno de la rotación se superpone con el turno siguiente de alguna persona. Elegí otra fecha o ajustá su turno siguiente.</p>
            ) : (
              <div className="rotation-finalize-check">
                <input id={ids.confirm} type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
                <label htmlFor={ids.confirm}>Revisé el impacto y quiero finalizar la rotación con último día {formatCalendarDate(preview.lastDay)}.</label>
              </div>
            )}
          </div>
        ) : null}

        <FormActions>
          <Button type="button" onClick={close} disabled={busy}>Cancelar</Button>
          <Button type="button" variant="danger" loading={busy} disabled={!preview || !confirmed || busy || overlaps > 0 || loading} onClick={() => void finalize()}>{busy ? "Finalizando..." : "Finalizar rotación"}</Button>
        </FormActions>
      </div>
    </Modal>
  );
}
