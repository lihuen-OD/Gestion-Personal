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
import { SortableHeader } from "../components/ui/SortableHeader";
import { useAuth } from "../context/AuthContext";
import { confirmAction } from "../services/appDialog";
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { AssociatedEmployeeFilters } from "../types/associatedEmployee.types";
import type { HourConcept, HourConceptFilters, HourConceptKind, HourConceptLoadMode, HourConceptWorkTreatment } from "../types/hourConcept.types";
import { roleLevel } from "../utils/roles";
import { activoInactivoLabel } from "../utils/status";
import { TOAST_SUCCESS_MS } from "../utils/toast";
import { useAsyncAction } from "../utils/useAsyncAction";
import { useSort, type SortAccessors } from "../utils/sort";
import { workTreatmentDescriptions, workTreatmentLabels, workTreatmentOptions } from "../utils/workedTimeAccounting";

const additionalKinds: HourConceptKind[] = ["EXTRA", "FERIADO", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "OTRO"];
const loadModeLabels: Record<HourConceptLoadMode, string> = { MANUAL: "Manual", AUTOMATIC: "Automático", BOTH: "Manual y automático" };
const hourConceptKindLabels: Record<HourConceptKind, string> = {
  NORMAL: "Normal",
  EXTRA: "Extra",
  FERIADO: "Feriado",
  NOCTURNA: "Nocturna",
  GUARDIA: "Guardia",
  SERENO: "Sereno",
  TRANSPORTE: "Transporte",
  OTRO: "Otro",
};

