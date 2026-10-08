import { useEffect, useState } from "react";
import { employeeApiService, type EmployeeLaborChange } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import { getUserErrorMessage } from "../../services/api/apiClient";
import type { Employee, EmployeeFieldHistoryRecord, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { requiredLaborChangeError } from "../../utils/laborFieldValidation";
import { formatCalendarDate, formatDateTime } from "../../utils/date";
import { argentinaDateKey } from "../../utils/argentinaDateKey";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Field } from "../ui/FormControls";
import { LoadingState } from "../ui/LoadingState";
import { isAssignablePosition, usePositionOptions } from "./options/positionOptions";

// D-5 (ORG_LOCATION_REORGANIZATION.md §19): el cambio viaja con su fecha
// desde y motivo; el backend registra la vigencia, el historial visible y la
// auditoría en la misma transacción que el dato (antes el historial era una
// segunda llamada del cliente que podía quedar sin escribir).
async function persistTrackedEmployee(updated: Employee, onSaved: (employee: Employee) => void, laborChange: EmployeeLaborChange) {
  onSaved(await employeeApiService.update(updated, { laborChange }));
}

export function LaborChangeNote() {
  return <p className="muted small">Rige desde la fecha indicada. No modifica fechas anteriores ni recalcula horas ya cargadas.</p>;
}

// Etapa 14D.2: mismo cambio que `FieldWithHistory` (FieldHistoryControls.tsx)
// — antes este hook no dependía de `open`, se disparaba apenas
// MultiCompanyField/EmployeePositionField montaban (2 de los 8 GET
// /field-history en paralelo medidos en el journey de 14D.1). Ahora sólo
// carga la primera vez que el historial se abre; `loaded` evita repetir el
// fetch si se cierra y se vuelve a abrir (caché local, Parte 3 del pedido).
function useBackendFieldHistory(employeeId: string, field: string, open: boolean) {
  const [history, setHistory] = useState<EmployeeFieldHistoryRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    let mounted = true;
    setStatus("loading");
    employeeHistoryApiService
      .getFieldHistory(employeeId, { section: "DATOS_LABORALES", field })
      .then((rows) => {
        if (mounted) {
          setHistory(rows);
          setStatus("success");
          setLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [open, loaded, employeeId, field, retry]);

  // Tras guardar, el historial se vuelve a leer del backend (lo escribió él).
  const reload = () => {
    setLoaded(false);
    setRetry((value) => value + 1);
  };
  return { history, status, retry: () => setRetry((value) => value + 1), reload };
}

function useCompanyOptions() {
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    orgStructureApiService
      .getCatalog()
      .then((catalog) => {
        if (mounted) setOptions(catalog.companies.map((company) => company.name));
      })
      .catch(() => {
      });
    return () => {
      mounted = false;
    };
  }, []);

  return options;
}

type TrackedFieldProps = {
  employee: Employee;
  canEdit: boolean;
  user: User;
  onSaved: (employee: Employee) => void;
};

