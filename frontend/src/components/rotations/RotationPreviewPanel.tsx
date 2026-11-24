import { AlertTriangle, ChevronLeft, ChevronRight, Coffee, XCircle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { Pagination } from "../ui/Pagination";
import { Section } from "../ui/Section";
import { shiftRotationApiService, type PreviewCell, type PreviewResponse, type PreviewRow, type ShiftRotation } from "../../services/api/shiftRotationApiService";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { formatCalendarDate } from "../../utils/date";
import { addDaysKey } from "../../utils/shiftRotationDraft";
import { defaultPreviewStart, PREVIEW_DEFAULT_WEEKS, PREVIEW_PAGE_SIZE, PREVIEW_PERIOD_WEEKS, previewDates, previewRange } from "../../utils/shiftRotationPreview";
import { RotationPreviewCalendar } from "./RotationPreviewCalendar";
import { RotationPreviewCellModal } from "./RotationPreviewCellModal";

export const SIMULATION_NOTICE = "Esta es una simulación. La rotación está inactiva y no genera obligaciones reales.";

/**
 * Pestaña "Vista previa" (R4.8D): horarios calculados por el backend para las
 * personas de la rotación (`GET /shifts/expected`, R4.7). Sólo lectura para
 * todos los roles. Rango de 1 a 6 semanas (máximo 42 días del contrato), 25
 * personas por página; al cambiar de página o de rango el calendario anterior
 * queda visible hasta que llega el nuevo.
 */
export function RotationPreviewPanel({ rotation }: { rotation: ShiftRotation }) {
  const todayKey = argentinaDateKey(new Date());
  const ids = { start: useId(), weeks: useId() };
  const [start, setStart] = useState(() => defaultPreviewStart(todayKey));
  const [weeks, setWeeks] = useState<number>(PREVIEW_DEFAULT_WEEKS);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "refreshing" | "success" | "error">("loading");
  const [openCell, setOpenCell] = useState<{ row: PreviewRow; cell: PreviewCell } | null>(null);
  const hasData = useRef(false);
  const range = previewRange(start, weeks);

  useEffect(() => {
    let alive = true;
    setStatus(hasData.current ? "refreshing" : "loading");
    shiftRotationApiService
      .preview({ rotationId: rotation.id, from: range.from, to: range.to, page, take: PREVIEW_PAGE_SIZE })
      .then((data) => {
        if (!alive) return;
        hasData.current = true;
        setResult(data);
        setStatus("success");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
    // `updatedAt` y `status`: al activar, desactivar o finalizar, la vista previa se vuelve a pedir (deja de ser simulación).
  }, [rotation.id, rotation.updatedAt, rotation.status, range.from, range.to, page, reload]);

  const dates = useMemo(() => (result ? previewDates(result.context.range.from, result.context.range.days) : []), [result]);
  const changeRange = (nextStart: string, nextWeeks = weeks) => {
    setStart(nextStart);
    setWeeks(nextWeeks);
    setPage(1);
  };
  const simulation = result?.context.previewMode === "HYPOTHETICAL_INACTIVE";
  const refreshing = status === "refreshing";

  return (
    <Section title="Vista previa" subtitle="Horarios calculados con la configuración guardada, por persona y día. Sólo lectura." className="rotation-preview-section">
      <div className="rotation-preview-controls">
        <div className="field-stack">
          <label htmlFor={ids.start}>Desde</label>
          <input id={ids.start} type="date" value={start} onChange={(event) => { if (event.target.value) changeRange(event.target.value); }} />
        </div>
        <div className="field-stack">
          <label htmlFor={ids.weeks}>Período</label>
          <select id={ids.weeks} value={weeks} onChange={(event) => changeRange(start, Number(event.target.value))}>
            {PREVIEW_PERIOD_WEEKS.map((value) => <option key={value} value={value}>{value === 1 ? "1 semana" : `${value} semanas`}</option>)}
          </select>
        </div>
        <div className="rotation-preview-nav" role="group" aria-label="Moverse en el calendario">
          <Button type="button" variant="subtle" onClick={() => changeRange(addDaysKey(start, -range.days))}><ChevronLeft size={16} aria-hidden="true" />Período anterior</Button>
          <Button type="button" variant="subtle" onClick={() => changeRange(defaultPreviewStart(todayKey))}>Esta semana</Button>
          <Button type="button" variant="subtle" onClick={() => changeRange(addDaysKey(start, range.days))}>Período siguiente<ChevronRight size={16} aria-hidden="true" /></Button>
        </div>
        <p className="rotation-preview-range" aria-live="polite">
          Del {formatCalendarDate(range.from)} al {formatCalendarDate(range.to)}
          {refreshing ? <span className="rotation-preview-refreshing">Actualizando…</span> : null}
        </p>
      </div>

      {simulation ? (
        <div className="info-note warning rotation-preview-simulation" role="note">
          <p><b>{SIMULATION_NOTICE}</b> Muestra cómo quedarían los horarios si se activara con la configuración actual.</p>
        </div>
      ) : result ? (
        <div className="info-note rotation-grid-note" role="note"><p>Configuración vigente de la rotación. La vista previa no modifica nada.</p></div>
      ) : null}

      <ul className="rotation-grid-legend" aria-label="Referencias de la vista previa">
        <li><span className="rotation-legend-sample is-shift">07:00–19:00</span>Turno de la rotación</li>
        <li><span className="rotation-legend-sample is-shift">19:00–07:00<abbr className="rotation-next-day" title="Termina al día siguiente">+1</abbr></span>Termina al día siguiente (no se repite)</li>
        <li><span className="rotation-legend-sample is-fixed">Fijo · código</span>Turno fijo fuera de la rotación</li>
        <li><span className="rotation-legend-sample is-rest"><Coffee size={12} aria-hidden="true" />Descanso</span>Descanso de la grilla</li>
        <li><span className="rotation-legend-sample is-missing"><AlertTriangle size={12} aria-hidden="true" />Sin configurar</span>Falta definir el día</li>
        <li><span className="rotation-legend-sample is-conflict"><XCircle size={12} aria-hidden="true" />Conflicto</span>Configuración contradictoria</li>
        <li><span className="rotation-legend-sample is-none">—</span>Sin programación</li>
      </ul>

      {status === "loading" ? (
        <LoadingState text="Calculando la vista previa..." />
      ) : status === "error" ? (
        <ErrorState message="No pudimos calcular la vista previa." onRetry={() => setReload((value) => value + 1)} />
      ) : result && !result.data.length ? (
        <EmptyState text="No hay personas para mostrar en el período elegido. Aparecen quienes pertenecen a la rotación en esas fechas y a quienes tenés acceso." />
      ) : result ? (
        <>
          <RotationPreviewCalendar rows={result.data} dates={dates} todayKey={todayKey} busy={refreshing} onOpenCell={(row, cell) => setOpenCell({ row, cell })} />
          {result.meta.total > result.meta.pageSize ? (
            <Pagination page={result.meta.page} pageSize={result.meta.pageSize} total={result.meta.total} hasMore={result.meta.hasMore} onPageChange={setPage} itemLabel="personas" />
          ) : (
            <p className="rotation-section-footnote">{result.meta.total === 1 ? "1 persona" : `${result.meta.total} personas`} en el período.</p>
          )}
        </>
      ) : null}

      {openCell ? <RotationPreviewCellModal row={openCell.row} cell={openCell.cell} close={() => setOpenCell(null)} /> : null}
    </Section>
  );
}