export function emptyConcept(code: string): HourConcept {
  return {
    id: crypto.randomUUID(),
    code,
    name: "",
    kind: "OTRO",
    status: "ACTIVO",
    loadMode: "MANUAL",
    systemRole: null,
    // Sin default a propósito: si suma o no al total es una decisión de
    // negocio explícita, nunca deducida del modo de carga.
    workTreatment: null,
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
      <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as HourConceptKind })}>{additionalKinds.map((kind) => <option key={kind} value={kind}>{hourConceptKindLabels[kind]}</option>)}</select></label>
      <label>Modo de carga *<select value={item.loadMode ?? "MANUAL"} onChange={(event) => setItem({ ...item, loadMode: event.target.value as HourConceptLoadMode })}>{Object.entries(loadModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>
        Tratamiento en el total *
        <select value={item.workTreatment ?? ""} onChange={(event) => setItem({ ...item, workTreatment: (event.target.value || null) as HourConceptWorkTreatment | null })}>
          <option value="" disabled>Seleccioná una opción</option>
          {workTreatmentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {item.workTreatment ? <small className="field-help">{workTreatmentDescriptions[item.workTreatment]}</small> : null}
      </label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>
    </div>
  );
}

const sortAccessors: SortAccessors<HourConcept, "code" | "name" | "kind" | "status"> = {
  code: (item) => item.code,
  name: (item) => item.name,
  kind: (item) => hourConceptKindLabels[item.kind],
  status: (item) => activoInactivoLabel(item.status),
};

export function HourConceptsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<HourConceptFilters>({ search: "", kind: "", status: "" });
  const [editing, setEditing] = useState<HourConcept | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [apiItems, setApiItems] = useState<HourConcept[] | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPreparingCreate, setIsPreparingCreate] = useState(false);
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
  const items = useMemo(() => all.filter((item) => matchesFilters(item, filters)), [all, filters]);
  const { sorted, sort, toggleSort } = useSort(items, sortAccessors);
  const options = getFilterOptions(all);
  const summary = useMemo(() => [
    ["Activas", all.filter((item) => item.status === "ACTIVO").length],
    ["Total configurados", all.length],
  ] as const, [all]);
  const isExistingConcept = Boolean(editing && apiItems?.some((item) => item.id === editing.id));

  const startCreate = async () => {
    setIsPreparingCreate(true);
    try {
      setEditing(emptyConcept(await hourConceptApiService.getNextCode()));
    } catch (error) {
      setNotice(getUserErrorMessage(error, "No pudimos obtener un código disponible. Intentá nuevamente."));
    } finally {
      setIsPreparingCreate(false);
    }
  };

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      setNotice("Completa el nombre.");
      return;
    }
    if (!editing.workTreatment) {
      setNotice("Elegí si el concepto está dentro de la jornada o suma horas adicionales.");
      return;
    }

    // Corregir el tratamiento de un concepto existente reinterpreta todas sus
    // horas ya cargadas (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §2):
    // se permite siempre, pero se confirma explícitamente.
    const stored = apiItems?.find((item) => item.id === editing.id);
    const treatmentChanged = Boolean(stored && stored.workTreatment !== editing.workTreatment);
    if (treatmentChanged) {
      const confirmed = await confirmAction(
        `Las horas ya cargadas de "${editing.name}" conservan sus minutos y pasan a leerse como "${workTreatmentLabels[editing.workTreatment]}" en grillas, totales, exportaciones y cierres.`,
        { title: "Cambiar tratamiento del concepto", confirmLabel: "Cambiar tratamiento" },
      );
      if (!confirmed) return;
    }

    try {
      const saved = stored
        ? await hourConceptApiService.update(editing.id, editing)
        : await hourConceptApiService.create(editing);

      setEditing(saved || null);
      setRefresh((value) => value + 1);
      setNotice(treatmentChanged ? "Concepto horario guardado. Las horas ya cargadas se leen con el nuevo tratamiento." : "Concepto horario guardado correctamente.");
      setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    } catch (saveError) {
      if (!stored && saveError instanceof ApiError && saveError.code === "HOUR_CONCEPT_UNIQUE_CONSTRAINT") {
        try {
          const code = await hourConceptApiService.getNextCode();
          setEditing((current) => current ? { ...current, code } : current);
          setNotice(`Ese código acaba de ser utilizado. Asignamos ${code} automáticamente.`);
          return;
        } catch {
          // Si también falla el refresco, se muestra el conflicto original.
        }
      }
      setNotice(getUserErrorMessage(saveError, "No pudimos guardar el concepto horario. Revisá los datos e intentá nuevamente."));
      setTimeout(() => setNotice(""), 3000);
    }
  });

  const toggleStatus = async (item: HourConcept) => {
    const activating = item.status !== "ACTIVO";
    const confirmed = await confirmAction(
      activating
        ? `¿Querés habilitar el concepto horario "${item.name}"?`
        : `¿Querés deshabilitar el concepto horario "${item.name}"? No se podrá usar en nuevas cargas ni en la clasificación automática; no se borra su historial (horas, reglas y legajos habilitados).`,
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

  // Eliminar definitivamente es para una configuración creada por error: un
  // único DELETE borra el concepto y su historial específico (horas del
  // concepto, reglas, legajos habilitados) y libera el código. Fichadas y
  // jornadas reales se conservan. Para conservar la historia de un concepto
  // válido se usa Deshabilitar.
  const removeConcept = async (item: HourConcept) => {
    const confirmed = await confirmAction(
      `Se eliminará el concepto "${item.name}" y las horas/configuración asociadas a él. Esta acción no se puede deshacer. Las fichadas y jornadas reales se conservarán. Si el concepto es válido pero ya no se usa, deshabilitalo para conservar su historial.`,
      { title: "Eliminar concepto definitivamente", confirmLabel: "Eliminar definitivamente", cancelLabel: "Cancelar", tone: "danger" },
    );
    if (!confirmed) return;

    try {
      await hourConceptApiService.remove(item.id);
      if (editing?.id === item.id) setEditing(null);
      setNotice(`Se eliminó definitivamente el concepto "${item.name}".`);
      setRefresh((value) => value + 1);
      setTimeout(() => setNotice(""), TOAST_SUCCESS_MS);
    } catch (removeError) {
      setNotice(getUserErrorMessage(removeError, "No pudimos eliminar el concepto horario."));
      setTimeout(() => setNotice(""), 3500);
    }
  };

  const editable = roleLevel(user!.role) === 1;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Conceptos horarios"
        description="Horas base es la jornada registrada. Cada concepto adicional clasifica horas dentro de esa jornada o suma horas trabajadas fuera de la fichada."
        action={editable ? <Button variant="primary" icon={Plus} onClick={startCreate} disabled={isPreparingCreate}>{isPreparingCreate ? "Preparando..." : "Crear concepto horario"}</Button> : undefined}
      />

      {notice && <div className="toast">{notice}</div>}

      <div className="stat-grid novelty-type-summary">
        {summary.map(([label, value]) => (
          <StatCard key={label} label={label} value={value} detail="Conceptos horarios" />
        ))}
      </div>

      <Section title="Listado de conceptos horarios" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados segun filtros aplicados.`}>
        <FilterPanel search={{ value: filters.search, onChange: (value) => setFilters({ ...filters, search: value }), placeholder: "Buscar por codigo, nombre o tipo" }}>
          <label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind} value={kind}>{hourConceptKindLabels[kind]}</option>)}</select></label>
          <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status} value={status}>{activoInactivoLabel(status)}</option>)}</select></label>
        </FilterPanel>
        <DataTable
          status={isLoadingApi ? "loading" : loadFailed ? "error" : items.length === 0 ? "empty" : "ready"}
          minWidth={900}
          emptyText="No hay conceptos horarios con los filtros aplicados."
          errorMessage="No se pudo cargar el catálogo de conceptos horarios."
          onRetry={() => setRefresh((value) => value + 1)}
        >
          <table>
            <thead><tr><SortableHeader label="Codigo" sortKey="code" sort={sort} onSort={toggleSort} /><SortableHeader label="Concepto horario" sortKey="name" sort={sort} onSort={toggleSort} /><th>Tratamiento</th><SortableHeader label="Tipo" sortKey="kind" sort={sort} onSort={toggleSort} /><th>Modo de carga</th><SortableHeader label="Estado" sortKey="status" sort={sort} onSort={toggleSort} /><th>Acción</th></tr></thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.code}</b></td>
                  <td><OverflowCell value={item.name} /></td>
                  <td>{item.systemRole === "NORMAL_BASE" ? <Badge tone="neutral">Base del sistema</Badge> : item.workTreatment ? workTreatmentLabels[item.workTreatment] : "Sin definir"}</td>
                  <td>{hourConceptKindLabels[item.kind]}</td>
                  <td>{item.loadMode ? loadModeLabels[item.loadMode] : "No aplica"}</td>
                  <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{activoInactivoLabel(item.status)}</Badge></td>
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
            subtitle="Configurá el concepto y si clasifica horas dentro de la jornada o suma horas adicionales al total trabajado."
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
