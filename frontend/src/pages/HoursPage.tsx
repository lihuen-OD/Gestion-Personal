import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Eye,
  FileBarChart,
  RefreshCcw,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../services/api/apiClient";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService, type EmployeePeriodDay, type EmployeeRowSortKey, type TimeEntryListSortKey } from "../services/api/timeEntryApiService";
import type { DayAccounting, PeriodAccounting, PeriodAccountingSummary } from "../types/workedTimeAccounting.types";
import { emptyPeriodAccounting } from "../utils/workedTimeAccounting";
import type { ListMeta } from "../services/api/listQuery";
import { useSortState, type SortState } from "../utils/sort";
import { noveltyApiService } from "../services/api/noveltyApiService";
import { formatMultiplier } from "../components/attendance/segmentDisplay";
import type { Employee, TimeEntry } from "../types";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, formatPeriodDay, getMonthDays, getWeekdayAbbr } from "../utils/period";
import { formatDecimalHoursDuration, formatDurationMinutes, hoursDecimalToMinutes } from "../utils/hours";
import { formatTimeEntryObservation } from "../utils/userFacingText";
import { statusTone } from "../utils/status";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { uniqueOptions } from "../components/employees/options/sharedOptions";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { TableShell } from "../components/ui/TableShell";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { ErrorState } from "../components/ui/ErrorState";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";
import { SortableHeader } from "../components/ui/SortableHeader";
import { Tabs } from "../components/ui/Tabs";

