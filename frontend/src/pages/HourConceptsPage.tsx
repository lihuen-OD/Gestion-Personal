import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HourConceptRulesPanel } from "../components/hour-concepts/HourConceptRulesPanel";
import { AssociatedEmployeesPanel } from "../components/shared/AssociatedEmployeesPanel";
import { OverflowCell } from "../components/ui/OverflowCell";
import { FilterPanel } from "../components/ui/FilterPanel";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { StatCard } from "../components/ui/StatCard";
import { useAuth } from "../context/AuthContext";
import { confirmAction } from "../services/appDialog";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { AssociatedEmployeeFilters } from "../types/associatedEmployee.types";
import type { HourConcept, HourConceptFilters, HourConceptKind, HourConceptLoadMode } from "../types/hourConcept.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

const additionalKinds: HourConceptKind[] = ["EXTRA", "FERIADO", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "OTRO"];
const loadModeLabels: Record<HourConceptLoadMode, string> = { MANUAL: "Manual", AUTOMATIC: "Automático", BOTH: "Manual y automático" };

export function emptyConcept(code: string): HourConcept {
  return {
    id: crypto.randomUUID(),
    code,
    name: "",
    kind: "OTRO",
    status: "ACTIVO",
    loadMode: "MANUAL",
    systemRole: null,
    createdAt: "",
    updatedAt: "",
  };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesFilters(item: HourConcept, filters: HourConceptFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.kind}`);
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

function getFilterOptions(items: HourConcept[]) {
  return {
    kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
    statuses: ["ACTIVO", "INACTIVO"],
  };
}

// Sección 1 — Datos del concepto. Solo los campos: el título/descripción y
// los botones Guardar/Cancelar ya los da el <Section> que la envuelve, así
// que esta función no repite ningún encabezado propio (evita la "card
// dentro de card" que tenía la versión anterior de esta pantalla).
function ConceptDataFields({ item, setItem }: { item: HourConcept; setItem: (item: HourConcept) => void }) {
  return (
    <div className="form-grid">
      <label>Codigo<input value={item.code} disabled /></label>
      <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
      <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as HourConceptKind })}>{additionalKinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <label>Modo de carga *<select value={item.loadMode ?? "MANUAL"} onChange={(event) => setItem({ ...item, loadMode: event.target.value as HourConceptLoadMode })}>{Object.entries(loadModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
    </div>
  );
}

export function HourConceptsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<HourConceptFilters>({ search: "", kind: "", status: "" });
  const [editing, setEditing] = useState<HourConcept | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [apiItems, setApiItems] = useState<HourConcept[] | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    if (!apiItems) setIsLoadingApi(true);
    setLoadFailed(false);
    hourConceptApiService.getAll()
      .then((items) => {
        if (!alive) return;
        setApiItems(items);
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

  // Al abrir "Editar"/"Crear", el detalle puede quedar bastante más abajo que
  // la tabla — sin esto, el usuario tiene que buscarlo scrolleando a mano.
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing]);

  const all = apiItems ?? [];
  const items = all.filter((item) => matchesFilters(item, filters));
  const options = getFilterOptions(all);
  const summary = useMemo(() => [
    ["Activas", all.filter((item) => item.status === "ACTIVO").length],
    ["Total configurados", all.length],
  ] as const, [all]);
  const isExistingConcept = Boolean(editing && apiItems?.some((item) => item.id === editing.id));

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setNotice("Completa el nombre.");
      return;
    }

    try {
      const existsInApi = Boolean(apiItems?.some((item) => item.id === editing.id));
      const saved = existsInApi
        ? await hourConceptApiService.update(editing.id, editing)
        : await hourConceptApiService.create(editing);

      setEditing(saved || null);
      setRefresh((value) => value + 1);
      setNotice("Concepto horario guardado correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch (saveError) {
      setNotice(getUserErrorMessage(saveError, "No pudimos guardar el concepto horario. Revisá los datos e intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  });

  const toggleStatus = async (item: HourConcept) => {
    const activating = item.status !== "ACTIVO";
    const confirmed = await confirmAction(
      activating
        ? `¿Querés habilitar el concepto horario "${item.name}"?`
        : `¿Querés deshabilitar el concepto horario "${item.name}"? Deja de aplicarse en la clasificación automática y en el fichador; no se borra su historial.`,
      {
        title: activating ? "Habilitar concepto horario" : "Deshabilitar concepto horario",
        confirmLabel: activating ? "Habilitar" : "Deshabilitar",
        tone: activating ? "primary" : "danger",
      },
    );
    if (!confirmed) return;
    try {
      await hourConceptApiService.updateStatus(item.id, activating ? "ACTIVO" : "INACTIVO");
      setRefresh((value) => value + 1);
    } catch (statusError) {
      setNotice(getUserErrorMessage(statusError, "No pudimos cambiar el estado del concepto horario. Intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  };

  // Eliminación (Etapa 8P): primero se confirma sin saber todavía si tiene
  // uso histórico. Si el backend responde 409 HOUR_CONCEPT_IN_USE, se pide
  // una segunda confirmación explícita con el texto exacto de la regla de
  // negocio, y recién ahí se reintenta con force=true (baja lógica, conserva
  // el historial). Si no tiene uso, la primera llamada ya lo elimina del todo.
  const removeConcept = async (item: HourConcept) => {
    const confirmed = await confirmAction(
      `¿Querés eliminar el concepto horario "${item.name}"? Esta acción no se puede deshacer.`,
      { title: "Eliminar concepto horario", confirmLabel: "Eliminar", tone: "danger" },
    );
    if (!confirmed) return;

    try {
      await hourConceptApiService.remove(item.id);
      if (editing?.id === item.id) setEditing(null);
      setNotice("Este concepto fue eliminado definitivamente.");
      setRefresh((value) => value + 1);
      setTimeout(() => setNotice(""), 2500);
      return;
    } catch (removeError) {
      if (!(removeError instanceof ApiError) || removeError.code !== "HOUR_CONCEPT_IN_USE") {
        setNotice(getUserErrorMessage(removeError, "No pudimos eliminar el concepto horario."));
        setTimeout(() => setNotice(""), 3500);
        return;
      }
    }

    const confirmedForced = await confirmAction(
      "Este concepto tiene uso histórico. Si lo eliminás, dejará de estar disponible para nuevas cargas/asignaciones, pero el sistema conserva la trazabilidad de lo ya cargado. ¿Confirmás la eliminación?",
      { title: "Eliminar concepto con uso histórico", confirmLabel: "Eliminar de todas formas", tone: "danger" },
    );
    if (!confirmedForced) return;

    try {
      await hourConceptApiService.remove(item.id, { force: true });
      if (editing?.id === item.id) setEditing(null);
      setNotice("Concepto horario eliminado. Se conserva el historial de lo ya cargado.");
      setRefresh((value) => value + 1);
      setTimeout(() => setNotice(""), 3000);
    } catch (forceError) {
      setNotice(getUserErrorMessage(forceError, "No pudimos eliminar el concepto horario."));
      setTimeout(() => setNotice(""), 3500);
    }
  };

  const editable = roleLevel(user!.role) === 1;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Conceptos horarios"
        description="Horas normales representa el total trabajado. Los conceptos adicionales son desgloses para liquidación, análisis y control."
        action={editable ? <Button variant="primary" icon={Plus} onClick={() => setEditing(emptyConcept(hourConceptApiService.getNextCode(all)))}>Crear concepto horario</Button> : undefined}
      />

      {notice && <div className="toast">{notice}</div>}

      <div className="stat-grid novelty-type-summary">
        {summary.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} detail="Conceptos horarios" />
        ))}
      </div>

      <Section title="Listado de conceptos horarios" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados segun filtros aplicados.`}>
        <FilterPanel search={{ value: filters.search, onChange: (value) => setFilters({ ...filters, search: value }), placeholder: "Buscar por codigo, nombre o tipo" }}>
          <label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        </FilterPanel>
        <DataTable
          status={isLoadingApi ? "loading" : loadFailed ? "error" : items.length === 0 ? "empty" : "ready"}
          minWidth={900}
          emptyText="No hay conceptos horarios con los filtros aplicados."
          errorMessage="No se pudo cargar el catálogo de conceptos horarios."
          onRetry={() => setRefresh((value) => value + 1)}
        >
          <table>
            <thead><tr><th>Codigo</th><th>Concepto horario</th><th>Rol</th><th>Tipo</th><th>Modo de carga</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.code}</b></td>
                  <td><OverflowCell value={item.name} /></td>
                  <td>{item.systemRole === "NORMAL_BASE" ? <Badge tone="neutral">Base del sistema</Badge> : "Adicional"}</td>
                  <td>{item.kind}</td>
                  <td>{item.loadMode ? loadModeLabels[item.loadMode] : "No aplica"}</td>
                  <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status}</Badge></td>
                  <td>
                    {item.systemRole === "NORMAL_BASE" ? <Badge tone="neutral">Protegido</Badge> : editable ? (
                      <div className="table-actions">
                        <button className="table-icon-action" title="Editar" aria-label="Editar" onClick={() => setEditing(item)}>
                          <Pencil size={14} /><span>Editar</span>
                        </button>
                        <button
                          className="table-icon-action"
                          title={item.status === "ACTIVO" ? "Deshabilitar" : "Habilitar"}
                          aria-label={item.status === "ACTIVO" ? "Deshabilitar" : "Habilitar"}
                          onClick={() => void toggleStatus(item)}
                        >
                          <Power size={14} /><span>{item.status === "ACTIVO" ? "Deshabilitar" : "Habilitar"}</span>
                        </button>
                        <button className="table-icon-action danger-link" title="Eliminar" aria-label="Eliminar" onClick={() => void removeConcept(item)}>
                          <Trash2 size={14} /><span>Eliminar</span>
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Section>

      {editing && (
        <div ref={editorRef} className="detail-section-stack">
          <Section
            title={isExistingConcept ? "Editar concepto horario" : "Nuevo concepto horario"}
            subtitle="Configura un desglose adicional. No reemplaza ni incrementa Horas normales."
            action={<div className="hero-actions"><Button variant="subtle" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar"}</Button></div>}
          >
            <ConceptDataFields item={editing} setItem={setEditing} />
          </Section>

          {isExistingConcept ? (
            <>
              <HourConceptRulesPanel hourConceptId={editing.id} loadMode={editing.loadMode!} canEdit={editable} />
              <AssociatedEmployeesPanel
                key={editing.id}
                variant="embedded"
                title="Empleados habilitados"
                description="Empleados con este concepto horario habilitado."
                emptyText="Este concepto todavía no está habilitado para ningún empleado."
                fetcher={(filters: AssociatedEmployeeFilters) => hourConceptApiService.getHourConceptEmployees(editing.id, filters)}
                canEdit={editable}
                onAddEmployees={(employeeIds) => hourConceptApiService.enableEmployees(editing.id, employeeIds)}
                onRemoveEmployee={(item) => hourConceptApiService.disableEmployee(editing.id, item.employeeId)}
                removeConfirmText={(item) => `¿Querés quitar el concepto horario "${editing.name}" para ${item.employee.lastName}, ${item.employee.firstName}?`}
              />
            </>
          ) : (
            <div className="info-note compact">
              <p>Guardá el concepto horario antes de configurar sus reglas horarias.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
