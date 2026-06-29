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
import { employeeApiService } from "../services/api/employeeApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Employee, TimeEntry } from "../types";
import { buildHoursExportWorkbook, type HoursExportRow } from "../utils/hoursExport";
import { displayLegajo, fullName } from "../utils/employee";
import { currentMonthPeriod, formatPeriodDay } from "../utils/period";
import { statusClass } from "../utils/status";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
}

export function HoursPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const period = searchParams.get("period") || currentMonthPeriod();
  const [costCenter, setCostCenter] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<{ entry: TimeEntry; action: "reject" | "return" }>();
  const [noveltyReject, setNoveltyReject] = useState<PendingItem>();
  const [reviewReason, setReviewReason] = useState("");
  const [baseEmployees, setBaseEmployees] = useState<Employee[]>([]);
  const [periodEntriesSource, setPeriodEntriesSource] = useState<TimeEntry[]>([]);
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
        const [apiEmployees, apiEntries] = await Promise.all([
          employeeApiService.getAll(),
          timeEntryApiService.getByPeriod(period),
        ]);
        const apiPending = pendingOnly
          ? await pendingApiService.getAll({ period, kind: "all", take: 300 }).catch(() => undefined)
          : undefined;
        if (cancelled) return;
        setBaseEmployees(apiEmployees);
        setPeriodEntriesSource(apiEntries);
        setPendingItems(apiPending?.data || []);
        setUsesBackend(true);
      } catch (error) {
        if (cancelled) return;
        setBaseEmployees([]);
        setPeriodEntriesSource([]);
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
  }, [period, refresh, user]);

  const costCenters = uniqueOptions(baseEmployees.map((employee) => employee.costCenter));
  const employees = baseEmployees.filter((employee) => {
    const searchText =
      `${displayLegajo(employee)} ${employee.legajoFinnegans} ${employee.dni} ${employee.cuil} ${employee.firstName} ${employee.lastName}`.toLowerCase();
    return (
      (!costCenter || employee.costCenter === costCenter) &&
      searchText.includes(search.toLowerCase())
    );
  });
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const periodEntries = periodEntriesSource.filter((entry) => employeeIds.has(entry.employeeId));
  const reviewEntries = periodEntries.filter((entry) => entry.status === "En revisión");
  const pendingNoveltyItems = pendingItems.filter((item) => item.kind === "novelty");
  const canReview = user ? timeEntryApiService.canReview(user) : false;
  const summary = (employeeId: string) =>
    timeEntryApiService.getEmployeePeriodSummary(periodEntries, employeeId);
  const shown = pendingOnly
    ? employees.filter((employee) =>
        reviewEntries.some((entry) => entry.employeeId === employee.id),
      )
    : employees;
  const exportRows = timeEntryApiService.getPeriodExportRowsFromEntries(period, shown, periodEntries);
  const filterExportRowsToShown = (rows: HoursExportRow[]) => {
    const shownCuils = new Set(shown.map((employee) => employee.cuil).filter(Boolean));
    const shownLegajos = new Set(
      shown.flatMap((employee) => [employee.legajoInterno, employee.legajoFinnegans, employee.legajo]).filter(Boolean),
    );
    return rows.filter((row) => shownCuils.has(row.cuil) || shownLegajos.has(row.legajo));
  };
  const employeeFor = (entry: TimeEntry) =>
    baseEmployees.find((employee) => employee.id === entry.employeeId);
  const approvedHours = periodEntries
    .filter((entry) => timeEntryApiService.isCountableStatus(entry.status))
    .reduce((sum, entry) => sum + entry.hours, 0);

  const setPeriodValue = (value: string) => setSearchParams(value ? { period: value } : {});
  const exportHours = async () => {
    setExportError("");
    setExporting(true);
    try {
      const rows = usesBackend
        ? filterExportRowsToShown(await timeEntryApiService.getPeriodExportRows(period))
        : exportRows;
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
            <button
              className="button subtle"
              type="button"
              disabled={exporting || !exportRows.length}
              onClick={exportHours}
            >
              <FileBarChart size={16} /> {exporting ? "Exportando..." : "Exportar horas"}
            </button>
          ) : undefined
        }
      />
      {loadError ? <div className="form-error">{loadError}</div> : null}
      {exportError ? <div className="form-error">{exportError}</div> : null}

      <div className="stat-grid">
        <StatCard label="Personas visibles" value={employees.length} icon={Users} />
        <StatCard
          label="Pendientes"
          value={employees.filter((employee) => summary(employee.id).status === "Pendiente").length}
          icon={Clock3}
          tone="orange"
        />
        <StatCard
          label="En revisión"
          value={new Set(reviewEntries.map((entry) => entry.employeeId)).size}
          icon={ClipboardList}
          tone="purple"
        />
        <StatCard
          label="Horas contables"
          value={`${approvedHours} h`}
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
                          <span className={statusClass(item.status)}>{item.status}</span>
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
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select value={costCenter} onChange={(event) => setCostCenter(event.target.value)}>
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
                    return (
                      <tr key={entry.id}>
                        <td>
                          <b>{displayLegajo(employee)}</b>
                        </td>
                        <td>
                          <OverflowCell value={employee ? fullName(employee) : "-"} />
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
                          <span className={statusClass(entry.status)}>{entry.status}</span>
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
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select value={costCenter} onChange={(event) => setCostCenter(event.target.value)}>
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
                      <span className={statusClass(periodSummary.status)}>
                        {periodSummary.status}
                      </span>
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
              <button className="button subtle" onClick={() => setReview(undefined)}>
                Cancelar
              </button>
              <button
                className={review.action === "reject" ? "button danger-button" : "button primary"}
                onClick={confirmReview}
              >
                {review.action === "reject" ? "Rechazar" : "Devolver"}
              </button>
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
              <button className="button subtle" onClick={() => setNoveltyReject(undefined)}>
                Cancelar
              </button>
              <button className="button danger-button" onClick={confirmNoveltyReject}>
                Rechazar
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
