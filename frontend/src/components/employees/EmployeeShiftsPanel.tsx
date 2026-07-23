import { Plus, Power, X } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmAction } from "../../services/appDialog";
import { shiftAssignmentApiService, type ShiftAssignment } from "../../services/api/shiftAssignmentApiService";
import { workforceApiService, type ShiftTemplate } from "../../services/api/workforceApiService";
import type { Employee, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { LoadingState } from "../ui/LoadingState";
import { TableShell } from "../ui/TableShell";

function ShiftAssignmentTable({ rows, onToggle, onRemove }: { rows: ShiftAssignment[]; onToggle: (assignment: ShiftAssignment) => void; onRemove: (assignment: ShiftAssignment) => void }) {
  return (
    <TableShell minWidth={780}>
      <table>
        <thead>
          <tr>
            <th>Turno</th>
            <th>Categoría</th>
            <th>Horario</th>
            <th>Fecha</th>
            <th>Observación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((assignment) => (
            <tr key={assignment.id}>
              <td><b>{assignment.shiftTemplate.code}</b> · {assignment.shiftTemplate.name}</td>
              <td>{assignment.shiftTemplate.categoryName || <em>Sin categoría</em>}</td>
              <td>{assignment.shiftTemplate.startTime}–{assignment.shiftTemplate.endTime}</td>
              <td>{new Date(assignment.status === "HABILITADO" ? assignment.assignedAt : assignment.disabledAt || assignment.assignedAt).toLocaleDateString("es-AR")}</td>
              <td>{assignment.observation || <em>Sin observación</em>}</td>
              <td>
                <div className="table-actions">
                  <button type="button" className="table-icon-action" title={assignment.status === "HABILITADO" ? "Deshabilitar" : "Habilitar"} aria-label={assignment.status === "HABILITADO" ? "Deshabilitar" : "Habilitar"} onClick={() => onToggle(assignment)}>
                    <Power size={14} /><span>{assignment.status === "HABILITADO" ? "Deshabilitar" : "Habilitar"}</span>
                  </button>
                  <button type="button" className="table-icon-action danger-link" title="Quitar" aria-label="Quitar" onClick={() => onRemove(assignment)}>
                    <X size={14} /><span>Quitar</span>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

export function EmployeeShiftsPanel({ employee }: { employee: Employee; user: User }) {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [observation, setObservation] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoadStatus("loading");
    Promise.all([shiftAssignmentApiService.getAll({ employeeId: employee.id }), workforceApiService.shiftTemplates()])
      .then(([assignmentItems, templateItems]) => {
        if (!mounted) return;
        setAssignments(assignmentItems);
        setTemplates(templateItems);
        setLoadStatus("success");
      })
      .catch(() => {
        if (mounted) setLoadStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [employee.id, refresh]);

  const { isRunning: isAssigning, run: assign } = useAsyncAction(async () => {
    if (!selectedTemplateId) return;
    try {
      await shiftAssignmentApiService.assign({ employeeIds: [employee.id], shiftTemplateId: selectedTemplateId, observation: observation.trim() || null });
      setSelectedTemplateId("");
      setObservation("");
      setNotice("Turno asignado correctamente.");
      setRefresh((value) => value + 1);
      setTimeout(() => setNotice(""), 2200);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos asignar el turno.");
    }
  });

  const toggle = async (assignment: ShiftAssignment) => {
    const activating = assignment.status === "DESHABILITADO";
    if (!(await confirmAction(`¿Querés ${activating ? "habilitar" : "deshabilitar"} el turno "${assignment.shiftTemplate.name}" para este empleado?`, { title: `${activating ? "Habilitar" : "Deshabilitar"} turno`, confirmLabel: activating ? "Habilitar" : "Deshabilitar", tone: activating ? "primary" : "danger" }))) return;
    try {
      await shiftAssignmentApiService.update(assignment.id, { status: activating ? "HABILITADO" : "DESHABILITADO" });
      setRefresh((value) => value + 1);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos cambiar el estado del turno.");
    }
  };

  const remove = async (assignment: ShiftAssignment) => {
    if (!(await confirmAction(`¿Querés quitar la asociación con el turno "${assignment.shiftTemplate.name}"?`, { title: "Quitar turno", confirmLabel: "Quitar", tone: "danger" }))) return;
    try {
      await shiftAssignmentApiService.remove(assignment.id);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "No pudimos quitar la asociación.");
    }
  };

  if (loadStatus === "loading") return <LoadingState text="Cargando turnos asociados..." />;
  if (loadStatus === "error") return <ErrorState message="No pudimos cargar los turnos asociados." onRetry={() => setRefresh((value) => value + 1)} />;

  const enabled = assignments.filter((assignment) => assignment.status === "HABILITADO");
  const disabled = assignments.filter((assignment) => assignment.status === "DESHABILITADO");
  const assignedTemplateIds = new Set(assignments.map((assignment) => assignment.shiftTemplateId));
  const availableTemplates = templates.filter((template) => template.status === "ACTIVO" && !assignedTemplateIds.has(template.id));

  return (
    <>
      {notice ? <div className="toast">{notice}</div> : null}
      <div className="form-grid">
        <label className="field">
          <span>Agregar turno</span>
          <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
            <option value="">Seleccionar turno...</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.code} · {template.name}{template.categoryName ? ` (${template.categoryName})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field"><span>Observación (opcional)</span><input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Ej: rota semana por medio con turno tarde" /></label>
      </div>
      <div className="form-actions">
        <button className="button primary" disabled={isAssigning || !selectedTemplateId} onClick={assign}>
          <Plus size={15} /> Agregar turno
        </button>
      </div>

      {!assignments.length ? (
        <EmptyState text="El empleado no tiene turnos asociados. Sus fichadas se evaluarán por horas trabajadas, duración máxima y observaciones, sin control de llegada tarde o salida anticipada." />
      ) : (
        <>
          <h4>Turnos habilitados ({enabled.length})</h4>
          {enabled.length ? <ShiftAssignmentTable rows={enabled} onToggle={toggle} onRemove={remove} /> : <div className="empty">Ningún turno habilitado.</div>}
          <h4>Turnos deshabilitados ({disabled.length})</h4>
          {disabled.length ? <ShiftAssignmentTable rows={disabled} onToggle={toggle} onRemove={remove} /> : <div className="empty">Ningún turno deshabilitado.</div>}
        </>
      )}
    </>
  );
}