const DAY_POPOVER_WIDTH = 260;
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
}: {
  label: string;
  day?: EmployeePeriodDay;
  accounting?: DayAccounting;
  employeeId: string;
  period: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
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

  return (
    <td className="day-cell">
      <button
        ref={triggerRef}
        type="button"
        className="day-cell-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Detalle del ${label}`}
      >
        <span className={day?.novelty ? "day-cell-value has-novelty" : "day-cell-value"}>{accounting ? formatDurationMinutes(accounting.totalWorkedMinutes) : "-"}</span>
        {day?.novelty ? <span className="alert-dot purple" /> : null}
        {accounting && accounting.multiplier > 1 ? <span className="alert-dot orange" /> : null}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="overflow-cell-popover day-cell-popover"
              style={{ left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${DAY_POPOVER_WIDTH}px` }}
            >
              <b>{label}</b>
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
                      <span className="day-cell-worked-total"><b>Total trabajado: {formatDurationMinutes(accounting.totalWorkedMinutes)}</b></span>
                      {accounting.multiplier > 1 ? (
                        <>
                          <span className="day-cell-special-hour">
                            Hora especial aplicada — Multiplicador {formatMultiplier(accounting.multiplier)}
                            {day?.specialHourRuleNames.length ? `: ${day.specialHourRuleNames.join(", ")}` : ""}
                          </span>
                          <span className="day-cell-liquidable-total"><b>Equivalencia para liquidación: {formatDurationMinutes(accounting.settlement.totalMinutes)}</b></span>
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
                  {day?.novelty ? <span>Novedad: {day.novelty.label}</span> : null}
                </>
              ) : (
                <span>Sin carga ni novedades registradas.</span>
              )}
              <Link className="table-link" to={`/horas/${employeeId}?period=${period}`} onClick={() => setOpen(false)}>
                Ver detalle completo
              </Link>
            </div>,
            document.body,
          )
        : null}
    </td>
  );
}

const emptyHoursSummary = {
  activeEmployees: 0,
  employeesWithEntries: 0,
  pendingEmployees: 0,
  reviewEmployees: 0,
  countableHours: 0,
  coverage: 0,
};

// Etapa 6L.5: PendingItem.date ya viene recortado a "YYYY-MM-DD"
// (pendingApiService.mapItem) — se reusa formatPeriodDay para mostrarlo
// igual que la tabla de Horas en revisión (mismo formato en toda la bandeja).
function pendingItemDayLabel(item: PendingItem) {
  return formatPeriodDay(item.date.slice(0, 7), Number(item.date.slice(8, 10)));
}

function breakdownResolveErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "HOUR_CONCEPT_BREAKDOWN_STATUS_NOT_RESOLVABLE") {
      return "Esta carga ya fue resuelta por otra persona. Actualizá la bandeja e intentá de nuevo.";
    }
    if (error.code === "HOUR_CONCEPT_BREAKDOWN_NOT_FOUND") {
      return "No encontramos esta carga. Puede que ya no exista o esté fuera de tu alcance.";
    }
    if (error.code === "FORBIDDEN") {
      return "No tenés permiso para resolver esta carga.";
    }
    return "No pudimos resolver la carga del concepto. Actualizá la bandeja e intentá nuevamente.";
  }
  return "No pudimos resolver la carga del concepto. Intentá nuevamente.";
}

// Etapa 7A: aprobar/rechazar/devolver una carga horaria o una novedad no tenía
// ningún manejo de error — si el endpoint fallaba, la promesa quedaba
// rechazada sin capturar: la bandeja no mostraba nada, el modal se cerraba
// igual y parecía que la acción había funcionado. Se les da el mismo
// tratamiento que ya tenían los desgloses manuales desde 6L.5.
function reviewActionErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "FORBIDDEN") {
      return "No tenés permiso para resolver este registro.";
    }
    return "No pudimos completar la acción. Actualizá la bandeja e intentá nuevamente.";
  }
  return "No pudimos completar la acción. Intentá nuevamente.";
}
const pageSize = 25;
const emptyListMeta: ListMeta = { total: 0, page: 1, pageSize, hasMore: false };

// "Por persona" pagina empleados: sólo legajo/empleado se ordenan en el
// backend; con otra columna elegida en "Por registro" se usa el orden default.
function employeeRowSort(sort: SortState<TimeEntryListSortKey>): SortState<EmployeeRowSortKey> {
  return sort && (sort.key === "legajo" || sort.key === "employee") ? { key: sort.key, direction: sort.direction } : null;
}

export function HoursPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
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
  const [review, setReview] = useState<{ entry: TimeEntry; action: "reject" | "return" }>();
  const [noveltyReject, setNoveltyReject] = useState<PendingItem>();
  // Etapa 6L.5: mismo patrón que review/noveltyReject, para desgloses manuales.
  const [breakdownReview, setBreakdownReview] = useState<{ item: PendingItem; action: "reject" | "return" }>();
  const [resolvingBreakdownId, setResolvingBreakdownId] = useState<string | null>(null);
  const [breakdownActionError, setBreakdownActionError] = useState("");
  // Etapa 7A: error de las acciones de revisión de cargas horarias y novedades
  // (antes fallaban en silencio). Se muestra en la cabecera de la página y,
  // cuando la acción salió de un modal, también adentro del modal.
  const [reviewActionError, setReviewActionError] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [groupByPerson, setGroupByPerson] = useState(false);
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
  const [reviewPage, setReviewPage] = useState(1);
  const resetReviewPage = useCallback(() => setReviewPage(1), []);
  const { sort: reviewSort, toggleSort: toggleReviewSort } = useSortState<TimeEntryListSortKey>(resetReviewPage);
  const [reviewEntriesMeta, setReviewEntriesMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [reviewEntries, setReviewEntries] = useState<TimeEntry[]>([]);
  const [reviewByPerson, setReviewByPerson] = useState<Array<{
    employee: Employee;
    summary: {
      status: string;
      // Misma contabilidad que la grilla, el cierre y el export
      // (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
      accounting: PeriodAccountingSummary;
      specialHourRuleNames: string[];
      specialHourConflict: boolean;
    };
  }>>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [hoursSummary, setHoursSummary] = useState(emptyHoursSummary);
  // Novedades y desgloses pendientes paginan por separado contra /pending
  // (kind=novelties / kind=hourConceptBreakdowns): antes una sola carga
  // kind=all&take=300 cortaba en silencio y el subtítulo contaba sólo lo traído.
  const [pendingNovelties, setPendingNovelties] = useState<PendingItem[]>([]);
  const [pendingNoveltiesMeta, setPendingNoveltiesMeta] = useState<ListMeta>(emptyListMeta);
  const [pendingNoveltyPage, setPendingNoveltyPage] = useState(1);
  const [pendingBreakdowns, setPendingBreakdowns] = useState<PendingItem[]>([]);
  const [pendingBreakdownsMeta, setPendingBreakdownsMeta] = useState<ListMeta>(emptyListMeta);
  const [pendingBreakdownPage, setPendingBreakdownPage] = useState(1);
  const [usesBackend, setUsesBackend] = useState(false);
  // Etapa 9F: el mega-efecto original tenía 10 dependencias en un único
  // Promise.all — cambiar `reviewPage`, `groupByPerson`, `debouncedSearch` o
  // `costCenter` volvía a pedir getSummary/pendingApiService.getAll aunque
  // ninguno de los dos acepta esos parámetros (siempre iban a devolver lo
  // mismo), y `pendingOnly` (que nunca cambia dentro de un mismo montaje —
  // /horas y /pendientes son rutas separadas) igual quedaba en el array. Se
  // separó en 3 efectos por dependencia real (ver más abajo), cada uno con su
  // propio loading/error para no blanquear ni bloquear secciones que no
  // dependen de lo que cambió. loadError se deriva de los 2 que sí pueden
  // fallar "duro" (grid/review) — getSummary y pendingApiService.getAll ya
  // hacían catch a un default antes de esta etapa, eso no se tocó.
  const [gridLoading, setGridLoading] = useState(true);
  const [gridError, setGridError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState("");
  const [pendingLoading, setPendingLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const loadError = gridError || reviewError;

  const costCenterId = costCenterOptions.find((item) => item.name === costCenter)?.id;

  // A) Grilla "Personas habilitadas para carga" — sólo existe cuando
  // !pendingOnly. Depende de período/búsqueda/centro de costo/página; no
  // depende de reviewPage/groupByPerson (esos son de la Bandeja).
  // Etapa 14G.4: antes esperaba a `costCenterOptionsReady` (catálogo de
  // org-structure) para arrancar — una dependencia artificial: `costCenterId`
  // ya sale de `costCenterOptions.find(...)`, que es `undefined` mientras el
  // catálogo no cargó (no hay forma de que el usuario haya elegido un centro
  // de costo todavía), así que sacar el gate no cambia qué se pide, sólo deja
  // de bloquear la grilla detrás de GET /org-structure. Ver docs/decisions/
  // WORKFORCE_MANAGEMENT_HOURS_ENTRY_PERFORMANCE_14G4.md.
  useEffect(() => {
    if (pendingOnly) return;
    if (!user) return;
    let cancelled = false;
    if (!periodRows.length) setGridLoading(true);
    setGridError("");
    timeEntryApiService.getPeriodEmployees({ period, search: debouncedSearch, costCenterId, page, take: pageSize, sort: gridSort })
      .then((result) => {
        if (cancelled) return;
        setPeriodRows(result.items);
        setPeriodRowsMeta(result.meta);
        setUsesBackend(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPeriodRows([]);
        setPeriodRowsMeta({ total: 0, page, pageSize, hasMore: false });
        setUsesBackend(false);
        setGridError("No pudimos cargar la información horaria. Intentá nuevamente.");
      })
      .finally(() => {
        if (!cancelled) setGridLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [costCenterId, debouncedSearch, gridSort, page, pendingOnly, period, refresh, user]);

  // B) Bandeja de revisión (Horas enviadas a revisión) — sólo existe cuando
  // pendingOnly. Depende de período/búsqueda/centro de costo/reviewPage/
  // groupByPerson (cambia de endpoint: listByEmployee vs list). Etapa 14G.4:
  // mismo criterio que la grilla (A) — sin gate de `costCenterOptionsReady`.
  useEffect(() => {
    if (!pendingOnly) return;
    if (!user) return;
    let cancelled = false;
    if (!reviewEntries.length && !reviewByPerson.length) setReviewLoading(true);
    setReviewError("");
    const reviewFilters = { period, status: "En revisión" as const, search: debouncedSearch, costCenterId, page: reviewPage, take: pageSize };
    const request = groupByPerson
      ? timeEntryApiService.listByEmployee({ ...reviewFilters, sort: employeeRowSort(reviewSort) })
      : timeEntryApiService.list({ ...reviewFilters, sort: reviewSort });
    request
      .then((result) => {
        if (cancelled) return;
        if (groupByPerson) {
          setReviewByPerson(result.items as typeof reviewByPerson);
          setReviewEntries([]);
        } else {
          setReviewEntries(result.items as TimeEntry[]);
          setReviewByPerson([]);
        }
        setReviewEntriesMeta(result.meta);
      })
      .catch(() => {
        if (cancelled) return;
        setReviewEntries([]);
        setReviewByPerson([]);
        setReviewEntriesMeta({ total: 0, page: reviewPage, pageSize, hasMore: false });
        setReviewError("No pudimos cargar la información horaria. Intentá nuevamente.");
      })
      .finally(() => {
        if (!cancelled) setReviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [costCenterId, debouncedSearch, groupByPerson, pendingOnly, period, refresh, reviewPage, reviewSort, user]);

  // C) Resumen (tarjetas, ambos modos) + pendientes de novedades/desgloses
  // (sólo pendingOnly) — ninguno de los dos endpoints acepta
  // búsqueda/centro/página, así que no dependen de esos filtros; ya cargaba
  // en paralelo al catálogo de centros de costo antes de 14G.4 (A/B ahora
  // también, ver más arriba).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    if (pendingOnly && !pendingNovelties.length && !pendingBreakdowns.length) setPendingLoading(true);
    timeEntryApiService.getSummary(period)
      .then((result) => { if (!cancelled) setHoursSummary(result); })
      .catch(() => { if (!cancelled) setHoursSummary(emptyHoursSummary); });
    if (!pendingOnly) return () => { cancelled = true; };
    Promise.all([
      pendingApiService.getAll({ period, kind: "novelties", page: pendingNoveltyPage, take: pageSize }),
      pendingApiService.getAll({ period, kind: "hourConceptBreakdowns", page: pendingBreakdownPage, take: pageSize }),
    ])
      .then(([novelties, breakdowns]) => {
        if (cancelled) return;
        setPendingNovelties(novelties.data);
        setPendingNoveltiesMeta(novelties.meta);
        setPendingBreakdowns(breakdowns.data);
        setPendingBreakdownsMeta(breakdowns.meta);
        setUsesBackend(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPendingNovelties([]);
        setPendingNoveltiesMeta(emptyListMeta);
        setPendingBreakdowns([]);
        setPendingBreakdownsMeta(emptyListMeta);
        setUsesBackend(false);
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingBreakdownPage, pendingNoveltyPage, pendingOnly, period, refresh, user]);

  // Etapa 14G.4: catálogo de centros de costo para el filtro — ya no bloquea
  // A/B (ver más arriba), así que corre en paralelo a la grilla/bandeja.
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
  const pendingNoveltyItems = pendingNovelties;
  // Etapa 6L.5: desgloses manuales EN_REVISION (kind: "hourConceptBreakdown").
  const pendingBreakdownItems = pendingBreakdowns;
  const canReview = user ? timeEntryApiService.canReview(user) : false;
  // Etapa 6L.3 (ajuste): aprobar/rechazar/devolver cargas horarias es
  // exclusivo de RRHH. canReview sigue igual para novedades (sin cambios).
  const canApprove = user ? timeEntryApiService.canApprove(user) : false;
  const summary = (employeeId: string) =>
    periodRows.find((row) => row.employee.id === employeeId)?.summary
    ?? { incidents: 0, status: "Pendiente", accounting: emptyPeriodAccounting(), dailyBreakdown: [] as EmployeePeriodDay[] };
  const monthDays = getMonthDays(period);
  const dailyFor = (employeeId: string) => {
    const map = new Map<number, EmployeePeriodDay>();
    for (const entry of summary(employeeId).dailyBreakdown) map.set(entry.day, entry);
    return map;
  };
  const setPeriodValue = (value: string) => {
    setPage(1);
    setReviewPage(1);
    setPendingNoveltyPage(1);
    setPendingBreakdownPage(1);
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
  const approve = async (entry: TimeEntry) => {
    if (!user) return;
    setReviewActionError("");
    try {
      await timeEntryApiService.approve(entry.id);
      setRefresh((value) => value + 1);
    } catch (error) {
      setReviewActionError(reviewActionErrorMessage(error));
    }
  };
  const openReview = (entry: TimeEntry, action: "reject" | "return") => {
    setReview({ entry, action });
    setReviewActionError("");
    setReviewReason("");
  };
  const confirmReview = async () => {
    if (!reviewReason.trim() || !review) return;
    if (!user) return;
    setReviewActionError("");
    try {
      if (review.action === "reject") {
        await timeEntryApiService.reject(review.entry.id, reviewReason.trim());
      } else {
        await timeEntryApiService.returnForCorrection(review.entry.id, reviewReason.trim());
      }
      setReview(undefined);
      setReviewReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      // el modal queda abierto a propósito, para poder reintentar sin
      // volver a escribir la observación
      setReviewActionError(reviewActionErrorMessage(error));
    }
  };
  const approveNovelty = async (item: PendingItem) => {
    if (!user) return;
    setReviewActionError("");
    try {
      await noveltyApiService.approve(item.sourceId);
      setRefresh((value) => value + 1);
    } catch (error) {
      setReviewActionError(reviewActionErrorMessage(error));
    }
  };
  const confirmNoveltyReject = async () => {
    if (!noveltyReject || !reviewReason.trim()) return;
    setReviewActionError("");
    try {
      await noveltyApiService.reject(noveltyReject.sourceId, reviewReason.trim());
      setNoveltyReject(undefined);
      setReviewReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      setReviewActionError(reviewActionErrorMessage(error));
    }
  };
  // Etapa 6L.5: aprobar/rechazar/devolver un desglose manual pendiente
  // (HourConceptBreakdown) desde la bandeja — mismo patrón que TimeEntry
  // arriba, pero contra los endpoints de employeeApiService agregados en 6L.3.
  const approveBreakdown = async (item: PendingItem) => {
    if (!user) return;
    setBreakdownActionError("");
    setResolvingBreakdownId(item.sourceId);
    try {
      await employeeApiService.approveManualHourConceptBreakdown(item.employeeId, item.sourceId);
      setRefresh((value) => value + 1);
    } catch (error) {
      setBreakdownActionError(breakdownResolveErrorMessage(error));
    } finally {
      setResolvingBreakdownId(null);
    }
  };
  const openBreakdownReview = (item: PendingItem, action: "reject" | "return") => {
    setBreakdownReview({ item, action });
    setBreakdownActionError("");
    setReviewReason("");
  };
  const confirmBreakdownReview = async () => {
    if (!reviewReason.trim() || !breakdownReview) return;
    if (!user) return;
    setBreakdownActionError("");
    setResolvingBreakdownId(breakdownReview.item.sourceId);
    try {
      if (breakdownReview.action === "reject") {
        await employeeApiService.rejectManualHourConceptBreakdown(breakdownReview.item.employeeId, breakdownReview.item.sourceId, reviewReason.trim());
      } else {
        await employeeApiService.returnManualHourConceptBreakdown(breakdownReview.item.employeeId, breakdownReview.item.sourceId, reviewReason.trim());
      }
      setBreakdownReview(undefined);
      setReviewReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      setBreakdownActionError(breakdownResolveErrorMessage(error));
    } finally {
      setResolvingBreakdownId(null);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="CONTROL HORARIO"
        title={pendingOnly ? "Bandeja de revisión" : "Carga de horas"}
        description={
          pendingOnly
            ? "Revisá, aprobá, rechazá o devolvé las horas enviadas a revisión."
            : "Las fichadas correctas se contabilizan automáticamente. Las horas especiales se muestran separadas y sólo las incidencias requieren revisión."
        }
        action={
          !pendingOnly ? (
            <Button
              variant="subtle"
              icon={FileBarChart}
              disabled={exporting}
              onClick={exportHours}
            >
              {exporting ? "Exportando..." : "Exportar horas"}
            </Button>
          ) : undefined
        }
      />
      {loadError ? <div className="form-error">{loadError}</div> : null}
      {exportError ? <div className="form-error">{exportError}</div> : null}
      {reviewActionError ? <div className="form-error">{reviewActionError}</div> : null}

      <div className="stat-grid">
        <StatCard label="Personas activas" value={hoursSummary.activeEmployees} icon={Users} />
        <StatCard
          label="Pendientes"
          value={hoursSummary.pendingEmployees}
          icon={Clock3}
          tone="orange"
        />
        <StatCard
          label="En revisión"
          value={hoursSummary.reviewEmployees}
          icon={ClipboardList}
          tone="purple"
        />
        <StatCard
          label="Total trabajado"
          value={formatDecimalHoursDuration(hoursSummary.countableHours)}
          icon={BarChart3}
          tone="green"
        />
      </div>

      {pendingOnly ? (
        <>
          <Section
            title="Novedades pendientes"
            subtitle={`${pendingNoveltiesMeta.total} novedades requieren revisión o aprobación`}
          >
            {pendingLoading ? (
              <LoadingState variant="table" rows={4} columns={7} />
            ) : pendingNoveltyItems.length ? (
              <TableShell minWidth={980}>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Legajo / Persona</th>
                      <th>Novedad</th>
                      <th>Detalle</th>
                      <th>Cantidad</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingNoveltyItems.map((item) => (
                      <tr key={`${item.kind}-${item.sourceId}`}>
                        <td>{pendingItemDayLabel(item)}</td>
                        <td>
                          <OverflowCell value={item.employeeLabel} />
                        </td>
                        <td>
                          <OverflowCell value={item.title} />
                        </td>
                        <td>
                          <OverflowCell value={item.subtitle || "-"} />
                        </td>
                        <td>{item.quantity || "-"}</td>
                        <td>
                          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                        </td>
                        <td>
                          {canReview ? (
                            <div className="table-actions">
                              <button
                                className="table-icon-action"
                                title="Aprobar novedad"
                                aria-label="Aprobar novedad"
                                onClick={() => approveNovelty(item)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Aprobar</span>
                              </button>
                              <button
                                className="table-icon-action danger-link"
                                title="Rechazar novedad"
                                aria-label="Rechazar novedad"
                                onClick={() => {
                                  setNoveltyReject(item);
                                  setReviewActionError("");
                                  setReviewReason("");
                                }}
                              >
                                <X size={14} />
                                <span>Rechazar</span>
                              </button>
                            </div>
                          ) : (
                            <span className="table-sub">Solo lectura</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            ) : (
              <EmptyState text={usesBackend ? "No hay novedades pendientes para este período." : "Las novedades pendientes no están disponibles temporalmente."} />
            )}
            {!pendingLoading && pendingNoveltiesMeta.total > 0 ? (
              <Pagination page={pendingNoveltiesMeta.page} pageSize={pendingNoveltiesMeta.pageSize} total={pendingNoveltiesMeta.total} hasMore={pendingNoveltiesMeta.hasMore} onPageChange={setPendingNoveltyPage} itemLabel="novedades" />
            ) : null}
          </Section>

          <Section
            title="Horas enviadas a revisión"
            subtitle={groupByPerson ? `${reviewEntriesMeta.total} personas con registros en revisión` : `${reviewEntriesMeta.total} registros de Hora normal pendientes de resolución — afectan el total trabajado.`}
            action={
              <Tabs
                tabs={[
                  { key: "flat", label: "Por registro" },
                  { key: "person", label: "Por persona" },
                ]}
                active={groupByPerson ? "person" : "flat"}
                onChange={(key) => {
                  setGroupByPerson(key === "person");
                  setReviewPage(1);
                }}
              />
            }
          >
          <FilterPanel
            search={{
              placeholder: "Buscar por legajo, DNI, CUIL, apellido o nombre",
              value: search,
              onChange: (value) => {
                setSearch(value);
                setReviewPage(1);
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
                  setReviewPage(1);
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

          {reviewLoading ? (
            <LoadingState variant="table" rows={5} columns={8} />
          ) : groupByPerson ? (
            reviewByPerson.length ? (
              <TableShell minWidth={1120}>
                <table>
                  <thead>
                    <tr>
                      <SortableHeader label="Legajo" sortKey="legajo" sort={employeeRowSort(reviewSort)} onSort={toggleReviewSort} />
                      <SortableHeader label="Empleado" sortKey="employee" sort={employeeRowSort(reviewSort)} onSort={toggleReviewSort} />
                      <th>Empresa</th>
                      <th>Centro de costo</th>
                      <th>Responsable de carga</th>
                      <th>Total en revisión</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewByPerson.map(({ employee, summary: personSummary }) => (
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
                        <td>
                          <span className="total-hours-cell">
                            <span title={personSummary.accounting.additiveMinutes > 0 ? `Base ${formatDurationMinutes(personSummary.accounting.baseMinutes)} + adicionales ${formatDurationMinutes(personSummary.accounting.additiveMinutes)}` : undefined}>
                              {formatDurationMinutes(personSummary.accounting.totalWorkedMinutes)}
                            </span>
                            {personSummary.accounting.hasSpecialMultiplier ? (
                              <Badge tone={personSummary.specialHourConflict ? "danger" : "warning"}>
                                <span
                                  title={`Hora especial aplicada${personSummary.specialHourRuleNames.length ? `: ${personSummary.specialHourRuleNames.join(", ")}` : ""}${personSummary.specialHourConflict ? " — Conflicto de reglas: se aplicó la de mayor prioridad" : ""}`}
                                >
                                  Para liquidación: {formatDurationMinutes(personSummary.accounting.settlement.totalMinutes)}
                                </span>
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <Badge tone={statusTone(personSummary.status)}>{personSummary.status}</Badge>
                        </td>
                        <td>
                          <Link
                            className="table-icon-action"
                            title="Ver detalle"
                            aria-label="Ver detalle"
                            to={`/horas/${employee.id}?period=${period}`}
                          >
                            <Eye size={14} />
                            <span>Ver detalle</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            ) : (
              <EmptyState text="No hay personas con registros en revisión para los filtros seleccionados." />
            )
          ) : reviewEntries.length ? (
            <TableShell minWidth={1080}>
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="Legajo" sortKey="legajo" sort={reviewSort} onSort={toggleReviewSort} />
                    <SortableHeader label="Empleado" sortKey="employee" sort={reviewSort} onSort={toggleReviewSort} />
                    <SortableHeader label="Día" sortKey="date" sort={reviewSort} onSort={toggleReviewSort} />
                    <SortableHeader label="Concepto" sortKey="hourConcept" sort={reviewSort} onSort={toggleReviewSort} />
                    <SortableHeader label="Horas" sortKey="hours" sort={reviewSort} onSort={toggleReviewSort} />
                    <th>Observación</th>
                    <SortableHeader label="Estado" sortKey="status" sort={reviewSort} onSort={toggleReviewSort} />
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <b>{entry.employeeLegajo || "-"}</b>
                      </td>
                      <td>
                        <OverflowCell value={entry.employeeName || "-"} />
                      </td>
                      <td>{formatPeriodDay(entry.period, entry.day)}</td>
                      <td>
                        <OverflowCell value={entry.type} />
                      </td>
                      <td>
                        <span className="total-hours-cell">
                          <b>{formatDurationMinutes(entry.totalMinutes ?? hoursDecimalToMinutes(entry.hours))}</b>
                          {(entry.specialHourMultiplier || 1) > 1 ? (
                            <Badge tone={entry.specialHourConflict ? "danger" : "warning"}>
                              <span
                                title={`Hora especial aplicada — Multiplicador ${formatMultiplier(entry.specialHourMultiplier)}${entry.specialHourRuleNames?.length ? `: ${entry.specialHourRuleNames.join(", ")}` : ""}${entry.specialHourConflict ? " — Conflicto de reglas: se aplicó la de mayor prioridad" : ""}`}
                              >
                                {formatMultiplier(entry.specialHourMultiplier)}
                              </span>
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="observation-cell">
                        <OverflowCell value={formatTimeEntryObservation(entry.notes) || "-"} />
                      </td>
                      <td>
                        <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                      </td>
                      <td>
                        {canApprove ? (
                          <div className="table-actions">
                            <button
                              className="table-icon-action"
                              title="Aprobar"
                              aria-label="Aprobar"
                              onClick={() => approve(entry)}
                            >
                              <CheckCircle2 size={14} />
                              <span>Aprobar</span>
                            </button>
                            <button
                              className="table-icon-action danger-link"
                              title="Rechazar"
                              aria-label="Rechazar"
                              onClick={() => openReview(entry, "reject")}
                            >
                              <X size={14} />
                              <span>Rechazar</span>
                            </button>
                            <button
                              className="table-icon-action"
                              title="Devolver"
                              aria-label="Devolver"
                              onClick={() => openReview(entry, "return")}
                            >
                              <RefreshCcw size={14} />
                              <span>Devolver</span>
                            </button>
                          </div>
                        ) : (
                          <span className="table-sub">Solo lectura</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState text="No hay horas en revisión para los filtros seleccionados." />
          )}
          <Pagination page={reviewEntriesMeta.page} pageSize={reviewEntriesMeta.pageSize} total={reviewEntriesMeta.total} hasMore={reviewEntriesMeta.hasMore} onPageChange={setReviewPage} itemLabel={groupByPerson ? "personas" : "registros"} />
          </Section>

          <Section
            title="Conceptos horarios pendientes"
            subtitle={`${pendingBreakdownsMeta.total} cargas de conceptos pendientes de resolución — las de horas adicionales suman al total trabajado al aprobarse; las de dentro de la jornada no.`}
          >
            {breakdownActionError ? <div className="form-error">{breakdownActionError}</div> : null}
            {pendingLoading ? (
              <LoadingState variant="table" rows={3} columns={7} />
            ) : pendingBreakdownItems.length ? (
              <TableShell minWidth={980}>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Legajo / Persona</th>
                      <th>Concepto adicional</th>
                      <th>Observación</th>
                      <th>Horas</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingBreakdownItems.map((item) => {
                      const isResolving = resolvingBreakdownId === item.sourceId;
                      return (
                        <tr key={`${item.kind}-${item.sourceId}`}>
                          <td>{pendingItemDayLabel(item)}</td>
                          <td>
                            <OverflowCell value={item.employeeLabel} />
                          </td>
                          <td>
                            <OverflowCell value={item.title} />
                          </td>
                          <td className="observation-cell">
                            <OverflowCell value={item.subtitle || "-"} />
                          </td>
                          <td>{item.quantity ? `${item.quantity} h` : "-"}</td>
                          <td>
                            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                          </td>
                          <td>
                            {canApprove ? (
                              <div className="table-actions">
                                <button
                                  className="table-icon-action"
                                  title="Aprobar carga del concepto"
                                  aria-label="Aprobar carga del concepto"
                                  disabled={isResolving}
                                  onClick={() => approveBreakdown(item)}
                                >
                                  <CheckCircle2 size={14} />
                                  <span>{isResolving ? "Aprobando..." : "Aprobar"}</span>
                                </button>
                                <button
                                  className="table-icon-action danger-link"
                                  title="Rechazar carga del concepto"
                                  aria-label="Rechazar carga del concepto"
                                  disabled={isResolving}
                                  onClick={() => openBreakdownReview(item, "reject")}
                                >
                                  <X size={14} />
                                  <span>Rechazar</span>
                                </button>
                                <button
                                  className="table-icon-action"
                                  title="Devolver carga del concepto"
                                  aria-label="Devolver carga del concepto"
                                  disabled={isResolving}
                                  onClick={() => openBreakdownReview(item, "return")}
                                >
                                  <RefreshCcw size={14} />
                                  <span>Devolver</span>
                                </button>
                              </div>
                            ) : (
                              <span className="table-sub">Solo lectura</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableShell>
            ) : (
              <EmptyState text="No hay cargas de conceptos pendientes de revisión." />
            )}
            {!pendingLoading && pendingBreakdownsMeta.total > 0 ? (
              <Pagination page={pendingBreakdownsMeta.page} pageSize={pendingBreakdownsMeta.pageSize} total={pendingBreakdownsMeta.total} hasMore={pendingBreakdownsMeta.hasMore} onPageChange={setPendingBreakdownPage} itemLabel="cargas" />
            ) : null}
          </Section>
        </>
      ) : null}

      {!pendingOnly ? (
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
                            Para liquidación: {formatDurationMinutes(periodSummary.accounting.settlement.totalMinutes)}
                          </Badge>
                        ) : null}
                      </span>
                    </td>
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
      ) : null}

      {review ? (
        <Modal
          title={
            review.action === "reject"
              ? "Rechazar carga horaria"
              : "Devolver carga horaria"
          }
          close={() => setReview(undefined)}
        >
          <div className="form-stack">
            <div className="info-note compact">
              <b>
                {review.entry.type} · {formatPeriodDay(review.entry.period, review.entry.day)}
              </b>
              <p>
                {review.action === "reject"
                  ? "El registro quedará rechazado y se conservará para auditoría."
                  : "El registro queda en estado Devuelto para que puedas corregirlo y volver a enviarlo."}
              </p>
            </div>
            <label>
              Observación obligatoria
              <textarea
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                placeholder="Indicá el motivo para dejar trazabilidad"
              />
            </label>
            {!reviewReason.trim() ? (
              <p className="error">La observación es obligatoria.</p>
            ) : null}
            {reviewActionError ? <p className="error">{reviewActionError}</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setReview(undefined)}>
                Cancelar
              </Button>
              <Button
                variant={review.action === "reject" ? "danger" : "primary"}
                onClick={confirmReview}
              >
                {review.action === "reject" ? "Rechazar" : "Devolver"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {breakdownReview ? (
        <Modal
          title={
            breakdownReview.action === "reject"
              ? "Rechazar carga del concepto"
              : "Devolver carga del concepto"
          }
          close={() => setBreakdownReview(undefined)}
        >
          <div className="form-stack">
            <div className="info-note compact">
              <b>
                {breakdownReview.item.title} · {pendingItemDayLabel(breakdownReview.item)}
              </b>
              <p>
                {breakdownReview.action === "reject"
                  ? "La carga quedará rechazada y se conservará para auditoría. No se cuenta en las horas del período."
                  : "La carga queda en estado Devuelto para que Nivel 2/3 la corrija y la vuelva a enviar."}
              </p>
            </div>
            <label>
              Observación obligatoria
              <textarea
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                placeholder="Indicá el motivo para dejar trazabilidad"
              />
            </label>
            {!reviewReason.trim() ? (
              <p className="error">La observación es obligatoria.</p>
            ) : null}
            {breakdownActionError ? <p className="error">{breakdownActionError}</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setBreakdownReview(undefined)}>
                Cancelar
              </Button>
              <Button
                variant={breakdownReview.action === "reject" ? "danger" : "primary"}
                disabled={resolvingBreakdownId === breakdownReview.item.sourceId}
                onClick={confirmBreakdownReview}
              >
                {resolvingBreakdownId === breakdownReview.item.sourceId
                  ? "Guardando..."
                  : breakdownReview.action === "reject"
                    ? "Rechazar"
                    : "Devolver"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {noveltyReject ? (
        <Modal title="Rechazar novedad" close={() => setNoveltyReject(undefined)}>
          <div className="form-stack">
            <div className="info-note compact">
              <b>{noveltyReject.title}</b>
              <p>{noveltyReject.employeeLabel}</p>
            </div>
            <label>
              Observación obligatoria
              <textarea
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                placeholder="Indicá el motivo para dejar trazabilidad"
              />
            </label>
            {!reviewReason.trim() ? (
              <p className="error">La observación es obligatoria.</p>
            ) : null}
            {reviewActionError ? <p className="error">{reviewActionError}</p> : null}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setNoveltyReject(undefined)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmNoveltyReject}>
                Rechazar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

    </>
  );
}
