import { useEffect, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { orgStructureApiService } from "../../services/api/orgStructureApiService";
import { positionApiService } from "../../services/api/positionApiService";
import type { Employee, EmployeeFieldHistoryRecord, User } from "../../types";
import type { Position } from "../../types/position.types";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/FormControls";

async function persistTrackedEmployee(updated: Employee, onSaved: (employee: Employee) => void) {
  try {
    onSaved(await employeeApiService.update(updated));
  } catch (error) {
    throw error;
  }
}

type CreateFieldHistoryInput = { employeeId: string; section: string; field: string; fieldLabel: string; oldValue: string | null; newValue: string; effectiveFrom: string; reason: string; };

async function recordFieldHistory(
  record: CreateFieldHistoryInput,
) {
  try {
    return await employeeHistoryApiService.createFieldHistory(record);
  } catch (error) {
    throw error;
  }
}

function useBackendFieldHistory(employeeId: string, field: string) {
  const [history, setHistory] = useState<EmployeeFieldHistoryRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    employeeHistoryApiService
      .getFieldHistory(employeeId, { section: "DATOS_LABORALES", field })
      .then((rows) => {
        if (mounted) setHistory(rows);
      })
      .catch(() => {
      });
    return () => {
      mounted = false;
    };
  }, [employeeId, field]);

  return { history, setHistory };
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

function useActivePositions() {
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    let mounted = true;
    positionApiService
      .getAll()
      .then((items) => {
        if (mounted) setPositions(items.filter((position) => position.status === "ACTIVO"));
      })
      .catch(() => {
      });
    return () => {
      mounted = false;
    };
  }, []);

  return positions;
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
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { history, setHistory } = useBackendFieldHistory(employee.id, "companies");
  const label = value.join(", ") || "Sin cargar";

  const toggle = (company: string) =>
    setSelected((current) =>
      current.includes(company) ? current.filter((item) => item !== company) : [...current, company],
    );

  const save = async () => {
    if (!selected.length) return setError("Seleccioná al menos una empresa.");
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
    const updated = {
      ...employee,
      companies: selected,
      company: selected.includes(employee.company) ? employee.company : selected[0],
    };
    try {
      const historyRow = await recordFieldHistory(
        {
          employeeId: employee.id,
          section: "DATOS_LABORALES",
          field: "companies",
          fieldLabel: "Empresa",
          oldValue: label || null,
          newValue: selected.join(", "),
          effectiveFrom: from,
          reason,
        },
      );
      setHistory((rows) => [historyRow, ...rows.filter((row) => row.id !== historyRow.id)]);
      await persistTrackedEmployee(updated, onSaved);
      setEditing(false);
      setOpen(true);
      setError("");
    } catch {
      setError("No se pudo guardar. Verifica que el backend esté activo.");
      return;
    }
  };

  return (
    <div className="tracked-field">
      <div className="tracked-main" onClick={() => setOpen(!open)}>
        <small>Empresa</small>
        <b>{label}</b>
        <span>Puede pertenecer a una o varias empresas</span>
      </div>
      <div className="tracked-actions">
        <button type="button" className="button subtle" onClick={() => setOpen(!open)}>
          Historial
        </button>
        {canEdit ? (
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              setEditing(true);
              setOpen(true);
              setSelected(value);
            }}
          >
            Modificar
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="tracked-history">
          <h4>Historial de Empresa</h4>
          {history.length ? (
            <div className="timeline">
              {history.map((item) => (
                <div key={item.id}>
                  <i />
                  <b>
                    {item.effectiveFrom} | {item.newValue}
                  </b>
                  <span>{item.createdByUserName}</span>
                  <p>
                    Anterior: {item.oldValue || "-"} · Motivo: {item.reason} · Registro:{" "}
                    {new Date(item.createdAt).toLocaleString("es-AR")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No hay historial registrado para este campo." />
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
              {error ? <p className="error">{error}</p> : null}
              <div className="form-actions">
                <button type="button" className="button subtle" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={save}>
                  Guardar modificación
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EmployeePositionField({ employee, canEdit, user, onSaved }: TrackedFieldProps) {
  const positions = useActivePositions();
  const current =
    positions.find((position) => position.id === employee.positionId) ||
    positions.find((position) => position.name === (employee.puestoNombre || employee.position));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(current?.id || "");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { history, setHistory } = useBackendFieldHistory(employee.id, "positionId");
  const selected = positions.find((position) => position.id === selectedId);

  const save = async () => {
    if (!from) return setError("La fecha desde es obligatoria.");
    if (!reason.trim()) return setError("El motivo del cambio es obligatorio.");
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
      const historyRow = await recordFieldHistory(
        {
          employeeId: employee.id,
          section: "DATOS_LABORALES",
          field: "positionId",
          fieldLabel: "Puesto",
          oldValue: employee.puestoNombre || employee.position || null,
          newValue: selected?.name || "Sin puesto vinculado",
          effectiveFrom: from,
          reason,
        },
      );
      setHistory((rows) => [historyRow, ...rows.filter((row) => row.id !== historyRow.id)]);
      await persistTrackedEmployee(updated, onSaved);
      setEditing(false);
      setOpen(true);
      setError("");
    } catch {
      setError("No se pudo guardar. Verifica que el backend esté activo.");
      return;
    }
  };

  return (
    <div className="tracked-field position-field-card">
      <div className="tracked-main" onClick={() => setOpen(!open)}>
        <small>Puesto</small>
        <b>{current?.name || employee.puestoNombre || employee.position || "Sin cargar"}</b>
        <span>{current ? `${current.areaDepartment} · ${current.sector}` : "Texto anterior sin vinculo"}</span>
      </div>
      <div className="tracked-actions">
        <button type="button" className="button subtle" onClick={() => setOpen(!open)}>
          Historial
        </button>
        {canEdit ? (
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              setEditing(true);
              setOpen(true);
              setSelectedId(current?.id || "");
            }}
          >
            Modificar
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="tracked-history">
          <h4>Historial de Puesto</h4>
          {history.length ? (
            <div className="timeline">
              {history.map((item) => (
                <div key={item.id}>
                  <i />
                  <b>
                    {item.effectiveFrom} | {item.newValue}
                  </b>
                  <span>{item.createdByUserName}</span>
                  <p>Anterior: {item.oldValue || "-"} · Motivo: {item.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No hay historial registrado para este campo." />
          )}
          {editing ? (
            <div className="tracked-edit">
              <label>
                Puesto existente
                <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">Seleccionar</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Fecha desde" type="date" value={from} set={setFrom} />
              <Field label="Motivo del cambio" value={reason} set={setReason} />
              {error ? <p className="error">{error}</p> : null}
              <div className="form-actions">
                <button type="button" className="button subtle" onClick={() => setEditing(false)}>
                  Cancelar
                </button>
                <button type="button" className="button primary" onClick={save}>
                  Guardar puesto
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
