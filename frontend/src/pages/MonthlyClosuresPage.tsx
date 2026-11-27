import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Eye, ListChecks, LockKeyhole, RotateCcw } from "lucide-react";
import { employeeApiService } from "../services/api/employeeApiService";
import { workforceApiService, type ClosureBlockerGroup, type ClosureBlockersPreview, type MonthlyClosure } from "../services/api/workforceApiService";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import type { Employee } from "../types";
import { monthlyClosureStatusText as statusText, monthlyClosureStatusTone as statusTone } from "../utils/monthlyClosureStatus";
import { currentMonthPeriod, formatPeriodLabel } from "../utils/period";
import { formatCalendarDate } from "../utils/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { TableShell } from "../components/ui/TableShell";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Modal } from "../components/ui/Modal";
import { MonthlyClosureReviewPanel } from "../components/hours/MonthlyClosureReviewPanel";
import { ClosureBlockerList, closureBlockerTypeLabel, employeeLabel } from "../components/hours/ClosureBlockerList";
import { confirmAction, requestText } from "../services/appDialog";

// Códigos con los que el cierre definitivo rechaza por pendientes: la pantalla
// nunca interpreta el texto, vuelve a consultar la vista previa estructurada.
const BLOCKED_CLOSE_CODES = new Set(["CLOSURE_HAS_OPERATIONAL_BLOCKERS", "CLOSURE_HAS_PENDING_NOVELTY_REVIEW"]);

type BlockersState = { status: "loading" | "ready" | "error"; data: ClosureBlockersPreview | null };
type BlockerDialog =
  | { kind: "employee"; group: ClosureBlockerGroup }
  | { kind: "close"; groups: ClosureBlockerGroup[]; closableEmployeeIds: string[] };

