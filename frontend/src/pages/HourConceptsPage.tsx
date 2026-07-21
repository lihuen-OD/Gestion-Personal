import { Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { OverflowCell } from "../components/ui/OverflowCell";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { useAuth } from "../context/AuthContext";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { Role } from "../types";
import type { HourConcept, HourConceptFilters, HourConceptKind } from "../types/hourConcept.types";
import { roleLevel } from "../utils/roles";
import { useAsyncAction } from "../utils/useAsyncAction";

const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const kinds: HourConceptKind[] = ["NORMAL", "EXTRA", "FERIADO", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "OTRO"];

function emptyConcept(code: string): HourConcept {
  return {
    id: crypto.randomUUID(),
    code,
    name: "",
    kind: "NORMAL",
    description: "",
    status: "ACTIVO",
    rules: { defaultUnit: "HORAS" },
    allowedLoadRoles: ["Nivel 1 - RRHH", "Nivel 3 - Administrativo de Carga Horaria"],
    approvalRoles: ["Nivel 1 - RRHH"],
    finnegansLinks: [],
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
  };
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesFilters(item: HourConcept, filters: HourConceptFilters) {
  const search = normalize(filters.search);
  const text = normalize(`${item.code} ${item.name} ${item.description} ${item.kind}`);
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

function RoleChecks({ label, value, onChange }: { label: string; value: Role[]; onChange: (value: Role[]) => void }) {
  return (
    <div className="catalog-check-block">
      <small>{label}</small>
      <div className="check-grid inline">
        {roles.map((role) => (
          <label className="check-card" key={role}>
            <input type="checkbox" checked={value.includes(role)} onChange={() => onChange(toggleValue(value, role))} />
            {role}
          </label>
        ))}
      </div>
    </div>
  );
}

function ConceptEditor({ item, setItem }: { item: HourConcept; setItem: (item: HourConcept) => void }) {
  const setRule = (patch: Partial<HourConcept["rules"]>) => setItem({ ...item, rules: { ...item.rules, ...patch } });

  return (
    <div className="hour-concept-editor">
      <div className="info-note">
        <b>Hora especial, no novedad</b>
        <p>Sereno, guardia, manejo de colectivo, nocturna, feriado trabajado y horas extra son horas trabajadas clasificadas. No se cargan como novedades.</p>
      </div>
      <div className="form-grid">
        <label>Codigo<input value={item.code} disabled /></label>
        <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
        <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as HourConceptKind })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
        <label>Unidad<input value="HORAS" disabled /></label>
        <div className="form-wide"><label>Descripcion funcional *<textarea value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} /></label></div>
        <div className="form-wide"><label>Notas internas<textarea value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label></div>
      </div>
      <RoleChecks label="Roles que pueden cargar" value={item.allowedLoadRoles} onChange={(value) => setItem({ ...item, allowedLoadRoles: value })} />
      <RoleChecks label="Roles que pueden aprobar" value={item.approvalRoles} onChange={(value) => setItem({ ...item, approvalRoles: value })} />
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

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
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

  const all = apiItems ?? [];
  const items = all.filter((item) => matchesFilters(item, filters));
  const options = getFilterOptions(all);
  const summary = useMemo(() => [
    ["Activas", all.filter((item) => item.status === "ACTIVO").length],
  ], [all]);

  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.description.trim()) {
      setNotice("Completa nombre y descripcion funcional.");
      return;
    }

    try {
      const existsInApi = Boolean(apiItems?.some((item) => item.id === editing.id));
      const saved = existsInApi
        ? await hourConceptApiService.update(editing.id, editing)
        : await hourConceptApiService.create(editing);

      setEditing(saved || null);
      setRefresh((value) => value + 1);
      setNotice("Hora especial guardada correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No pudimos guardar el concepto horario. Revisá los datos e intentá nuevamente.");
      setTimeout(() => setNotice(""), 3000);
    }
  });

  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURACION"
        title="Horas especiales"
        description="Catalogo de horas trabajadas clasificadas. Sereno, guardia, manejo de colectivo, nocturna, feriados y extras se cargan aca, no como novedades."
        action={<Button variant="primary" icon={Plus} onClick={() => setEditing(emptyConcept(hourConceptApiService.getNextCode(all)))}>Crear hora especial</Button>}
      />

      {notice && <div className="toast">{notice}</div>}

      <div className="stat-grid novelty-type-summary">
        {summary.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div><small>{label}</small><strong>{value}</strong><span>Horas especiales</span></div>
          </div>
        ))}
      </div>

      <Section title="Listado de horas especiales" subtitle={isLoadingApi ? "Cargando catálogo..." : `${items.length} resultados segun filtros aplicados.`}>
        <div className="filters catalog-filters">
          <label className="search-field">
            <input placeholder="Buscar por codigo, nombre o tipo" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </label>
          <label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
        <DataTable
          status={isLoadingApi ? "loading" : loadFailed ? "error" : items.length === 0 ? "empty" : "ready"}
          minWidth={900}
          emptyText="No hay horas especiales con los filtros aplicados."
          errorMessage="No se pudo cargar el catalogo de horas especiales."
          onRetry={() => setRefresh((value) => value + 1)}
        >
          <table>
            <thead><tr><th>Codigo</th><th>Hora especial</th><th>Tipo</th><th>Estado</th><th>Accion</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.code}</b></td>
                  <td><OverflowCell value={item.name} /><span className="table-sub">{item.description}</span></td>
                  <td>{item.kind}</td>
                  <td><Badge tone={item.status === "ACTIVO" ? "success" : "neutral"}>{item.status}</Badge></td>
                  <td><button className="table-link table-icon-action" title="Editar" aria-label="Editar" onClick={() => setEditing(item)}><Pencil size={14}/><span>Editar</span></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Section>

      {editing && (
        <Section
          title={editing.name || "Nueva hora especial"}
          subtitle="Definicion operativa interna para carga horaria. No se exporta a Finnegans."
          action={<div className="hero-actions"><Button variant="subtle" onClick={() => setEditing(null)}>Cerrar</Button><Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar hora especial"}</Button></div>}
        >
          <ConceptEditor item={editing} setItem={setEditing} />
        </Section>
      )}
    </>
  );
}
