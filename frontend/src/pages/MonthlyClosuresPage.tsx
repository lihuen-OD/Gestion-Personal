import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, RotateCcw, Send } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { employeeApiService } from "../services/api/employeeApiService";
import { workforceApiService, type MonthlyClosure, type TimeCorrection } from "../services/api/workforceApiService";
import type { Employee } from "../types";
import { roleLevel } from "../utils/roles";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
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

  const load = useCallback(async () => {
    setLoading(true);
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
      {loading ? <div className="empty">Cargando cierres…</div> : <>
        <div className="bulk-toolbar">
          <label><input type="checkbox" checked={selectable.length > 0 && selectable.every((row) => selected.includes(row.id))} onChange={(event) => setSelected(event.target.checked ? selectable.map((row) => row.id) : [])} /> Seleccionar pendientes</label>
          {isRrhh ? <Button variant="primary" icon={CheckCheck} disabled={!selected.length || working} onClick={() => execute(() => workforceApiService.approveClosures(selected))}>Aprobar seleccionados</Button>
            : <Button variant="primary" icon={Send} disabled={!selected.length || working} onClick={() => execute(() => workforceApiService.submitClosures(period, rows.filter((row) => selected.includes(row.id)).map((row) => row.employeeId)))}>Enviar cierre a RH</Button>}
        </div>
        <table><thead><tr><th></th><th>Legajo</th><th>Empleado</th><th>Estado</th><th>Responsable</th><th>Observación</th><th>Acción</th></tr></thead><tbody>
          {rows.map((row) => { const canSelect = selectable.some((item) => item.id === row.id); return <tr key={row.id}>
            <td><input aria-label={`Seleccionar ${row.employee.legajo}`} type="checkbox" disabled={!canSelect} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /></td>
            <td><b>{row.employee.legajo}</b></td><td>{row.employee.lastName}, {row.employee.firstName}</td>
            <td><span className={`badge ${statusTone(row.status)}`}>{statusText[row.status]}</span></td>
            <td>{row.submittedBy?.name || "—"}</td><td>{row.reviewNote || "—"}</td>
            <td>{isRrhh && row.status === "ENVIADO" ? <button className="table-link" onClick={async () => { const reason = await requestText("Indicá por qué se devuelve este cierre para que el responsable pueda corregirlo.", { title: "Devolver cierre mensual", inputLabel: "Motivo de devolución", confirmLabel: "Devolver", tone: "danger" }); if (reason) await execute(() => workforceApiService.returnClosure(row.id, reason)); }}><RotateCcw size={15}/> Devolver</button> : "—"}</td>
          </tr>; })}
        </tbody></table>
        {!rows.length ? <div className="empty">No hay cierres registrados para este período.</div> : null}
      </>}
    </Section>
    <Section title="Correcciones posteriores al cierre" subtitle="Aquí aparecen únicamente cambios solicitados después de enviar o aprobar el mes.">
      <table><thead><tr><th>Empleado</th><th>Día / concepto</th><th>Anterior</th><th>Propuesto</th><th>Motivo</th><th>Solicitó</th><th>Acción</th></tr></thead><tbody>
        {pendingCorrections.map((item) => <tr key={item.id}><td><b>{item.employee.legajo}</b> · {item.employee.lastName}, {item.employee.firstName}</td><td>{new Date(item.timeEntry.date).toLocaleDateString("es-AR")} · {item.timeEntry.hourConcept.name}</td><td>{Number(item.previousHours)} h</td><td>{Number(item.proposedHours)} h</td><td>{item.reason}</td><td>{item.createdBy.name}</td><td>{isRrhh ? <div className="table-actions"><button className="table-link" onClick={() => void execute(() => workforceApiService.reviewCorrection(item.id, "approve"))}>Aprobar</button><button className="table-link danger-text" onClick={() => void execute(() => workforceApiService.reviewCorrection(item.id, "reject"))}>Rechazar</button></div> : <span className="badge warning">Esperando a RH</span>}</td></tr>)}
      </tbody></table>
      {!pendingCorrections.length ? <div className="empty">No hay correcciones pendientes para este período.</div> : null}
    </Section>
  </>;
}
