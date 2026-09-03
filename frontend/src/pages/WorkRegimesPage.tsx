import { CalendarOff, Pencil, Plus, Power, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  openShiftOverflowActionLabel,
  openShiftOverflowActionOptions,
  workRegimeKindLabel,
  workRegimeKindOptions,
  workRegimeStatusTone,
} from "../components/work-regimes/workRegimeLabels";
import { AssociatedEmployeesPanel } from "../components/shared/AssociatedEmployeesPanel";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { FilterPanel } from "../components/ui/FilterPanel";
import { Field } from "../components/ui/FormControls";
import { Modal } from "../components/ui/Modal";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { useAuth } from "../context/AuthContext";
import { confirmAction } from "../services/appDialog";
import { getUserErrorMessage } from "../services/api/apiClient";
import { extendedShiftAlertHoursToMinutes, extendedShiftAlertMinutesToHours, workRegimeApiService, type WorkRegimeInput } from "../services/api/workRegimeApiService";
import type { AssociatedEmployeeFilters, WorkRegimeEmployeesStatusFilter } from "../types/associatedEmployee.types";
import type { OpenShiftOverflowAction, WorkRegime, WorkRegimeFilters, WorkRegimeKind } from "../types/workRegime.types";
import { formatVigencyDate, vigencyLabel, vigencyTone } from "../components/shared/AssociatedEmployeesPanel.helpers";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

// Etapa 10D: el draft edita la alerta de jornada extendida en horas enteras
// (extendedShiftAlertHours) — la conversión a/desde minutos (lo que
// realmente guarda WorkRegime) ocurre sólo al cargar un registro existente y
// al guardar, vía los helpers de workRegimeApiService.ts.
type WorkRegimeDraft = Omit<WorkRegimeInput, "extendedShiftAlertMinutes"> & { extendedShiftAlertHours: number | "" };

