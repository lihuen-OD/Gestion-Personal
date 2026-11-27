import { AlertTriangle, Coffee, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Section } from "../ui/Section";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationVersion, type ShiftRotationVersionSummary } from "../../services/api/shiftRotationApiService";
import { confirmAction } from "../../services/appDialog";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../utils/date";
import { humanizeRotationMessage, rotationCycleLabel } from "../../utils/shiftRotation";
import { addDaysKey } from "../../utils/shiftRotationDraft";
import { TOAST_SUCCESS_MS } from "../../utils/toast";
import {
  buildGridModel,
  defaultVersionId,
  gridIssueSummary,
  sortVersionsForSelect,
  versionOptionLabel,
  versionRangeText,
  versionTimeline,
  versionTimelineLabel,
} from "../../utils/shiftRotationGrid";
import { RotationCycleGrid } from "./RotationCycleGrid";
import { RotationVersionEditor, type VersionEditorMode } from "./RotationVersionEditor";

const TIMELINE_TONE = { CURRENT: "success", FUTURE: "info", PAST: "neutral" } as const;

/**
 * Grilla del ciclo en sólo lectura (R4.8B1). Las versiones llegan resumidas en
 * el detalle; la grilla completa de la elegida se pide al seleccionarla y se
 * conserva visible mientras se refresca (cambios de equipos). R4.8B2: RRHH
 * crea versiones nuevas y edita o elimina las que todavía no rigieron
 * (`locked` lo decide el backend); el resto queda en sólo lectura.
 */
function reopenText(versions: ShiftRotationVersionSummary[], target: ShiftRotationVersionSummary) {
  // Lo mismo que hace el backend al borrar: la anterior se extiende hasta el día previo a la siguiente (o a lo que cubría la borrada).
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const index = sorted.findIndex((item) => item.id === target.id);
  const previous = index > 0 ? sorted[index - 1] : null;
  if (!previous) return "No hay una versión anterior: en esas fechas la rotación queda sin grilla.";
  const next = sorted[index + 1];
  const reopenTo = next ? addDaysKey(next.effectiveFrom, -1) : target.effectiveTo;
  return `La versión anterior (desde el ${formatCalendarDate(previous.effectiveFrom)}) vuelve a regir ${reopenTo ? `hasta el ${formatCalendarDate(reopenTo)}` : "sin fecha de fin"}.`;
}

