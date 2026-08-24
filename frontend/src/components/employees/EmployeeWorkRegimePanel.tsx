import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Field } from "../ui/FormControls";
import { LoadingState } from "../ui/LoadingState";
import { Modal } from "../ui/Modal";
import { TableShell } from "../ui/TableShell";
import { confirmAction } from "../../services/appDialog";
import { getUserErrorMessage } from "../../services/api/apiClient";
import { workRegimeApiService } from "../../services/api/workRegimeApiService";
import type { EmployeeWorkRegimeAssignment, WorkRegime } from "../../types/workRegime.types";
import type { Employee, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { formatCalendarDate } from "../../utils/date";
import { requiredLaborChangeError } from "../../utils/laborFieldValidation";
import { openShiftOverflowActionLabel, workRegimeKindLabel } from "../work-regimes/workRegimeLabels";

type EmployeeWorkRegimePanelProps = {
  employee: Employee;
  user: User;
  canEdit: boolean;
  onSaved: (employee: Employee) => void;
};

type AssignmentDraft = {
  workRegimeId: string;
  effectiveFrom: string;
  effectiveTo: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function formatDate(value: string) {
  return formatCalendarDate(dateKey(value));
}

export function assignmentRowStatus(assignment: EmployeeWorkRegimeAssignment, currentId: string | null, today: string): "vigente" | "futuro" | "histórico" {
  if (assignment.id === currentId) return "vigente";
  if (dateKey(assignment.effectiveFrom) > today) return "futuro";
  return "histórico";
}

function statusTone(status: "vigente" | "futuro" | "histórico"): "success" | "warning" | "neutral" {
  if (status === "vigente") return "success";
  if (status === "futuro") return "warning";
  return "neutral";
}

function emptyDraft(): AssignmentDraft {
  return { workRegimeId: "", effectiveFrom: todayKey(), effectiveTo: "" };
}

export function EmployeeWorkRegimePanel({ employee, canEdit }: EmployeeWorkRegimePanelProps) {
  const [history, setHistory] = useState<EmployeeWorkRegimeAssignment[]>([]);
  const [current, setCurrent] = useState<EmployeeWorkRegimeAssignment | null>(null);
  const [catalog, setCatalog] = useState<WorkRegime[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");

  const [open, setOpen] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssignmentDraft>(emptyDraft());
  const [error, setError] = useState("");

  const [closingAssignment, setClosingAssignment] = useState<EmployeeWorkRegimeAssignment | null>(null);
  const [closeDate, setCloseDate] = useState(todayKey());
  const [closeError, setCloseError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoadStatus("loading");
    Promise.all([
      workRegimeApiService.getAssignmentHistory(employee.id),
      workRegimeApiService.getCurrentAssignment(employee.id),
      workRegimeApiService.getAll(),
    ])
      .then(([historyItems, currentItem, catalogResult]) => {
        if (!mounted) return;
        setHistory(historyItems);
        setCurrent(currentItem);
        setCatalog(catalogResult.items);
        setLoadStatus("success");
      })
      .catch(() => {
        if (mounted) setLoadStatus("error");
      });
    return () => { mounted = false; };
  }, [employee.id, refresh]);

  const reload = () => setRefresh((value) => value + 1);

  const close = () => {
    setOpen(false);
    setEditingAssignmentId(null);
    setDraft(emptyDraft());
    setError("");
  };

  const openAssign = () => {
    setEditingAssignmentId(null);
    setDraft(emptyDraft());
    setError("");
    setOpen(true);
  };

  const openEditAssignment = (assignment: EmployeeWorkRegimeAssignment) => {
    setEditingAssignmentId(assignment.id);
    setDraft({
      workRegimeId: assignment.workRegimeId,
      effectiveFrom: dateKey(assignment.effectiveFrom),
      effectiveTo: assignment.effectiveTo ? dateKey(assignment.effectiveTo) : "",
    });
    setError("");
    setOpen(true);
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!draft.workRegimeId) return setError("Seleccioná un régimen laboral.");
    const fromError = requiredLaborChangeError(draft.effectiveFrom);
    if (fromError) return setError(fromError);
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) return setError("La fecha hasta no puede ser anterior a la fecha desde.");

    const payload = {
      workRegimeId: draft.workRegimeId,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo || null,
    };
    try {
      if (editingAssignmentId) await workRegimeApiService.updateAssignment(employee.id, editingAssignmentId, payload);
      else await workRegimeApiService.assign(employee.id, payload);
      reload();
      close();
      setNotice("Régimen laboral asignado correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (saveError) {
      setError(getUserErrorMessage(saveError, "No pudimos asignar el régimen laboral. Intentá nuevamente."));
    }
  });

  const openClose = (assignment: EmployeeWorkRegimeAssignment) => {
    setClosingAssignment(assignment);
    setCloseDate(todayKey());
    setCloseError("");
  };

  const { isRunning: isClosing, run: confirmClose } = useAsyncAction(async () => {
    if (!closingAssignment) return;
    if (closeDate < dateKey(closingAssignment.effectiveFrom)) {
      setCloseError("La fecha hasta no puede ser anterior a la fecha desde.");
      return;
    }
    const confirmed = await confirmAction(
      `¿Querés cerrar la vigencia de "${closingAssignment.workRegime.name}" al ${formatDate(closeDate)}?`,
      { title: "Cerrar vigencia", confirmLabel: "Cerrar vigencia", tone: "danger" },
    );
    if (!confirmed) return;
    try {
      await workRegimeApiService.closeAssignment(employee.id, closingAssignment.id, closeDate);
      setClosingAssignment(null);
      reload();
      setNotice("Vigencia cerrada correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (closeErr) {
      setCloseError(getUserErrorMessage(closeErr, "No pudimos cerrar la vigencia. Intentá nuevamente."));
    }
  });

  if (loadStatus === "loading") return <LoadingState text="Cargando régimen laboral..." />;
  if (loadStatus === "error") return <ErrorState message="No pudimos cargar el régimen laboral del empleado." onRetry={reload} />;

  const today = todayKey();
  const sortedHistory = [...history].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  return (
    <>
      {notice ? <div className="toast">{notice}</div> : null}

      <div className="info-note">
        <b>¿Qué es un régimen laboral?</b>
        <p>El régimen laboral define cómo se comporta el sistema frente al empleado (alertas de turno, qué hacer ante una jornada abierta excedida). No es el horario del turno.</p>
      </div>

      <div className="block-card">
        <div className="block-card-head">
          <div>
            <h3>Régimen vigente</h3>
            {current ? (
              <p>
                {current.workRegime.name} · {workRegimeKindLabel(current.workRegime.kind)} · Desde {formatDate(current.effectiveFrom)}
                {current.effectiveTo ? ` hasta ${formatDate(current.effectiveTo)}` : ""}
              </p>
            ) : (
              <p>El empleado no tiene un régimen laboral vigente para la fecha de hoy.</p>
            )}
            {current ? (
              <small>
                Alerta fuera de turno: {current.workRegime.alertOnOutOfShift ? "Sí" : "No"} · Jornada excedida: {openShiftOverflowActionLabel(current.workRegime.openShiftOverflowAction)}
              </small>
            ) : null}
          </div>
          {canEdit ? (
            <div className="tracked-actions">
              <Button variant="primary" onClick={openAssign}><Plus size={15} /> Asignar régimen</Button>
            </div>
          ) : null}
        </div>
      </div>

      <h4>Historial de regímenes</h4>
      {!sortedHistory.length ? (
        <EmptyState text="Todavía no se asignó ningún régimen laboral a este empleado." />
      ) : (
        <TableShell minWidth={860}>
          <table>
            <thead>
              <tr>
                <th>Régimen</th>
                <th>Tipo</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Estado</th>
                {canEdit ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedHistory.map((assignment) => {
                const rowStatus = assignmentRowStatus(assignment, current?.id ?? null, today);
                return (
                  <tr key={assignment.id}>
                    <td><b>{assignment.workRegime.name}</b></td>
                    <td>{workRegimeKindLabel(assignment.workRegime.kind)}</td>
                    <td>{formatDate(assignment.effectiveFrom)}</td>
                    <td>{assignment.effectiveTo ? formatDate(assignment.effectiveTo) : <em>Sin definir</em>}</td>
                    <td><Badge tone={statusTone(rowStatus)}>{rowStatus === "vigente" ? "Vigente" : rowStatus === "futuro" ? "Futuro" : "Histórico"}</Badge></td>
                    {canEdit ? (
                      <td>
                        <div className="table-actions">
                          <button className="table-icon-action" title="Editar asignación" aria-label="Editar asignación" onClick={() => openEditAssignment(assignment)}>
                            <Pencil size={14} /><span>Editar</span>
                          </button>
                          {!assignment.effectiveTo ? (
                            <button className="table-icon-action danger-link" title="Cerrar vigencia" aria-label="Cerrar vigencia" onClick={() => openClose(assignment)}>
                              <X size={14} /><span>Cerrar vigencia</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}

      {open && (
        <Modal title={editingAssignmentId ? "Editar asignación de régimen" : "Asignar régimen laboral"} close={close}>
          <div className="form-stack">
            <label>
              Régimen laboral *
              <select value={draft.workRegimeId} onChange={(event) => setDraft({ ...draft, workRegimeId: event.target.value })}>
                <option value="">Seleccionar régimen...</option>
                {catalog.map((regime) => (
                  <option key={regime.id} value={regime.id}>
                    {regime.code} · {regime.name}{regime.status === "INACTIVO" ? " (inactivo)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Vigencia desde *" type="date" value={draft.effectiveFrom} set={(effectiveFrom) => setDraft({ ...draft, effectiveFrom })} />
            <Field label="Vigencia hasta (opcional)" type="date" value={draft.effectiveTo} set={(effectiveTo) => setDraft({ ...draft, effectiveTo })} />
            {error && <p className="error">{error}</p>}
            <div className="form-actions">
              <Button variant="subtle" onClick={close}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : editingAssignmentId ? "Guardar cambios" : "Guardar asignación"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {closingAssignment && (
        <Modal title="Cerrar vigencia" close={() => setClosingAssignment(null)}>
          <div className="form-stack">
            <p>Régimen: <b>{closingAssignment.workRegime.name}</b> · Desde {formatDate(closingAssignment.effectiveFrom)}</p>
            <Field label="Vigencia hasta *" type="date" value={closeDate} set={setCloseDate} />
            {closeError && <p className="error">{closeError}</p>}
            <div className="form-actions">
              <Button variant="subtle" onClick={() => setClosingAssignment(null)}>Cancelar</Button>
              <Button variant="danger" onClick={confirmClose} disabled={isClosing}>{isClosing ? "Cerrando..." : "Cerrar vigencia"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
