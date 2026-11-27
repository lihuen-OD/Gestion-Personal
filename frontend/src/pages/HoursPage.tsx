import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  CalendarCheck,
  CalendarOff,
  Clock3,
  Eye,
  FileBarChart,
  ShieldPlus,
  Calculator,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../services/api/apiClient";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { timeEntryApiService, type EmployeePeriodDay, type EmployeeRowSortKey } from "../services/api/timeEntryApiService";
import type { DayAccounting, PeriodAccounting } from "../types/workedTimeAccounting.types";
import { emptyPeriodAccounting } from "../utils/workedTimeAccounting";
import { useSortState } from "../utils/sort";
import { formatMultiplier } from "../components/attendance/segmentDisplay";
import type { Employee } from "../types";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, getMonthDays, getWeekdayAbbr, monthDate } from "../utils/period";
import { argentinaDateKey } from "../utils/argentinaDateKey";
import { roleLevel } from "../utils/roles";
import { DayOffManagerDialog } from "../components/hours/DayOffManagerDialog";
import { HolidayWorkAssignmentDialog } from "../components/hours/HolidayWorkAssignmentDialog";
import { DayOffMark, dayOffDescription } from "../components/hours/DayOffMark";
import { ManualHoursConflictDialog, manualHoursDecisionText } from "../components/hours/ManualHoursConflictDialog";
import { ManualHoursConflictsPanel } from "../components/hours/ManualHoursConflictsPanel";
import { manualHoursConflictApiService, type ManualHoursConflict } from "../services/api/manualHoursConflictApiService";
import { formatDecimalHoursDuration, formatDurationMinutes } from "../utils/hours";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { uniqueOptions } from "../components/employees/options/sharedOptions";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { TableShell } from "../components/ui/TableShell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import {
  NoveltyCoverageChipList,
  NoveltyCoverageCompactList,
  NoveltyCoverageResolutionModal,
  noveltyCoverageStateLabel,
  type NoveltyCoverageReviewTarget,
} from "../components/hours/NoveltyCoverage";
import { Pagination } from "../components/ui/Pagination";
import { SortableHeader } from "../components/ui/SortableHeader";

const DAY_POPOVER_WIDTH = 340;
const DAY_VIEWPORT_PADDING = 16;
const DAY_POPOVER_GAP = 10;
const DAY_POPOVER_ESTIMATED_HEIGHT = 240;

