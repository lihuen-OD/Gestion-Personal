import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, Hourglass, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import {
  noveltyApiService,
  type NoveltyCoverageDayDetail,
  type NoveltyCoverageResolution,
} from "../../services/api/noveltyApiService";
import type {
  NoveltyCoverageItem,
  NoveltyCoverageReviewReason,
  NoveltyCoverageState,
} from "../../types/workedTimeAccounting.types";
import { formatCalendarDate, formatDateTime } from "../../utils/date";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";
import { noveltyColorClass } from "../../utils/noveltyColor";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";

const statePresentation: Record<NoveltyCoverageState, { label: string; detail: string }> = {
  COUNTED: { label: "Computa", detail: "Suma al total computable" },
  INFORMATIVE: { label: "Informativa", detail: "Visible, no suma" },
  PENDING_APPROVAL: { label: "Pendiente", detail: "No suma hasta su aprobación" },
  REVIEW_REQUIRED: { label: "Revisar", detail: "No suma hasta resolver la revisión" },
};

const reasonLabels: Record<NoveltyCoverageReviewReason, string> = {
  SCHEDULE_UNRESOLVED: "No se pudo determinar la jornada esperada de ese día.",
  RESOLUTION_OUTDATED: "Las horas trabajadas cambiaron desde la última resolución.",
  REAL_WORK_ON_INCOMPATIBLE: "La novedad no puede coexistir con el trabajo registrado.",
  REAL_WORK_EXCEEDS_EXPECTED: "El trabajo más la cobertura supera la jornada esperada.",
  REAL_WORK_WITHOUT_EXPECTED: "Hay trabajo registrado, pero no existe una jornada esperada para validarlo.",
};

export function noveltyCoverageStateLabel(state: NoveltyCoverageState) {
  return statePresentation[state].label;
}

export function noveltyCoverageReasonLabel(reason: NoveltyCoverageReviewReason) {
  return reasonLabels[reason];
}

function StateIcon({ state }: { state: NoveltyCoverageState }) {
  if (state === "REVIEW_REQUIRED") return <AlertTriangle size={12} aria-hidden="true" />;
  if (state === "PENDING_APPROVAL") return <Hourglass size={12} aria-hidden="true" />;
  if (state === "INFORMATIVE") return <Info size={12} aria-hidden="true" />;
  return <Clock3 size={12} aria-hidden="true" />;
}

export function NoveltyCoverageChip({ item, onReview, compact = false }: { item: NoveltyCoverageItem; onReview?: (item: NoveltyCoverageItem) => void; compact?: boolean }) {
  const presentation = statePresentation[item.state];
  const className = [
    "novelty-coverage-chip",
    `is-${item.state.toLowerCase().replace("_", "-")}`,
    noveltyColorClass(item.uiColor ?? undefined, item.noveltyTypeId),
    compact ? "is-compact" : "",
  ].filter(Boolean).join(" ");
  const content = (
    <>
      <StateIcon state={item.state} />
      <span className="novelty-coverage-chip-name">{item.label || item.code || "Novedad"}</span>
      <span className="novelty-coverage-chip-time">{formatCompactDurationMinutes(item.minutes)}</span>
      <span className="novelty-coverage-chip-state">{presentation.label}</span>
    </>
  );
  const description = `${item.label || item.code || "Novedad"}: ${formatDurationMinutes(item.minutes)}. ${presentation.detail}.`;
  if (item.reviewRequired && onReview) {
    return <button type="button" className={className} title={description} aria-label={`${description} Abrir revisión.`} onClick={() => onReview(item)}>{content}</button>;
  }
  return <span className={className} title={description} aria-label={description}>{content}</span>;
}

export function NoveltyCoverageChipList({ items, onReview, compact = false }: { items: NoveltyCoverageItem[]; onReview?: (item: NoveltyCoverageItem) => void; compact?: boolean }) {
  if (!items.length) return null;
  return <div className="novelty-coverage-chip-list">{items.map((item) => <NoveltyCoverageChip key={`${item.noveltyId}-${item.noveltyTypeId}`} item={item} onReview={onReview} compact={compact} />)}</div>;
}

/**
 * Resumen no interactivo para celdas densas de `/horas`. La celda completa
 * ya es el botón que abre el detalle, por lo que estos chips nunca crean un
 * botón anidado. Estado, nombre y duración siguen visibles sin depender sólo
 * del color; el resto queda disponible en el popover.
 */