export function RotationGridPanel({ rotation, reloadToken, canEdit = false, onVersionsChanged }: { rotation: ShiftRotation; reloadToken: number; canEdit?: boolean; onVersionsChanged?: () => void }) {
  const todayKey = argentinaDateKey(new Date());
  const selectId = useId();
  const versions = useMemo(() => sortVersionsForSelect(rotation.versions), [rotation.versions]);
  const [selectedId, setSelectedId] = useState<string | null>(() => defaultVersionId(rotation.versions, todayKey));
  const [version, setVersion] = useState<ShiftRotationVersion | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const shownId = useRef<string | null>(null);
  const [editor, setEditor] = useState<VersionEditorMode | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  // Si la versión elegida desaparece (p. ej. se borró una futura), volver a la predeterminada.
  useEffect(() => {
    if (!selectedId || !rotation.versions.some((item) => item.id === selectedId)) setSelectedId(defaultVersionId(rotation.versions, todayKey));
  }, [rotation.versions]);

  useEffect(() => {
    if (!selectedId) {
      setVersion(null);
      setStatus("idle");
      return;
    }
    let alive = true;
    // Carga inicial o cambio de versión: indicador grande. Refresco de la misma versión: silencioso.
    if (shownId.current !== selectedId) setStatus("loading");
    shiftRotationApiService
      .version(rotation.id, selectedId)
      .then((data) => {
        if (!alive) return;
        shownId.current = data.id;
        setVersion(data);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [rotation.id, selectedId, reloadToken, retry]);

  const summary = rotation.versions.find((item) => item.id === selectedId) ?? null;
  const sections = useMemo(() => (version ? buildGridModel(version, rotation.crews) : []), [version, rotation.crews]);
  const issues = useMemo(() => (version ? gridIssueSummary(version.issues, rotation.crews) : { errors: [], warnings: [] }), [version, rotation.crews]);
  const timeline = summary ? versionTimeline(summary, todayKey) : null;

  const editable = canEdit && summary !== null && !summary.locked && version !== null && status === "success";

  const removeVersion = async () => {
    if (!summary || deleting) return;
    const ok = await confirmAction(`Se elimina la versión ${versionRangeText(summary)}, que todavía no rigió. ${reopenText(rotation.versions, summary)} Esta acción no se puede deshacer.`, { title: "Eliminar versión", confirmLabel: "Eliminar", tone: "danger" });
    if (!ok) return;
    setDeleting(true);
    setActionError("");
    try {
      await shiftRotationApiService.removeVersion(rotation.id, summary.id);
      setNotice("Versión eliminada.");
      onVersionsChanged?.();
    } catch (reason) {
      setActionError(humanizeRotationMessage(getUserErrorMessage(reason, "No pudimos eliminar la versión.")));
    } finally {
      setDeleting(false);
    }
  };

  if (editor) {
    return (
      <RotationVersionEditor
        rotation={rotation}
        mode={editor}
        onCancel={() => setEditor(null)}
        onSaved={(saved, created) => {
          setEditor(null);
          shownId.current = null;
          setSelectedId(saved.id);
          setNotice(created ? "Versión creada." : "Versión guardada.");
          onVersionsChanged?.();
        }}
      />
    );
  }

  const createButton = <Button variant="primary" onClick={() => { setActionError(""); setEditor({ kind: "create" }); }}><Plus size={16} /> Nueva versión</Button>;
  const selector = versions.length > 1 ? (
    <div className="rotation-version-select">
      <label htmlFor={selectId}>Versión</label>
      <select id={selectId} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
        {versions.map((item) => <option key={item.id} value={item.id}>{versionOptionLabel(item, todayKey)}</option>)}
      </select>
    </div>
  ) : undefined;

  const headerActions = selector || (canEdit && versions.length) ? (
    <div className="rotation-grid-actions">
      {selector}
      {canEdit && versions.length ? createButton : null}
    </div>
  ) : undefined;

  return (
    <Section title="Grilla del ciclo" subtitle="Turnos y descansos de cada equipo, de lunes a domingo, en cada semana del ciclo." action={headerActions} className="rotation-grid-section">
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      {actionError ? <p className="error rotation-section-error" role="alert">{actionError}</p> : null}
      {!versions.length ? (
        <EmptyState text="Esta rotación todavía no tiene grilla. La grilla se define en versiones con una fecha de inicio." action={canEdit ? createButton : undefined} />
      ) : status === "loading" || status === "idle" || (status === "success" && !summary) ? (
        <LoadingState text="Cargando grilla..." />
      ) : status === "error" || !version || !summary ? (
        <ErrorState message="No pudimos cargar la grilla de esta versión." onRetry={() => setRetry((value) => value + 1)} />
      ) : (
        <>
          <dl className="rotation-version-facts">
            <div><dt>Versión</dt><dd><Badge tone={TIMELINE_TONE[timeline!]}>{versionTimelineLabel(timeline!)}</Badge></dd></div>
            <div><dt>Vigencia</dt><dd>{versionRangeText(summary).replace(/^./, (first) => first.toUpperCase())}</dd></div>
            <div><dt>Ciclo</dt><dd>{rotationCycleLabel(version.cycleLengthWeeks)}</dd></div>
            <div><dt>Semana A</dt><dd>La del lunes {formatCalendarDate(version.anchorWeekStart)}{version.cycleLengthWeeks > 1 ? `; se repite cada ${version.cycleLengthWeeks} semanas` : "; se repite cada semana"}</dd></div>
          </dl>
          {version.locked ? (
            <div className="info-note rotation-grid-note" role="note"><p>Esta versión ya rigió y no se puede modificar. Los cambios se hacen con una versión nueva desde una fecha futura.</p></div>
          ) : null}
          {editable ? (
            <div className="rotation-version-actions">
              <Button variant="subtle" icon={Pencil} onClick={() => { setActionError(""); setEditor({ kind: "edit", version: version! }); }}>Editar esta versión</Button>
              <Button variant="subtle" icon={Trash2} className="rotation-danger-button" onClick={() => void removeVersion()} disabled={deleting}>{deleting ? "Eliminando..." : "Eliminar versión"}</Button>
            </div>
          ) : null}
          <ul className="rotation-grid-legend" aria-label="Referencias de la grilla">
            <li><span className="rotation-legend-sample is-shift">07:00–19:00</span>Turno: horario y código</li>
            <li><span className="rotation-legend-sample is-shift">19:00–07:00<abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr></span>Termina al día siguiente</li>
            <li><span className="rotation-legend-sample is-rest"><Coffee size={12} aria-hidden="true" />Descanso</span>Día libre del equipo</li>
            <li><span className="rotation-legend-sample is-missing"><AlertTriangle size={12} aria-hidden="true" />Sin configurar</span>Día sin definir en esta versión</li>
          </ul>
          {sections.length ? (
            <RotationCycleGrid sections={sections} caption={`Grilla de la versión ${versionRangeText(summary)}`} />
          ) : (
            <EmptyState size="compact" text="No hay equipos activos ni días cargados en esta versión." />
          )}
          {issues.errors.length || issues.warnings.length ? (
            <div className="rotation-grid-issues">
              <h4>Problemas de esta versión</h4>
              <ul>
                {issues.errors.map((text) => <li key={`e:${text}`} className="is-error"><XCircle size={14} aria-hidden="true" /><span className="sr-only">Error: </span>{text}</li>)}
                {issues.warnings.map((text) => <li key={`w:${text}`} className="is-warning"><AlertTriangle size={14} aria-hidden="true" /><span className="sr-only">Advertencia: </span>{text}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
