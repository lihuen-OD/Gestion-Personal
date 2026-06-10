import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { documentCategoryMockService } from "../services/documentCategoryMockService";
import type { Role } from "../types";
import type { DocumentCategory, DocumentCategoryKind, DocumentCategoryScope, ExternalDocumentLink } from "../types/documentCategory.types";

const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const kinds: DocumentCategoryKind[] = ["PERSONAL", "LABORAL", "MEDICA", "LIQUIDACION", "TRANSPORTE", "CAPACITACION", "LEGAL", "NOVEDAD", "OTRO"];
const scopes: DocumentCategoryScope[] = ["LEGAJO", "NOVEDAD", "LIQUIDACION", "TRANSPORTE", "ALTA_BAJA", "PUESTO"];

function roleLevel(role: string) { return role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3; }
function toggleValue<T extends string>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function emptyCategory(code: string): DocumentCategory {
  return { id: crypto.randomUUID(), code, name: "", kind: "PERSONAL", status: "ACTIVO", description: "", scopes: ["LEGAJO"], rules: { expires: false, alertBeforeDays: 0, mandatory: false, requiresApproval: false, allowMultipleFiles: true }, uploadRoles: ["Nivel 1 - RRHH"], viewRoles: ["Nivel 1 - RRHH"], approvalRoles: ["Nivel 1 - RRHH"], externalLinks: [], createdAt: "", updatedAt: "", createdBy: "", updatedBy: "", history: [] };
}

function BoolCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="catalog-rule-card"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b><small>{checked ? "Activo" : "Inactivo"}</small></span></label>;
}

function CheckList<T extends string>({ label, options, value, onChange }: { label: string; options: T[]; value: T[]; onChange: (value: T[]) => void }) {
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{options.map((option) => <label className="check-card" key={option}><input type="checkbox" checked={value.includes(option)} onChange={() => onChange(toggleValue(value, option))} />{option}</label>)}</div></div>;
}

function ExternalLinks({ item, setItem }: { item: DocumentCategory; setItem: (item: DocumentCategory) => void }) {
  const update = (id: string, patch: Partial<ExternalDocumentLink>) => setItem({ ...item, externalLinks: item.externalLinks.map((link) => link.id === id ? { ...link, ...patch } : link) });
  return <div className="catalog-finnegans"><div className="panel-head compact"><div><h3>Vinculos externos</h3><p>Codigos o carpetas externas para integraciones futuras.</p></div><button type="button" className="button subtle" onClick={() => setItem(documentCategoryMockService.addExternalLink(item))}>Agregar vinculo</button></div><div className="catalog-link-list">{item.externalLinks.map((link) => <div className="catalog-link-row" key={link.id}><label>Proveedor<select value={link.provider} onChange={(event) => update(link.id, { provider: event.target.value as ExternalDocumentLink["provider"] })}><option>FINNEGANS</option><option>CARPETA_RED</option><option>OTRO</option></select></label><label>Codigo<input value={link.code} onChange={(event) => update(link.id, { code: event.target.value })} /></label><label>Nombre<input value={link.name} onChange={(event) => update(link.id, { name: event.target.value })} /></label><label>Estado<select value={link.status} onChange={(event) => update(link.id, { status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label><label>Notas<input value={link.notes || ""} onChange={(event) => update(link.id, { notes: event.target.value })} /></label><button className="icon-button danger-link" type="button" onClick={() => setItem(documentCategoryMockService.removeExternalLink(item, link.id))}>x</button></div>)}</div></div>;
}

function CategoryEditor({ item, setItem }: { item: DocumentCategory; setItem: (item: DocumentCategory) => void }) {
  const setRule = (patch: Partial<DocumentCategory["rules"]>) => setItem({ ...item, rules: { ...item.rules, ...patch } });
  return <div className="document-category-editor">
    <div className="form-grid">
      <label>Codigo<input value={item.code} disabled /></label>
      <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
      <label>Tipo<select value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as DocumentCategoryKind })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
      <label>Dias alerta vencimiento<input type="number" value={item.rules.alertBeforeDays} onChange={(event) => setRule({ alertBeforeDays: Number(event.target.value) })} /></label>
      <label>Vigencia default dias<input type="number" value={item.rules.defaultValidityDays || ""} onChange={(event) => setRule({ defaultValidityDays: event.target.value ? Number(event.target.value) : undefined })} /></label>
      <div className="form-wide"><label>Descripcion *<textarea value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} /></label></div>
      <div className="form-wide"><label>Notas internas<textarea value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label></div>
    </div>
    <CheckList label="Aplica en modulos" options={scopes} value={item.scopes} onChange={(value) => setItem({ ...item, scopes: value })} />
    <div className="catalog-rules"><div className="catalog-rule-grid"><BoolCheck label="Documento obligatorio" checked={item.rules.mandatory} onChange={(value) => setRule({ mandatory: value })} /><BoolCheck label="Tiene vencimiento" checked={item.rules.expires} onChange={(value) => setRule({ expires: value })} /><BoolCheck label="Requiere aprobacion" checked={item.rules.requiresApproval} onChange={(value) => setRule({ requiresApproval: value })} /><BoolCheck label="Permite multiples archivos" checked={item.rules.allowMultipleFiles} onChange={(value) => setRule({ allowMultipleFiles: value })} /></div></div>
    <CheckList label="Roles que pueden cargar" options={roles} value={item.uploadRoles} onChange={(value) => setItem({ ...item, uploadRoles: value })} />
    <CheckList label="Roles que pueden ver" options={roles} value={item.viewRoles} onChange={(value) => setItem({ ...item, viewRoles: value })} />
    <CheckList label="Roles que pueden aprobar" options={roles} value={item.approvalRoles} onChange={(value) => setItem({ ...item, approvalRoles: value })} />
    <ExternalLinks item={item} setItem={setItem} />
  </div>;
}

