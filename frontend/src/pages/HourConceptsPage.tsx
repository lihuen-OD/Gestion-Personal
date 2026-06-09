import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hourConceptMockService } from "../services/hourConceptMockService";
import type { Role } from "../types";
import type { FinnegansHourConceptLink, HourConcept, HourConceptKind, HourConceptUnit } from "../types/hourConcept.types";

const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const kinds: HourConceptKind[] = ["NORMAL", "EXTRA", "FERIADO", "NOCTURNA", "FRANCO", "GUARDIA", "AUSENCIA_HORARIA", "LLEGADA_TARDE", "OTRO"];
const units: HourConceptUnit[] = ["HORAS", "DIAS", "EVENTOS"];

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }

function emptyConcept(code: string): HourConcept {
  return {
    id: crypto.randomUUID(),
    code,
    name: "",
    kind: "NORMAL",
    description: "",
    status: "ACTIVO",
    rules: { affectsAttendance: true, affectsSettlement: true, requiresApproval: false, requiresObservation: false, allowsManualLoad: true, allowsRange: true, allowsQuantity: true, defaultUnit: "HORAS", multiplier: 1, maxDailyHours: 8 },
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

function BoolCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="catalog-rule-card"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b><small>{checked ? "Activo" : "Inactivo"}</small></span></label>;
}

function RoleChecks({ label, value, onChange }: { label: string; value: Role[]; onChange: (value: Role[]) => void }) {
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roles.map((role) => <label className="check-card" key={role}><input type="checkbox" checked={value.includes(role)} onChange={() => onChange(toggleValue(value, role))} />{role}</label>)}</div></div>;
}

function FinnegansLinks({ item, setItem }: { item: HourConcept; setItem: (item: HourConcept) => void }) {
  const update = (id: string, patch: Partial<FinnegansHourConceptLink>) => setItem({ ...item, finnegansLinks: item.finnegansLinks.map((link) => link.id === id ? { ...link, ...patch } : link) });
  return <div className="catalog-finnegans"><div className="catalog-link-list">{item.finnegansLinks.map((link) => <div className="catalog-link-row" key={link.id}><label>Codigo<input value={link.code} onChange={(event) => update(link.id, { code: event.target.value })} /></label><label>Nombre externo<input value={link.name} onChange={(event) => update(link.id, { name: event.target.value })} /></label><label>Concepto liquidable<input value={link.settlementConcept} onChange={(event) => update(link.id, { settlementConcept: event.target.value })} /></label><label>Prioridad<input type="number" value={link.priority} onChange={(event) => update(link.id, { priority: Number(event.target.value) })} /></label><label>Estado<select value={link.status} onChange={(event) => update(link.id, { status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label><label>Notas<input value={link.notes || ""} onChange={(event) => update(link.id, { notes: event.target.value })} /></label><button className="icon-button danger-link" type="button" onClick={() => setItem(hourConceptMockService.removeFinnegansLink(item, link.id))}>x</button></div>)}</div><button type="button" className="button subtle" onClick={() => setItem(hourConceptMockService.addFinnegansLink(item))}>Agregar vinculacion Finnegans</button></div>;
}

function ConceptEditor({ item, setItem }: { item: HourConcept; setItem: (item: HourConcept) => void }) {
  const setRule = (patch: Partial<HourConcept["rules"]>) => setItem({ ...item, rules: { ...item.rules, ...patch } });
  return <div className="hour-concept-editor">
    <div className="form-grid">
      <label>Codigo<input value={item.code} disabled /></label>
      <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
      <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as HourConceptKind })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
      <label>Unidad por defecto<select value={item.rules.defaultUnit} onChange={(event) => setRule({ defaultUnit: event.target.value as HourConceptUnit })}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
      <label>Multiplicador<input type="number" step="0.01" value={item.rules.multiplier} onChange={(event) => setRule({ multiplier: Number(event.target.value) })} /></label>
      <label>Maximo horas diarias<input type="number" value={item.rules.maxDailyHours || ""} onChange={(event) => setRule({ maxDailyHours: event.target.value ? Number(event.target.value) : undefined })} /></label>
      <div className="form-wide"><label>Descripcion funcional *<textarea value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} /></label></div>
      <div className="form-wide"><label>Notas internas<textarea value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label></div>
    </div>
    <div className="catalog-rules"><div className="catalog-rule-grid"><BoolCheck label="Afecta asistencia" checked={item.rules.affectsAttendance} onChange={(value) => setRule({ affectsAttendance: value })} /><BoolCheck label="Afecta liquidacion" checked={item.rules.affectsSettlement} onChange={(value) => setRule({ affectsSettlement: value })} /><BoolCheck label="Requiere aprobacion" checked={item.rules.requiresApproval} onChange={(value) => setRule({ requiresApproval: value })} /><BoolCheck label="Requiere observacion" checked={item.rules.requiresObservation} onChange={(value) => setRule({ requiresObservation: value })} /><BoolCheck label="Permite carga manual" checked={item.rules.allowsManualLoad} onChange={(value) => setRule({ allowsManualLoad: value })} /><BoolCheck label="Permite rango horario" checked={item.rules.allowsRange} onChange={(value) => setRule({ allowsRange: value })} /><BoolCheck label="Permite cantidad" checked={item.rules.allowsQuantity} onChange={(value) => setRule({ allowsQuantity: value })} /></div></div>
    <RoleChecks label="Roles que pueden cargar" value={item.allowedLoadRoles} onChange={(value) => setItem({ ...item, allowedLoadRoles: value })} />
    <RoleChecks label="Roles que pueden aprobar" value={item.approvalRoles} onChange={(value) => setItem({ ...item, approvalRoles: value })} />
    <FinnegansLinks item={item} setItem={setItem} />
  </div>;
}

