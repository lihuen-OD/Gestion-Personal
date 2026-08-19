import { Power, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EmployeeRemoteSelector } from "../employees/EmployeeRemoteSelector";
import { LoadingState } from "../ui/LoadingState";
import { ErrorState } from "../ui/ErrorState";
import { TableShell } from "../ui/TableShell";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { confirmAction } from "../../services/appDialog";
import { shiftAssignmentApiService, type ShiftAssignment } from "../../services/api/shiftAssignmentApiService";
import type { Employee } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { assignmentVigencyLabel, assignmentVigencyStatus, assignmentVigencyTone, buildShiftAssignmentVigencyPayload, formatAssignmentDate, formatWeekdays } from "../../utils/shiftAssignment";
import { ShiftAssignmentVigencyFields } from "../shared/ShiftAssignmentVigencyFields";

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

export function ShiftEmployeesPanel({ shiftTemplateId, canEdit }: { shiftTemplateId: string; canEdit: boolean }) {
  const [assignments, setAssignments] = useState<ShiftAssignment[] | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadRetry, setLoadRetry] = useState(0);
  const [selected, setSelected] = useState<Employee[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayDateInput());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [observation, setObservation] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    setLoadStatus("loading");
    shiftAssignmentApiService
      .getAll({ shiftTemplateId })
      .then((items) => {
        if (!alive) return;
        setAssignments(items);
        setLoadStatus("success");
      })
      .catch(() => {
        if (alive) setLoadStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [shiftTemplateId, loadRetry]);

  const { isRunning: isAssigning, run: assignSelected } = useAsyncAction(async () => {
    if (!selected.length || !effectiveFrom) return;
    try {
      await shiftAssignmentApiService.assign({
        employeeIds: selected.map((employee) => employee.id),
        shiftTemplateId,
        observation: observation.trim() || null,
        ...buildShiftAssignmentVigencyPayload({ effectiveFrom, effectiveTo, weekdays }),
      });
      setSelected([]);
      setEffectiveFrom(todayDateInput());
      setEffectiveTo("");
      setWeekdays([]);
      setObservation("");
      setNotice("Empleados asignados correctamente.");
      setLoadRetry((value) => value + 1);
      setTimeout(() => setNotice(""), 2200);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos asignar el turno.");
    }
  });

  const toggle = async (assignment: ShiftAssignment) => {
    const activating = assignment.status === "DESHABILITADO";
    const name = `${assignment.employee.lastName}, ${assignment.employee.firstName}`;
    if (!(await confirmAction(`¿Querés ${activating ? "habilitar" : "deshabilitar"} el turno para ${name}?`, { title: `${activating ? "Habilitar" : "Deshabilitar"} turno`, confirmLabel: activating ? "Habilitar" : "Deshabilitar", tone: activating ? "primary" : "danger" }))) return;
    try {
      await shiftAssignmentApiService.update(assignment.id, { status: activating ? "HABILITADO" : "DESHABILITADO" });
      setLoadRetry((value) => value + 1);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos cambiar el estado de la asignación.");
    }
  };

  const remove = async (assignment: ShiftAssignment) => {
    const name = `${assignment.employee.lastName}, ${assignment.employee.firstName}`;
    if (!(await confirmAction(`¿Querés quitar la asociación del turno con ${name}?`, { title: "Quitar asociación", confirmLabel: "Quitar", tone: "danger" }))) return;
    try {
      await shiftAssignmentApiService.remove(assignment.id);
      setLoadRetry((value) => value + 1);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos quitar la asociación.");
    }
  };

  if (loadStatus === "loading") return <LoadingState text="Cargando empleados asociados..." />;
  if (loadStatus === "error") return <ErrorState message="No pudimos cargar los empleados asociados a este turno." onRetry={() => setLoadRetry((value) => value + 1)} />;

  const enabled = (assignments || []).filter((item) => item.status === "HABILITADO");
  const disabled = (assignments || []).filter((item) => item.status === "DESHABILITADO");
  // Excluye solo a quienes ya tienen el turno HABILITADO: seleccionarlos de
  // nuevo hoy es un no-op silencioso en el backend (shiftAssignment.service.ts).
  // Un empleado con la asignación DESHABILITADO sigue apareciendo a propósito:
  // volver a elegirlo la rehabilita (mismo backend, rama reEnable) con la
  // vigencia/días nuevos del formulario.
  const enabledEmployeeIds = new Set(enabled.map((item) => item.employee.id));

  return (
    <div className="shift-employees-panel">
      {notice ? <div className="toast">{notice}</div> : null}
      {canEdit ? (
        <div className="rule-people-field">
          <span>Asignar empleados a este turno</span>
          <EmployeeRemoteSelector selected={selected} multiple showStatusFilter wide={false} excludeIds={enabledEmployeeIds} onChange={setSelected} />
          <div className="form-grid">
            <ShiftAssignmentVigencyFields
              effectiveFrom={effectiveFrom}
              effectiveTo={effectiveTo}
              weekdays={weekdays}
              onEffectiveFromChange={setEffectiveFrom}
              onEffectiveToChange={setEffectiveTo}
              onWeekdaysChange={setWeekdays}
            />
          </div>
          <label className="field"><span>Observación (opcional)</span><input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Ej: rota semana por medio con turno tarde" /></label>
          <div className="rule-form-actions">
            <Button variant="primary" disabled={isAssigning || !selected.length || !effectiveFrom} onClick={assignSelected}>{isAssigning ? "Asignando..." : "Asignar seleccionados"}</Button>
          </div>
        </div>
      ) : null}

      <h4>Empleados habilitados ({enabled.length})</h4>
      {enabled.length ? (
        <TableShell minWidth={920}>
          <table>
            <thead><tr><th>Legajo</th><th>Empleado</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Vigencia</th><th>Observación</th><th>Acciones</th></tr></thead>
            <tbody>
              {enabled.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.employee.legajo}</td>
                  <td>{assignment.employee.lastName}, {assignment.employee.firstName}</td>
                  <td>{formatAssignmentDate(assignment.effectiveFrom)}</td>
                  <td>{formatAssignmentDate(assignment.effectiveTo)}</td>
                  <td>{formatWeekdays(assignment.weekdays)}</td>
                  <td><Badge tone={assignmentVigencyTone(assignmentVigencyStatus(assignment.effectiveFrom, assignment.effectiveTo))}>{assignmentVigencyLabel(assignmentVigencyStatus(assignment.effectiveFrom, assignment.effectiveTo))}</Badge></td>
                  <td>{assignment.observation || <em>Sin observación</em>}</td>
                  <td>
                    {canEdit ? (
                      <div className="table-actions">
                        <button type="button" className="table-icon-action" title="Deshabilitar" aria-label="Deshabilitar" onClick={() => void toggle(assignment)}><Power size={14} /><span>Deshabilitar</span></button>
                        <button type="button" className="table-icon-action danger-link" title="Quitar" aria-label="Quitar" onClick={() => void remove(assignment)}><X size={14} /><span>Quitar</span></button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      ) : <div className="empty">Ningún empleado tiene este turno habilitado.</div>}

      <h4>Empleados deshabilitados ({disabled.length})</h4>
      {disabled.length ? (
        <TableShell minWidth={920}>
          <table>
            <thead><tr><th>Legajo</th><th>Empleado</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Deshabilitado</th><th>Observación</th><th>Acciones</th></tr></thead>
            <tbody>
              {disabled.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.employee.legajo}</td>
                  <td>{assignment.employee.lastName}, {assignment.employee.firstName}</td>
                  <td>{formatAssignmentDate(assignment.effectiveFrom)}</td>
                  <td>{formatAssignmentDate(assignment.effectiveTo)}</td>
                  <td>{formatWeekdays(assignment.weekdays)}</td>
                  <td>{assignment.disabledAt ? new Date(assignment.disabledAt).toLocaleDateString("es-AR") : "-"}</td>
                  <td>{assignment.observation || <em>Sin observación</em>}</td>
                  <td>
                    {canEdit ? (
                      <div className="table-actions">
                        <button type="button" className="table-icon-action" title="Habilitar" aria-label="Habilitar" onClick={() => void toggle(assignment)}><Power size={14} /><span>Habilitar</span></button>
                        <button type="button" className="table-icon-action danger-link" title="Quitar" aria-label="Quitar" onClick={() => void remove(assignment)}><X size={14} /><span>Quitar</span></button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      ) : <div className="empty">No hay empleados deshabilitados para este turno.</div>}
    </div>
  );
}
