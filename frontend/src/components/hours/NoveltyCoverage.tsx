import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, Hourglass, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, getUserErrorMessage } from "../../services/api/apiClient";
import {
  noveltyApiService,
  type NoveltyCoverageDayDetail,
  type NoveltyCoverageDetail,
  type NoveltyCoverageResolutionAction,
} from "../../services/api/noveltyApiService";
import type {
  NoveltyCoverageItem,
  NoveltyCoverageReviewReason,
  NoveltyCoverageState,
} from "../../types/workedTimeAccounting.types";
import { formatCalendarDate, formatDateTime } from "../../utils/date";
import { formatCompactDurationMinutes, formatDurationMinutes, formatDayDurationInput, parseDayDurationInput } from "../../utils/hours";
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
  COVERAGE_TOTAL_EXCEEDS_EXPECTED: "Las novedades de este día, junto con el trabajo registrado, superan la jornada esperada. Ninguna suma hasta que indiques cuál no cubre este día o corrijas la novedad, el trabajo o el turno.",
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
  if (onReview) {
    return <button type="button" className={className} title={description} aria-label={`${description} ${item.reviewRequired ? "Abrir revisión." : "Ver detalle."}`} onClick={() => onReview(item)}>{content}</button>;
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

function resolutionText(day: NoveltyCoverageDayDetail) {
  if (day.resolution === "CONFIRMED_ZERO") return "0 h confirmadas";
  if (day.resolution === "SET_BASE_MINUTES") return `${formatDurationMinutes(day.resolvedBaseMinutes ?? 0)} base`;
  return "Sin resolución manual";
}

export type NoveltyCoverageReviewTarget = { item: NoveltyCoverageItem; date: string; employeeId?: string; period?: string; workedMinutes?: number; computableMinutes?: number };

type CoverageTypeInfo = NoveltyCoverageDetail["novelty"]["noveltyType"];

/** Máximo de un ajuste manual del día (§19); null si no hay tope propio. Mismo criterio que el backend. */
function adjustmentMaxMinutes(type: CoverageTypeInfo | null, quantityMinutes: number | null, day: Pick<NoveltyCoverageDayDetail, "outcome" | "expectedMinutes"> | null) {
  if (!type?.coverageMode || !day) return null;
  if (type.coverageMode === "FIXED_MINUTES") return type.coverageFixedMinutes ?? 0;
  if (type.coverageMode === "MANUAL_MINUTES") return quantityMinutes ?? 0;
  if (type.coverageMode === "EXPECTED_SCHEDULE") return day.outcome === "SCHEDULE_UNRESOLVED" || day.expectedMinutes == null ? null : day.expectedMinutes;
  return 0;
}

/** Cuánto cubre el tipo según su configuración (§17): fijo, al cargar o según la jornada. */
function configuredValueText(type: CoverageTypeInfo | null, quantityMinutes: number | null | undefined) {
  if (!type?.coverageMode) return "No disponible";
  if (type.coverageMode === "FIXED_MINUTES") return `${formatDurationMinutes(type.coverageFixedMinutes ?? 0)} fijas por día`;
  if (type.coverageMode === "MANUAL_MINUTES") return quantityMinutes ? `${formatDurationMinutes(quantityMinutes)} indicadas al cargar` : "Cantidad indicada al cargar";
  if (type.coverageMode === "EXPECTED_SCHEDULE") return "Según la jornada que debía cumplir";
  return "No registra tiempo";
}

/**
 * Detalle y revisión de un día de cobertura (NOVELTY_COVERAGE_ENGINE.md §17
 * a §19). Mismo modal en dos modos: DETAIL para un día ya calculado ("Ajuste
 * excepcional del día") y REVIEW para un día pendiente. El ajuste va de 0 al
 * máximo que el tipo admite ese día (valor fijo, cantidad cargada o jornada
 * conocida); sin tope propio sólo si la jornada de un tipo "según jornada"
 * no se pudo determinar. Nunca depende del nombre del tipo.
 */
export function NoveltyCoverageResolutionModal({ target, close, onResolved }: { target: NoveltyCoverageReviewTarget; close: () => void; onResolved: () => void }) {
  const [day, setDay] = useState<NoveltyCoverageDayDetail | null>(null);
  const [coverageType, setCoverageType] = useState<CoverageTypeInfo | null>(null);
  const [quantityMinutes, setQuantityMinutes] = useState<number | null>(null);
  const [canAdjust, setCanAdjust] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState<NoveltyCoverageResolutionAction>("CONFIRMED_ZERO");
  const [baseTime, setBaseTime] = useState("08:00");
  const [note, setNote] = useState("");
  const mode = target.item.reviewRequired ? "REVIEW" : "DETAIL";

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
        setCoverageType(coverage.novelty.noveltyType);
        setQuantityMinutes(coverage.novelty.quantityMinutes ?? null);
        setCanAdjust(coverage.canAdjust ?? false);
        // Valor inicial: el ajuste vigente, la cobertura actual o el máximo del día.
        const initial = selectedDay.resolution === "SET_BASE_MINUTES" && selectedDay.resolvedBaseMinutes
          ? selectedDay.resolvedBaseMinutes
          : selectedDay.effectiveBaseMinutes || adjustmentMaxMinutes(coverage.novelty.noveltyType, coverage.novelty.quantityMinutes ?? null, selectedDay);
        if (initial) setBaseTime(formatDayDurationInput(initial));
      })
      .catch(() => {
        if (!cancelled) setError("No pudimos cargar el detalle de cobertura. Actualizá la pantalla e intentá nuevamente.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [target.item.noveltyId, target.date]);

  // Ajuste de un día (§17 a §19): entre 0 y el máximo que el tipo admite ese
  // día (valor fijo, cantidad cargada o jornada conocida). El backend valida lo mismo.
  const blocksHours = target.item.reviewReasons.some((reason) => reason === "REAL_WORK_ON_INCOMPATIBLE" || reason === "COVERAGE_TOTAL_EXCEEDS_EXPECTED");
  const unresolved = day?.outcome === "SCHEDULE_UNRESOLVED";
  const coverageMode = coverageType?.coverageMode;
  const adjustable = canAdjust && Boolean(day) && Boolean(coverageMode) && coverageMode !== "NONE";
  // Sin tope propio: sólo un tipo "según jornada" cuya jornada no se pudo determinar.
  const unbounded = coverageMode === "EXPECTED_SCHEDULE" && (unresolved || day?.expectedMinutes == null);
  const maxMinutes = unbounded ? null : adjustmentMaxMinutes(coverageType, quantityMinutes, day);
  const allowsHours = adjustable && !blocksHours && (unbounded || (maxMinutes ?? 0) > 0);
  const effective = day?.effectiveBaseMinutes ?? 0;
  const allowsZero = adjustable && (effective > 0 || unresolved || (day?.reviewStatus === "RESOLVED" && day.resolution !== "CONFIRMED_ZERO"));
  const allowsRestore = adjustable && day?.reviewStatus === "RESOLVED";
  const options: NoveltyCoverageResolutionAction[] = [
    ...(allowsHours ? ["SET_BASE_MINUTES" as const] : []),
    ...(allowsZero ? ["CONFIRMED_ZERO" as const] : []),
    ...(allowsRestore ? ["RESTORE_AUTOMATIC" as const] : []),
  ];
  const allowsManualResolution = options.length > 0;
  const selected: NoveltyCoverageResolutionAction | null = options.includes(resolution) ? resolution : options[0] ?? null;
  const baseMinutes = useMemo(() => parseDayDurationInput(baseTime), [baseTime]);
  const previewMinutes = baseMinutes && day ? Math.round(baseMinutes * day.multiplier) : 0;
  const maxText = maxMinutes != null ? `Máximo permitido: ${formatDurationMinutes(maxMinutes)} (${coverageMode === "MANUAL_MINUTES" ? "cantidad cargada" : coverageMode === "EXPECTED_SCHEDULE" ? "jornada del día" : "valor de la novedad"}).` : "La jornada de ese día no se pudo determinar.";

  const submit = async () => {
    if (!day || !selected) return;
    if (note.trim().length < 5) return setError("Escribí una nota de al menos 5 caracteres. Quedará guardada en la trazabilidad.");
    if (selected === "SET_BASE_MINUTES" && !baseMinutes) return setError("Indicá las horas base en formato HH:mm, entre 00:01 y 24:00.");
    if (selected === "SET_BASE_MINUTES" && maxMinutes != null && baseMinutes! > maxMinutes) return setError(`La cobertura de este día no puede superar ${formatDurationMinutes(maxMinutes)}.`);
    setSaving(true);
    setError("");
    try {
      await noveltyApiService.resolveCoverageDay(target.item.noveltyId, target.date, {
        resolution: selected,
        baseMinutes: selected === "SET_BASE_MINUTES" ? baseMinutes : null,
        note: note.trim(),
        correctionReason: note.trim(),
      });
      onResolved();
      close();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED") setError(getUserErrorMessage(reason, "Este día no admite esa resolución. Confirmá 0 h o corregí la novedad."));
      else if (reason instanceof ApiError && ["NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW", "NOVELTY_COVERAGE_DAY_NOT_FOUND", "NOVELTY_COVERAGE_DAY_NOT_RESOLVED"].includes(reason.code)) {
        setError(getUserErrorMessage(reason, "La cobertura cambió mientras la estabas revisando. Actualizamos los datos para que veas el estado vigente."));
        onResolved();
      } else setError(getUserErrorMessage(reason, "No pudimos guardar la resolución. Actualizá la pantalla e intentá nuevamente."));
    } finally {
      setSaving(false);
    }
  };

  const title = `${mode === "REVIEW" ? "Revisar" : "Detalle de"} ${target.item.label || target.item.code || "novedad"}`;
  return (
    <Modal title={title} subtitle={formatCalendarDate(target.date)} close={close} closeDisabled={saving}>
      <div className="form-stack novelty-coverage-resolution">
        {loading ? <LoadingState text="Cargando cobertura del día..." /> : null}
        {!loading && day ? (
          <>
            <div className="novelty-coverage-review-summary">
              <div><span>Valor configurado</span><b>{configuredValueText(coverageType, quantityMinutes)}</b><small>Lo define el tipo de novedad</small></div>
              <div><span>Trabajo registrado</span><b>{target.workedMinutes == null ? "No disponible" : formatDurationMinutes(target.workedMinutes)}</b><small>Se conserva como trabajo real</small></div>
              <div><span>Jornada esperada</span><b>{day.expectedMinutes == null ? "Sin resolver" : formatDurationMinutes(day.expectedMinutes)}</b></div>
              <div><span>Cobertura actual</span><b>{formatDurationMinutes(day.effectiveBaseMinutes)}</b></div>
              {target.computableMinutes != null ? <div><span>Computable del día</span><b>{formatDurationMinutes(target.computableMinutes)}</b><small>Trabajo real + cobertura válida</small></div> : null}
              <div><span>Para liquidación</span><b>{formatDurationMinutes(day.computedMinutes)}</b></div>
            </div>
            <div className="info-note compact">
              <b>Reglas aplicadas</b>
              <p>{day.label}{day.multiplier !== 1 ? ` · Multiplicador ×${day.multiplier}` : ""}{day.shiftTemplate ? ` · Turno ${day.shiftTemplate.name}` : ""} · {day.countsTowardTotal ? "Suma al total computable" : "Informativa, no suma"}</p>
            </div>
            {target.item.reviewReasons.length ? (
              <div className="info-note compact warning">
                <b>Por qué requiere revisión</b>
                {target.item.reviewReasons.map((reason) => <p key={reason}>{reasonLabels[reason]}</p>)}
              </div>
            ) : null}
            {day.resolvedAt || day.resolutionNote ? (
              <div className="info-note compact">
                <b>Última resolución: {resolutionText(day)}</b>
                <p>{[day.resolvedBy, day.resolvedAt ? formatDateTime(day.resolvedAt) : null].filter(Boolean).join(" · ") || "Autor no disponible"}</p>
                {day.resolutionNote ? <p>Nota: {day.resolutionNote}</p> : null}
              </div>
            ) : null}
            {allowsManualResolution ? (
              <fieldset className="novelty-resolution-options">
                <legend>{mode === "REVIEW" ? "Resolución admitida" : "Ajuste excepcional del día"}</legend>
                {mode === "DETAIL" ? <small className="field-help">Corrige sólo la cobertura de esta novedad en este día. Prevalece sobre la regla del tipo hasta que restaures el cálculo automático.</small> : null}
                {allowsHours ? <label><input type="radio" name="coverage-resolution" checked={selected === "SET_BASE_MINUTES"} onChange={() => setResolution("SET_BASE_MINUTES")} data-modal-initial-focus={selected === "SET_BASE_MINUTES" || undefined} autoFocus={selected === "SET_BASE_MINUTES"} /> <span><b>Indicar horas del día</b><small>{maxText}</small></span></label> : null}
                {allowsZero ? <label><input type="radio" name="coverage-resolution" checked={selected === "CONFIRMED_ZERO"} onChange={() => setResolution("CONFIRMED_ZERO")} data-modal-initial-focus={selected === "CONFIRMED_ZERO" || undefined} autoFocus={selected === "CONFIRMED_ZERO"} /> <span><b>Confirmar 0 h de cobertura</b><small>La novedad queda visible, pero no aporta horas este día.</small></span></label> : null}
                {allowsRestore ? <label><input type="radio" name="coverage-resolution" checked={selected === "RESTORE_AUTOMATIC"} onChange={() => setResolution("RESTORE_AUTOMATIC")} data-modal-initial-focus={selected === "RESTORE_AUTOMATIC" || undefined} autoFocus={selected === "RESTORE_AUTOMATIC"} /> <span><b>Restaurar cálculo automático</b><small>Deshace el ajuste manual y vuelve a la regla del tipo.</small></span></label> : null}
              </fieldset>
            ) : mode === "REVIEW" ? (
              <div className="info-note compact warning"><b>Este caso no admite horas ni confirmación en cero.</b><p>Corregí el trabajo registrado o rechazá/eliminá la novedad desde su circuito correspondiente.</p></div>
            ) : null}
            {allowsHours && selected === "SET_BASE_MINUTES" ? (
              <label>Horas base (HH:mm)<input type="time" min="00:01" max={maxMinutes != null ? formatDayDurationInput(maxMinutes) : "24:00"} value={baseTime} onChange={(event) => setBaseTime(event.target.value)} />
                <small className="field-help">{maxMinutes != null ? `${maxText} ` : ""}Vista previa: {baseMinutes ? `${formatDurationMinutes(baseMinutes)} × ${day.multiplier} = ${formatDurationMinutes(previewMinutes)} para liquidación` : "ingresá una duración válida"}.</small>
              </label>
            ) : null}
            {allowsManualResolution ? <label>Nota obligatoria<textarea spellCheck lang="es-AR" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explicá la decisión y su respaldo" /></label> : null}
            <div className="novelty-corrective-links">
              <small className="field-help">Otras correcciones (no cambian sólo la cobertura de este día):</small>
              {target.employeeId && target.period ? <Link className="table-link" to={`/horas/${target.employeeId}?period=${target.period}`} onClick={close}>Corregir horas del legajo</Link> : null}
              <Link className="table-link" to="/novedades" onClick={close}>Gestionar la novedad</Link>
            </div>
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="form-actions"><Button variant="subtle" onClick={close} disabled={saving}>{allowsManualResolution ? "Cancelar" : "Cerrar"}</Button>{day && allowsManualResolution ? <Button variant="primary" onClick={submit} disabled={saving}>{saving ? "Guardando..." : "Guardar resolución"}</Button> : null}</div>
      </div>
    </Modal>
  );
}