export function MonthlyClosuresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") || currentMonthPeriod();
  const setPeriod = (value: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set("period", value); else next.delete("period");
    return next;
  }, { replace: true });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [closures, setClosures] = useState<MonthlyClosure[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState<MonthlyClosure | null>(null);
  const [blockers, setBlockers] = useState<BlockersState>({ status: "loading", data: null });
  const [dialog, setDialog] = useState<BlockerDialog | null>(null);
  const loaded = useRef(false);
  const blockersRequest = useRef(0);

  const loadBlockers = useCallback(async () => {
    const request = ++blockersRequest.current;
    // Conserva lo ya mostrado del mismo período mientras se actualiza (sin parpadeo).
    setBlockers((current) => ({ status: "loading", data: current.data?.period === period ? current.data : null }));
    try {
      const data = await workforceApiService.closureBlockers(period);
      if (request === blockersRequest.current) setBlockers({ status: "ready", data });
      return data;
    } catch {
      if (request === blockersRequest.current) setBlockers({ status: "error", data: null });
      return null;
    }
  }, [period]);

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    setError("");
    void loadBlockers();
    try {
      const [employeeResult, closureResult] = await Promise.all([employeeApiService.getAllOptions(), workforceApiService.closures(period)]);
      setEmployees(employeeResult);
      setClosures(closureResult);
      setSelected([]);
      loaded.current = true;
    } catch { setError("No se pudieron cargar los cierres mensuales."); }
    finally { setLoading(false); }
  }, [period, loadBlockers]);

  useEffect(() => { void load(); }, [load]);

  // Al volver de Asistencia o Carga de horas (otra pestaña o la misma), los
  // pendientes se recalculan sin recargar la página.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadBlockers(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loadBlockers]);

  const byEmployee = useMemo(() => new Map(closures.map((item) => [item.employeeId, item])), [closures]);
  const blockersByEmployee = useMemo(() => new Map((blockers.data?.employees ?? []).map((group) => [group.employee.id, group])), [blockers.data]);
  const rows = employees.map((employee) => byEmployee.get(employee.id) || ({
    id: `open-${employee.id}`, employeeId: employee.id, period, status: "ABIERTO",
    employee: { id: employee.id, legajo: employee.legajo, firstName: employee.firstName, lastName: employee.lastName },
  } as MonthlyClosure));
  const openRows = rows.filter((row) => row.status === "ABIERTO");
  const visibleGroups = (blockers.data?.employees ?? []).filter((group) => byEmployee.get(group.employee.id)?.status !== "CERRADO");
  const visibleBlockerCount = visibleGroups.reduce((sum, group) => sum + group.blockers.length, 0);

  const runClose = async (employeeIds: string[]) => {
    setWorking(true); setError("");
    try { await workforceApiService.closeClosures(period, employeeIds); setDialog(null); await load(); }
    catch (reason) {
      if (reason instanceof ApiError && BLOCKED_CLOSE_CODES.has(reason.code)) {
        // Validación definitiva del backend: algo cambió desde la última
        // consulta. Se vuelve a pedir la vista previa y se muestra agrupada.
        const fresh = await loadBlockers();
        const groups = (fresh?.employees ?? []).filter((group) => employeeIds.includes(group.employee.id));
        if (groups.length) {
          const blocked = new Set(groups.map((group) => group.employee.id));
          setDialog({ kind: "close", groups, closableEmployeeIds: employeeIds.filter((id) => !blocked.has(id)) });
        } else setError(getUserErrorMessage(reason, "No se pudo cerrar el período."));
      } else setError(getUserErrorMessage(reason, "No se pudo cerrar el período."));
    } finally { setWorking(false); }
  };

  const closeSelected = async () => {
    const employeeIds = rows.filter((row) => selected.includes(row.id)).map((row) => row.employeeId);
    if (!employeeIds.length) return;
    const groups = employeeIds.flatMap((id) => blockersByEmployee.get(id) ?? []);
    if (groups.length) {
      const blocked = new Set(groups.map((group) => group.employee.id));
      setDialog({ kind: "close", groups, closableEmployeeIds: employeeIds.filter((id) => !blocked.has(id)) });
      return;
    }
    await runClose(employeeIds);
  };

  const reopen = async (row: MonthlyClosure) => {
    const reason = await requestText("Indicá el motivo de la reapertura. Quedará registrado en auditoría.", { title: "Reabrir mes", inputLabel: "Motivo", confirmLabel: "Reabrir", tone: "danger" });
    if (!reason || reason.trim().length < 5) return;
    setWorking(true); setError("");
    try { await workforceApiService.reopenClosure(row.id, reason); await load(); }
    catch (cause) {
      if (cause instanceof ApiError && cause.code === "CLOSURE_REOPEN_EXPORTED_CONFIRMATION_REQUIRED") {
        const confirmed = await confirmAction("Este mes ya fue exportado. Las versiones históricas se conservarán sin cambios y una nueva exportación generará otra versión. ¿Querés reabrirlo?", { title: "Mes ya exportado", confirmLabel: "Reabrir igualmente", tone: "danger" });
        if (confirmed) { try { await workforceApiService.reopenClosure(row.id, reason, true); await load(); } catch (retryCause) { setError(getUserErrorMessage(retryCause, "No se pudo reabrir el período.")); } }
      } else setError(getUserErrorMessage(cause, "No se pudo reabrir el período."));
    } finally { setWorking(false); }
  };

  const pendingCell = (row: MonthlyClosure) => {
    if (row.status === "CERRADO") return <span className="closure-muted">—</span>;
    if (blockers.status === "loading" && !blockers.data) return <span className="closure-muted">Revisando…</span>;
    if (blockers.status === "error") return <span className="closure-muted">Sin datos</span>;
    const group = blockersByEmployee.get(row.employeeId);
    if (!group) return <Badge tone="success">Listo para cerrar</Badge>;
    return <button type="button" className="closure-pending-trigger" onClick={() => setDialog({ kind: "employee", group })}><AlertTriangle size={13} aria-hidden="true" />{group.blockers.length} {group.blockers.length === 1 ? "pendiente" : "pendientes"}</button>;
  };

  return <>
    <PageHeader eyebrow="GESTIÓN HORARIA" title="Cierres mensuales" description="Cualquier responsable autorizado puede cerrar o reabrir sus legajos. El cierre bloquea cambios normales hasta la reapertura." />
    {error ? <div className="form-error" role="alert">{error}</div> : null}

    <Section
      title="Pendientes para cerrar"
      subtitle={`${formatPeriodLabel(period)} · Sólo lo que puede cambiar las horas impide cerrar. Las observaciones informativas no bloquean.`}
      action={<Button variant="subtle" icon={RotateCcw} disabled={blockers.status === "loading"} onClick={() => void loadBlockers()}>Actualizar</Button>}
    >
      {blockers.status === "loading" && !blockers.data ? <LoadingState text="Revisando pendientes del período..." />
        : blockers.status === "error" ? <ErrorState title="No se pudieron revisar los pendientes" message="El cierre sigue validándose al confirmar. Reintentá para ver el detalle." onRetry={() => void loadBlockers()} />
        : !visibleGroups.length ? <div className="closure-blockers-clear"><CheckCircle2 size={18} aria-hidden="true" /><span>Sin pendientes: los legajos abiertos de {formatPeriodLabel(period)} se pueden cerrar.</span></div>
        : <>
          <p className="closure-blockers-summary"><b>{visibleGroups.length}</b> {visibleGroups.length === 1 ? "legajo tiene" : "legajos tienen"} <b>{visibleBlockerCount}</b> {visibleBlockerCount === 1 ? "pendiente que impide" : "pendientes que impiden"} cerrar.</p>
          <TableShell minWidth={860}><table><thead><tr><th>Legajo</th><th>Empleado</th><th>Pendientes</th><th>Desde</th><th>Acciones</th></tr></thead><tbody>
            {visibleGroups.map((group) => {
              const types = [...new Set(group.blockers.map((blocker) => blocker.type))];
              return <tr key={group.employee.id}>
                <td><b>{group.employee.legajo}</b></td>
                <td>{employeeLabel(group.employee)}</td>
                <td><div className="closure-badge-row">{types.map((type) => <Badge key={type} tone="warning">{closureBlockerTypeLabel[type]} · {group.blockers.filter((blocker) => blocker.type === type).length}</Badge>)}</div></td>
                <td>{formatCalendarDate(group.blockers[0]!.date)}</td>
                <td><div className="table-actions"><button type="button" className="table-icon-action" onClick={() => setDialog({ kind: "employee", group })}><ListChecks size={14} /><span>Ver incidencias</span></button></div></td>
              </tr>;
            })}
          </tbody></table></TableShell>
        </>}
    </Section>

    <Section title="Estado del período" subtitle="Cerrá los legajos listos. Los que tienen pendientes se informan antes de confirmar." action={<label className="field compact-field"><span>Período</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>}>
      {loading ? <LoadingState text="Cargando cierres..." /> : <>
        <div className="bulk-toolbar">
          <label><input type="checkbox" checked={openRows.length > 0 && openRows.every((row) => selected.includes(row.id))} onChange={(event) => setSelected(event.target.checked ? openRows.map((row) => row.id) : [])} /> Seleccionar abiertos</label>
          <Button variant="primary" icon={LockKeyhole} disabled={!selected.length || working} onClick={() => void closeSelected()}>Cerrar seleccionados</Button>
        </div>
        <TableShell minWidth={1100}><table><thead><tr><th></th><th>Legajo</th><th>Empleado</th><th>Estado</th><th>Pendientes</th><th>Responsable</th><th>Exportaciones</th><th>Acciones</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}>
            <td><input aria-label={`Seleccionar ${row.employee.legajo}`} type="checkbox" disabled={row.status !== "ABIERTO"} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td>
            <td><b>{row.employee.legajo}</b></td><td>{row.employee.lastName}, {row.employee.firstName}</td>
            <td><Badge tone={statusTone(row.status)}>{statusText[row.status]}</Badge></td>
            <td>{pendingCell(row)}</td>
            <td>{row.closedBy?.name || "—"}</td>
            <td>{row.exportHistory ? `${row.exportHistory.count} · última v${row.exportHistory.latestVersion}` : "Sin exportar"}</td>
            <td><div className="table-actions"><button type="button" className="table-icon-action" onClick={() => setReviewing(row)}><Eye size={14}/><span>Revisar horas</span></button>{row.status === "CERRADO" ? <button type="button" className="table-icon-action danger-link" onClick={() => void reopen(row)}><RotateCcw size={14}/><span>Reabrir</span></button> : null}</div></td>
          </tr>)}
        </tbody></table></TableShell>
        {!rows.length ? <EmptyState text="No hay legajos disponibles para este período." /> : null}
      </>}
    </Section>

    {dialog?.kind === "employee" ? (
      <Modal size="wide" title={`Pendientes de ${employeeLabel(dialog.group.employee)}`} subtitle={`Legajo ${dialog.group.employee.legajo} · ${formatPeriodLabel(period)}`} close={() => setDialog(null)}>
        <ClosureBlockerList groups={[dialog.group]} onNavigate={() => setDialog(null)} />
      </Modal>
    ) : null}
    {dialog?.kind === "close" ? (
      <Modal size="wide" title="No se pueden cerrar todos los seleccionados" subtitle={`${dialog.groups.length} ${dialog.groups.length === 1 ? "legajo tiene" : "legajos tienen"} pendientes que pueden cambiar las horas de ${formatPeriodLabel(period)}.`} close={() => setDialog(null)} closeDisabled={working}>
        <ClosureBlockerList groups={dialog.groups} onNavigate={() => setDialog(null)} />
        <div className="form-actions">
          <Button variant="subtle" disabled={working} onClick={() => setDialog(null)}>Volver</Button>
          {dialog.closableEmployeeIds.length ? <Button variant="primary" icon={LockKeyhole} disabled={working} onClick={() => void runClose(dialog.closableEmployeeIds)}>{working ? "Cerrando..." : `Cerrar sólo ${dialog.closableEmployeeIds.length} sin pendientes`}</Button> : null}
        </div>
      </Modal>
    ) : null}
    {reviewing ? <MonthlyClosureReviewPanel closure={reviewing} period={period} close={() => setReviewing(null)} /> : null}
  </>;
}