export function MultiCompanyField({ employee, canEdit, user, onSaved }: TrackedFieldProps) {
  const value = employee.companies?.length ? employee.companies : [employee.company].filter(Boolean);
  const companyOptions = useCompanyOptions();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(value);
  const [from, setFrom] = useState(argentinaDateKey(new Date()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { history, status: historyStatus, retry: retryHistory, reload: reloadHistory } = useBackendFieldHistory(employee.id, "companies", open);
  const label = value.join(", ") || "Sin cargar";

  const toggle = (company: string) =>
    setSelected((current) =>
      current.includes(company) ? current.filter((item) => item !== company) : [...current, company],
    );

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!selected.length) return setError("Seleccioná al menos una empresa.");
    const validationError = requiredLaborChangeError(from, reason);
    if (validationError) return setError(validationError);
    const updated = {
      ...employee,
      companies: selected,
      company: selected.includes(employee.company) ? employee.company : selected[0],
    };
    try {
      await persistTrackedEmployee(updated, onSaved, { effectiveFrom: from, reason });
      reloadHistory();
      setEditing(false);
      setOpen(true);
      setError("");
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar el cambio. Intentá nuevamente."));
      return;
    }
  });

  return (
    <div className="tracked-field">
      <div className="tracked-main" onClick={() => setOpen(!open)}>
        <small>Empresa empleadora</small>
        <b>{label}</b>
        <span>Relación laboral; distinta del alcance del puesto</span>
      </div>
      <div className="tracked-actions">
        <Button type="button" variant="subtle" onClick={() => setOpen(!open)}>
          Historial
        </Button>
        {canEdit ? (
          <Button
            type="button"
            variant="subtle"
            onClick={() => {
              setEditing(true);
              setOpen(true);
              setSelected(value);
            }}
          >
            Modificar
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="tracked-history">
          <h4>Historial de Empresa empleadora</h4>
          {historyStatus === "loading" ? (
            <LoadingState text="Cargando historial..." />
          ) : historyStatus === "error" ? (
            <ErrorState message="No pudimos cargar el historial." onRetry={retryHistory} size="compact" />
          ) : history.length ? (
            <div className="timeline">
              {history.map((item) => (
                <div key={item.id}>
                  <i />
                  <b>
                    {formatCalendarDate(item.effectiveFrom)} | {item.newValue}
                  </b>
                  <span>{item.createdByUserName}</span>
                  <p>
                    Anterior: {item.oldValue || "-"} · Motivo: {item.reason} · Registro:{" "}
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No hay historial registrado para este campo." size="compact" />
          )}
          {editing ? (
            <div className="tracked-edit">
              <div className="check-grid inline">
                {companyOptions.map((company) => (
                  <label className="check-card" key={company}>
                    <input
                      type="checkbox"
                      checked={selected.includes(company)}
                      onChange={() => toggle(company)}
                    />
                    {company}
                  </label>
                ))}
              </div>
              <Field label="Fecha desde" type="date" value={from} set={setFrom} />
              <Field label="Motivo del cambio" value={reason} set={setReason} />
              <LaborChangeNote />
              {error ? <p className="error">{error}</p> : null}
              <div className="form-actions">
                <Button type="button" variant="subtle" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="primary" onClick={save} disabled={isSaving}>
                  {isSaving ? "Guardando..." : "Guardar modificación"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EmployeePositionField({ employee, canEdit, user, onSaved }: TrackedFieldProps) {
  const positions = usePositionOptions();
  const current =
    positions.find((position) => position.id === employee.positionId) ||
    positions.find((position) => position.name === (employee.puestoNombre || employee.position));
  // A6: para una asignación nueva sólo se ofrecen puestos activos con alcance.
  const assignable = positions.filter(isAssignablePosition);
  const currentScopes = current?.orgScopes || [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(current?.id || "");
  const [from, setFrom] = useState(argentinaDateKey(new Date()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { history, status: historyStatus, retry: retryHistory, reload: reloadHistory } = useBackendFieldHistory(employee.id, "positionId", open);
  const selected = assignable.find((position) => position.id === selectedId);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const validationError = requiredLaborChangeError(from, reason);
    if (validationError) return setError(validationError);
    if (selectedId && !selected) return setError("Seleccioná un puesto activo con alcance organizacional.");
    const updated = selected
      ? {
          ...employee,
          positionId: selected.id,
          puestoId: selected.id,
          puestoNombre: selected.name,
          position: selected.name,
        }
      : { ...employee, positionId: "", puestoId: "", puestoNombre: "", position: "" };
    try {
      await persistTrackedEmployee(updated, onSaved, { effectiveFrom: from, reason });
      reloadHistory();
      setEditing(false);
      setOpen(true);
      setError("");
    } catch (error) {
      setError(getUserErrorMessage(error, "No pudimos guardar el cambio. Intentá nuevamente."));
      return;
    }
  });

  return (
    <div className="tracked-field position-field-card">
      <div className="tracked-main" onClick={() => setOpen(!open)}>
        <small>Puesto</small>
        <b>{current?.name || employee.puestoNombre || employee.position || "Sin cargar"}</b>
        <span>
          {current
            ? currentScopes.length
              ? `${currentScopes.length} ${currentScopes.length === 1 ? "alcance" : "alcances"}: ${currentScopes.map((scope) => scope.name).join(", ")}`
              : "Pendiente de recarga: sin alcance organizacional"
            : employee.puestoNombre || employee.position
              ? "Texto anterior sin vínculo"
              : "Sin puesto asignado"}
        </span>
      </div>
      <div className="tracked-actions">
        <Button type="button" variant="subtle" onClick={() => setOpen(!open)}>
          Historial
        </Button>
        {canEdit ? (
          <Button
            type="button"
            variant="subtle"
            onClick={() => {
              setEditing(true);
              setOpen(true);
              setSelectedId(current && isAssignablePosition(current) ? current.id : "");
            }}
          >
            Modificar
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="tracked-history">
          <h4>Historial de Puesto</h4>
          {historyStatus === "loading" ? (
            <LoadingState text="Cargando historial..." />
          ) : historyStatus === "error" ? (
            <ErrorState message="No pudimos cargar el historial." onRetry={retryHistory} size="compact" />
          ) : history.length ? (
            <div className="timeline">
              {history.map((item) => (
                <div key={item.id}>
                  <i />
                  <b>
                    {formatCalendarDate(item.effectiveFrom)} | {item.newValue}
                  </b>
                  <span>{item.createdByUserName}</span>
                  <p>Anterior: {item.oldValue || "-"} · Motivo: {item.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No hay historial registrado para este campo." size="compact" />
          )}
          {editing ? (
            <div className="tracked-edit">
              <label>
                Puesto con alcance organizacional
                <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">Sin puesto</option>
                  {assignable.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </select>
              </label>
              {current && !isAssignablePosition(current) ? (
                <p className="muted small">
                  El puesto actual “{current.name}” está {current.status === "ACTIVO" ? "pendiente de recarga" : "inactivo"} y no se ofrece para nuevas asignaciones. Cancelá para conservarlo.
                </p>
              ) : null}
              <Field label="Fecha desde" type="date" value={from} set={setFrom} />
              <Field label="Motivo del cambio" value={reason} set={setReason} />
              <LaborChangeNote />
              {error ? <p className="error">{error}</p> : null}
              <div className="form-actions">
                <Button type="button" variant="subtle" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button type="button" variant="primary" onClick={save} disabled={isSaving}>
                  {isSaving ? "Guardando..." : "Guardar puesto"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