// Celda de un día en la grilla de período: muestra el total trabajado real
// y, en el detalle, la composición calculada por el backend
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md) — nunca la recalcula.
function DayCell({
  label,
  day,
  accounting,
  employeeId,
  period,
  onManageDayOff,
  manualHoursConflict,
  onReviewManualHours,
  onCoverageResolved,
}: {
  label: string;
  day?: EmployeePeriodDay;
  accounting?: DayAccounting;
  employeeId: string;
  period: string;
  // Abre "Gestionar francos" con este día y esta persona (mismo modal y servicio que el encabezado).
  onManageDayOff?: () => void;
  // Fichada sobre horas cargadas a mano cuya fecha operativa es este día
  // (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md).
  manualHoursConflict?: ManualHoursConflict;
  onReviewManualHours?: () => void;
  onCoverageResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [coverageReview, setCoverageReview] = useState<NoveltyCoverageReviewTarget | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(DAY_VIEWPORT_PADDING, rect.left), window.innerWidth - DAY_POPOVER_WIDTH - DAY_VIEWPORT_PADDING);
    // Altura real del popover una vez montado (la composición del día varía
    // según los conceptos); antes del primer render se usa una estimación.
    const height = popoverRef.current?.offsetHeight || DAY_POPOVER_ESTIMATED_HEIGHT;
    const fitsBelow = window.innerHeight - rect.bottom > height + DAY_POPOVER_GAP + DAY_VIEWPORT_PADDING;
    const top = fitsBelow ? rect.bottom + DAY_POPOVER_GAP : Math.max(DAY_VIEWPORT_PADDING, rect.top - height - DAY_POPOVER_GAP);
    setPosition({ left, top });
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    // Segunda pasada con la altura real ya medida.
    const frame = window.requestAnimationFrame(updatePosition);
    const onScrollOrResize = () => updatePosition();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const dayOff = day?.dayOff ?? null;
  const workedMinutes = accounting?.totalWorkedMinutes ?? day?.totalWorkedMinutes ?? 0;
  const coveredMinutes = accounting?.noveltyCoveredMinutes ?? day?.noveltyCoveredMinutes ?? 0;
  const computableMinutes = accounting?.computableMinutes ?? day?.computableMinutes ?? workedMinutes;
  const noveltyItems = day?.novelties ?? [];
  const uncountedMinutes = accounting?.dayOffUncountedMinutes ?? 0;
  const reviewPending = manualHoursConflict?.status === "PENDIENTE";
  const cellLabel = dayOff ? `Detalle del ${label}: ${dayOffDescription(dayOff, workedMinutes)}` : `Detalle del ${label}`;
  const noveltyDescription = noveltyItems.length
    ? `${noveltyItems.length} novedad(es): ${noveltyItems.map((item) => `${item.label || item.code || "Novedad"}, ${formatDurationMinutes(item.minutes)}, ${noveltyCoverageStateLabel(item.state)}`).join("; ")}; ${coveredMinutes ? `${formatDurationMinutes(coveredMinutes)} cubiertas` : "sin cobertura computable"}`
    : undefined;
  const reviewDescription = reviewPending ? "Revisión pendiente: fichada sobre horas cargadas manualmente" : undefined;
  return (
    <td className={dayOff ? "day-cell is-day-off" : noveltyItems.length ? "day-cell is-novelty" : "day-cell"}>
      <button
        ref={triggerRef}
        type="button"
        className="day-cell-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={[cellLabel, noveltyDescription, reviewDescription].filter(Boolean).join(". ")}
        title={[dayOff ? dayOffDescription(dayOff, workedMinutes) : undefined, noveltyDescription, reviewDescription].filter(Boolean).join(" · ") || undefined}
      >
        {dayOff ? (
          // "Franco · 0 h" (o lo reconocido): nunca "-", que es "sin horas".
          // Una novedad del mismo día queda como marca secundaria, no se oculta.
          <DayOffMark countedMinutes={workedMinutes} />
        ) : (
          <span className="day-cell-computable"><span className="day-cell-value">{accounting || day ? formatDurationMinutes(computableMinutes) : "-"}</span></span>
        )}
        {noveltyItems.length ? <NoveltyCoverageCompactList items={noveltyItems} /> : null}
        {accounting && accounting.multiplier > 1 ? <span className="alert-dot orange" /> : null}
        {reviewPending ? <span className="alert-dot review" /> : null}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="overflow-cell-popover day-cell-popover"
              style={{ left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${DAY_POPOVER_WIDTH}px` }}
            >
              <b>{label}</b>
              {manualHoursConflict ? (
                <span className={reviewPending ? "day-cell-manual-review is-pending" : "day-cell-manual-review"}>
                  {reviewPending
                    ? `Revisión pendiente: se registró una fichada (${formatDurationMinutes(manualHoursConflict.clockMinutes)}) en una jornada que ya tenía horas cargadas manualmente (${formatDurationMinutes(manualHoursConflict.manualMinutes)}). Computan las cargadas hasta que se decida.`
                    : `Fichada sobre horas cargadas manualmente: ${manualHoursDecisionText(manualHoursConflict)}`}
                </span>
              ) : null}
              {dayOff ? (
                <>
                  <span className="day-cell-day-off">Franco asignado: no debía trabajar.</span>
                  {dayOff.activityShifts > 0 ? (
                    <span>
                      Actividad registrada por el fichador: {dayOff.activityMinutes > 0 ? formatDurationMinutes(dayOff.activityMinutes) : "jornada abierta"}.
                      {workedMinutes > 0 ? "" : " No computa hasta que se reconozca."}
                    </span>
                  ) : null}
                  {dayOff.notes ? <span>Observación: {dayOff.notes}</span> : null}
                </>
              ) : null}
              {!dayOff && uncountedMinutes > 0 ? (
                <span className="day-cell-day-off">Incluye {formatDurationMinutes(uncountedMinutes)} de una jornada en franco que no computan.</span>
              ) : null}
              {accounting || day ? (
                <>
                  {accounting ? (
                    <>
                      <span>Horas base: {formatDurationMinutes(accounting.baseMinutes)}</span>
                      {accounting.withinBaseMinutes > 0 ? (
                        <>
                          <span>Horas normales: {formatDurationMinutes(accounting.normalResidualMinutes)}</span>
                          <span>Dentro de la jornada: {formatDurationMinutes(accounting.withinBaseMinutes)}</span>
                        </>
                      ) : null}
                      {accounting.additiveMinutes > 0 ? <span>Horas adicionales: {formatDurationMinutes(accounting.additiveMinutes)}</span> : null}
                      <span className="day-cell-worked-total"><b>Total trabajado: {formatDurationMinutes(workedMinutes)}</b></span>
                      <span>Cubierto por novedades: {formatDurationMinutes(coveredMinutes)}</span>
                      <span className="day-cell-computable-total"><b>Total computable: {formatDurationMinutes(computableMinutes)}</b></span>
                      {accounting.multiplier > 1 || accounting.settlement.noveltyMinutes !== accounting.noveltyCoveredMinutes ? (
                        <>
                          <span className="day-cell-special-hour">
                            Hora especial aplicada — Multiplicador {formatMultiplier(accounting.multiplier)}
                            {day?.specialHourRuleNames.length ? `: ${day.specialHourRuleNames.join(", ")}` : ""}
                          </span>
                          {/* Para liquidación por componente (backend), nunca una única equivalencia que mezcle conceptos (§17). */}
                          <span className="day-cell-liquidable-total"><b>Para liquidación</b></span>
                          <span>Horas normales: {formatDurationMinutes(accounting.settlement.normalMinutes)}</span>
                          {accounting.settlement.withinBaseMinutes > 0 ? <span>Dentro de la jornada: {formatDurationMinutes(accounting.settlement.withinBaseMinutes)}</span> : null}
                          {accounting.settlement.additiveMinutes > 0 ? <span>Horas adicionales: {formatDurationMinutes(accounting.settlement.additiveMinutes)}</span> : null}
                          {accounting.settlement.noveltyMinutes > 0 ? <span>Novedades: {formatDurationMinutes(accounting.settlement.noveltyMinutes)}</span> : null}
                          <span><b>Total para liquidación: {formatDurationMinutes(accounting.settlement.totalMinutes)}</b></span>
                        </>
                      ) : null}
                      {accounting.withinBaseExcessMinutes > 0 ? (
                        <span className="day-cell-special-hour-conflict">Hay horas dentro de la jornada sin horas base que las contengan. Revisá la carga.</span>
                      ) : null}
                    </>
                  ) : null}
                  {day?.specialHourConflict ? (
                    <span className="day-cell-special-hour-conflict">Hay más de una Hora especial en conflicto ese día. Se aplicó la de mayor prioridad.</span>
                  ) : null}
                  {noveltyItems.length ? <NoveltyCoverageChipList items={noveltyItems} compact onReview={(item) => { setOpen(false); setCoverageReview({ item, date: monthDate(period, accounting?.day ?? day?.day ?? 1), employeeId, period, workedMinutes, computableMinutes: accounting?.computableMinutes }); }} /> : null}
                </>
              ) : (
                <span>Sin carga ni novedades registradas.</span>
              )}
              <div className="day-cell-actions">
                <Link className="table-link" to={`/horas/${employeeId}?period=${period}`} onClick={() => setOpen(false)}>
                  Ver detalle completo
                </Link>
                {manualHoursConflict && onReviewManualHours ? (
                  <Button
                    variant={reviewPending ? "primary" : "subtle"}
                    icon={Eye}
                    onClick={() => {
                      setOpen(false);
                      onReviewManualHours();
                    }}
                  >
                    {reviewPending ? "Revisar" : "Ver revisión"}
                  </Button>
                ) : null}
                {onManageDayOff ? (
                  <Button
                    variant="subtle"
                    icon={CalendarOff}
                    onClick={() => {
                      setOpen(false);
                      onManageDayOff();
                    }}
                  >
                    Gestionar franco
                  </Button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
      {coverageReview ? <NoveltyCoverageResolutionModal target={coverageReview} close={() => setCoverageReview(null)} onResolved={onCoverageResolved} /> : null}
    </td>
  );
}

const emptyHoursSummary = {
  activeEmployees: 0,
  employeesWithEntries: 0,
  pendingEmployees: 0,
  countableHours: 0,
  coveredHours: 0,
  computableHours: 0,
  coverage: 0,
};

const pageSize = 25;

export function HoursPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const period = searchParams.get("period") || currentMonthPeriod();
  const [costCenter, setCostCenter] = useState("");
  const [page, setPage] = useState(1);
  // Orden server-side de cada tabla paginada: cambiarlo vuelve a su página 1.
  const resetGridPage = useCallback(() => setPage(1), []);
  const { sort: gridSort, toggleSort: toggleGridSort } = useSortState<EmployeeRowSortKey>(resetGridPage);
  const [refresh, setRefresh] = useState(0);
  // "Gestionar francos": abierto desde el encabezado (fecha sugerida) o desde
  // el detalle de un día (esa fecha y esa persona preseleccionada).
  const [dayOffDialog, setDayOffDialog] = useState<{ date: string; search?: string; employeeId?: string } | null>(null);
  // "Gestionar feriados" (convocatorias): también se abre desde la dirección
  // anterior de Configuración, que redirige con ?gestionar=feriados.
  const holidayDialogOpen = searchParams.get("gestionar") === "feriados";
  const setHolidayDialogOpen = (open: boolean) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (open) next.set("gestionar", "feriados");
      else next.delete("gestionar");
      return next;
    }, { replace: true });
  };
  // Fichadas sobre horas cargadas a mano del período (MANUAL_HOURS_VS_CLOCK_PUNCH.md).
  const [manualConflicts, setManualConflicts] = useState<ManualHoursConflict[]>([]);
  const [manualConflictsError, setManualConflictsError] = useState("");
  const [manualConflictsReload, setManualConflictsReload] = useState(0);
  const [manualConflictDialog, setManualConflictDialog] = useState<ManualHoursConflict | null>(null);
  const [periodRows, setPeriodRows] = useState<
    Array<{
      employee: Employee;
      summary: {
        incidents: number;
        status: string;
        accounting: PeriodAccounting;
        dailyBreakdown: EmployeePeriodDay[];
      };
    }>
  >([]);
  const [periodRowsMeta, setPeriodRowsMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [costCenterOptions, setCostCenterOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [hoursSummary, setHoursSummary] = useState(emptyHoursSummary);
  // Etapa 9F: la carga se separa en efectos por dependencia real (ver más
  // abajo), cada uno con su propio loading/error para no blanquear ni
  // bloquear secciones que no dependen de lo que cambió. getSummary hace
  // catch a un default; sólo la grilla puede fallar "duro".
  const [gridLoading, setGridLoading] = useState(true);
  const [gridError, setGridError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const loadError = gridError;

  const costCenterId = costCenterOptions.find((item) => item.name === costCenter)?.id;

  // A) Grilla "Personas habilitadas para carga". Depende de
  // período/búsqueda/centro de costo/página/orden.
  // Etapa 14G.4: antes esperaba a `costCenterOptionsReady` (catálogo de
  // org-structure) para arrancar — una dependencia artificial: `costCenterId`
  // ya sale de `costCenterOptions.find(...)`, que es `undefined` mientras el
  // catálogo no cargó (no hay forma de que el usuario haya elegido un centro
  // de costo todavía), así que sacar el gate no cambia qué se pide, sólo deja
  // de bloquear la grilla detrás de GET /org-structure. Ver docs/decisions/
  // WORKFORCE_MANAGEMENT_HOURS_ENTRY_PERFORMANCE_14G4.md.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    if (!periodRows.length) setGridLoading(true);
    setGridError("");
    timeEntryApiService.getPeriodEmployees({ period, search: debouncedSearch, costCenterId, page, take: pageSize, sort: gridSort })
      .then((result) => {
        if (cancelled) return;
        setPeriodRows(result.items);
        setPeriodRowsMeta(result.meta);
      })
      .catch(() => {
        if (cancelled) return;
        setPeriodRows([]);
        setPeriodRowsMeta({ total: 0, page, pageSize, hasMore: false });
        setGridError("No pudimos cargar la información horaria. Intentá nuevamente.");
      })
      .finally(() => {
        if (!cancelled) setGridLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [costCenterId, debouncedSearch, gridSort, page, period, refresh, user]);

  // C) Resumen (tarjetas): el endpoint no acepta búsqueda/centro/página, así
  // que no depende de esos filtros.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    timeEntryApiService.getSummary(period)
      .then((result) => { if (!cancelled) setHoursSummary(result); })
      .catch(() => { if (!cancelled) setHoursSummary(emptyHoursSummary); });
    return () => {
      cancelled = true;
    };
  }, [period, refresh, user]);

  // D) Fichadas sobre horas cargadas a mano del período: no
  // depende de búsqueda/centro/página. Sin loading propio: la sección sólo
  // aparece si hay revisiones y, en un refresh, conserva las que ya mostraba.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    manualHoursConflictApiService.list(period)
      .then((items) => {
        if (cancelled) return;
        setManualConflicts(items);
        setManualConflictsError("");
      })
      .catch(() => {
        if (!cancelled) setManualConflictsError("No pudimos cargar las revisiones de fichadas sobre horas cargadas. Intentá nuevamente.");
      });
    return () => {
      cancelled = true;
    };
  }, [manualConflictsReload, period, refresh, user]);

  // Etapa 14G.4: catálogo de centros de costo para el filtro — no bloquea la
  // grilla (ver más arriba), así que corre en paralelo.
  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (mounted) {
          setCostCenterOptions(catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const costCenters = uniqueOptions(costCenterOptions.map((item) => item.name));
  const employees = periodRows.map((row) => row.employee);
  const summary = (employeeId: string) =>
    periodRows.find((row) => row.employee.id === employeeId)?.summary
    ?? { incidents: 0, status: "Pendiente", accounting: emptyPeriodAccounting(), dailyBreakdown: [] as EmployeePeriodDay[] };
  const monthDays = getMonthDays(period);
  // Una revisión por jornada, marcada en su fecha operativa (una nocturna no
  // aparece en dos días).
  const manualConflictByDay = new Map(manualConflicts.map((conflict) => [`${conflict.employee.id}|${conflict.operationalDate}`, conflict]));
  // Hoy si cae en el período elegido; si no, el primer día del período.
  const todayKey = argentinaDateKey(new Date());
  const defaultDayOffDate = todayKey.startsWith(period) ? todayKey : monthDate(period, 1);
  const dailyFor = (employeeId: string) => {
    const map = new Map<number, EmployeePeriodDay>();
    for (const entry of summary(employeeId).dailyBreakdown) map.set(entry.day, entry);
    return map;
  };
  const setPeriodValue = (value: string) => {
    setPage(1);
    setSearchParams(value ? { period: value } : {});
  };
  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: el export sale sólo del
  // backend (misma contabilidad que la grilla y el cierre). Ya no existe el
  // "export con los datos visibles": sin conceptos ni equivalencias por día
  // produciría un archivo para liquidación con totales incorrectos.
  const exportHours = async () => {
    setExportError("");
    setExporting(true);
    try {
      const { columns, rows } = await timeEntryApiService.getPeriodExport(period);
      if (!rows.length) {
        setExportError("No hay horas aprobadas para exportar con los filtros actuales.");
        return;
      }
      const { buildHoursExportWorkbook } = await import("../utils/hoursExport");
      buildHoursExportWorkbook(columns, rows, period);
    } catch (error) {
      // Etapa 15E.2: el período todavía no tiene el cierre mensual aprobado —
      // bloqueo de negocio explícito, nunca se genera el archivo igual.
      if (error instanceof ApiError && error.code === "MONTHLY_CLOSURE_NOT_APPROVED") {
        setExportError("El período debe estar aprobado antes de exportar para liquidación.");
        return;
      }
      setExportError("No pudimos preparar la exportación. Intentá nuevamente.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="CONTROL HORARIO"
        title="Carga de horas"
        description="Las fichadas correctas se contabilizan automáticamente. Las horas especiales se muestran separadas y sólo las incidencias requieren revisión."
        action={
          <>
            <Button variant="subtle" icon={CalendarOff} onClick={() => setDayOffDialog({ date: defaultDayOffDate })}>
              Gestionar francos
            </Button>
            <Button variant="subtle" icon={CalendarCheck} onClick={() => setHolidayDialogOpen(true)}>
              Gestionar feriados
            </Button>
            <Button
              variant="subtle"
              icon={FileBarChart}
              disabled={exporting}
              onClick={exportHours}
            >
              {exporting ? "Exportando..." : "Exportar horas"}
            </Button>
          </>
        }
      />
      {loadError ? <div className="form-error">{loadError}</div> : null}
      {exportError ? <div className="form-error">{exportError}</div> : null}

      <div className="stat-grid">
        <StatCard label="Personas activas" value={hoursSummary.activeEmployees} icon={Users} />
        <StatCard
          label="Sin horas cargadas"
          value={hoursSummary.pendingEmployees}
          icon={Clock3}
          tone="orange"
        />
        <StatCard
          label="Total trabajado"
          value={formatDecimalHoursDuration(hoursSummary.countableHours)}
          icon={BarChart3}
          tone="green"
        />
        <StatCard label="Cubierto por novedades" value={formatDecimalHoursDuration(hoursSummary.coveredHours)} icon={ShieldPlus} tone="purple" />
        <StatCard label="Total computable" value={formatDecimalHoursDuration(hoursSummary.computableHours)} icon={Calculator} tone="blue" />
      </div>

      <ManualHoursConflictsPanel
        conflicts={manualConflicts}
        error={manualConflictsError}
        onRetry={() => setManualConflictsReload((value) => value + 1)}
        onOpen={setManualConflictDialog}
      />

      <Section
        title="Personas habilitadas para carga"
        subtitle="La asignación del responsable y del encargado directo determina quién aparece en este listado."
      >
        <FilterPanel
          search={{
            placeholder: "Buscar persona por legajo, DNI, CUIL, apellido o nombre",
            value: search,
            onChange: (value) => {
              setSearch(value);
              setPage(1);
            },
          }}
        >
          <label>
            Período
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriodValue(event.target.value)}
            />
          </label>
          <label>
            Centro de costo
            <select
              value={costCenter}
              onChange={(event) => {
                setCostCenter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos los centros de costo</option>
              {costCenters.map((center) => (
                <option key={center} value={center}>
                  {center}
                </option>
              ))}
            </select>
          </label>
        </FilterPanel>

        {gridLoading ? (
          <LoadingState variant="table" rows={5} columns={9} />
        ) : gridError ? (
          <ErrorState message={gridError} onRetry={() => setRefresh((value) => value + 1)} />
        ) : !employees.length ? (
          <EmptyState text="No hay personas habilitadas para carga con los filtros aplicados." />
        ) : (
        <TableShell minWidth={1120 + monthDays.length * 64}>
          <table className="people-hours-table">
            <thead>
              <tr>
                <SortableHeader label="Legajo" sortKey="legajo" sort={gridSort} onSort={toggleGridSort} />
                <SortableHeader label="Empleado" sortKey="employee" sort={gridSort} onSort={toggleGridSort} />
                <th>Empresa</th>
                <th>Centro de costo</th>
                <th>Responsable de carga</th>
                <th>Horas base</th>
                <th>Horas adicionales</th>
                <th>Total trabajado</th>
                <th>Cubierto por novedades</th>
                <th>Total computable</th>
                <th>Acción</th>
                {monthDays.map((day) => (
                  <th key={day} className="day-col">
                    {getWeekdayAbbr(period, day)} {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const periodSummary = summary(employee.id);
                const dayMap = dailyFor(employee.id);
                return (
                  <tr key={employee.id}>
                    <td>
                      <b>{displayLegajo(employee)}</b>
                    </td>
                    <td>
                      <OverflowCell value={fullName(employee)} />
                    </td>
                    <td>
                      <OverflowCell value={employee.company} />
                    </td>
                    <td>
                      <OverflowCell value={employee.costCenter} />
                    </td>
                    <td>
                      <OverflowCell
                        value={
                          (employee.timeResponsibles?.length
                            ? employee.timeResponsibles
                            : [employee.timeResponsible]
                          )
                            .filter(Boolean)
                            .join(", ") || "-"
                        }
                      />
                    </td>
                    <td>{formatDurationMinutes(periodSummary.accounting.baseMinutes)}</td>
                    <td>{formatDurationMinutes(periodSummary.accounting.additiveMinutes)}</td>
                    <td>
                      <span className="total-hours-cell">
                        <span>{formatDurationMinutes(periodSummary.accounting.totalWorkedMinutes)}</span>
                        {periodSummary.accounting.hasSpecialMultiplier ? (
                          <Badge tone="warning">
                            <span title="Total de control: suma conceptos que pueden liquidarse distinto. El detalle por concepto está en el legajo.">
                              Para liquidación: {formatDurationMinutes(periodSummary.accounting.settlement.totalMinutes)}
                            </span>
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td>{formatDurationMinutes(periodSummary.accounting.noveltyCoveredMinutes)}</td>
                    <td><b>{formatDurationMinutes(periodSummary.accounting.computableMinutes)}</b></td>
                    <td>
                      <Link
                        className="table-icon-action"
                        title="Cargar / Ver"
                        aria-label="Cargar / Ver"
                        to={`/horas/${employee.id}?period=${period}`}
                      >
                        <Eye size={14} />
                        <span>Cargar / Ver</span>
                      </Link>
                    </td>
                    {monthDays.map((day) => (
                      <DayCell
                        key={day}
                        label={`${getWeekdayAbbr(period, day)} ${day}`}
                        day={dayMap.get(day)}
                        accounting={periodSummary.accounting.days[String(day)]}
                        employeeId={employee.id}
                        period={period}
                        onManageDayOff={() => setDayOffDialog({ date: monthDate(period, day), search: displayLegajo(employee), employeeId: employee.id })}
                        manualHoursConflict={manualConflictByDay.get(`${employee.id}|${monthDate(period, day)}`)}
                        onReviewManualHours={() => {
                          const conflict = manualConflictByDay.get(`${employee.id}|${monthDate(period, day)}`);
                          if (conflict) setManualConflictDialog(conflict);
                        }}
                        onCoverageResolved={() => setRefresh((value) => value + 1)}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
        )}
        <Pagination page={periodRowsMeta.page} pageSize={periodRowsMeta.pageSize} total={periodRowsMeta.total} hasMore={periodRowsMeta.hasMore} onPageChange={setPage} itemLabel="legajos" />
      </Section>


      {manualConflictDialog ? (
        <ManualHoursConflictDialog
          conflict={manualConflictDialog}
          close={() => setManualConflictDialog(null)}
          // El servicio ya invalidó las cachés derivadas: la revisión se
          // actualiza en el acto y la grilla y el resumen se vuelven a pedir
          // sin recargar la página.
          onResolved={(resolved) => {
            setManualConflicts((current) => current.map((item) => (item.id === resolved.id ? resolved : item)));
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}

      {dayOffDialog ? (
        <DayOffManagerDialog
          initialDate={dayOffDialog.date}
          initialSearch={dayOffDialog.search}
          initialSelectedEmployeeId={dayOffDialog.employeeId}
          close={() => setDayOffDialog(null)}
          // El servicio ya invalidó las cachés derivadas: la grilla y el
          // resumen se vuelven a pedir sin recargar la página.
          onSaved={() => setRefresh((value) => value + 1)}
        />
      ) : null}

      {holidayDialogOpen ? (
        <HolidayWorkAssignmentDialog
          initialMonth={period}
          close={() => setHolidayDialogOpen(false)}
          // La convocatoria cambia la obligación del día (cobertura de
          // novedades): la grilla y el resumen se vuelven a pedir.
          onSaved={() => setRefresh((value) => value + 1)}
        />
      ) : null}
    </>
  );
}