export function NoveltyCoverageCompactList({ items, maxVisible = 1 }: { items: NoveltyCoverageItem[]; maxVisible?: number }) {
  if (!items.length) return null;
  const visible = items.slice(0, Math.max(1, maxVisible));
  const hiddenCount = items.length - visible.length;
  return (
    <span className="day-cell-novelty-chips" aria-hidden="true">
      {visible.map((item) => {
        const presentation = statePresentation[item.state];
        return (
          <span
            key={`${item.noveltyId}-${item.noveltyTypeId}`}
            className={`day-cell-novelty-chip is-${item.state.toLowerCase().replace("_", "-")} ${noveltyColorClass(item.uiColor ?? undefined, item.noveltyTypeId)}`}
            title={`${item.label || item.code || "Novedad"}: ${formatDurationMinutes(item.minutes)}. ${presentation.detail}.`}
          >
            <span className="day-cell-novelty-chip-main">
              <StateIcon state={item.state} />
              <span>{item.label || item.code || "Novedad"}</span>
              <b>{formatCompactDurationMinutes(item.minutes)}</b>
            </span>
            <small>{presentation.label}</small>
          </span>
        );
      })}
      {hiddenCount > 0 ? <span className="day-cell-novelty-more" title={`${hiddenCount} novedad(es) más`}>+{hiddenCount}</span> : null}
    </span>
  );
}

function parseHoursAndMinutes(value: string) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  return total >= 1 && total <= 1440 ? total : null;
}

function resolutionText(day: NoveltyCoverageDayDetail) {
  if (day.resolution === "CONFIRMED_ZERO") return "0 h confirmadas";
  if (day.resolution === "SET_BASE_MINUTES") return `${formatDurationMinutes(day.resolvedBaseMinutes ?? 0)} base`;
  return "Sin resolución manual";
}

export type NoveltyCoverageReviewTarget = { item: NoveltyCoverageItem; date: string; employeeId?: string; period?: string; workedMinutes?: number };