export function HourConceptsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(hourConceptMockService.getEmptyFilters());
  const [editing, setEditing] = useState<HourConcept | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  void refresh;
  const items = hourConceptMockService.getFiltered(filters);
  const all = hourConceptMockService.getAll();
  const options = hourConceptMockService.getFilterOptions();
  const summary = useMemo(() => [
    ["Activos", all.filter((item) => item.status === "ACTIVO").length],
    ["Liquidables", all.filter((item) => item.rules.affectsSettlement).length],
    ["Requieren aprobacion", all.filter((item) => item.rules.requiresApproval).length],
    ["Con Finnegans", all.filter((item) => item.finnegansLinks.length).length],
  ], [all]);
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.description.trim()) return setNotice("Completa nombre y descripcion funcional.");
    const exists = Boolean(hourConceptMockService.getById(editing.id));
    const saved = exists ? hourConceptMockService.update(editing.id, editing, user!) : hourConceptMockService.create(editing, user!);
    setEditing(saved || null);
    setRefresh((value) => value + 1);
    setNotice("Concepto horario guardado correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">CONFIGURACION</p><h1>Conceptos horarios</h1><p>Catalogo maestro de conceptos de carga horaria, reglas operativas y vinculacion Finnegans.</p></div><button className="button primary" onClick={() => setEditing(emptyConcept(hourConceptMockService.getNextCode()))}><Plus size={17} /> Crear concepto</button></div>
    {notice && <div className="toast">{notice}</div>}
    <div className="stat-grid novelty-type-summary">{summary.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Conceptos horarios</span></div></div>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>Listado de conceptos</h3><p>{items.length} resultados segun filtros aplicados.</p></div></div><div className="panel-body"><div className="filters catalog-filters"><label className="search-field"><input placeholder="Buscar por codigo, nombre o Finnegans" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Liquidacion<select value={filters.affectsSettlement} onChange={(event) => setFilters({ ...filters, affectsSettlement: event.target.value })}><option value="">Todos</option><option value="true">Afecta</option><option value="false">No afecta</option></select></label><label>Aprobacion<select value={filters.requiresApproval} onChange={(event) => setFilters({ ...filters, requiresApproval: event.target.value })}><option value="">Todos</option><option value="true">Requiere</option><option value="false">No requiere</option></select></label><label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><table><thead><tr><th>Codigo</th><th>Concepto</th><th>Tipo</th><th>Reglas</th><th>Finnegans</th><th>Estado</th><th>Accion</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.description}</span></td><td>{item.kind}</td><td>{item.rules.affectsSettlement ? "Liquida" : "No liquida"} · x{item.rules.multiplier}</td><td>{item.finnegansLinks.map((link) => link.code).join(", ") || "-"}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => setEditing(item)}>Editar</button></td></tr>)}</tbody></table></div></section>
    {editing && <section className="panel"><div className="panel-head"><div><h3>{editing.name || "Nuevo concepto horario"}</h3><p>Definicion funcional, reglas y equivalencias externas.</p></div><div className="hero-actions"><button className="button subtle" onClick={() => setEditing(null)}>Cerrar</button><button className="button primary" onClick={save}>Guardar concepto</button></div></div><div className="panel-body"><ConceptEditor item={editing} setItem={setEditing} /></div></section>}
  </>;
}

