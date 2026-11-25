import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { describedBy, FieldMessages } from "../ui/FieldMessages";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Section } from "../ui/Section";
import { ApiError } from "../../services/api/apiClient";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationVersion } from "../../services/api/shiftRotationApiService";
import { workforceApiService, type ShiftTemplate } from "../../services/api/workforceApiService";
import { confirmAction } from "../../services/appDialog";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../utils/date";
import { rotationCycleLabel, rotationWeekLabel } from "../../utils/shiftRotation";
import { buildGridModel, crewLabel, defaultVersionId, sortVersionsForSelect, versionOptionLabel } from "../../utils/shiftRotationGrid";
import {
  addDaysKey,
  cellsBeyondCycle,
  describeDraftSaveError,
  draftCellKey,
  draftDays,
  draftFromVersion,
  draftPayload,
  draftsEqual,
  eligibleTemplates,
  emptyDraft,
  isMondayKey,
  MAX_CYCLE_WEEKS,
  minimumNewVersionStart,
  missingDaysByCrew,
  resizeDraftCycle,
  setDraftCell,
  shiftDaysWithoutBlocks,
  type DraftSaveError,
  type VersionDraft,
} from "../../utils/shiftRotationDraft";
import { RotationCellEditorModal } from "./RotationCellEditorModal";
import { RotationCycleGrid, type GridCellTarget } from "./RotationCycleGrid";
import { RotationVersionConflictModal } from "./RotationVersionConflictModal";

export type VersionEditorMode = { kind: "create" } | { kind: "edit"; version: ShiftRotationVersion };

const EMPTY_SOURCE = "empty";

function dateErrors(draft: VersionDraft, minimum: string) {
  const errors: { effectiveFrom?: string; anchorWeekStart?: string } = {};
  if (!draft.effectiveFrom) errors.effectiveFrom = "Indicá desde qué fecha rige la versión.";
  else if (draft.effectiveFrom < minimum) errors.effectiveFrom = `Elegí el ${formatCalendarDate(minimum)} o una fecha posterior.`;
  if (!draft.anchorWeekStart) errors.anchorWeekStart = "Indicá el lunes que empieza la semana A.";
  else if (!isMondayKey(draft.anchorWeekStart)) errors.anchorWeekStart = "Elegí un lunes: cada semana del ciclo empieza un lunes.";
  return errors;
}

/**
 * Editor de una versión de la grilla (R4.8B2, sólo RRHH). Arma un borrador
 * completo y lo envía en un solo cuerpo (`POST` para una versión nueva,
 * `PATCH` con `expectedUpdatedAt` para una futura). No se puede guardar con
 * días sin configurar en equipos activos ni con fechas inválidas; el resto lo
 * valida el backend y sus errores se muestran sobre la grilla y en cada celda.
 * Ante cualquier error el borrador se conserva.
 */
