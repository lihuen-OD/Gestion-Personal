import { Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { OverflowCell } from "../components/ui/OverflowCell";
import { TableShell } from "../components/ui/TableShell";
import { useAuth } from "../context/AuthContext";
import { auditParameterApiService } from "../services/api/auditParameterApiService";
import type { Role } from "../types";
import type { AuditEventScope, AuditEventSeverity, AuditParameter, AuditRetentionUnit } from "../types/auditParameter.types";
import { roleLevel } from "../utils/roles";

const roles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const scopes: AuditEventScope[] = ["LEGAJO", "NOVEDAD", "HORAS", "LIQUIDACION", "DOCUMENTACION", "PUESTOS", "CONFIGURACION", "ORGANIGRAMA", "USUARIOS"];
const severities: AuditEventSeverity[] = ["INFO", "ADVERTENCIA", "CRITICO"];
const retentionUnits: AuditRetentionUnit[] = ["DIAS", "MESES", "ANIOS"];

function toggleValue<T extends string>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

function emptyParameter(code: string): AuditParameter {
  return { id: crypto.randomUUID(), code, name: "", scope: "LEGAJO", severity: "INFO", status: "ACTIVO", description: "", trackCreate: true, trackUpdate: true, trackDeleteOrDeactivate: false, trackApproval: false, trackExport: false, requiresReason: false, requiresEffectiveDate: false, visibleToRoles: ["Nivel 1 - RRHH"], notification: { enabled: false, rolesToNotify: ["Nivel 1 - RRHH"], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false }, retention: { amount: 5, unit: "ANIOS", lockAfterClose: false, allowExport: true }, createdAt: "", updatedAt: "", createdBy: "", updatedBy: "", history: [] };
}

function nextAuditCode(items: AuditParameter[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `AUD-${String(max + 1).padStart(3, "0")}`;
}

function BoolCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="catalog-rule-card"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b><small>{checked ? "Activo" : "Inactivo"}</small></span></label>;
}

function RoleChecks({ label, value, onChange }: { label: string; value: Role[]; onChange: (value: Role[]) => void }) {
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{roles.map((role) => <label className="check-card" key={role}><input type="checkbox" checked={value.includes(role)} onChange={() => onChange(toggleValue(value, role))} />{role}</label>)}</div></div>;
}

function ParameterEditor({ item, setItem }: { item: AuditParameter; setItem: (item: AuditParameter) => void }) {
  const setNotification = (patch: Partial<AuditParameter["notification"]>) => setItem({ ...item, notification: { ...item.notification, ...patch } });
  const setRetention = (patch: Partial<AuditParameter["retention"]>) => setItem({ ...item, retention: { ...item.retention, ...patch } });
  return <div className="audit-parameter-editor">
    <div className="form-grid">
      <label>Codigo<input value={item.code} disabled /></label>
      <label>Nombre *<input value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
      <label>Modulo<select value={item.scope} onChange={(event) => setItem({ ...item, scope: event.target.value as AuditEventScope })}>{scopes.map((scope) => <option key={scope}>{scope}</option>)}</select></label>
      <label>Severidad<select value={item.severity} onChange={(event) => setItem({ ...item, severity: event.target.value as AuditEventSeverity })}>{severities.map((severity) => <option key={severity}>{severity}</option>)}</select></label>
      <label>Estado<select value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as "ACTIVO" | "INACTIVO" })}><option>ACTIVO</option><option>INACTIVO</option></select></label>
      <label>Retencion<input type="number" value={item.retention.amount} onChange={(event) => setRetention({ amount: Number(event.target.value) })} /></label>
      <label>Unidad retencion<select value={item.retention.unit} onChange={(event) => setRetention({ unit: event.target.value as AuditRetentionUnit })}>{retentionUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
      <div className="form-wide"><label>Descripcion *<textarea value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} /></label></div>
      <div className="form-wide"><label>Notas internas<textarea value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label></div>
    </div>
    <div className="catalog-rules"><div className="catalog-rule-grid"><BoolCheck label="Audita alta" checked={item.trackCreate} onChange={(value) => setItem({ ...item, trackCreate: value })} /><BoolCheck label="Audita modificacion" checked={item.trackUpdate} onChange={(value) => setItem({ ...item, trackUpdate: value })} /><BoolCheck label="Audita baja/inactivacion" checked={item.trackDeleteOrDeactivate} onChange={(value) => setItem({ ...item, trackDeleteOrDeactivate: value })} /><BoolCheck label="Audita aprobacion" checked={item.trackApproval} onChange={(value) => setItem({ ...item, trackApproval: value })} /><BoolCheck label="Audita exportacion" checked={item.trackExport} onChange={(value) => setItem({ ...item, trackExport: value })} /><BoolCheck label="Requiere motivo" checked={item.requiresReason} onChange={(value) => setItem({ ...item, requiresReason: value })} /><BoolCheck label="Requiere fecha desde" checked={item.requiresEffectiveDate} onChange={(value) => setItem({ ...item, requiresEffectiveDate: value })} /><BoolCheck label="Bloquea tras cierre" checked={item.retention.lockAfterClose} onChange={(value) => setRetention({ lockAfterClose: value })} /><BoolCheck label="Permite exportar auditoria" checked={item.retention.allowExport} onChange={(value) => setRetention({ allowExport: value })} /></div></div>
    <RoleChecks label="Visible para roles" value={item.visibleToRoles} onChange={(visibleToRoles) => setItem({ ...item, visibleToRoles })} />
    <div className="catalog-rules"><div className="panel-head compact"><div><h3>Notificaciones</h3><p>Alertas internas para eventos auditados.</p></div></div><div className="catalog-rule-grid"><BoolCheck label="Notificaciones activas" checked={item.notification.enabled} onChange={(value) => setNotification({ enabled: value })} /><BoolCheck label="Notificar altas" checked={item.notification.notifyOnCreate} onChange={(value) => setNotification({ notifyOnCreate: value })} /><BoolCheck label="Notificar modificaciones" checked={item.notification.notifyOnUpdate} onChange={(value) => setNotification({ notifyOnUpdate: value })} /><BoolCheck label="Notificar bajas/inactivaciones" checked={item.notification.notifyOnDeleteOrDeactivate} onChange={(value) => setNotification({ notifyOnDeleteOrDeactivate: value })} /><BoolCheck label="Notificar exportaciones" checked={item.notification.notifyOnExport} onChange={(value) => setNotification({ notifyOnExport: value })} /></div></div>
    <RoleChecks label="Roles a notificar" value={item.notification.rolesToNotify} onChange={(rolesToNotify) => setNotification({ rolesToNotify })} />
  </div>;
}