function emptyDraft(): WorkRegimeDraft {
  return {
    code: "",
    name: "",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: true,
    openShiftOverflowAction: "ROLLOVER",
    extendedShiftAlertHours: "",
    description: "",
    status: "ACTIVO",
  };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const employeesVigencyFilterOptions: { value: WorkRegimeEmployeesStatusFilter; label: string }[] = [
  { value: "current", label: "Vigentes" },
  { value: "historical", label: "Históricos" },
  { value: "all", label: "Todos" },
];

// Etapa 13J.1: "no hay vigentes" y "no encontramos nada con esos filtros"
// son mensajes distintos (checklist UX, empty states) — hasActiveFilters
// viene del propio AssociatedEmployeesPanel (búsqueda/sector/centro de
// costo/empresa); el filtro de vigencia lo resuelve esta función porque
// vive en WorkRegimesPage.
export function associatedEmployeesEmptyText(vigencyFilter: WorkRegimeEmployeesStatusFilter, hasActiveFilters: boolean): string {
  if (hasActiveFilters) return "No encontramos empleados con esos filtros.";
  if (vigencyFilter === "current") return "No hay empleados vigentes con este régimen.";
  if (vigencyFilter === "historical") return "No hay empleados históricos con este régimen.";
  return "Este régimen todavía no tiene empleados asociados.";
}

export function matchesFilters(item: WorkRegime, filters: WorkRegimeFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description || ""}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

export function WorkRegimesPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<WorkRegimeFilters>({ search: "", kind: "", status: "" });
  const [apiItems, setApiItems] = useState<WorkRegime[] | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkRegimeDraft>(emptyDraft());
  const [error, setError] = useState("");
  const [viewingEmployeesFor, setViewingEmployeesFor] = useState<WorkRegime | null>(null);
  // Etapa 13J: por defecto sólo vigentes — evita repetir el bug reportado
  // (empleados con vigencia vencida apareciendo como "asociados" sin aviso).
  const [employeesVigencyFilter, setEmployeesVigencyFilter] = useState<WorkRegimeEmployeesStatusFilter>("current");
  const [assignEffectiveFrom, setAssignEffectiveFrom] = useState(todayKey());
  // Etapa 13J.1: controla el título/subtítulo del modal "Empleados
  // asociados" cuando el panel cambia a su vista interna de alta (evita
  // modal sobre modal — ver AssociatedEmployeesPanel addMode="inline").
  const [isAddingEmployees, setIsAddingEmployees] = useState(false);

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    setLoadFailed(false);
    workRegimeApiService.getAll()
      .then((result) => {
        if (!alive) return;
        setApiItems(result.items);
      })
      .catch(() => {
        if (!alive) return;
        setApiItems([]);
        setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  const all = apiItems ?? [];
  const items = all.filter((item) => matchesFilters(item, filters));
  const summary = useMemo(() => [
    ["Regímenes activos", all.filter((item) => item.status === "ACTIVO").length],
    ["Total configurados", all.length],
  ] as const, [all]);

  const reload = () => setRefresh((value) => value + 1);

  const close = () => {
    setOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError("");
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError("");
    setOpen(true);
  };

  const openEdit = (item: WorkRegime) => {
    setEditingId(item.id);
    setDraft({
      code: item.code,
      name: item.name,
      kind: item.kind,
      alertOnOutOfShift: item.alertOnOutOfShift,
      openShiftOverflowAction: item.openShiftOverflowAction,
      extendedShiftAlertHours: extendedShiftAlertMinutesToHours(item.extendedShiftAlertMinutes),
      description: item.description || "",
      status: item.status,
    });
    setError("");
    setOpen(true);
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code) return setError("El código es obligatorio.");
    if (!name) return setError("El nombre es obligatorio.");

    const { extendedShiftAlertHours, ...rest } = draft;
    const payload: WorkRegimeInput = { ...rest, code, name, extendedShiftAlertMinutes: extendedShiftAlertHoursToMinutes(extendedShiftAlertHours) };

    try {
      if (editingId) await workRegimeApiService.update(editingId, payload);
      else await workRegimeApiService.create(payload);
      reload();
      close();
      setNotice("Régimen laboral guardado correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (saveError) {
      setError(getUserErrorMessage(saveError, "No pudimos guardar el régimen laboral. Intentá nuevamente."));
    }
  });

  const toggleStatus = async (item: WorkRegime) => {
    const activating = item.status !== "ACTIVO";
    const confirmed = await confirmAction(
      activating
        ? `¿Querés activar el régimen "${item.name}"?`
        : `¿Querés inactivar el régimen "${item.name}"? Deja de estar disponible para nuevas asignaciones.`,
      {
        title: activating ? "Activar régimen laboral" : "Inactivar régimen laboral",
        confirmLabel: activating ? "Activar" : "Inactivar",
        tone: activating ? "primary" : "danger",
      },
    );
    if (!confirmed) return;
    try {
      await workRegimeApiService.updateStatus(item.id, activating ? "ACTIVO" : "INACTIVO");
      reload();
    } catch (statusError) {
      setNotice(getUserErrorMessage(statusError, "No pudimos cambiar el estado del régimen. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  };

  const editable = roleLevel(user!.role) === 1;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Regímenes laborales"
        description="Catálogo de regímenes de trabajo (Cosecha, Riego, Oficina flexible, etc.) y cómo se comporta el sistema frente a cada uno."
        action={editable ? <Button variant="primary" icon={Plus} onClick={openCreate}>Crear régimen</Button> : undefined}
      />

      {notice && <div className="toast">{notice}</div>}

      <div className="info-note">
        <b>¿Qué es un régimen laboral?</b>
        <p>El régimen laboral define cómo se comporta el sistema frente al empleado. No es el horario del turno.</p>
      </div>

      <div className="stat-grid novelty-type-summary">
        {summary.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} detail="Regímenes laborales" />
        ))}
      </div>

      <Section title="Listado de regímenes laborales" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados según filtros aplicados.`}>
        <FilterPanel search={{ value: filters.search, onChange: (value) => setFilters({ ...filters, search: value }), placeholder: "Buscar por código o nombre" }}>
          <label>
            Tipo
            <select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}>
              <option value="">Todos</option>
              {workRegimeKindOptions.map((kind) => <option key={kind} value={kind}>{workRegimeKindLabel(kind)}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Todos</option>
              <option value="ACTIVO">Activo</option>
              <option value="INACTIVO">Inactivo</option>
            </select>
          </label>
        </FilterPanel>
        <DataTable
          status={isLoadingApi ? "loading" : loadFailed ? "error" : items.length === 0 ? "empty" : "ready"}
          minWidth={1000}
          emptyText="No hay regímenes laborales con los filtros aplicados."
          errorMessage="No se pudo cargar el catálogo de regímenes laborales."
          onRetry={reload}
        >
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Tipo de régimen</th>
                <th>Alerta fuera de turno</th>
                <th>Acción jornada excedida</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.code}</b></td>
                  <td><OverflowCell value={item.name} />{item.description ? <span className="table-sub">{item.description}</span> : null}</td>
                  <td>{workRegimeKindLabel(item.kind)}</td>
                  <td><Badge tone={item.alertOnOutOfShift ? "warning" : "neutral"}>{item.alertOnOutOfShift ? "Sí" : "No"}</Badge></td>
                  <td>{openShiftOverflowActionLabel(item.openShiftOverflowAction)}</td>
                  <td><Badge tone={workRegimeStatusTone(item.status)}>{item.status === "ACTIVO" ? "Activo" : "Inactivo"}</Badge></td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="table-icon-action"
                        title="Ver empleados asociados"
                        aria-label="Ver empleados asociados"
                        onClick={() => {
                          setViewingEmployeesFor(item);
                          setEmployeesVigencyFilter("current");
                          setAssignEffectiveFrom(todayKey());
                          setIsAddingEmployees(false);
                        }}
                      >
                        <Users size={15} />
                      </button>
                      {editable ? (
                        <>
                          <button className="table-icon-action" title="Editar régimen" aria-label="Editar régimen" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                          <button className="table-icon-action" title={item.status === "ACTIVO" ? "Inactivar régimen" : "Activar régimen"} aria-label={item.status === "ACTIVO" ? "Inactivar régimen" : "Activar régimen"} onClick={() => toggleStatus(item)}><Power size={15} /></button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Section>

      {open && (
        <Modal title={editingId ? "Editar régimen laboral" : "Crear régimen laboral"} close={close}>
          <div className="form-stack">
            <Field label="Código *" value={draft.code} set={(code) => setDraft({ ...draft, code })} />
            <Field label="Nombre *" value={draft.name} set={(name) => setDraft({ ...draft, name })} />
            <label>
              Tipo de régimen
              <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as WorkRegimeKind })}>
                {workRegimeKindOptions.map((kind) => <option key={kind} value={kind}>{workRegimeKindLabel(kind)}</option>)}
              </select>
            </label>
            <label className="check-card">
              <input type="checkbox" checked={draft.alertOnOutOfShift} onChange={(event) => setDraft({ ...draft, alertOnOutOfShift: event.target.checked })} />
              Alertar si el empleado no tiene turno compatible
            </label>
            <label>
              Acción ante jornada abierta excedida
              <select value={draft.openShiftOverflowAction} onChange={(event) => setDraft({ ...draft, openShiftOverflowAction: event.target.value as OpenShiftOverflowAction })}>
                {openShiftOverflowActionOptions.map((action) => <option key={action} value={action}>{openShiftOverflowActionLabel(action)}</option>)}
              </select>
            </label>
            <label>
              Alerta de jornada extendida
              <input
                type="number"
                min={0}
                max={24}
                placeholder="Sin definir"
                value={draft.extendedShiftAlertHours}
                onChange={(event) => setDraft({ ...draft, extendedShiftAlertHours: event.target.value === "" ? "" : Number(event.target.value) })}
              />
            </label>
            <small className="muted">Cantidad máxima de horas trabajadas antes de generar una alerta informativa. No modifica las horas registradas.</small>
            <label>
              Descripción
              <textarea value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            <label>
              Estado
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as WorkRegime["status"] })}>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>

            {error && <p className="error">{error}</p>}

            <div className="form-actions">
              <Button variant="subtle" onClick={close}>Cancelar</Button>
              <Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : editingId ? "Guardar cambios" : "Guardar régimen"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {viewingEmployeesFor && (
        <Modal
          title={isAddingEmployees ? "Agregar empleados al régimen" : `Empleados con régimen ${viewingEmployeesFor.code} - ${viewingEmployeesFor.name}`}
          subtitle={
            isAddingEmployees
              ? "Seleccioná los empleados que tendrán este régimen desde la fecha indicada."
              : "Consultá empleados vigentes o históricos asociados a este régimen."
          }
          close={() => {
            setViewingEmployeesFor(null);
            setIsAddingEmployees(false);
          }}
        >
          <AssociatedEmployeesPanel
            key={`${viewingEmployeesFor.id}-${employeesVigencyFilter}`}
            emptyText={(hasActiveFilters) => associatedEmployeesEmptyText(employeesVigencyFilter, hasActiveFilters)}
            fetcher={(filters: AssociatedEmployeeFilters) => workRegimeApiService.getWorkRegimeEmployees(viewingEmployeesFor.id, { ...filters, status: employeesVigencyFilter })}
            renderFilterExtra={() => (
              <select
                aria-label="Filtrar por vigencia"
                value={employeesVigencyFilter}
                onChange={(event) => setEmployeesVigencyFilter(event.target.value as WorkRegimeEmployeesStatusFilter)}
              >
                {employeesVigencyFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
            showCuilColumn={false}
            showEmployeeStatusColumn={false}
            enableMobileCards
            extraColumns={[
              {
                header: "Vigencia",
                render: (item) => (
                  <div className="vigency-cell">
                    <Badge tone={vigencyTone(item.vigencyStatus)}>{vigencyLabel(item.vigencyStatus)}</Badge>
                    <span className="table-sub">Desde {formatVigencyDate(item.effectiveFrom)}</span>
                    <span className="table-sub">Hasta {formatVigencyDate(item.effectiveTo)}</span>
                  </div>
                ),
              },
            ]}
            canEdit={editable}
            addMode="inline"
            onAddModeChange={setIsAddingEmployees}
            onAddEmployees={async (employeeIds) => {
              const effectiveFrom = assignEffectiveFrom || todayKey();
              await Promise.all(
                employeeIds.map((employeeId) => workRegimeApiService.assign(employeeId, { workRegimeId: viewingEmployeesFor.id, effectiveFrom })),
              );
            }}
            addExtraDisabled={!assignEffectiveFrom}
            addExtraDisabledHint="Indicá la fecha de vigencia desde para continuar."
            renderAddExtra={() => (
              <div className="add-vigency-field">
                <Field label="Vigencia desde *" type="date" value={assignEffectiveFrom} set={setAssignEffectiveFrom} />
                <small className="muted small">Fecha desde la cual este régimen queda activo para los empleados seleccionados.</small>
              </div>
            )}
            onRemoveEmployee={async (item) => {
              await workRegimeApiService.closeAssignment(item.employeeId, item.id, todayKey());
            }}
            canRemove={(item) => item.vigencyStatus === "current"}
            removeActionTone="neutral"
            removeActionIcon={CalendarOff}
            removeActionLabel="Finalizar vigencia"
            removeConfirmTitle="Finalizar asignación de régimen"
            removeConfirmText={(item) => `¿Querés finalizar la asignación de "${viewingEmployeesFor.name}" para ${item.employee.lastName}, ${item.employee.firstName}? Esta acción cierra la vigencia del régimen a partir de hoy, pero conserva el historial.`}
          />
        </Modal>
      )}
    </>
  );
}