export function RotationVersionEditor({ rotation, mode, onCancel, onSaved }: { rotation: ShiftRotation; mode: VersionEditorMode; onCancel: () => void; onSaved: (version: ShiftRotationVersion, created: boolean) => void }) {
  const todayKey = argentinaDateKey(new Date());
  const baseId = useId();
  const ids = { from: `${baseId}-from`, cycle: `${baseId}-cycle`, anchor: `${baseId}-anchor`, source: `${baseId}-source` };
  const creating = mode.kind === "create";
  const minimum = creating
    ? minimumNewVersionStart(rotation.status, rotation.versions, todayKey)
    : rotation.status === "INACTIVO" ? todayKey : addDaysKey(todayKey, 1);
  const versions = useMemo(() => sortVersionsForSelect(rotation.versions), [rotation.versions]);

  const [source, setSource] = useState(() => (creating ? defaultVersionId(rotation.versions, todayKey) ?? EMPTY_SOURCE : EMPTY_SOURCE));
  const [sourceStatus, setSourceStatus] = useState<"idle" | "loading" | "error">("idle");
  const [sourceRetry, setSourceRetry] = useState(0);
  const [draft, setDraft] = useState<VersionDraft>(() => (mode.kind === "edit" ? draftFromVersion(mode.version) : emptyDraft(minimum)));
  const [baseline, setBaseline] = useState<VersionDraft>(draft);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(mode.kind === "edit" ? mode.version.updatedAt : "");
  const [templates, setTemplates] = useState<ShiftTemplate[] | null>(null);
  const [templatesStatus, setTemplatesStatus] = useState<"loading" | "success" | "error">("loading");
  const [templatesRetry, setTemplatesRetry] = useState(0);
  const [editingCell, setEditingCell] = useState<GridCellTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DraftSaveError | null>(null);
  const [conflict, setConflict] = useState<ShiftRotationVersion | null>(null);
  const [conflictNote, setConflictNote] = useState("");
  const [showDateErrors, setShowDateErrors] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // El editor reemplaza a la grilla más abajo en la pestaña: al abrirlo se lleva a la vista y el foco va al primer campo.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    container.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    container.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let alive = true;
    setTemplatesStatus("loading");
    workforceApiService
      .shiftTemplates()
      .then((items) => {
        if (!alive) return;
        setTemplates(items);
        setTemplatesStatus("success");
      })
      .catch(() => {
        if (alive) setTemplatesStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [templatesRetry]);

  // Versión nueva: el borrador parte de una copia (conserva el ciclo y la semana A para que la alternancia siga) o vacío.
  useEffect(() => {
    if (!creating) return;
    if (source === EMPTY_SOURCE) {
      const next = emptyDraft(draft.effectiveFrom || minimum);
      setDraft(next);
      setBaseline(next);
      setSourceStatus("idle");
      return;
    }
    let alive = true;
    setSourceStatus("loading");
    shiftRotationApiService
      .version(rotation.id, source)
      .then((data) => {
        if (!alive) return;
        const next = draftFromVersion(data, { effectiveFrom: draft.effectiveFrom || minimum });
        setDraft(next);
        setBaseline(next);
        setSourceStatus("idle");
      })
      .catch(() => {
        if (alive) setSourceStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [source, sourceRetry]);

  const dirty = !draftsEqual(draft, baseline) || (creating && draft.effectiveFrom !== baseline.effectiveFrom);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const eligible = useMemo(() => eligibleTemplates(templates ?? [], rotation.shiftGroup.id), [templates, rotation.shiftGroup.id]);
  const sections = useMemo(() => buildGridModel({ cycleLengthWeeks: draft.cycleLengthWeeks, days: draftDays(draft), issues: saveError?.cellIssues ?? [] }, rotation.crews), [draft, rotation.crews, saveError]);
  const missing = useMemo(() => missingDaysByCrew(draft, rotation.crews), [draft, rotation.crews]);
  const missingTotal = missing.reduce((sum, entry) => sum + entry.count, 0);
  const emptyShiftDays = shiftDaysWithoutBlocks(draft);
  const errors = dateErrors(draft, minimum);
  // Un lunes mal elegido se avisa enseguida; los campos vacíos o la fecha mínima, al intentar guardar.
  const fromMessages = { hint: showDateErrors && errors.effectiveFrom ? undefined : `Desde el ${formatCalendarDate(minimum)} o posterior.`, error: showDateErrors ? errors.effectiveFrom : undefined };
  const anchorError = draft.anchorWeekStart || showDateErrors ? errors.anchorWeekStart : undefined;
  const anchorMessages = { hint: anchorError ? undefined : "Fija qué semana del calendario es la A; las demás se cuentan desde ahí.", error: anchorError };
  const canSave = !saving && !missingTotal && !emptyShiftDays && !Object.keys(errors).length && (creating || dirty) && sourceStatus === "idle";

  const update = (patch: Partial<VersionDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const changeCycle = async (weeks: number) => {
    const lost = cellsBeyondCycle(draft, weeks);
    if (lost) {
      const from = rotationWeekLabel(weeks);
      const to = rotationWeekLabel(draft.cycleLengthWeeks - 1);
      const ok = await confirmAction(`Al pasar a un ciclo de ${rotationCycleLabel(weeks)} se descartan ${lost} ${lost === 1 ? "día configurado" : "días configurados"} de ${from === to ? `la semana ${from}` : `las semanas ${from} a ${to}`}.`, { title: "Acortar el ciclo", confirmLabel: "Descartar y acortar", tone: "danger" });
      if (!ok) return;
    }
    setDraft((current) => resizeDraftCycle(current, weeks));
  };

  const changeSource = async (next: string) => {
    if (dirty && !(await confirmAction("Cambiar el punto de partida reemplaza la grilla que estás editando.", { title: "Reemplazar el borrador", confirmLabel: "Reemplazar", tone: "danger" }))) return;
    setSaveError(null);
    setSource(next);
  };

  const cancel = async () => {
    if (dirty && !(await confirmAction("Los cambios de esta versión todavía no se guardaron y se van a perder.", { title: "Descartar cambios", confirmLabel: "Descartar", tone: "danger" }))) return;
    onCancel();
  };

  const save = async () => {
    setShowDateErrors(true);
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = mode.kind === "edit"
        ? await shiftRotationApiService.updateVersion(rotation.id, mode.version.id, { ...draftPayload(draft), expectedUpdatedAt })
        : await shiftRotationApiService.createVersion(rotation.id, draftPayload(draft));
      onSaved(saved, creating);
    } catch (reason) {
      setSaveError(describeDraftSaveError(reason, rotation.crews));
    } finally {
      setSaving(false);
    }
  };

  const reviewConflict = async () => {
    if (mode.kind !== "edit") return;
    try {
      setConflict(await shiftRotationApiService.version(rotation.id, mode.version.id));
    } catch (reason) {
      setSaveError({ code: "", message: reason instanceof ApiError && reason.status === 404 ? "La versión ya no existe: otra persona la eliminó. Podés cancelar y crear una versión nueva." : "No pudimos leer la versión guardada. Tus cambios siguen en pantalla.", details: [], cellIssues: [], stale: false });
    }
  };

  const keepMine = () => {
    if (!conflict) return;
    setExpectedUpdatedAt(conflict.updatedAt);
    setBaseline(draftFromVersion(conflict));
    setConflict(null);
    setSaveError(null);
    setConflictNote("Conservaste tus cambios. Al guardar, van a reemplazar la versión que guardó la otra persona.");
  };

  const useCurrent = async () => {
    if (!conflict) return;
    if (!(await confirmAction("Se descartan todos los cambios que hiciste en esta versión.", { title: "Descartar mis cambios", confirmLabel: "Descartar", tone: "danger" }))) return;
    const next = draftFromVersion(conflict);
    setDraft(next);
    setBaseline(next);
    setExpectedUpdatedAt(conflict.updatedAt);
    setConflict(null);
    setSaveError(null);
    setConflictNote("");
  };

  const title = creating ? "Nueva versión de la grilla" : "Editar versión de la grilla";
  const subtitle = creating
    ? "La versión nueva rige desde la fecha indicada; la anterior termina el día previo."
    : "Sólo se editan versiones que todavía no rigieron. Los cambios se guardan juntos.";

  return (
    <div ref={containerRef} className="rotation-editor-anchor">
      <Section title={title} subtitle={subtitle} className="rotation-editor">
        <div className="rotation-editor-fields">
          <div className="field-stack">
            <label htmlFor={ids.from}>Vigente desde *</label>
            <input id={ids.from} type="date" min={minimum} value={draft.effectiveFrom} aria-invalid={fromMessages.error ? true : undefined} aria-describedby={describedBy(ids.from, fromMessages)} onChange={(event) => update({ effectiveFrom: event.target.value })} />
            <FieldMessages id={ids.from} {...fromMessages} />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.cycle}>Semanas del ciclo *</label>
            <select id={ids.cycle} value={draft.cycleLengthWeeks} aria-describedby={`${ids.cycle}-hint`} onChange={(event) => void changeCycle(Number(event.target.value))}>
              {Array.from({ length: MAX_CYCLE_WEEKS }, (_, index) => index + 1).map((weeks) => <option key={weeks} value={weeks}>{rotationCycleLabel(weeks)}</option>)}
            </select>
            <FieldMessages id={ids.cycle} hint="Después de la última semana el ciclo vuelve a la A." />
          </div>
          <div className="field-stack">
            <label htmlFor={ids.anchor}>Lunes de la semana A *</label>
            <input id={ids.anchor} type="date" value={draft.anchorWeekStart} aria-invalid={anchorError ? true : undefined} aria-describedby={describedBy(ids.anchor, anchorMessages)} onChange={(event) => update({ anchorWeekStart: event.target.value })} />
            <FieldMessages id={ids.anchor} {...anchorMessages} />
          </div>
          {creating ? (
            <div className="field-stack">
              <label htmlFor={ids.source}>Partir de</label>
              <select id={ids.source} value={source} aria-describedby={`${ids.source}-hint`} onChange={(event) => void changeSource(event.target.value)}>
                {versions.map((version) => <option key={version.id} value={version.id}>Versión {versionOptionLabel(version, todayKey).toLowerCase()}</option>)}
                <option value={EMPTY_SOURCE}>Grilla vacía</option>
              </select>
              <FieldMessages id={ids.source} hint={source === EMPTY_SOURCE ? "Todos los días empiezan sin configurar." : "Copia días, bloques, ciclo y semana A; después podés cambiarlos."} />
            </div>
          ) : null}
        </div>

        {conflictNote ? <div className="info-note rotation-grid-note" role="status"><p>{conflictNote}</p></div> : null}
        {saveError ? (
          <div className="rotation-save-error" role="alert">
            <p className="rotation-save-error-title"><AlertTriangle size={16} aria-hidden="true" />{saveError.message}</p>
            {saveError.details.length ? <ul>{saveError.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
            {saveError.cellIssues.length ? <p className="rotation-save-error-hint">Los días con problemas están marcados con «Revisar» en la grilla.</p> : null}
            {saveError.stale ? (
              <>
                <p className="rotation-save-error-hint">Tus cambios siguen en pantalla. Revisá la versión guardada antes de decidir si conservarlos o descartarlos.</p>
                <div className="rotation-save-error-actions">
                  <Button type="button" variant="subtle" onClick={() => void reviewConflict()}>Ver la versión guardada</Button>
                </div>
              </>
            ) : <p className="rotation-save-error-hint">Tus cambios siguen en pantalla: corregí y volvé a guardar.</p>}
          </div>
        ) : null}

        {templatesStatus === "error" ? (
          <div className="info-note warning rotation-grid-note" role="alert">
            <p><b>No pudimos cargar los turnos.</b> Podés revisar la grilla, pero para elegir turnos hace falta el catálogo.</p>
            <Button type="button" variant="subtle" onClick={() => setTemplatesRetry((value) => value + 1)}>Reintentar</Button>
          </div>
        ) : null}

        {sourceStatus === "loading" ? (
          <LoadingState text="Copiando la grilla..." />
        ) : sourceStatus === "error" ? (
          <ErrorState message="No pudimos copiar la versión elegida." onRetry={() => setSourceRetry((value) => value + 1)} />
        ) : sections.length ? (
          <RotationCycleGrid sections={sections} caption={`${title}: editá cada día con su botón`} onEditCell={templatesStatus === "success" ? setEditingCell : undefined} />
        ) : (
          <p className="rotation-editor-empty">La rotación no tiene equipos activos. Agregá un equipo para poder armar la grilla.</p>
        )}

        <div className="rotation-editor-footer">
          <div className="rotation-editor-status" role="status" aria-live="polite">
            {missingTotal ? (
              <p className="is-warning"><AlertTriangle size={15} aria-hidden="true" />Faltan {missingTotal} {missingTotal === 1 ? "día" : "días"} por configurar: {missing.map((entry) => `${crewLabel(entry.crew)} ${entry.count}`).join(", ")}. No se puede guardar una grilla incompleta.</p>
            ) : emptyShiftDays ? (
              <p className="is-warning"><AlertTriangle size={15} aria-hidden="true" />Hay {emptyShiftDays} {emptyShiftDays === 1 ? "día de trabajo" : "días de trabajo"} sin turno elegido.</p>
            ) : sections.length ? (
              <p className="is-ok"><CheckCircle2 size={15} aria-hidden="true" />Todos los días están configurados.{dirty ? " Hay cambios sin guardar." : creating ? "" : " Todavía no hay cambios para guardar."}</p>
            ) : null}
          </div>
          <div className="rotation-editor-actions">
            <Button type="button" onClick={() => void cancel()} disabled={saving}>Cancelar</Button>
            <Button type="button" variant="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>{saving ? "Guardando..." : "Guardar versión"}</Button>
          </div>
        </div>

        {editingCell ? (
          <RotationCellEditorModal
            target={editingCell}
            cell={draft.cells[draftCellKey(editingCell.crewId, editingCell.cycleWeekIndex, editingCell.weekday)] ?? null}
            templates={eligible}
            groupName={rotation.shiftGroup.name}
            close={() => setEditingCell(null)}
            onApply={(cell) => {
              setDraft((current) => setDraftCell(current, draftCellKey(editingCell.crewId, editingCell.cycleWeekIndex, editingCell.weekday), cell));
              setEditingCell(null);
            }}
          />
        ) : null}
        {conflict ? <RotationVersionConflictModal current={conflict} crews={rotation.crews} close={() => setConflict(null)} onKeepMine={keepMine} onUseCurrent={() => void useCurrent()} /> : null}
      </Section>
    </div>
  );
}
