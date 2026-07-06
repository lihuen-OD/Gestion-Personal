import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Eye,
  FileBarChart,
  RefreshCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, TimeEntry } from "../types";
import { buildHoursExportWorkbook } from "../utils/hoursExport";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, formatPeriodDay } from "../utils/period";
import { statusTone } from "../utils/status";
import { useDebouncedValue } from "../utils/useDebouncedValue";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Pagination } from "../components/ui/Pagination";

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
}

const emptyHoursSummary = {
  activeEmployees: 0,
  employeesWithEntries: 0,
  pendingEmployees: 0,
  reviewEmployees: 0,
  countableHours: 0,
  coverage: 0,
};
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
  const [reviewReason, setReviewReason] = useState("");
  const [baseEmployees, setBaseEmployees] = useState<Employee[]>([]);
  const [periodRows, setPeriodRows] = useState<Array<{ employee: Employee; summary: { total: number; status: string } }>>([]);
  const [periodRowsMeta, setPeriodRowsMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewEntriesMeta, setReviewEntriesMeta] = useState({ total: 0, page: 1, pageSize, hasMore: false });
  const [periodEntriesSource, setPeriodEntriesSource] = useState<TimeEntry[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<Array<{ id: string; name: string }>>([]);
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
      if (!user) return;
      setLoading(true);
      setLoadError("");
      try {
        const costCenterId = costCenterOptions.find((item) => item.name === costCenter)?.id;
        const [apiRows, apiSummary, apiReviewEntries, apiPending] = await Promise.all([
          timeEntryApiService.getPeriodEmployees({ period, search: debouncedSearch, costCenterId, page, take: pageSize }),
          timeEntryApiService.getSummary(period).catch(() => emptyHoursSummary),
          pendingOnly ? timeEntryApiService.list({ period, status: "En revisión", search: debouncedSearch, costCenterId, page: reviewPage, take: pageSize }) : Promise.resolve({ items: [], meta: { total: 0, page: 1, pageSize, hasMore: false } }),
          pendingOnly ? pendingApiService.getAll({ period, kind: "all", take: 300 }).catch(() => undefined) : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        setBaseEmployees([]);
        setPeriodRows(apiRows.items);
        setPeriodRowsMeta(apiRows.meta);
        setPeriodEntriesSource(apiReviewEntries.items);
        setReviewEntriesMeta(apiReviewEntries.meta);
        setHoursSummary(apiSummary);
        setPendingItems(apiPending?.data || []);
        setUsesBackend(true);
      } catch (error) {
        if (cancelled) return;
        setBaseEmployees([]);
        setPeriodRows([]);
        setPeriodRowsMeta({ total: 0, page, pageSize, hasMore: false });
        setPeriodEntriesSource([]);
        setReviewEntriesMeta({ total: 0, page: reviewPage, pageSize, hasMore: false });
        setHoursSummary(emptyHoursSummary);
        setPendingItems([]);
        setUsesBackend(false);
        setLoadError("No se pudo cargar carga horaria desde backend. Verifica que la API este levantada y que existan datos en la base.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [costCenter, costCenterOptions, debouncedSearch, page, pendingOnly, period, refresh, reviewPage, user]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (mounted) setCostCenterOptions(catalog.costCenters.filter((item) => item.status === "ACTIVO").map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const costCenters = uniqueOptions(costCenterOptions.map((item) => item.name));
  const employees = periodRows.map((row) => row.employee);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const periodEntries = periodEntriesSource.filter((entry) => employeeIds.has(entry.employeeId));
  const reviewEntries = periodEntries.filter((entry) => entry.status === "En revisión");
  const pendingNoveltyItems = pendingItems.filter((item) => item.kind === "novelty");
  const canReview = user ? timeEntryApiService.canReview(user) : false;
  const summary = (employeeId: string) =>
    periodRows.find((row) => row.employee.id === employeeId)?.summary ||
    timeEntryApiService.getEmployeePeriodSummary(periodEntries, employeeId);
  const shown = pendingOnly
    ? employees.filter((employee) =>
        reviewEntries.some((entry) => entry.employeeId === employee.id),
      )
    : employees;
  const exportRows = timeEntryApiService.getPeriodExportRowsFromEntries(period, shown, periodEntries);
  const employeeFor = (entry: TimeEntry) =>
    baseEmployees.find((employee) => employee.id === entry.employeeId) || periodRows.find((row) => row.employee.id === entry.employeeId)?.employee;
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
      buildHoursExportWorkbook(rows, period);
    } catch (error) {
      if (!exportRows.length) {
        setExportError("No se pudo preparar la exportación desde el backend.");
        return;
      }
      buildHoursExportWorkbook(exportRows, period);
      setExportError("Se exportó usando los datos visibles de la pantalla porque el backend no respondió.");
    } finally {
      setExporting(false);
    }
  };
  const approve = async (entry: TimeEntry) => {
    if (!user) return;
    await timeEntryApiService.approve(entry.id);
    setRefresh((value) => value + 1);
  };
  const openReview = (entry: TimeEntry, action: "reject" | "return") => {
    setReview({ entry, action });
    setReviewReason("");
  };
  const confirmReview = async () => {
    if (!reviewReason.trim() || !review) return;
    if (!user) return;
    if (review.action === "reject") {
      await timeEntryApiService.reject(review.entry.id, reviewReason.trim());
    } else {
      await timeEntryApiService.returnForCorrection(review.entry.id, reviewReason.trim());
    }
    setReview(undefined);
    setReviewReason("");
    setRefresh((value) => value + 1);
  };
  const approveNovelty = async (item: PendingItem) => {
    if (!user) return;
    await noveltyApiService.approve(item.sourceId);
    setRefresh((value) => value + 1);
  };
  const confirmNoveltyReject = async () => {
    if (!noveltyReject || !reviewReason.trim()) return;
    await noveltyApiService.reject(noveltyReject.sourceId, reviewReason.trim());
    setNoveltyReject(undefined);
    setReviewReason("");
    setRefresh((value) => value + 1);
  };

  return (
    <>
      <PageHeader
        eyebrow="CONTROL HORARIO"
        title={pendingOnly ? "Bandeja de revisión" : "Carga de horas"}
        description={
          pendingOnly
            ? "Revisá, aprobá, rechazá o devolvé las horas enviadas a revisión."
            : "Seleccioná el período y buscá personas asignadas. Los totales visibles cuentan horas aprobadas y en revisión."
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
          value={`${hoursSummary.countableHours} h`}
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
            {pendingNoveltyItems.length ? (
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
                                className="table-link table-icon-action"
                                title="Aprobar novedad"
                                aria-label="Aprobar novedad"
                                onClick={() => approveNovelty(item)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Aprobar</span>
                              </button>
                              <button
                                className="table-link table-icon-action danger-link"
                                title="Rechazar novedad"
                                aria-label="Rechazar novedad"
                                onClick={() => {
                                  setNoveltyReject(item);
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
              <EmptyState text={usesBackend ? "No hay novedades pendientes para este período." : "Levantá el backend para ver novedades pendientes consolidadas."} />
            )}
          </Section>

          <Section
            title="Horas enviadas a revisión"
            subtitle={`${reviewEntries.length} registros pendientes de resolución`}
          >
          <div className="filters">
            <label>
              Período
              <input
                type="month"
                value={period}
                onChange={(event) => setPeriodValue(event.target.value)}
              />
            </label>
            <label className="search-field">
              <Search size={17} />
              <input
                placeholder="Buscar por legajo, DNI, CUIL, apellido o nombre"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                  setReviewPage(1);
                }}
              />
            </label>
            <select
              value={costCenter}
              onChange={(event) => {
                setCostCenter(event.target.value);
                setPage(1);
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
          </div>

          {reviewEntries.length ? (
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
                  {reviewEntries.map((entry) => {
                    const employee = employeeFor(entry);
                    const employeeLegajo = employee ? displayLegajo(employee) : entry.employeeLegajo || "-";
                    const employeeName = employee ? fullName(employee) : entry.employeeName || "-";
                    return (
                      <tr key={entry.id}>
                        <td>
                          <b>{employeeLegajo}</b>
                        </td>
                        <td>
                          <OverflowCell value={employeeName} />
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
                          {canReview ? (
                            <div className="table-actions">
                              <button
                                className="table-link table-icon-action"
                                title="Aprobar"
                                aria-label="Aprobar"
                                onClick={() => approve(entry)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Aprobar</span>
                              </button>
                              <button
                                className="table-link table-icon-action danger-link"
                                title="Rechazar"
                                aria-label="Rechazar"
                                onClick={() => openReview(entry, "reject")}
                              >
                                <X size={14} />
                                <span>Rechazar</span>
                              </button>
                              <button
                                className="table-link table-icon-action"
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
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState text="No hay horas en revisión para los filtros seleccionados." />
          )}
          <Pagination page={reviewEntriesMeta.page} pageSize={reviewEntriesMeta.pageSize} total={reviewEntriesMeta.total} hasMore={reviewEntriesMeta.hasMore} onPageChange={setReviewPage} itemLabel="registros" />
          </Section>
        </>
      ) : null}

      <Section
        title={pendingOnly ? "Personas con registros en revisión" : "Personas habilitadas para carga"}
        subtitle="La asignación del responsable y del encargado directo determina quién aparece en este listado."
      >
        <div className="filters">
          <label>
            Período
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriodValue(event.target.value)}
            />
          </label>
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar persona por legajo, DNI, CUIL, apellido o nombre"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setReviewPage(1);
              }}
            />
          </label>
          <select
            value={costCenter}
            onChange={(event) => {
              setCostCenter(event.target.value);
              setPage(1);
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
        </div>

        <TableShell minWidth={1120}>
          <table>
            <thead>
              <tr>
                <th>Legajo</th>
                <th>Empleado</th>
                <th>Empresa</th>
                <th>Centro de costo</th>
                <th>Responsable de carga</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((employee) => {
                const periodSummary = summary(employee.id);
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
                    <td>{periodSummary.total} h</td>
                    <td>
                      <Badge tone={statusTone(periodSummary.status)}>
                        {periodSummary.status}
                      </Badge>
                    </td>
                    <td>
                      <Link
                        className="table-link table-icon-action"
                        title="Cargar / Ver"
                        aria-label="Cargar / Ver"
                        to={`/horas/${employee.id}?period=${period}`}
                      >
                        <Eye size={14} />
                        <span>Cargar / Ver</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
        <Pagination page={periodRowsMeta.page} pageSize={periodRowsMeta.pageSize} total={periodRowsMeta.total} hasMore={periodRowsMeta.hasMore} onPageChange={setPage} itemLabel="legajos" />
      </Section>

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
                  : "El registro vuelve a Pendiente para que pueda corregirse."}
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