export function NoveltyCoverageResolutionModal({ target, close, onResolved }: { target: NoveltyCoverageReviewTarget; close: () => void; onResolved: () => void }) {
  const [day, setDay] = useState<NoveltyCoverageDayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState<NoveltyCoverageResolution>("CONFIRMED_ZERO");
  const [baseTime, setBaseTime] = useState("08:00");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    noveltyApiService.getCoverage(target.item.noveltyId)
      .then((coverage) => {
        if (cancelled) return;
        const selectedDay = coverage.days.find((candidate) => candidate.date.slice(0, 10) === target.date);
        if (!selectedDay) throw new Error("coverage day missing");
        setDay(selectedDay);
        if (selectedDay.resolution === "SET_BASE_MINUTES" && selectedDay.resolvedBaseMinutes) {
          const hours = Math.floor(selectedDay.resolvedBaseMinutes / 60);
          const minutes = selectedDay.resolvedBaseMinutes % 60;
          setBaseTime(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
        }
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos cargar el detalle de cobertura. Actualizá la pantalla e intentá nuevamente.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [target.item.noveltyId, target.date]);

  const isIncompatible = target.item.reviewReasons.includes("REAL_WORK_ON_INCOMPATIBLE");
  const allowsManualResolution = day?.outcome === "SCHEDULE_UNRESOLVED" || day?.outcome === "COVERED";
  const allowsSetBase = allowsManualResolution && !isIncompatible;
  const baseMinutes = useMemo(() => parseHoursAndMinutes(baseTime), [baseTime]);
  const previewMinutes = baseMinutes && day ? Math.round(baseMinutes * day.multiplier) : 0;

  const submit = async () => {
    if (!day || !allowsManualResolution) return;
    if (note.trim().length < 5) return setError("Escribí una nota de al menos 5 caracteres. Quedará guardada en la trazabilidad.");
    if (resolution === "SET_BASE_MINUTES" && !baseMinutes) return setError("Indicá las horas base en formato HH:mm, entre 00:01 y 24:00.");
    setSaving(true);
    setError("");
    try {
      await noveltyApiService.resolveCoverageDay(target.item.noveltyId, target.date, {
        resolution,
        baseMinutes: resolution === "SET_BASE_MINUTES" ? baseMinutes : null,
        note: note.trim(),
        correctionReason: note.trim(),
      });
      onResolved();
      close();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "NOVELTY_COVERAGE_EXCEEDS_EXPECTED") setError("El trabajo registrado más la cobertura superaría la jornada esperada. Corregí las horas o indicá una cobertura menor.");
      else if (reason instanceof ApiError && reason.code === "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED") setError("Esta novedad no admite horas en este conflicto. Corregí el trabajo registrado o gestioná la novedad.");
      else if (reason instanceof ApiError && ["NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW", "NOVELTY_COVERAGE_DAY_NOT_FOUND"].includes(reason.code)) {
        setError(getUserErrorMessage(reason, "La cobertura cambió mientras la estabas revisando. Actualizamos los datos para que veas el estado vigente."));
        onResolved();
      } else setError(getUserErrorMessage(reason, "No pudimos guardar la resolución. Actualizá la pantalla e intentá nuevamente."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Revisar ${target.item.label || target.item.code || "novedad"}`} subtitle={formatCalendarDate(target.date)} close={close} closeDisabled={saving}>
      <div className="form-stack novelty-coverage-resolution">
        {loading ? <LoadingState text="Cargando cobertura del día..." /> : null}
        {!loading && day ? (
          <>
            <div className="novelty-coverage-review-summary">
              <div><span>Trabajo registrado</span><b>{target.workedMinutes == null ? "No disponible" : formatDurationMinutes(target.workedMinutes)}</b><small>Se conserva como trabajo real</small></div>
              <div><span>Jornada esperada</span><b>{day.expectedMinutes == null ? "Sin resolver" : formatDurationMinutes(day.expectedMinutes)}</b></div>
              <div><span>Cobertura actual</span><b>{formatDurationMinutes(day.effectiveBaseMinutes)}</b></div>
              <div><span>Para liquidación</span><b>{formatDurationMinutes(day.computedMinutes)}</b></div>
            </div>
            <div className="info-note compact warning">
              <b>Por qué requiere revisión</b>
              {target.item.reviewReasons.map((reason) => <p key={reason}>{reasonLabels[reason]}</p>)}
            </div>
            {day.resolvedAt || day.resolutionNote ? (
              <div className="info-note compact">
                <b>Última resolución: {resolutionText(day)}</b>
                <p>{[day.resolvedBy, day.resolvedAt ? formatDateTime(day.resolvedAt) : null].filter(Boolean).join(" · ") || "Autor no disponible"}</p>
                {day.resolutionNote ? <p>Nota: {day.resolutionNote}</p> : null}
              </div>
            ) : null}
            {allowsManualResolution ? (
              <fieldset className="novelty-resolution-options">
                <legend>Resolución admitida</legend>
                <label><input type="radio" name="coverage-resolution" checked={resolution === "CONFIRMED_ZERO"} onChange={() => setResolution("CONFIRMED_ZERO")} data-modal-initial-focus autoFocus /> <span><b>Confirmar 0 h de cobertura</b><small>La novedad queda visible, pero no aporta horas este día.</small></span></label>
                {allowsSetBase ? <label><input type="radio" name="coverage-resolution" checked={resolution === "SET_BASE_MINUTES"} onChange={() => setResolution("SET_BASE_MINUTES")} /> <span><b>Indicar horas base</b><small>El backend valida que sean compatibles con el trabajo y la jornada.</small></span></label> : null}
              </fieldset>
            ) : (
              <div className="info-note compact warning"><b>Este caso no admite horas ni confirmación en cero.</b><p>Corregí el trabajo registrado o rechazá/eliminá la novedad desde su circuito correspondiente.</p></div>
            )}
            {allowsSetBase && resolution === "SET_BASE_MINUTES" ? (
              <label>Horas base (HH:mm)<input type="time" min="00:01" max="24:00" value={baseTime} onChange={(event) => setBaseTime(event.target.value)} />
                <small className="field-help">Vista previa: {baseMinutes ? `${formatDurationMinutes(baseMinutes)} × ${day.multiplier} = ${formatDurationMinutes(previewMinutes)} para liquidación` : "ingresá una duración válida"}.</small>
              </label>
            ) : null}
            {allowsManualResolution ? <label>Nota obligatoria<textarea spellCheck lang="es-AR" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explicá la decisión y su respaldo" /></label> : null}
            <div className="novelty-corrective-links">
              {target.employeeId && target.period ? <Link className="table-link" to={`/horas/${target.employeeId}?period=${target.period}`} onClick={close}>Corregir horas del legajo</Link> : null}
              <Link className="table-link" to="/novedades" onClick={close}>Gestionar la novedad</Link>
            </div>
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions"><Button variant="subtle" onClick={close} disabled={saving}>Cancelar</Button>{day && allowsManualResolution ? <Button variant="primary" onClick={submit} disabled={saving}>{saving ? "Guardando..." : "Guardar resolución"}</Button> : null}</div>
      </div>
    </Modal>
  );
}
