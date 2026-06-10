import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hourConceptMockService } from "../services/hourConceptMockService";
import { noveltyTypeMockService } from "../services/noveltyTypeMockService";
import { settlementConfigMockService } from "../services/settlementConfigMockService";
import type { Role } from "../types";
import type { FinnegansSettlementLink, SettlementConfig, SettlementPeriodicity, SettlementProcessStatus, SettlementTypeKind, SettlementValidationRule } from "../types/settlementConfig.types";

const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const kinds: SettlementTypeKind[] = ["NORMAL", "SAC", "FINAL", "AJUSTE", "VACACIONES", "PREMIO", "OTRO"];
const periodicities: SettlementPeriodicity[] = ["MENSUAL", "QUINCENAL", "SEMANAL", "EVENTUAL"];
const processStatuses: SettlementProcessStatus[] = ["BORRADOR", "PRELIQUIDADO", "CERRADO", "EXPORTADO"];
const severities: SettlementValidationRule["severity"][] = ["INFO", "ADVERTENCIA", "BLOQUEANTE"];

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }
function toggleValue<T extends string>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function emptyConfig(code: string): SettlementConfig {
  return {
    id: crypto.randomUUID(),
    code,
    name: "",
    kind: "NORMAL",
    periodicity: "MENSUAL",
    status: "ACTIVO",
    description: "",
    defaultProcessStatus: "BORRADOR",
    closesAttendance: true,
    exportsToFinnegans: true,
    includesNovelties: true,
    includesHourConcepts: true,
    includesDocumentsValidation: false,
    allowedRoles: ["Nivel 1 - RRHH"],
    approvalRoles: ["Nivel 1 - RRHH"],
    noveltyTypeIds: [],
    hourConceptIds: [],
    validationRules: [],
    finnegansLinks: [],
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
  };
}

function BoolCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="catalog-rule-card"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b><small>{checked ? "Activo" : "Inactivo"}</small></span></label>;
}

function CheckList({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{options.map((option) => <label className="check-card" key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={() => onChange(toggleValue(value, option.id))} />{option.name}</label>)}</div></div>;
}

function RoleChecks({ label, value, onChange }: { label: string; value: Role[]; onChange: (value: Role[]) => void }) {
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roles.map((role) => <label className="check-card" key={role}><input type="checkbox" checked={value.includes(role)} onChange={() => onChange(toggleValue(value, role))} />{role}</label>)}</div></div>;
}

function ValidationRules({ item, setItem }: { item: SettlementConfig; setItem: (item: SettlementConfig) => void }) {
  const update = (id: string, patch: Partial<SettlementValidationRule>) => setItem({ ...item, validationRules: item.validationRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule) });
  return <div className="catalog-finnegans"><div className="panel-head compact"><div><h3>Validaciones previas</h3><p>Reglas que se verifican antes de cerrar o exportar una liquidacion.</p></div><button className="button subtle" type="button" onClick={() => setItem(settlementConfigMockService.addValidationRule(item))}>Agregar regla</button></div><div className="catalog-link-list">{item.validationRules.map((rule) => <div className="settlement-rule-row" key={rule.id}><label>Nombre<input value={rule.name} onChange={(event) => update(rule.id, { name: event.target.value })} /></label><label>Descripcion<input value={rule.description} onChange={(event) => update(rule.id, { description: event.target.value })} /></label><label>Severidad<select value={rule.severity} onChange={(event) => update(rule.id, { severity: event.target.value as SettlementValidationRule["severity"] })}>{severities.map((severity) => <option key={severity}>{severity}</option>)}</select></label><label className="mini-check"><input type="checkbox" checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} />Activa</label><button className="icon-button danger-link" type="button" onClick={() => setItem(settlementConfigMockService.removeValidationRule(item, rule.id))}>x</button></div>)}</div></div>;
}