export function AuditParametersPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ search: "", scope: "", severity: "", requiresReason: "", status: "" });
  const [apiItems, setApiItems] = useState<AuditParameter[] | null>(null);
  const [usesBackend, setUsesBackend] = useState(false);
  const [editing, setEditing] = useState<AuditParameter | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let mounted = true;
    auditParameterApiService.getAll()
      .then((items) => {
        if (!mounted) return;
        setApiItems(items);
        setUsesBackend(true);
      })
      .catch(() => {
        if (!mounted) return;
        setApiItems(null);
        setUsesBackend(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  const all = apiItems ?? [];
  const filterText = filters.search.trim().toLowerCase();
  const items = all.filter((item) => {
    const text = `${item.code} ${item.name} ${item.description} ${item.scope} ${item.severity}`.toLowerCase();
    if (filterText && !text.includes(filterText)) return false;
    if (filters.scope && item.scope !== filters.scope) return false;
    if (filters.severity && item.severity !== filters.severity) return false;
    if (filters.requiresReason && String(item.requiresReason) !== filters.requiresReason) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
  const options = {
    scopes: Array.from(new Set(all.map((item) => item.scope))).sort(),
    severities: Array.from(new Set(all.map((item) => item.severity))).sort(),
    statuses: ["ACTIVO", "INACTIVO"],
  };
  const summary = useMemo(() => [["Parametros", all.length], ["Criticos", all.filter((item) => item.severity === "CRITICO").length], ["Con motivo", all.filter((item) => item.requiresReason).length], ["Notifican", all.filter((item) => item.notification.enabled).length]], [all]);
  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.description.trim()) return setNotice("Completa nombre y descripcion.");
    try {
      const exists = Boolean(apiItems?.some((item) => item.id === editing.id));
      const saved = exists
        ? await auditParameterApiService.update(editing)
        : await auditParameterApiService.create(editing);
      setEditing(saved || null);
      setRefresh((value) => value + 1);
      setNotice("Parametro de auditoria guardado correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No se pudo guardar el parametro de auditoria.");
    }
  };
  return <>
    <div className="page-header"><div><p className="eyebrow">CONFIGURACION</p><h1>Parametros de auditoria</h1><p>Reglas de trazabilidad, notificacion y retencion para todos los modulos conectados.</p></div><button className="button primary" onClick={() => setEditing(emptyParameter(nextAuditCode(all)))}><Plus size={17} /> Crear parametro</button></div>
    {notice && <div className="toast">{notice}</div>}
    <div className="stat-grid novelty-type-summary">{summary.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Auditoria</span></div></div>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>Listado de parametros</h3><p>{items.length} resultados segun filtros aplicados.</p></div></div><div className="panel-body"><div className="filters catalog-filters"><label className="search-field"><input placeholder="Buscar por codigo, nombre o modulo" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label><label>Modulo<select value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })}><option value="">Todos</option>{options.scopes.map((scope) => <option key={scope}>{scope}</option>)}</select></label><label>Severidad<select value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">Todas</option>{options.severities.map((severity) => <option key={severity}>{severity}</option>)}</select></label><label>Motivo<select value={filters.requiresReason} onChange={(event) => setFilters({ ...filters, requiresReason: event.target.value })}><option value="">Todos</option><option value="true">Requiere</option><option value="false">No requiere</option></select></label><label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label></div><TableShell minWidth={1040}><table><thead><tr><th>Codigo</th><th>Parametro</th><th>Modulo</th><th>Eventos</th><th>Retencion</th><th>Estado</th><th>Accion</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.description}</span></td><td><OverflowCell value={`${item.scope} · ${item.severity}`} /></td><td><OverflowCell value={[item.trackCreate && "Alta", item.trackUpdate && "Edicion", item.trackApproval && "Aprobacion", item.trackExport && "Exportacion"].filter(Boolean).join(", ")} /></td><td>{item.retention.amount} {item.retention.unit}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link table-icon-action" title="Editar" aria-label="Editar" onClick={() => setEditing(item)}><Pencil size={14}/><span>Editar</span></button></td></tr>)}</tbody></table></TableShell></div></section>
    {editing && <section className="panel"><div className="panel-head"><div><h3>{editing.name || "Nuevo parametro"}</h3><p>Eventos auditados, retencion, motivo obligatorio y notificaciones.</p></div><div className="hero-actions"><button className="button subtle" onClick={() => setEditing(null)}>Cerrar</button><button className="button primary" onClick={save}>Guardar parametro</button></div></div><div className="panel-body"><ParameterEditor item={editing} setItem={setEditing} /></div></section>}
  </>;
}
