import { Pencil, Plus, Power } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  openShiftOverflowActionLabel,
  openShiftOverflowActionOptions,
  workRegimeKindLabel,
  workRegimeKindOptions,
  workRegimeStatusTone,
} from "../components/work-regimes/workRegimeLabels";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { Field } from "../components/ui/FormControls";
import { Modal } from "../components/ui/Modal";
import { OverflowCell } from "../components/ui/OverflowCell";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { useAuth } from "../context/AuthContext";
import { confirmAction } from "../services/appDialog";
import { getUserErrorMessage } from "../services/api/apiClient";
import { workRegimeApiService } from "../services/api/workRegimeApiService";
import type { OpenShiftOverflowAction, WorkRegime, WorkRegimeFilters, WorkRegimeKind } from "../types/workRegime.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

type WorkRegimeDraft = Pick<WorkRegime, "code" | "name" | "kind" | "alertOnOutOfShift" | "openShiftOverflowAction" | "description" | "status">;

function emptyDraft(): WorkRegimeDraft {
  return {
    code: "",
    name: "",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: true,
    openShiftOverflowAction: "ROLLOVER",
    description: "",
    status: "ACTIVO",
  };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
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

    try {
      if (editingId) await workRegimeApiService.update(editingId, { ...draft, code, name });
      else await workRegimeApiService.create({ ...draft, code, name });
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

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Regímenes laborales"
        description="Catálogo de regímenes de trabajo (Cosecha, Riego, Oficina flexible, etc.) y cómo se comporta el sistema frente a cada uno."
        action={<Button variant="primary" icon={Plus} onClick={openCreate}>Crear régimen</Button>}
      />

      {notice && <div className="toast">{notice}</div>}

      <div className="info-note">
        <b>¿Qué es un régimen laboral?</b>
        <p>El régimen laboral define cómo se comporta el sistema frente al empleado. No es el horario del turno.</p>
      </div>

      <div className="stat-grid novelty-type-summary">
        {summary.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div><small>{label}</small><strong>{value}</strong><span>Regímenes laborales</span></div>
          </div>
        ))}
      </div>

      <Section title="Listado de regímenes laborales" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados según filtros aplicados.`}>
        <div className="filters catalog-filters">
          <label className="search-field">
            <input placeholder="Buscar por código o nombre" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
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
        </div>
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
                      <button className="icon-button" title="Editar régimen" aria-label="Editar régimen" onClick={() => openEdit(item)}><Pencil size={15} /></button>
                      <button className="icon-button" title={item.status === "ACTIVO" ? "Inactivar régimen" : "Activar régimen"} aria-label={item.status === "ACTIVO" ? "Inactivar régimen" : "Activar régimen"} onClick={() => toggleStatus(item)}><Power size={15} /></button>
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
    </>
  );
}