function FinnegansLinks({ item, setItem }: { item: SettlementConfig; setItem: (item: SettlementConfig) => void }) {
  const update = (id: string, patch: Partial<FinnegansSettlementLink>) => setItem({ ...item, finnegansLinks: item.finnegansLinks.map((link) => link.id === id ? { ...link, ...patch } : link) });
  return <div className="catalog-finnegans"><div className="panel-head compact"><div><h3>Vinculacion Finnegans</h3><p>Codigos externos para exportacion futura.</p></div><button type="button" className="button subtle" onClick={() => setItem(settlementConfigMockService.addFinnegansLink(item))}>Agregar vinculo</button></div><div className="catalog-link-list">{item.finnegansLinks.map((link) => <div className="catalog-link-row" key={link.id}><label>Codigo<input value={link.code} onChange={(event) => update(link.id, { code: event.target.value })} /></label><label>Nombre externo<input value={link.name} onChange={(event) => update(link.id, { name: event.target.value })} /></label><label>Codigo exportacion<input value={link.exportCode} onChange={(event) => update(link.id, { exportCode: event.target.value })} /></label><label>Estado<select value={link.status} onChange={(event) => update(link.id, { status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label><label>Notas<input value={link.notes || ""} onChange={(event) => update(link.id, { notes: event.target.value })} /></label><button className="icon-button danger-link" type="button" onClick={() => setItem(settlementConfigMockService.removeFinnegansLink(item, link.id))}>x</button></div>)}</div></div>;
}

function ConfigEditor({ item, setItem }: { item: SettlementConfig; setItem: (item: SettlementConfig) => void }) {
  const noveltyTypes = noveltyTypeMockService.getActive().map((type) => ({ id: type.id, name: `${type.code} - ${type.name}` }));
  const hourConcepts = hourConceptMockService.getActive().map((concept) => ({ id: concept.id, name: `${concept.code} - ${concept.name}` }));
  return <div className="settlement-editor">
    <div className="form-grid">
      <label>Codigo<input value={item.code} disabled /></label>
      <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
      <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as SettlementTypeKind })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <label>Periodicidad<select value={item.periodicity} onChange={(event) => setItem({ ...item, periodicity: event.target.value as SettlementPeriodicity })}>{periodicities.map((periodicity) => <option key={periodicity}>{periodicity}</option>)}</select></label>
      <label>Estado inicial<select value={item.defaultProcessStatus} onChange={(event) => setItem({ ...item, defaultProcessStatus: event.target.value as SettlementProcessStatus })}>{processStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
      <div className="form-wide"><label>Descripcion *<textarea value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} /></label></div>
      <div className="form-wide"><label>Notas internas<textarea value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label></div>
    </div>
    <div className="catalog-rules"><div className="catalog-rule-grid"><BoolCheck label="Cierra asistencia" checked={item.closesAttendance} onChange={(value) => setItem({ ...item, closesAttendance: value })} /><BoolCheck label="Exporta a Finnegans" checked={item.exportsToFinnegans} onChange={(value) => setItem({ ...item, exportsToFinnegans: value })} /><BoolCheck label="Incluye novedades" checked={item.includesNovelties} onChange={(value) => setItem({ ...item, includesNovelties: value })} /><BoolCheck label="Incluye conceptos horarios" checked={item.includesHourConcepts} onChange={(value) => setItem({ ...item, includesHourConcepts: value })} /><BoolCheck label="Valida documentacion" checked={item.includesDocumentsValidation} onChange={(value) => setItem({ ...item, includesDocumentsValidation: value })} /></div></div>
    <RoleChecks label="Roles que pueden ejecutar" value={item.allowedRoles} onChange={(allowedRoles) => setItem({ ...item, allowedRoles })} />
    <RoleChecks label="Roles que pueden aprobar/cerrar" value={item.approvalRoles} onChange={(approvalRoles) => setItem({ ...item, approvalRoles })} />
    <CheckList label="Tipos de novedades que impactan" options={noveltyTypes} value={item.noveltyTypeIds} onChange={(noveltyTypeIds) => setItem({ ...item, noveltyTypeIds })} />
    <CheckList label="Conceptos horarios que impactan" options={hourConcepts} value={item.hourConceptIds} onChange={(hourConceptIds) => setItem({ ...item, hourConceptIds })} />
    <ValidationRules item={item} setItem={setItem} />
    <FinnegansLinks item={item} setItem={setItem} />
  </div>;
}

export function SettlementConfigPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(settlementConfigMockService.getEmptyFilters());
  const [editing, setEditing] = useState<SettlementConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  void refresh;
  const all = settlementConfigMockService.getAll();
  const items = settlementConfigMockService.getFiltered(filters);
  const options = settlementConfigMockService.getFilterOptions();
  const summary = useMemo(() => [
    ["Configuraciones", all.length],
    ["Activas", all.filter((item) => item.status === "ACTIVO").length],
    ["Exportables", all.filter((item) => item.exportsToFinnegans).length],
    ["Con cierre asistencia", all.filter((item) => item.closesAttendance).length],
  ], [all]);
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.description.trim()) return setNotice("Completa nombre y descripcion.");
    const exists = Boolean(settlementConfigMockService.getById(editing.id));
    const saved = exists ? settlementConfigMockService.update(editing.id, editing, user!) : settlementConfigMockService.create(editing, user!);
    setEditing(saved || null);
    setRefresh((value) => value + 1);
    setNotice("Configuracion de liquidacion guardada correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">CONFIGURACION</p><h1>Liquidacion</h1><p>Reglas maestras para preliquidar, cerrar y exportar conceptos a Finnegans.</p></div><button className="button primary" onClick={() => setEditing(emptyConfig(settlementConfigMockService.getNextCode()))}><Plus size={17} /> Crear configuracion</button></div>
    {notice && <div className="toast">{notice}</div>}
    <div className="stat-grid novelty-type-summary">{summary.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Liquidacion</span></div></div>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>Configuraciones de liquidacion</h3><p>{items.length} resultados segun filtros aplicados.</p></div></div><div className="panel-body"><div className="filters catalog-filters"><label className="search-field"><input placeholder="Buscar por codigo, nombre o Finnegans" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Periodicidad<select value={filters.periodicity} onChange={(event) => setFilters({ ...filters, periodicity: event.target.value })}><option value="">Todas</option>{options.periodicities.map((periodicity) => <option key={periodicity}>{periodicity}</option>)}</select></label><label>Finnegans<select value={filters.exportsToFinnegans} onChange={(event) => setFilters({ ...filters, exportsToFinnegans: event.target.value })}><option value="">Todos</option><option value="true">Exporta</option><option value="false">No exporta</option></select></label><label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><table><thead><tr><th>Codigo</th><th>Configuracion</th><th>Tipo</th><th>Impactos</th><th>Finnegans</th><th>Estado</th><th>Accion</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.description}</span></td><td>{item.kind} · {item.periodicity}</td><td>{item.includesNovelties ? "Novedades" : ""}{item.includesNovelties && item.includesHourConcepts ? " + " : ""}{item.includesHourConcepts ? "Horas" : ""}</td><td>{item.finnegansLinks.map((link) => link.code).join(", ") || "-"}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => setEditing(item)}>Editar</button></td></tr>)}</tbody></table></div></section>
    {editing && <section className="panel"><div className="panel-head"><div><h3>{editing.name || "Nueva configuracion"}</h3><p>Definicion funcional, impactos, validaciones y exportacion.</p></div><div className="hero-actions"><button className="button subtle" onClick={() => setEditing(null)}>Cerrar</button><button className="button primary" onClick={save}>Guardar configuracion</button></div></div><div className="panel-body"><ConfigEditor item={editing} setItem={setEditing} /></div></section>}
  </>;
}
