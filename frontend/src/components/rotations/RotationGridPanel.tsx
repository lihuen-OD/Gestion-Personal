import { AlertTriangle, Coffee, XCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Section } from "../ui/Section";
import { shiftRotationApiService, type ShiftRotation, type ShiftRotationVersion } from "../../services/api/shiftRotationApiService";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../utils/date";
import { rotationCycleLabel } from "../../utils/shiftRotation";
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

const TIMELINE_TONE = { CURRENT: "success", FUTURE: "info", PAST: "neutral" } as const;

/**
 * Grilla del ciclo en sólo lectura (R4.8B1). Las versiones llegan resumidas en
 * el detalle; la grilla completa de la elegida se pide al seleccionarla y se
 * conserva visible mientras se refresca (cambios de equipos). Crear o editar
 * versiones es R4.8B2.
 */
export function RotationGridPanel({ rotation, reloadToken }: { rotation: ShiftRotation; reloadToken: number }) {
  const todayKey = argentinaDateKey(new Date());
  const selectId = useId();
  const versions = useMemo(() => sortVersionsForSelect(rotation.versions), [rotation.versions]);
  const [selectedId, setSelectedId] = useState<string | null>(() => defaultVersionId(rotation.versions, todayKey));
  const [version, setVersion] = useState<ShiftRotationVersion | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const shownId = useRef<string | null>(null);

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

  const selector = versions.length > 1 ? (
    <div className="rotation-version-select">
      <label htmlFor={selectId}>Versión</label>
      <select id={selectId} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
        {versions.map((item) => <option key={item.id} value={item.id}>{versionOptionLabel(item, todayKey)}</option>)}
      </select>
    </div>
  ) : undefined;

  return (
    <Section title="Grilla del ciclo" subtitle="Turnos y descansos de cada equipo, de lunes a domingo, en cada semana del ciclo." action={selector} className="rotation-grid-section">
      {!versions.length ? (
        <EmptyState text="Esta rotación todavía no tiene grilla. La grilla se define en versiones con una fecha de inicio." />
      ) : status === "loading" || status === "idle" ? (
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
