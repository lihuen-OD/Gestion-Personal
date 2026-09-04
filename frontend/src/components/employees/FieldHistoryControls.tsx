import { useEffect, useState } from "react";
import { employeeApiService } from "../../services/api/employeeApiService";
import { employeeHistoryApiService } from "../../services/api/employeeHistoryApiService";
import { getUserErrorMessage } from "../../services/api/apiClient";
import type { Employee, EmployeeBlockHistoryRecord, EmployeeFieldHistoryRecord, FieldHistorySection, User } from "../../types";
import { useAsyncAction } from "../../utils/useAsyncAction";
import { requiredLaborChangeError } from "../../utils/laborFieldValidation";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";
import { Field, Select } from "../ui/FormControls";
import { LoadingState } from "../ui/LoadingState";

type FieldWithHistoryProps = {
  employee: Employee;
  section: FieldHistorySection;
  field: string;
  label: string;
  value: string;
  effectiveFrom?: string;
  canEdit: boolean;
  user: User;
  options?: string[];
  onSaved: (employee: Employee) => void;
};

function setValueByPath(employee: Employee, path: string, value: string): Employee {
  if (!path.includes(".")) return { ...employee, [path]: value } as Employee;
  const [root, key] = path.split(".");
  return {
    ...employee,
    [root]: {
      ...(employee as unknown as Record<string, Record<string, unknown>>)[root],
      [key]: value,
    },
  } as Employee;
}

export function FieldWithHistory({
  employee,
  section,
  field,
  label,
  value,
  effectiveFrom,
  canEdit,
  user,
  options,
  onSaved,
}: FieldWithHistoryProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(value);
  const [from, setFrom] = useState(effectiveFrom || new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<EmployeeFieldHistoryRecord[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "success" | "error">("loading");
  const [historyRetry, setHistoryRetry] = useState(0);
  // Etapa 14D.2: antes, este efecto no dependía de `open` — se disparaba
  // apenas el campo montaba, sin que el usuario pidiera ver el historial
  // (8 GET /field-history en paralelo al entrar a Datos Laborales, 16 con
  // React StrictMode en dev — medido en el journey de 14D.1). Ahora sólo
  // carga la PRIMERA vez que se abre (`historyLoaded` evita repetir el
  // fetch si se cierra y se vuelve a abrir — "caché local" pedida en la
  // Parte 3); un reintento tras error sí puede volver a disparar la carga.
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!open || historyLoaded) return;
    let mounted = true;
    setHistoryStatus("loading");
    employeeHistoryApiService
      .getFieldHistory(employee.id, { section, field })
      .then((rows) => {
        if (mounted) {
          setHistory(rows);
          setHistoryStatus("success");
          setHistoryLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) setHistoryStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [open, historyLoaded, employee.id, section, field, historyRetry]);

  const currentFrom =
    history[0]?.effectiveFrom ||
    effectiveFrom ||
    employee.startDate ||
    "Sin cargar";

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const validationError = requiredLaborChangeError(from, reason);
    if (validationError) return setError(validationError);
    const updated = setValueByPath(employee, field, next);
    const record = {
      employeeId: employee.id,
      section,
      field,
      fieldLabel: label,
      oldValue: value || null,
      newValue: next,
      effectiveFrom: from,
      reason,
    };
    const saved = await employeeApiService
      .update(updated)
      .then(async (employeeFromApi) => {
        const historyRow = await employeeHistoryApiService.createFieldHistory(record);
        setHistory((rows) => [historyRow, ...rows.filter((row) => row.id !== historyRow.id)]);
        setHistoryStatus("success");
        return employeeFromApi;
      })
      .catch((error) => {
        setError(getUserErrorMessage(error, "No pudimos guardar el cambio. Intentá nuevamente."));
        return;
      });
    if (!saved) return;
    onSaved(saved);
    setEditing(false);
    setOpen(true);
    setError("");
  });

  return (
    <div className="tracked-field">
      <div className="tracked-main" onClick={() => setOpen(!open)}>
        <small>{label}</small>
        <b>{value || "Sin cargar"}</b>
        <span>Desde: {currentFrom}</span>
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
              setNext(value);
            }}
          >
            Modificar
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="tracked-history">
          <h4>Historial de {label}</h4>
          {historyStatus === "loading" ? (
            <LoadingState text="Cargando historial..." />
          ) : historyStatus === "error" ? (
            <ErrorState message="No pudimos cargar el historial." onRetry={() => setHistoryRetry((value) => value + 1)} size="compact" />
          ) : history.length ? (
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
            <EmptyState text="No hay historial registrado para este campo." size="compact" />
          )}
          {editing ? (
            <div className="tracked-edit">
              {options ? (
                <Select label="Nuevo valor" value={next} set={setNext} options={options} />
              ) : (
                <Field label="Nuevo valor" value={next} set={setNext} />
              )}
              <Field label="Fecha desde" type="date" value={from} set={setFrom} />
              <Field label="Motivo del cambio" value={reason} set={setReason} />
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

type BlockHistoryTimelineProps = {
  employeeId: string;
  section: FieldHistorySection;
  block: string;
  empty: string;
  refreshKey?: number;
};

export function BlockHistoryTimeline({
  employeeId,
  section,
  block,
  empty,
  refreshKey = 0,
}: BlockHistoryTimelineProps) {
  const [rows, setRows] = useState<EmployeeBlockHistoryRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");
    employeeHistoryApiService
      .getBlockHistory(employeeId, { section, block })
      .then((items) => {
        if (mounted) {
          setRows(items);
          setStatus("success");
        }
      })
      .catch(() => {
        if (mounted) setStatus("error");
      });
    return () => {
      mounted = false;
    };
  }, [employeeId, section, block, refreshKey, retry]);

  return status === "loading" ? (
    <LoadingState text="Cargando historial..." />
  ) : status === "error" ? (
    <ErrorState message="No pudimos cargar el historial." onRetry={() => setRetry((value) => value + 1)} size="compact" />
  ) : rows.length ? (
    <div className="timeline">
      {rows.map((row) => (
        <div key={row.id}>
          <i />
          <b>
            {row.effectiveFrom} · {row.blockLabel}
          </b>
          <span>{row.createdByUserName}</span>
          <p>
            Anterior: {row.oldValue || "-"} · Nuevo: {row.newValue} · Motivo: {row.reason} ·
            Registro: {new Date(row.createdAt).toLocaleString("es-AR")}
          </p>
        </div>
      ))}
    </div>
  ) : (
    <EmptyState text={empty} size="compact" />
  );
}