export function DocumentCategoriesPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(documentCategoryMockService.getEmptyFilters());
  const [editing, setEditing] = useState<DocumentCategory | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  void refresh;
  const all = documentCategoryMockService.getAll();
  const items = documentCategoryMockService.getFiltered(filters);
  const options = documentCategoryMockService.getFilterOptions();
  const summary = useMemo(() => [["Categorias", all.length], ["Obligatorias", all.filter((item) => item.rules.mandatory).length], ["Con vencimiento", all.filter((item) => item.rules.expires).length], ["Con aprobacion", all.filter((item) => item.rules.requiresApproval).length]], [all]);
  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.description.trim()) return setNotice("Completa nombre y descripcion.");
    const exists = Boolean(documentCategoryMockService.getById(editing.id));
    const saved = exists ? documentCategoryMockService.update(editing.id, editing, user!) : documentCategoryMockService.create(editing, user!);
    setEditing(saved || null);
    setRefresh((value) => value + 1);
    setNotice("Categoria documental guardada correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">CONFIGURACION</p><h1>Categorias documentales</h1><p>Catalogo documental conectado a legajos, novedades, liquidacion, alertas e historial.</p></div><button className="button primary" onClick={() => setEditing(emptyCategory(documentCategoryMockService.getNextCode()))}><Plus size={17} /> Crear categoria</button></div>
    {notice && <div className="toast">{notice}</div>}
    <div className="stat-grid novelty-type-summary">{summary.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Documentacion</span></div></div>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>Listado de categorias</h3><p>{items.length} resultados segun filtros aplicados.</p></div></div><div className="panel-body"><div className="filters catalog-filters"><label className="search-field"><input placeholder="Buscar por codigo, nombre o vinculo externo" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label>Tipo<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>Modulo<select value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })}><option value="">Todos</option>{options.scopes.map((scope) => <option key={scope}>{scope}</option>)}</select></label><label>Obligatoria<select value={filters.mandatory} onChange={(event) => setFilters({ ...filters, mandatory: event.target.value })}><option value="">Todas</option><option value="true">Si</option><option value="false">No</option></select></label><label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><table><thead><tr><th>Codigo</th><th>Categoria</th><th>Tipo</th><th>Modulos</th><th>Reglas</th><th>Estado</th><th>Accion</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.description}</span></td><td>{item.kind}</td><td>{item.scopes.join(", ")}</td><td>{item.rules.mandatory ? "Obligatoria" : "Opcional"} · {item.rules.expires ? `Vence / alerta ${item.rules.alertBeforeDays}d` : "Sin vencimiento"}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => setEditing(item)}>Editar</button></td></tr>)}</tbody></table></div></section>
    {editing && <section className="panel"><div className="panel-head"><div><h3>{editing.name || "Nueva categoria"}</h3><p>Definicion documental, reglas de vencimiento, permisos y vinculos externos.</p></div><div className="hero-actions"><button className="button subtle" onClick={() => setEditing(null)}>Cerrar</button><button className="button primary" onClick={save}>Guardar categoria</button></div></div><div className="panel-body"><CategoryEditor item={editing} setItem={setEditing} /></div></section>}
  </>;
}
