import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, RotateCcw, Send, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { workforceApiService, type MonthlyClosure, type TimeCorrection } from "../services/api/workforceApiService";
import type { Employee } from "../types";
import { roleLevel } from "../utils/roles";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { TableShell } from "../components/ui/TableShell";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { requestText } from "../services/appDialog";

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const statusText: Record<string, string> = {
  ABIERTO: "Abierto",
  ENVIADO: "Esperando a RH",
  APROBADO: "Aprobado por RH",
  DEVUELTO: "Devuelto para corregir",
  CORRECCION_PENDIENTE: "Corrección pendiente",
};
const statusTone = (status: string) => status === "APROBADO" ? "success" : status === "DEVUELTO" ? "danger" : status === "ABIERTO" ? "neutral" : "warning";

export function MonthlyClosuresPage() {
  const { user } = useAuth();
  const isRrhh = roleLevel(user!.role) === 1;
  const [period, setPeriod] = useState(currentPeriod);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [closures, setClosures] = useState<MonthlyClosure[]>([]);
  const [corrections, setCorrections] = useState<TimeCorrection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  // Etapa 9B: `load` está memoizado por [period] y se invoca también desde
  // `execute()` (fuera del efecto de montaje) — leer `closures.length`
  // directo del closure sería un valor stale entre renders donde `period`
  // no cambió. Un ref siempre refleja el último dato real cargado.
  const hasLoadedDataRef = useRef(false);

  const load = useCallback(async () => {
    // Sólo mostrar el loading grande cuando todavía no hay datos en
    // pantalla — cambiar de período o repetir load() tras una acción
    // (aprobar/enviar/devolver) no debe blanquear toda la sección, incluida
    // la barra de acciones (mismo patrón de EmployeesPage).
    if (!hasLoadedDataRef.current) setLoading(true);
    setError("");
    try {
      const [employeeResult, closureResult, correctionResult] = await Promise.all([
        employeeApiService.getOptions({ take: 1000 }),
        workforceApiService.closures(period),
        workforceApiService.corrections(),
      ]);
      setEmployees(employeeResult.items);
      setClosures(closureResult);
      setCorrections(correctionResult);
      setSelected([]);
      hasLoadedDataRef.current = true;
    } catch {
      setError("No se pudo cargar el circuito de cierres. Reintentá en unos segundos.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);
  const byEmployee = useMemo(() => new Map(closures.map((item) => [item.employeeId, item])), [closures]);
  const rows = isRrhh ? closures : employees.map((employee) => byEmployee.get(employee.id) || ({
    id: `open-${employee.id}`, employeeId: employee.id, period, status: "ABIERTO", employee: {
      id: employee.id, legajo: employee.legajo, firstName: employee.firstName, lastName: employee.lastName,
    },
  } as MonthlyClosure));
  const selectable = rows.filter((row) => isRrhh ? row.status === "ENVIADO" : ["ABIERTO", "DEVUELTO"].includes(row.status));
  const pendingCorrections = corrections.filter((item) => item.status === "PENDIENTE" && item.timeEntry.date.slice(0, 7) === period);

  const execute = async (operation: () => Promise<unknown>) => {
    setWorking(true); setError("");
    try { await operation(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción."); }
    finally { setWorking(false); }
  };

  return <>
    <PageHeader eyebrow="GESTIÓN HORARIA" title="Cierres mensuales" description="Nivel 2 y 3 consolidan sus legajos; RH controla y aprueba el cierre final del período." />
    {error ? <div className="form-error">{error}</div> : null}
    <Section title="Estado del período" subtitle="El cierre se realiza por legajo y conserva un historial auditable." action={<label className="field compact-field"><span>Período</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>}>
      {loading ? <LoadingState text="Cargando cierres..." /> : <>
        <div className="bulk-toolbar">
          <label><input type="checkbox" checked={selectable.length > 0 && selectable.every((row) => selected.includes(row.id))} onChange={(event) => setSelected(event.target.checked ? selectable.map((row) => row.id) : [])} /> Seleccionar pendientes</label>
          {isRrhh ? <Button variant="primary" icon={CheckCheck} disabled={!selected.length || working} onClick={() => execute(() => workforceApiService.approveClosures(selected))}>Aprobar seleccionados</Button>
            : <Button variant="primary" icon={Send} disabled={!selected.length || working} onClick={() => execute(() => workforceApiService.submitClosures(period, rows.filter((row) => selected.includes(row.id)).map((row) => row.employeeId)))}>Enviar cierre a RH</Button>}
        </div>
        <TableShell minWidth={1080}>
        <table><thead><tr><th></th><th>Legajo</th><th>Empleado</th><th>Estado</th><th>Responsable</th><th>Observación</th><th>Acción</th></tr></thead><tbody>
          {rows.map((row) => { const canSelect = selectable.some((item) => item.id === row.id); return <tr key={row.id}>
            <td><input aria-label={`Seleccionar ${row.employee.legajo}`} type="checkbox" disabled={!canSelect} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td>
            <td><b>{row.employee.legajo}</b></td><td>{row.employee.lastName}, {row.employee.firstName}</td>
            <td><Badge tone={statusTone(row.status)}>{statusText[row.status]}</Badge></td>
            <td>{row.submittedBy?.name || "—"}</td><td>{row.reviewNote || "—"}</td>
            <td>{isRrhh && row.status === "ENVIADO" ? <div className="table-actions"><button type="button" className="table-icon-action" title="Devolver cierre" aria-label={`Devolver cierre de ${row.employee.legajo}`} onClick={async () => { const reason = await requestText("Indicá por qué se devuelve este cierre para que el responsable pueda corregirlo.", { title: "Devolver cierre mensual", inputLabel: "Motivo de devolución", confirmLabel: "Devolver", tone: "danger" }); if (reason) await execute(() => workforceApiService.returnClosure(row.id, reason)); }}><RotateCcw size={14}/><span>Devolver</span></button></div> : "—"}</td>
          </tr>; })}
        </tbody></table>
        </TableShell>
        {!rows.length ? <EmptyState text="No hay cierres registrados para este período." /> : null}
      </>}
    </Section>
    <Section title="Correcciones posteriores al cierre" subtitle="Aquí aparecen únicamente cambios solicitados después de enviar o aprobar el mes.">
      <TableShell minWidth={1100}>
      <table><thead><tr><th>Empleado</th><th>Día / concepto</th><th>Anterior</th><th>Propuesto</th><th>Motivo</th><th>Solicitó</th><th>Acción</th></tr></thead><tbody>
        {pendingCorrections.map((item) => <tr key={item.id}><td><b>{item.employee.legajo}</b> · {item.employee.lastName}, {item.employee.firstName}</td><td>{new Date(item.timeEntry.date).toLocaleDateString("es-AR")} · {item.timeEntry.hourConcept.name}</td><td>{Number(item.previousHours)} h</td><td>{Number(item.proposedHours)} h</td><td>{item.reason}</td><td>{item.createdBy.name}</td><td>{isRrhh ? <div className="table-actions"><button type="button" className="table-icon-action" title="Aprobar corrección" aria-label="Aprobar corrección" onClick={() => void execute(() => workforceApiService.reviewCorrection(item.id, "approve"))}><Check size={14}/><span>Aprobar</span></button><button type="button" className="table-icon-action danger-link" title="Rechazar corrección" aria-label="Rechazar corrección" onClick={() => void execute(() => workforceApiService.reviewCorrection(item.id, "reject"))}><X size={14}/><span>Rechazar</span></button></div> : <Badge tone="warning">Esperando a RH</Badge>}</td></tr>)}
      </tbody></table>
      </TableShell>
      {!pendingCorrections.length ? <EmptyState text="No hay correcciones pendientes para este período." /> : null}
    </Section>
  </>;
}
