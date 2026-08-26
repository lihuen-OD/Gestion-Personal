import { useEffect, useRef, useState } from "react";
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
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, TimeEntry } from "../types";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, formatPeriodDay, getMonthDays, getWeekdayAbbr } from "../utils/period";
import { formatHours } from "../utils/hours";
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
import { Tabs } from "../components/ui/Tabs";

type DayBreakdown = { day: number; normal: number; special: number; total: number; novelty: { label: string } | null };

const DAY_POPOVER_WIDTH = 260;
const DAY_VIEWPORT_PADDING = 16;
const DAY_POPOVER_GAP = 10;

function DayCell({
  label,
  breakdown,
  employeeId,
  period,
}: {
  label: string;
  breakdown?: DayBreakdown;
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
    const fitsBelow = window.innerHeight - rect.bottom > 160;
    const top = fitsBelow ? rect.bottom + DAY_POPOVER_GAP : Math.max(DAY_VIEWPORT_PADDING, rect.top - 150);
    setPosition({ left, top });
  };

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
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
        <span className={breakdown?.novelty ? "day-cell-value has-novelty" : "day-cell-value"}>{breakdown ? formatHours(breakdown.total) : "-"}</span>
        {breakdown?.novelty ? <span className="alert-dot purple" /> : null}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="overflow-cell-popover day-cell-popover"
              style={{ left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${DAY_POPOVER_WIDTH}px` }}
            >
              <b>{label}</b>
              {breakdown ? (
                <>
                  <span>Horas normales: {formatHours(breakdown.normal)} h</span>
                  <span>Horas especiales: {formatHours(breakdown.special)} h</span>
                  {breakdown.novelty ? <span>Novedad: {breakdown.novelty.label}</span> : null}
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
      return "Este desglose ya fue resuelto por otra persona. Actualizá la bandeja e intentá de nuevo.";
    }
    if (error.code === "HOUR_CONCEPT_BREAKDOWN_NOT_FOUND") {
      return "No encontramos este desglose. Puede que ya no exista o esté fuera de tu alcance.";
    }
    if (error.code === "FORBIDDEN") {
      return "No tenés permiso para resolver este desglose.";
    }
    return error.message;
  }
  return "No pudimos resolver el desglose manual. Intentá nuevamente.";
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
    return error.message;
  }
  return "No pudimos completar la acción. Intentá nuevamente.";
}
const pageSize = 25;

export function HoursPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const period = searchParams.get("period") || currentMonthPeriod();
  const [costCenter, setCostCenter] = useState("");
  const [page, setPage] = useState(1);
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
        total: number;
        normal: number;
        special: number;
        incidents: number;
        status: string;
        dailyBreakdown: Array<{ day: number; normal: number; special: number; total: number; novelty: { label: string } | null }>;
      };
    }>
  >([]);
  const [periodRowsMeta, setPeriodRowsMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewEntriesMeta, setReviewEntriesMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [reviewEntries, setReviewEntries] = useState<TimeEntry[]>([]);
  const [reviewByPerson, setReviewByPerson] = useState<Array<{ employee: Employee; summary: { total: number; status: string } }>>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [costCenterOptionsReady, setCostCenterOptionsReady] = useState(false);
  const [hoursSummary, setHoursSummary] = useState(emptyHoursSummary);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [usesBackend, setUsesBackend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user || !costCenterOptionsReady) return;
      setLoading(true);
      setLoadError("");
      try {
        const costCenterId = costCenterOptions.find((item) => item.name === costCenter)?.id;
        const reviewFilters = { period, status: "En revisión" as const, search: debouncedSearch, costCenterId, page: reviewPage, take: pageSize };
        const emptyRows = { items: [], meta: { total: 0, page: 1, pageSize, hasMore: false } };
        async function loadReview() {
          if (!pendingOnly) return { entries: [] as TimeEntry[], byPerson: [] as typeof reviewByPerson, meta: emptyRows.meta };
          if (groupByPerson) {
            const result = await timeEntryApiService.listByEmployee(reviewFilters);
            return { entries: [] as TimeEntry[], byPerson: result.items, meta: result.meta };
          }
          const result = await timeEntryApiService.list(reviewFilters);
          return { entries: result.items, byPerson: [] as typeof reviewByPerson, meta: result.meta };
        }
        const [apiRows, apiSummary, apiReview, apiPending] = await Promise.all([
          pendingOnly ? Promise.resolve(emptyRows) : timeEntryApiService.getPeriodEmployees({ period, search: debouncedSearch, costCenterId, page, take: pageSize }),
          timeEntryApiService.getSummary(period).catch(() => emptyHoursSummary),
          loadReview(),
          pendingOnly ? pendingApiService.getAll({ period, kind: "all", take: 300 }).catch(() => undefined) : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        setPeriodRows(apiRows.items);
        setPeriodRowsMeta(apiRows.meta);
        setReviewEntries(apiReview.entries);
        setReviewByPerson(apiReview.byPerson);
        setReviewEntriesMeta(apiReview.meta);
        setHoursSummary(apiSummary);
        setPendingItems(apiPending?.data || []);
        setUsesBackend(true);
      } catch (error) {
        if (cancelled) return;
        setPeriodRows([]);
        setPeriodRowsMeta({ total: 0, page, pageSize, hasMore: false });
        setReviewEntries([]);
        setReviewByPerson([]);
        setReviewEntriesMeta({ total: 0, page: reviewPage, pageSize, hasMore: false });
        setHoursSummary(emptyHoursSummary);
        setPendingItems([]);
        setUsesBackend(false);
        setLoadError("No pudimos cargar la información horaria. Intentá nuevamente.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [costCenter, costCenterOptionsReady, debouncedSearch, groupByPerson, page, pendingOnly, period, refresh, reviewPage, user]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (mounted) {
          setCostCenterOptions(catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
          setCostCenterOptionsReady(true);
        }
      })
      .catch(() => {
        if (mounted) setCostCenterOptionsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const costCenters = uniqueOptions(costCenterOptions.map((item) => item.name));
  const employees = periodRows.map((row) => row.employee);
  const pendingNoveltyItems = pendingItems.filter((item) => item.kind === "novelty");
  // Etapa 6L.5: desgloses manuales EN_REVISION — ya llegaban en pendingItems
  // desde 6L.3 (kind: "hourConceptBreakdown"), pero no se mostraban en ningún lado.
  const pendingBreakdownItems = pendingItems.filter((item) => item.kind === "hourConceptBreakdown");
  const canReview = user ? timeEntryApiService.canReview(user) : false;
  // Etapa 6L.3 (ajuste): aprobar/rechazar/devolver cargas horarias es
  // exclusivo de RRHH. canReview sigue igual para novedades (sin cambios).
  const canApprove = user ? timeEntryApiService.canApprove(user) : false;
  const summary = (employeeId: string) => {
    const backendSummary = periodRows.find((row) => row.employee.id === employeeId)?.summary;
    if (backendSummary) return backendSummary;
    const legacy = timeEntryApiService.getEmployeePeriodSummary(reviewEntries, employeeId);
    return { ...legacy, normal: legacy.total, special: 0, incidents: 0, dailyBreakdown: [] as Array<{ day: number; normal: number; special: number; total: number; novelty: { label: string } | null }> };
  };
  const monthDays = getMonthDays(period);
  const dailyFor = (employeeId: string) => {
    const map = new Map<number, { day: number; normal: number; special: number; total: number; novelty: { label: string } | null }>();
    for (const entry of summary(employeeId).dailyBreakdown) map.set(entry.day, entry);
    return map;
  };
  const exportRows = timeEntryApiService.getPeriodExportRowsFromEntries(period, employees, reviewEntries);
  const setPeriodValue = (value: string) => {
    setPage(1);
    setReviewPage(1);
    setSearchParams(value ? { period: value } : {});
  };
  const exportHours = async () => {
    setExportError("");
    setExporting(true);
    try {
      const rows = usesBackend ? await timeEntryApiService.getPeriodExportRows(period) : exportRows;
      if (!rows.length) {
        setExportError("No hay horas aprobadas para exportar con los filtros actuales.");
        return;
      }
      const { buildHoursExportWorkbook } = await import("../utils/hoursExport");
      buildHoursExportWorkbook(rows, period);
    } catch (error) {
      if (!exportRows.length) {
        setExportError("No pudimos preparar la exportación. Intentá nuevamente.");
        return;
      }
      const { buildHoursExportWorkbook } = await import("../utils/hoursExport");
      buildHoursExportWorkbook(exportRows, period);
      setExportError("La exportación se generó con los datos visibles porque no pudimos obtener información adicional.");
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
              disabled={exporting || (!usesBackend && !exportRows.length)}
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
          label="Horas contables"
          value={`${formatHours(hoursSummary.countableHours)} h`}
          icon={BarChart3}
          tone="green"
        />
      </div>

      {pendingOnly ? (
        <>
          <Section
            title="Novedades pendientes"
            subtitle={`${pendingNoveltyItems.length} novedades requieren revisión o aprobación`}
          >
            {loading ? (
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
                        <td>{item.date}</td>
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
          </Section>

          <Section
            title="Horas enviadas a revisión"
            subtitle={groupByPerson ? `${reviewByPerson.length} personas con registros en revisión` : `${reviewEntries.length} registros de Hora normal pendientes de resolución — afectan el total trabajado.`}
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

          {loading ? (
            <LoadingState variant="table" rows={5} columns={8} />
          ) : groupByPerson ? (
            reviewByPerson.length ? (
              <TableShell minWidth={1120}>
                <table>
                  <thead>
                    <tr>
                      <th>Legajo</th>
                      <th>Empleado</th>
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
                        <td>{formatHours(personSummary.total)} h</td>
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
                    <th>Legajo</th>
                    <th>Empleado</th>
                    <th>Día</th>
                    <th>Concepto</th>
                    <th>Horas</th>
                    <th>Observación</th>
                    <th>Estado</th>
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
                        <b>{entry.hours} h</b>
                      </td>
                      <td className="observation-cell">
                        <OverflowCell value={entry.notes || "-"} />
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
            title="Desgloses manuales pendientes"
            subtitle={`${pendingBreakdownItems.length} conceptos adicionales pendientes de resolución — son desgloses para liquidación/análisis y no modifican Hora normal ni el total trabajado.`}
          >
            {breakdownActionError ? <div className="form-error">{breakdownActionError}</div> : null}
            {loading ? (
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
                                  title="Aprobar desglose"
                                  aria-label="Aprobar desglose"
                                  disabled={isResolving}
                                  onClick={() => approveBreakdown(item)}
                                >
                                  <CheckCircle2 size={14} />
                                  <span>{isResolving ? "Aprobando..." : "Aprobar"}</span>
                                </button>
                                <button
                                  className="table-icon-action danger-link"
                                  title="Rechazar desglose"
                                  aria-label="Rechazar desglose"
                                  disabled={isResolving}
                                  onClick={() => openBreakdownReview(item, "reject")}
                                >
                                  <X size={14} />
                                  <span>Rechazar</span>
                                </button>
                                <button
                                  className="table-icon-action"
                                  title="Devolver desglose"
                                  aria-label="Devolver desglose"
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
              <EmptyState text="No hay desgloses manuales pendientes de revisión." />
            )}
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

        {loading ? (
          <LoadingState variant="table" rows={5} columns={9} />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => setRefresh((value) => value + 1)} />
        ) : !employees.length ? (
          <EmptyState text="No hay personas habilitadas para carga con los filtros aplicados." />
        ) : (
        <TableShell minWidth={1120 + monthDays.length * 64}>
          <table className="people-hours-table">
            <thead>
              <tr>
                <th>Legajo</th>
                <th>Empleado</th>
                <th>Empresa</th>
                <th>Centro de costo</th>
                <th>Responsable de carga</th>
                <th>Normales</th>
                <th>Especiales</th>
                <th>Total</th>
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
                    <td>{formatHours(periodSummary.normal)} h</td>
                    <td>{formatHours(periodSummary.special)} h</td>
                    <td>{formatHours(periodSummary.total)} h</td>
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
                        breakdown={dayMap.get(day)}
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
              ? "Rechazar desglose manual"
              : "Devolver desglose manual"
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
                  ? "El desglose quedará rechazado y se conservará para auditoría. No afecta Hora normal ni el total trabajado."
                  : "El desglose queda en estado Devuelto para que Nivel 2/3 lo corrija y lo vuelva a enviar. No afecta Hora normal ni el total trabajado."}
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
