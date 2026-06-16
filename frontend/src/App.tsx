import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, Archive, BarChart3, Bell, Building2, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, Clock3, Eye, FileBarChart, FileText, FolderOpen, Plus, RefreshCcw, Search, ShieldCheck, SlidersHorizontal, Users, X } from "lucide-react";
import { useAuth } from "./context/AuthContext";
import { auditMockService } from "./services/auditMockService";
import { documentMockService } from "./services/documentMockService";
import { documentCategoryMockService } from "./services/documentCategoryMockService";
import { dashboardMetricsMockService } from "./services/dashboardMetricsMockService";
import { employeeMockService } from "./services/employeeMockService";
import { employeeChangeLogService } from "./services/employeeChangeLogService";
import { employeeBlockHistoryMockService } from "./services/employeeBlockHistoryMockService";
import { employeeFieldHistoryMockService } from "./services/employeeFieldHistoryMockService";
import { calculateEmployeeStatus, calculateLaborStatus } from "./services/employeeStatusService";
import { laborMovementMockService } from "./services/laborMovementMockService";
import { locationService } from "./services/locationService";
import { noveltyMockService } from "./services/noveltyMockService";
import { noveltyTypeMockService } from "./services/noveltyTypeMockService";
import { orgStructureMockService } from "./services/orgStructureMockService";
import { salaryRangeMockService } from "./services/salaryRangeMockService";
import { hourConceptMockService } from "./services/hourConceptMockService";
import { timeEntryMockService } from "./services/timeEntryMockService";
import { userMockService } from "./services/userMockService";
import { LocationMapPicker } from "./components/LocationMapPicker";
import { GeoAddressFields } from "./components/GeoAddressFields";
import { OverflowCell } from "./components/ui/OverflowCell";
import { TableShell } from "./components/ui/TableShell";
import { OrganigramasPage } from "./pages/OrganigramasPage";
import { PuestoCreatePage } from "./pages/PuestoCreatePage";
import { PuestoDetailPage } from "./pages/PuestoDetailPage";
import { PuestosPage } from "./pages/PuestosPage";
import { NoveltyTypeCreatePage } from "./pages/NoveltyTypeCreatePage";
import { NoveltyTypeDetailPage } from "./pages/NoveltyTypeDetailPage";
import { NoveltyTypesPage } from "./pages/NoveltyTypesPage";
import { OrgStructurePage } from "./pages/OrgStructurePage";
import { HourConceptsPage } from "./pages/HourConceptsPage";
import { FinnegansExportPage } from "./pages/FinnegansExportPage";
import { DocumentCategoriesPage } from "./pages/DocumentCategoriesPage";
import { AuditParametersPage } from "./pages/AuditParametersPage";
import { positionMockService } from "./services/positionMockService";
import type { Employee, EmployeeChangeLog, FieldHistorySection, LaborMovementType, Novelty, Role, TimeEntry, TimeStatus, User } from "./types";
import type { DocumentCategory } from "./types/documentCategory.types";
import { noveltyColorClass } from "./utils/noveltyColor";
import { formatPeriodDay, formatPeriodLabel, getMonthDays, monthDate } from "./utils/period";
import { roleLevel, roleOptions } from "./utils/roles";
import { buildHoursExportWorkbook } from "./utils/hoursExport";
import { displayLegajo, employeeCompanies, fullName } from "./utils/employee";
import { statusClass } from "./utils/status";
import { LoginPage } from "./pages/LoginPage";
import { Alert, DashboardBars, DashboardPage } from "./pages/DashboardPage";
import { AppShell } from "./app/AppShell";
import { PageHeader } from "./components/ui/PageHeader";
import { Section } from "./components/ui/Section";
import { StatCard } from "./components/ui/StatCard";
import { EmptyState } from "./components/ui/EmptyState";

const companies = () => orgStructureMockService.getCompanyNames();
const exitReasons = ["Renuncia", "Despido", "Jubilación", "Fin de contrato", "Fallecimiento", "Otro"];
const tabs = ["Información General", "Contacto y Domicilio", "Datos Laborales", "Responsables / Asignaciones", "Transporte", "Configuración Horaria", "Ausentismo / Novedades", "Gestión Documental", "Historial de Eventos", "Auditoría"];
const tabSections = ["INFORMACION_GENERAL","CONTACTO_DOMICILIO","DATOS_LABORALES","RESPONSABLES","TRANSPORTE","CONFIGURACION_HORARIA","NOVEDADES","DOCUMENTACION"] as const;
const entryReasons = ["Alta inicial", "Reingreso", "Transferencia desde otra empresa", "Contratacion eventual", "Otro"];
const Empty = EmptyState;

export function App() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  const level = roleLevel(user.role);
  return <AppShell><Routes>
    <Route path="/" element={level === 3 ? <Navigate to="/horas" /> : <DashboardPage />} />
    <Route path="/legajos" element={<EmployeesPage />} /><Route path="/legajos/nuevo" element={<EmployeeCreatePage />} /><Route path="/legajos/:id" element={<EmployeeDetailPage />} />
    <Route path="/puestos" element={<PuestosPage />} /><Route path="/puestos/nuevo" element={<PuestoCreatePage />} /><Route path="/puestos/:id" element={<PuestoDetailPage />} />
    <Route path="/configuracion/empresas-estructura" element={<OrgStructurePage />} />
    <Route path="/configuracion/conceptos-horarios" element={<HourConceptsPage />} />
    <Route path="/configuracion/liquidacion" element={<FinnegansExportPage />} />
    <Route path="/configuracion/categorias-documentales" element={<DocumentCategoriesPage />} />
    <Route path="/configuracion/parametros-auditoria" element={<AuditParametersPage />} />
    <Route path="/configuracion/tipos-novedades" element={<NoveltyTypesPage />} /><Route path="/configuracion/tipos-novedades/nuevo" element={<NoveltyTypeCreatePage />} /><Route path="/configuracion/tipos-novedades/:id" element={<NoveltyTypeDetailPage />} />
    <Route path="/horas" element={<HoursPage />} /><Route path="/horas/:id" element={<EmployeeHoursPage />} />
    <Route path="/novedades" element={<NoveltiesPage />} /><Route path="/documentacion" element={<DocumentsPage />} /><Route path="/organigramas" element={<OrganigramasPage />} />
    <Route path="/usuarios" element={<UsersPage />} /><Route path="/auditoria" element={<AuditPage />} />
    <Route path="/configuracion" element={<SettingsPage />} /><Route path="/reportes" element={<ReportsPage />} /><Route path="/pendientes" element={<HoursPage pendingOnly />} />
    <Route path="*" element={<Navigate to="/" />} />
  </Routes></AppShell>;
}

function LaborStatusCard({employee}:{employee:Employee}) {
  const status = calculateLaborStatus(employee.laborMovements || []);
  const movement = status.currentMovement;
  return <div className="labor-status-card"><div><p className="eyebrow">ESTADO LABORAL</p><h3><span className={statusClass(status.status)}>{status.status}</span></h3><p>{status.message}</p><p>El estado laboral se calcula automáticamente según los movimientos de Alta / Baja laboral.</p></div><div><small>Último movimiento vigente</small><b>{movement ? `${movement.type} · ${movement.reason}` : "Sin movimiento"}</b></div><div><small>Fecha desde</small><b>{movement?.effectiveFrom || status.scheduledTermination?.effectiveFrom || "Sin cargar"}</b></div></div>;
}

function SectionChangeHistory({employeeId,section,title,maxItems=5}:{employeeId:string;section:typeof tabSections[number];title:string;maxItems?:number}) {
  const contactFields = new Set(["phone","mobile","email","emergencyContact","emergencyRelation","emergencyPhone"]);
  const rows = employeeChangeLogService.getByEmployeeAndSection(employeeId, section).filter(row=>section!=="CONTACTO_DOMICILIO"||contactFields.has(row.field)).slice(0,maxItems);
  return <Section title={title} subtitle="Cambios detectados al guardar la ficha"><div className="section-history">{rows.length ? <TableShell minWidth={980}><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Campo</th><th>Valor anterior</th><th>Valor nuevo</th><th>Motivo</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{new Date(row.createdAt).toLocaleString("es-AR")}</td><td>{row.userName}</td><td><OverflowCell value={row.fieldLabel} /></td><td><OverflowCell value={row.oldValue} /></td><td><OverflowCell value={row.newValue} /></td><td><OverflowCell value={row.reason || "-"} /></td></tr>)}</tbody></table></TableShell> : <Empty text="Todavía no hay cambios registrados en esta sección."/>}</div></Section>;
}

type LaborHistoryTab = NonNullable<EmployeeChangeLog["category"]>;

const laborHistoryTabs: { id: LaborHistoryTab; label: string; empty: string }[] = [
  { id: "ALTA", label: "Altas", empty: "Todavía no hay eventos de alta registrados." },
  { id: "BAJA", label: "Bajas", empty: "Todavía no hay eventos de baja registrados." },
  { id: "CAMBIO_LABORAL", label: "Cambios laborales", empty: "Todavía no hay cambios laborales registrados." },
];

function laborHistoryCategory(row: EmployeeChangeLog): LaborHistoryTab {
  return row.category || "CAMBIO_LABORAL";
}

function LaborHistory({employeeId}:{employeeId:string}) {
  const [active,setActive]=useState<LaborHistoryTab>("ALTA");
  const rows=employeeChangeLogService.getByEmployeeAndSection(employeeId,"DATOS_LABORALES");
  const visible=rows.filter(row=>laborHistoryCategory(row)===active);
  const selected=laborHistoryTabs.find(tab=>tab.id===active)!;
  const totals=laborHistoryTabs.reduce<Record<LaborHistoryTab,number>>((acc,tab)=>({...acc,[tab.id]:rows.filter(row=>laborHistoryCategory(row)===tab.id).length}),{ALTA:0,BAJA:0,CAMBIO_LABORAL:0});
  return <Section title="Historial laboral" subtitle="Altas, bajas y modificaciones laborales registradas desde el historial de cambios"><div className="labor-history">
    <div className="labor-history-tabs">{laborHistoryTabs.map(tab=><button key={tab.id} className={active===tab.id?"active":""} onClick={()=>setActive(tab.id)}><span>{tab.label}</span><b>{totals[tab.id]}</b></button>)}</div>
    {visible.length ? <div className="labor-history-list">{visible.map(row=><article className="labor-history-item" key={row.id}>
      <div><span className={`history-badge ${laborHistoryCategory(row).toLowerCase()}`}>{selected.label}</span><b>{row.description || row.action}</b><small>{new Date(row.createdAt).toLocaleString("es-AR")} · {row.userName}</small></div>
      <dl><div><dt>Campo</dt><dd>{row.fieldLabel}</dd></div><div><dt>Valor anterior</dt><dd>{row.oldValue}</dd></div><div><dt>Valor nuevo</dt><dd>{row.newValue}</dd></div></dl>
    </article>)}</div> : <Empty text={selected.empty}/>}
  </div></Section>;
}

type FieldWithHistoryProps = { employee: Employee; section: FieldHistorySection; field: string; label: string; value: string; effectiveFrom?: string; canEdit: boolean; user: User; options?: string[]; onSaved: (employee: Employee) => void };

function setValueByPath(employee: Employee, path: string, value: string): Employee {
  if (!path.includes(".")) return { ...employee, [path]: value } as Employee;
  const [root,key]=path.split(".");
  return { ...employee, [root]: { ...(employee as unknown as Record<string, Record<string, unknown>>)[root], [key]: value } } as Employee;
}

function FieldWithHistory({employee,section,field,label,value,effectiveFrom,canEdit,user,options,onSaved}:FieldWithHistoryProps) {
  const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[next,setNext]=useState(value),[from,setFrom]=useState(effectiveFrom || new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const history=employeeFieldHistoryMockService.getByField(employee.id,section,field);
  const currentFrom=employeeFieldHistoryMockService.getCurrentEffectiveFrom(employee.id,section,field) || effectiveFrom || employee.startDate || "Sin cargar";
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated=setValueByPath(employee,field,next);employeeFieldHistoryMockService.create({employeeId:employee.id,section,field,fieldLabel:label,oldValue:value || null,newValue:next,effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);const saved=employeeMockService.update(updated,user);onSaved(saved);setEditing(false);setOpen(true);setError("");};
  return <div className="tracked-field"><div className="tracked-main" onClick={()=>setOpen(!open)}><small>{label}</small><b>{value || "Sin cargar"}</b><span>Desde: {currentFrom}</span></div><div className="tracked-actions"><button type="button" className="button subtle" onClick={()=>setOpen(!open)}>Historial</button>{canEdit&&<button type="button" className="button subtle" onClick={()=>{setEditing(true);setOpen(true);setNext(value)}}>Modificar</button>}</div>{open&&<div className="tracked-history"><h4>Historial de {label}</h4>{history.length?<div className="timeline">{history.map(item=><div key={item.id}><i/><b>{item.effectiveFrom} | {item.newValue}</b><span>{item.createdByUserName}</span><p>Anterior: {item.oldValue || "-"} · Motivo: {item.reason} · Registro: {new Date(item.createdAt).toLocaleString("es-AR")}</p></div>)}</div>:<Empty text="No hay historial registrado para este campo."/>}{editing&&<div className="tracked-edit">{options?<Select label="Nuevo valor" value={next} set={setNext} options={options}/>:<Field label="Nuevo valor" value={next} set={setNext}/>}<Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button type="button" className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button type="button" className="button primary" onClick={save}>Guardar modificación</button></div></div>}</div>}</div>;
}

function MultiCompanyField({employee,canEdit,user,onSaved}:{employee:Employee;canEdit:boolean;user:User;onSaved:(employee:Employee)=>void}) {
  const value=employee.companies?.length?employee.companies:[employee.company].filter(Boolean);
  const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[selected,setSelected]=useState<string[]>(value),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const history=employeeFieldHistoryMockService.getByField(employee.id,"DATOS_LABORALES","companies");
  const label=value.join(", ") || "Sin cargar";
  const toggle=(company:string)=>setSelected(current=>current.includes(company)?current.filter(item=>item!==company):[...current,company]);
  const save=()=>{if(!selected.length)return setError("Seleccioná al menos una empresa.");if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated={...employee,companies:selected,company:selected.includes(employee.company)?employee.company:selected[0]};employeeFieldHistoryMockService.create({employeeId:employee.id,section:"DATOS_LABORALES",field:"companies",fieldLabel:"Empresa",oldValue:label||null,newValue:selected.join(", "),effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setOpen(true);setError("");};
  return <div className="tracked-field"><div className="tracked-main" onClick={()=>setOpen(!open)}><small>Empresa</small><b>{label}</b><span>Puede pertenecer a una o varias empresas</span></div><div className="tracked-actions"><button type="button" className="button subtle" onClick={()=>setOpen(!open)}>Historial</button>{canEdit&&<button type="button" className="button subtle" onClick={()=>{setEditing(true);setOpen(true);setSelected(value)}}>Modificar</button>}</div>{open&&<div className="tracked-history"><h4>Historial de Empresa</h4>{history.length?<div className="timeline">{history.map(item=><div key={item.id}><i/><b>{item.effectiveFrom} | {item.newValue}</b><span>{item.createdByUserName}</span><p>Anterior: {item.oldValue || "-"} · Motivo: {item.reason} · Registro: {new Date(item.createdAt).toLocaleString("es-AR")}</p></div>)}</div>:<Empty text="No hay historial registrado para este campo."/>}{editing&&<div className="tracked-edit"><div className="check-grid inline">{companies().map(company=><label className="check-card" key={company}><input type="checkbox" checked={selected.includes(company)} onChange={()=>toggle(company)}/>{company}</label>)}</div><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button type="button" className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button type="button" className="button primary" onClick={save}>Guardar modificación</button></div></div>}</div>}</div>;
}

function CompanyMultiCreateField({value,setValue}:{value:Employee;setValue:(employee:Employee)=>void}) {
  const selected=value.companies?.length?value.companies:[value.company].filter(Boolean);
  const toggle=(company:string)=>{const next=selected.includes(company)?selected.filter(item=>item!==company):[...selected,company];setValue({...value,companies:next,company:next[0] || ""});};
  return <div className="form-wide"><small>Empresa *</small><div className="check-grid inline">{companies().map(company=><label className="check-card" key={company}><input type="checkbox" checked={selected.includes(company)} onChange={()=>toggle(company)}/>{company}</label>)}</div><p className="info-note compact">Podés seleccionar más de una empresa para directivos y gerentes. La primera seleccionada queda como referencia principal del legajo.</p></div>;
}

function employeeSearchLabel(employee: Employee) {
  return `${employee.lastName}, ${employee.firstName} · Legajo ${displayLegajo(employee)} · DNI ${employee.dni} · CUIL ${employee.cuil}`;
}

function assignmentPersonName(employee: Employee) {
  return `${employee.firstName} ${employee.lastName}`;
}

function normalizePeopleSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function PeopleMultiSearch({ label, selected, onChange, excludeId }: { label: string; selected: string[]; onChange: (values: string[]) => void; excludeId?: string }) {
  const [query,setQuery]=useState("");
  const normalized=normalizePeopleSearch(query.trim());
  const cleanSelected=selected.filter(Boolean);
  const selectedSet=new Set(cleanSelected);
  const options=employeeMockService.getAll().filter(employee=>employee.id!==excludeId).filter(employee=>!selectedSet.has(assignmentPersonName(employee))).filter(employee=>{
    const text=normalizePeopleSearch(`${employee.firstName} ${employee.lastName} ${employee.lastName} ${employee.firstName} ${displayLegajo(employee)} ${employee.legajoFinnegans || ""} ${employee.dni} ${employee.cuil}`);
    return normalized.length>=1 && text.includes(normalized);
  }).slice(0,8);
  const add=(name:string)=>{if(!selectedSet.has(name))onChange([...cleanSelected,name]);setQuery("");};
  const remove=(name:string)=>onChange(cleanSelected.filter(item=>item!==name));
  return <div className="people-search form-wide"><small>{label}</small><div className="search-field"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar por nombre, apellido, DNI, CUIL o legajo"/></div>{query.trim().length>0&&<div className="people-search-results">{options.length?options.map(employee=><button type="button" key={employee.id} onClick={()=>add(assignmentPersonName(employee))}><b>{assignmentPersonName(employee)}</b><small>{employeeSearchLabel(employee)}</small></button>):<span>No encontramos personas con esa busqueda.</span>}</div>}<div className="selected-people">{cleanSelected.length?cleanSelected.map(name=><span key={name}>{name}<button type="button" onClick={()=>remove(name)}>x</button></span>):<em>Sin personas seleccionadas.</em>}</div></div>;
}

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b,"es"));
}

function selectedEmployeePosition(employee: Employee) {
  const positions=positionMockService.getAll();
  return positions.find(position=>position.id===employee.positionId)||positions.find(position=>position.name===(employee.puestoNombre||employee.position));
}

function positionAllowedValues(position: ReturnType<typeof selectedEmployeePosition>, field: "businessUnit"|"establishment"|"sector") {
  if(!position)return [];
  if(field==="businessUnit")return position.businessUnitNames?.length?position.businessUnitNames:[position.businessUnitName].filter(Boolean) as string[];
  if(field==="establishment")return position.establishmentNames?.length?position.establishmentNames:[position.establishmentName].filter(Boolean) as string[];
  return position.sectorNames?.length?position.sectorNames:[position.sector].filter(Boolean) as string[];
}

function laborSelectOptions(field:"businessUnit"|"establishment"|"sector"|"internalCategory"|"receiptCategory", current="") {
  const positions=positionMockService.getAll();
  const employees=employeeMockService.getAll();
  const structure=orgStructureMockService.getOptions();
  if(field==="businessUnit")return uniqueOptions([current,...structure.businessUnits,...positions.flatMap(position=>position.businessUnitNames?.length?position.businessUnitNames:[position.businessUnitName||""]),...employees.map(employee=>employee.businessUnit)]);
  if(field==="establishment")return uniqueOptions([current,...structure.establishments,...positions.flatMap(position=>position.establishmentNames?.length?position.establishmentNames:[position.establishmentName||""]),...employees.map(employee=>employee.establishment)]);
  if(field==="sector")return uniqueOptions([current,...structure.sectors,...positions.flatMap(position=>position.sectorNames?.length?position.sectorNames:[position.sector||""]),...employees.map(employee=>employee.sector)]);
  if(field==="receiptCategory")return uniqueOptions([current,...employees.map(employee=>employee.receiptCategory),...salaryRangeMockService.getOrderedCategories().map(category=>category.replace(/\s+[A-I]$/,""))]);
  return uniqueOptions([current,...salaryRangeMockService.getOrderedCategories(),...employees.map(employee=>employee.internalCategory)]);
}

function structureSelectOptions(field:"company"|"costCenter"|"area", current="") {
  const structure=orgStructureMockService.getOptions();
  if(field==="company")return uniqueOptions([current,...structure.companies]);
  if(field==="costCenter")return uniqueOptions([current,...structure.costCenters,...employeeMockService.getAll().map(employee=>employee.costCenter)]);
  return uniqueOptions([current,...structure.areas]);
}

function userRoleOptions(current="") {
  return uniqueOptions([current, ...roleOptions, ...userMockService.getAll().map((user) => user.role)]);
}

function EmployeePositionCreateField({value,setValue}:{value:Employee;setValue:(employee:Employee)=>void}) {
  const positions=positionMockService.getAll().filter(position=>position.status==="ACTIVO");
  const selected=positions.find(position=>position.id===value.positionId);
  const select=(id:string)=>{const position=positions.find(item=>item.id===id);setValue(position?{...value,positionId:position.id,puestoId:position.id,puestoNombre:position.name,position:position.name}:{...value,positionId:"",puestoId:"",puestoNombre:"",position:""});};
  return <div className="form-wide position-selector-card"><label>Puesto<select value={selected?.id||""} onChange={event=>select(event.target.value)}><option value="">Seleccionar puesto existente</option>{positions.map(position=><option key={position.id} value={position.id}>{position.name}</option>)}</select></label></div>;
}

function EmployeePositionField({employee,canEdit,user,onSaved}:{employee:Employee;canEdit:boolean;user:User;onSaved:(employee:Employee)=>void}) {
  const positions=positionMockService.getAll().filter(position=>position.status==="ACTIVO");
  const current=positions.find(position=>position.id===employee.positionId)||positions.find(position=>position.name===(employee.puestoNombre||employee.position));
  const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[selectedId,setSelectedId]=useState(current?.id||""),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const history=employeeFieldHistoryMockService.getByField(employee.id,"DATOS_LABORALES","positionId");
  const selected=positions.find(position=>position.id===selectedId);
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated=selected?{...employee,positionId:selected.id,puestoId:selected.id,puestoNombre:selected.name,position:selected.name}:{...employee,positionId:"",puestoId:"",puestoNombre:"",position:""};employeeFieldHistoryMockService.create({employeeId:employee.id,section:"DATOS_LABORALES",field:"positionId",fieldLabel:"Puesto",oldValue:employee.puestoNombre||employee.position||null,newValue:selected?.name||"Sin puesto vinculado",effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setOpen(true);setError("");};
  return <div className="tracked-field position-field-card"><div className="tracked-main" onClick={()=>setOpen(!open)}><small>Puesto</small><b>{current?.name||employee.puestoNombre||employee.position||"Sin cargar"}</b><span>{current?`${current.areaDepartment} · ${current.sector}`:"Texto anterior sin vinculo"}</span></div><div className="tracked-actions"><button type="button" className="button subtle" onClick={()=>setOpen(!open)}>Historial</button>{canEdit&&<button type="button" className="button subtle" onClick={()=>{setEditing(true);setOpen(true);setSelectedId(current?.id||"")}}>Modificar</button>}</div>{open&&<div className="tracked-history"><h4>Historial de Puesto</h4>{history.length?<div className="timeline">{history.map(item=><div key={item.id}><i/><b>{item.effectiveFrom} | {item.newValue}</b><span>{item.createdByUserName}</span><p>Anterior: {item.oldValue || "-"} · Motivo: {item.reason}</p></div>)}</div>:<Empty text="No hay historial registrado para este campo."/>}{editing&&<div className="tracked-edit"><label>Puesto existente<select value={selectedId} onChange={event=>setSelectedId(event.target.value)}><option value="">Seleccionar</option>{positions.map(position=><option key={position.id} value={position.id}>{position.name}</option>)}</select></label><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button type="button" className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button type="button" className="button primary" onClick={save}>Guardar puesto</button></div></div>}</div>}</div>;
}

function SalaryRangeValidationCard({employee}:{employee:Employee}) {
  const position=selectedEmployeePosition(employee);
  const categoryResult=salaryRangeMockService.compareCategoryToPosition(position,employee.internalCategory);
  const check=(label:string,value:string,allowed:string[])=>({label,value:value||"Sin cargar",allowed,ok:!position||!allowed.length||allowed.includes(value),missing:!value});
  const rows=[
    check("Unidad de negocio",employee.businessUnit,positionAllowedValues(position,"businessUnit")),
    check("Establecimiento",employee.establishment,positionAllowedValues(position,"establishment")),
    check("Sector",employee.sector,positionAllowedValues(position,"sector")),
  ];
  const structuralMismatch=rows.some(row=>position&&row.allowed.length&&!row.ok&&!row.missing);
  const categoryMismatch=["BELOW_RANGE","ABOVE_RANGE","UNKNOWN_CATEGORY"].includes(categoryResult.status);
  const categoryPending=["NO_POSITION","NO_RANGE"].includes(categoryResult.status)||!employee.internalCategory;
  const tone=!position?"neutral":structuralMismatch||categoryMismatch?"danger":categoryPending||rows.some(row=>row.missing)?"warning":"success";
  const title=!position?"Puesto sin seleccionar":tone==="success"?"Datos laborales dentro del puesto":tone==="danger"?"Hay datos fuera del puesto":"Validación pendiente";
  const categoryText={
    IN_RANGE:`${employee.internalCategory} esta dentro del rango salarial.`,
    BELOW_RANGE:`${employee.internalCategory} esta por debajo del rango salarial.`,
    ABOVE_RANGE:`${employee.internalCategory} esta por encima del rango salarial.`,
    NO_POSITION:"No hay puesto seleccionado. Se puede guardar igual; la validación queda pendiente.",
    NO_RANGE:"El puesto no tiene rango salarial configurado.",
    UNKNOWN_CATEGORY:"La categoría interna no se encuentra en el catálogo salarial.",
  }[categoryResult.status];
  return <div className={`salary-range-check ${tone}`}><small>Validación contra Puestos</small><b>{title}</b><p>{categoryText}</p><div className="structure-check-list">{rows.map(row=><span className={row.ok&&!row.missing?"ok":row.missing?"pending":"bad"} key={row.label}>{row.label}: {row.value}{row.allowed.length?` · Puesto permite: ${row.allowed.join(", ")}`:""}</span>)}<span className={categoryResult.status==="IN_RANGE"?"ok":categoryPending?"pending":"bad"}>Categoría interna: {employee.internalCategory||"Sin cargar"} · Rango: {categoryResult.range.length?categoryResult.range.join(", "):"Sin rango"}</span></div></div>;
}

function LaborMovementPanel({employee,user,canEdit,onSaved}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void}) {
  const [open,setOpen]=useState(false),[type,setType]=useState<LaborMovementType>("BAJA"),[effectiveFrom,setEffectiveFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[observation,setObservation]=useState(""),[error,setError]=useState("");
  const status=calculateLaborStatus(employee.laborMovements || []);
  const save=()=>{if(!type)return setError("El tipo de movimiento es obligatorio.");if(!effectiveFrom)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated=laborMovementMockService.addMovement(employee.id,{type,effectiveFrom,reason,observation},user);onSaved(updated);setOpen(false);setReason("");setObservation("");setError("");};
  return <Section title="Alta / Baja laboral" subtitle="Movimientos laborales que calculan el estado del colaborador" action={canEdit?<button type="button" className="button primary" onClick={()=>setOpen(true)}>Registrar movimiento laboral</button>:undefined}><div className="labor-movement-table"><TableShell minWidth={980}><table><thead><tr><th>Tipo</th><th>Fecha desde</th><th>Motivo</th><th>Observación</th><th>Usuario</th><th>Fecha de registro</th><th>Estado</th></tr></thead><tbody>{(employee.laborMovements || []).map(movement=>{const isFuture=new Date(`${movement.effectiveFrom}T00:00:00`)>new Date();return <tr key={movement.id}><td><span className={movement.type==="ALTA"?"badge success":"badge danger"}>{movement.type}</span></td><td>{movement.effectiveFrom}</td><td><OverflowCell value={movement.reason} /></td><td><OverflowCell value={movement.observation || "-"} /></td><td>{movement.createdByUserName}</td><td>{new Date(movement.createdAt).toLocaleString("es-AR")}</td><td>{isFuture?"Programado":"Vigente / histórico"}</td></tr>})}</tbody></table></TableShell>{!(employee.laborMovements || []).length&&<Empty text="No hay movimientos laborales registrados."/>}{employee.status==="Inactivo"&&!(employee.laborMovements || []).some(item=>item.type==="BAJA")&&<p className="soft-alert">Este legajo figura como inactivo en datos anteriores, pero no tiene movimiento de baja registrado.</p>}</div>{open&&<Modal title="Registrar movimiento laboral" close={()=>setOpen(false)}><div className="form-stack"><Select label="Tipo de movimiento" value={type} set={v=>setType(v as LaborMovementType)} options={["ALTA","BAJA"]}/><Field label="Fecha desde" type="date" value={effectiveFrom} set={setEffectiveFrom}/><Select label="Motivo" value={reason} set={setReason} options={type==="ALTA"?entryReasons:exitReasons}/><Field label="Observación" value={observation} set={setObservation}/>{error&&<p className="error">{error}</p>}<p className="info-note">Estado resultante actual: {status.status}. El estado laboral no se edita manualmente.</p><div className="form-actions"><button className="button subtle" onClick={()=>setOpen(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar movimiento</button></div></div></Modal>}</Section>;
}

function BlockHistoryTimeline({employeeId,section,block,empty}:{employeeId:string;section:FieldHistorySection;block:string;empty:string}) {
  const rows=employeeBlockHistoryMockService.getByBlock(employeeId,section,block);
  return rows.length?<div className="timeline">{rows.map(row=><div key={row.id}><i/><b>{row.effectiveFrom} · {row.blockLabel}</b><span>{row.createdByUserName}</span><p>Anterior: {row.oldValue || "-"} · Nuevo: {row.newValue} · Motivo: {row.reason} · Registro: {new Date(row.createdAt).toLocaleString("es-AR")}</p></div>)}</div>:<Empty text={empty}/>;
}

const addressSummary=(e:Employee)=>`${e.domicilio.calle || "-"} ${e.domicilio.numero || ""}, ${e.domicilio.localidadNombre || e.city || "-"}, ${e.domicilio.departamentoNombre || "-"}, ${e.domicilio.provinciaNombre || "-"}. CP ${e.domicilio.codigoPostal || "-"}`;
const transportSummary=(e:Employee)=>e.transport?`Utiliza transporte · ${e.city || "-"}${e.transportNotes?` · ${e.transportNotes}`:""}`:"No utiliza transporte";
const hoursSummary=(e:Employee)=>e.enabledHours.length?e.enabledHours.join(", "):"Sin horas especiales";

function AddressBlock({employee,user,canEdit,onSaved}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void}) {
  const [showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState(employee.domicilio),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const oldValue=addressSummary(employee);const updated={...employee,domicilio:draft,addressStreet:draft.calle,address:draft.calle,addressNumber:draft.numero,city:draft.localidadNombre,department:draft.departamentoNombre,province:draft.provinciaNombre,zip:draft.codigoPostal,locationMap:draft.ubicacionMapa};employeeBlockHistoryMockService.create({employeeId:employee.id,section:"CONTACTO_DOMICILIO",block:"DOMICILIO",blockLabel:"Domicilio",oldValue,newValue:addressSummary(updated),effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setShowHistory(true);};
  return <div className="block-card"><div className="block-card-head"><div><h3>Domicilio actual</h3><p>{addressSummary(employee)}</p><small>Ubicación en mapa: {employee.domicilio.ubicacionMapa?.label || "Sin ubicación definida"}</small></div><div className="tracked-actions"><button className="button subtle" onClick={()=>setShowHistory(!showHistory)}>Ver historial</button>{canEdit&&<button className="button primary" onClick={()=>{setDraft(employee.domicilio);setEditing(true)}}>Modificar domicilio</button>}</div></div>{showHistory&&<BlockHistoryTimeline employeeId={employee.id} section="CONTACTO_DOMICILIO" block="DOMICILIO" empty="Todavía no hay historial de domicilio registrado."/>}{editing&&<Modal title="Modificar domicilio" close={()=>setEditing(false)}><div className="form-stack"><Field label="Dirección / Calle" value={draft.calle} set={v=>setDraft({...draft,calle:v})}/><Field label="Número" value={draft.numero} set={v=>setDraft({...draft,numero:v})}/><Field label="Provincia" value={draft.provinciaNombre} set={v=>setDraft({...draft,provinciaNombre:v})}/><Field label="Departamento" value={draft.departamentoNombre} set={v=>setDraft({...draft,departamentoNombre:v})}/><Field label="Localidad" value={draft.localidadNombre} set={v=>setDraft({...draft,localidadNombre:v})}/><Field label="Código postal" value={draft.codigoPostal} set={v=>setDraft({...draft,codigoPostal:v})}/><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar domicilio</button></div></div></Modal>}</div>;
}

function AddressMapCard({employee,readOnly,onChange}:{employee:Employee;readOnly:boolean;onChange:(employee:Employee)=>void}) {
  const localityCenter = employee.domicilio.localidadId ? locationService.getLocalityCenter(employee.domicilio.localidadId) : undefined;
  return <LocationMapPicker provinceName={employee.domicilio.provinciaNombre} departmentName={employee.domicilio.departamentoNombre} localityName={employee.domicilio.localidadNombre} addressStreet={employee.domicilio.calle} addressNumber={employee.domicilio.numero} initialCenter={localityCenter ? {...localityCenter.center, zoom: localityCenter.zoom} : undefined} value={employee.domicilio.ubicacionMapa} readOnly={readOnly} onChange={(ubicacionMapa)=>onChange({...employee,domicilio:{...employee.domicilio,ubicacionMapa},locationMap:ubicacionMapa})}/>;
}

function AddressEditBlock({employee,user,canEdit,onSaved}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void}) {
  const [showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState(employee.domicilio),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const setAddress=(patch:Partial<Employee["domicilio"]>)=>setDraft({...draft,...patch,...(patch.ubicacionMapa?.source==="MANUAL"?{fuenteGeocoding:"MANUAL_MARKER" as const}:null)});
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const oldValue=addressSummary(employee);const updated={...employee,domicilio:draft,addressStreet:draft.calle,address:draft.calle,addressNumber:draft.numero,city:draft.localidadNombre,department:draft.departamentoNombre,province:draft.provinciaNombre,zip:draft.codigoPostal,locationMap:draft.ubicacionMapa};employeeBlockHistoryMockService.create({employeeId:employee.id,section:"CONTACTO_DOMICILIO",block:"DOMICILIO",blockLabel:"Domicilio",oldValue,newValue:addressSummary(updated),effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setShowHistory(true);};
  return <div className="block-card"><div className="block-card-head"><div><h3>Domicilio actual</h3><p>{addressSummary(employee)}</p><small>Ubicación en mapa: {employee.domicilio.ubicacionMapa?.label || "Sin ubicación definida"}</small></div><div className="tracked-actions"><button className="button subtle" onClick={()=>setShowHistory(!showHistory)}>Ver historial</button>{canEdit&&<button className="button primary" onClick={()=>{setDraft(employee.domicilio);setEditing(true)}}>Modificar domicilio</button>}</div></div><AddressMapCard employee={employee} readOnly onChange={()=>undefined}/>{showHistory&&<BlockHistoryTimeline employeeId={employee.id} section="CONTACTO_DOMICILIO" block="DOMICILIO" empty="Todavía no hay historial de domicilio registrado."/>}{editing&&<Modal title="Modificar domicilio" close={()=>setEditing(false)}><div className="address-edit-layout"><div className="address-edit-card"><div><b>Datos de domicilio</b><span>Completá la dirección en orden para alimentar el mapa y el historial.</span></div><GeoAddressFields value={draft} onChange={setDraft}/></div><div className="address-edit-card map-card"><div><b>Ubicación en mapa</b><span>Buscá la dirección, abrila en Google Maps si hace falta, o ajustá el marcador manualmente.</span></div><LocationMapPicker provinceName={draft.provinciaNombre} departmentName={draft.departamentoNombre} localityName={draft.localidadNombre} addressStreet={draft.calle} addressNumber={draft.numero} value={draft.ubicacionMapa} onChange={ubicacionMapa=>setAddress({ubicacionMapa})}/></div><div className="address-edit-card change-card"><div><b>Datos del cambio</b><span>Estos datos quedan guardados en el historial de domicilio.</span></div><div className="address-change-grid"><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/></div>{error&&<p className="error">{error}</p>}</div><div className="form-actions"><button className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar domicilio</button></div></div></Modal>}</div>;
}

function AssignmentBlock({employee,user,canEdit,onSaved,kind}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void;kind:"MANAGER"|"TIME"}) {
  const isManager=kind==="MANAGER", block=isManager?"ENCARGADO_DIRECTO":"RESPONSABLE_CARGA_HORARIA", title=isManager?"Encargado directo actual":"Responsable de carga horaria actual";
  const currentList=isManager?(employee.directManagers?.length?employee.directManagers:[employee.directManager].filter(Boolean)):(employee.timeResponsibles?.length?employee.timeResponsibles:[employee.timeResponsible].filter(Boolean));
  const role=isManager?"":employee.timeResponsibleRole, fromValue=isManager?employee.directManagerFrom:employee.timeResponsibleFrom, notesValue=isManager?employee.directManagerNotes:employee.timeResponsibleNotes;
  const [showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(false),[names,setNames]=useState<string[]>(currentList),[roleDraft,setRole]=useState(role),[from,setFrom]=useState(fromValue || new Date().toISOString().slice(0,10)),[notes,setNotes]=useState(notesValue || ""),[reason,setReason]=useState(""),[error,setError]=useState("");
  const summary=(values=currentList)=>isManager?`${values.length?values.join(", "):"Sin asignar"} · Desde ${fromValue || "Sin cargar"}`:`${values.length?values.join(", "):"Sin asignar"} · ${role || "Sin rol"} · Desde ${fromValue || "Sin cargar"}`;
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const clean=names.filter(Boolean);const updated=isManager?{...employee,directManagers:clean,directManager:clean[0]||"",directManagerFrom:from,directManagerTo:"",directManagerStatus:"",directManagerNotes:notes}:{...employee,timeResponsibles:clean,timeResponsible:clean[0]||"",timeResponsibleRole:roleDraft,timeResponsibleFrom:from,timeResponsibleTo:"",timeResponsibleStatus:"",timeResponsibleNotes:notes};const nextSummary=isManager?`${clean.length?clean.join(", "):"Sin asignar"} · Desde ${from}`:`${clean.length?clean.join(", "):"Sin asignar"} · ${roleDraft || "Sin rol"} · Desde ${from}`;employeeBlockHistoryMockService.create({employeeId:employee.id,section:"RESPONSABLES_ASIGNACIONES",block,blockLabel:title,oldValue:summary(),newValue:nextSummary,effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setShowHistory(true);};
  return <div className="block-card"><div className="block-card-head"><div><h3>{title}</h3><p>{summary()}</p><small>{isManager?"Relacion jerarquica o funcional para organigramas.":"Usuarios autorizados a cargar horas, ausencias y novedades horarias."}</small></div><div className="tracked-actions"><button className="button subtle" onClick={()=>setShowHistory(!showHistory)}>Ver historial</button>{canEdit&&<button className="button primary" onClick={()=>{setNames(currentList);setEditing(true)}}>{currentList.length?isManager?"Editar encargados":"Editar responsables":isManager?"Agregar encargado":"Agregar responsable"}</button>}</div></div>{showHistory&&<BlockHistoryTimeline employeeId={employee.id} section="RESPONSABLES_ASIGNACIONES" block={block} empty="Todavia no hay historial registrado."/>}{editing&&<Modal title={title} close={()=>setEditing(false)}><div className="form-stack"><PeopleMultiSearch label={isManager?"Encargados directos":"Responsables de carga horaria"} selected={names} onChange={setNames} excludeId={employee.id}/>{!isManager&&<Select label="Rol" value={roleDraft} set={setRole} options={userRoleOptions(roleDraft)}/>}<Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Observacion" value={notes} set={setNotes}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar asignacion</button></div></div></Modal>}</div>;
}

function TransportBlock({employee,user,canEdit,onSaved}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void}) {
  const [showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(false),[transport,setTransport]=useState(employee.transport?"Sí":"No"),[city,setCity]=useState(employee.city),[notes,setNotes]=useState(employee.transportNotes),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated={...employee,transport:transport==="Sí",city,transportRoute:"",transportNotes:notes};employeeBlockHistoryMockService.create({employeeId:employee.id,section:"TRANSPORTE",block:"TRANSPORTE",blockLabel:"Transporte",oldValue:transportSummary(employee),newValue:transportSummary(updated),effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setShowHistory(true);};
  return <div className="block-card"><div className="block-card-head"><div><h3>Transporte actual</h3><p>{transportSummary(employee)}</p></div><div className="tracked-actions"><button className="button subtle" onClick={()=>setShowHistory(!showHistory)}>Ver historial</button>{canEdit&&<button className="button primary" onClick={()=>setEditing(true)}>Modificar transporte</button>}</div></div>{showHistory&&<BlockHistoryTimeline employeeId={employee.id} section="TRANSPORTE" block="TRANSPORTE" empty="Todavía no hay historial de transporte registrado."/>}{editing&&<Modal title="Modificar transporte" close={()=>setEditing(false)}><div className="form-stack"><Select label="Utiliza transporte de empresa" value={transport} set={setTransport} options={["Sí","No"]}/>{transport==="Sí"&&<Field label="Ciudad / Localidad de origen" value={city} set={setCity}/>}<Field label="Observaciones" value={notes} set={setNotes}/><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar transporte</button></div></div></Modal>}</div>;
}

const hourOptions=()=>hourConceptMockService.getActive().map((concept)=>concept.name);

function HoursSpecialBlock({employee,user,canEdit,onSaved}:{employee:Employee;user:User;canEdit:boolean;onSaved:(employee:Employee)=>void}) {
  const [showHistory,setShowHistory]=useState(false),[editing,setEditing]=useState(false),[hours,setHours]=useState(employee.enabledHours),[from,setFrom]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(""),[error,setError]=useState("");
  const save=()=>{if(!from)return setError("La fecha desde es obligatoria.");if(!reason.trim())return setError("El motivo del cambio es obligatorio.");const updated={...employee,enabledHours:hours};employeeBlockHistoryMockService.create({employeeId:employee.id,section:"CONFIGURACION_HORARIA_LIQUIDACION",block:"HORAS_ESPECIALES",blockLabel:"Horas especiales habilitadas",oldValue:hoursSummary(employee),newValue:hoursSummary(updated),effectiveFrom:from,reason},user,`Legajo ${employee.legajoInterno || employee.legajo}`);onSaved(employeeMockService.update(updated,user));setEditing(false);setShowHistory(true);};
  return <div className="block-card"><div className="block-card-head"><div><h3>Horas especiales habilitadas</h3><p>{hoursSummary(employee)}</p></div><div className="tracked-actions"><button className="button subtle" onClick={()=>setShowHistory(!showHistory)}>Ver historial</button>{canEdit&&<button className="button primary" onClick={()=>setEditing(true)}>Modificar configuración horaria</button>}</div></div>{showHistory&&<BlockHistoryTimeline employeeId={employee.id} section="CONFIGURACION_HORARIA_LIQUIDACION" block="HORAS_ESPECIALES" empty="Todavía no hay historial registrado."/>}{editing&&<Modal title="Modificar configuración horaria" close={()=>setEditing(false)}><div className="form-stack"><div className="check-grid">{hourOptions().map(hour=><label className="check-card" key={hour}><input type="checkbox" checked={hours.includes(hour)} onChange={event=>setHours(event.target.checked?[...hours,hour]:hours.filter(item=>item!==hour))}/>{hour}</label>)}</div><Field label="Fecha desde" type="date" value={from} set={setFrom}/><Field label="Motivo del cambio" value={reason} set={setReason}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={()=>setEditing(false)}>Cancelar</button><button className="button primary" onClick={save}>Guardar horas</button></div></div></Modal>}</div>;
}

function EmployeesPage() {
  const { user } = useAuth(); const level = roleLevel(user!.role); const [search,setSearch]=useState(""); const [company,setCompany]=useState("");
  const all=employeeMockService.getAll(); const employees=all.filter(e=>(level!==2||e.sector===user!.sector)&&(!company||employeeCompanies(e).includes(company))&&`${displayLegajo(e)} ${e.legajoFinnegans} ${e.dni} ${e.cuil} ${e.lastName} ${e.firstName}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="BASE MAESTRA DE PERSONAS" title={level===2?"Legajos de mi área":"Legajos"} description="Buscá, consultá y gestioná la información integral de cada colaborador." action={level===1?<Link to="/legajos/nuevo" className="button primary"><Plus size={17}/> Nuevo legajo</Link>:undefined}/>
    <div className="stat-grid five"><StatCard label="Total legajos" value={all.length} icon={Users}/><StatCard label="Activos" value={all.filter(e=>calculateEmployeeStatus(e)==="Activo").length} icon={CheckCircle2} tone="green"/><StatCard label="Inactivos" value={all.filter(e=>calculateEmployeeStatus(e)==="Inactivo").length} icon={Archive} tone="red"/><StatCard label="Sin responsable" value={all.filter(e=>!e.timeResponsible).length} icon={AlertTriangle} tone="orange"/><StatCard label="Carga pendiente" value="6" icon={Clock3} tone="purple"/></div>
    <Section title="Listado de legajos" subtitle={`${employees.length} resultados`} action={<button className="button subtle"><SlidersHorizontal size={16}/> Más filtros</button>}><div className="filters"><label className="search-field"><Search size={17}/><input placeholder="Buscar por legajo, DNI, CUIL, apellido o nombre" value={search} onChange={e=>setSearch(e.target.value)}/></label><select value={company} onChange={e=>setCompany(e.target.value)}><option value="">Todas las empresas</option>{companies().map(c=><option key={c}>{c}</option>)}</select></div><TableShell minWidth={980}><table><thead><tr><th>Legajo</th><th>CUIL</th><th>Apellido</th><th>Nombre</th><th>Centro de costo</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{employees.map(e=>{const laborStatus=calculateEmployeeStatus(e);return <tr key={e.id}><td><b>{displayLegajo(e)}</b></td><td>{e.cuil}</td><td>{e.lastName}</td><td>{e.firstName}</td><td><OverflowCell value={e.costCenter} /></td><td><span className={statusClass(laborStatus)}>{laborStatus}</span></td><td><Link className="table-link table-icon-action" title="Ver detalle" aria-label="Ver detalle" to={`/legajos/${e.id}`}><Eye size={14}/><span>Ver detalle</span></Link></td></tr>})}</tbody></table></TableShell></Section></>;
}

const emptyMap = { lat:null, lng:null, source:"MOCK" as const, label:"" };
const blankEmployee: Employee = { id:"", legajo:"", legajoInterno:"", legajoFinnegans:"", firstName:"", lastName:"", dni:"", cuil:"", birthDate:"", gender:"", civilStatus:"", nationality:"Argentina", phone:"", mobile:"", email:"", address:"", addressStreet:"", addressNumber:"S/N", city:"", department:"", province:"", zip:"", domicilio:{calle:"",numero:"S/N",provinciaId:"",provinciaNombre:"",departamentoId:"",departamentoNombre:"",localidadId:"",localidadNombre:"",codigoPostal:"",ubicacionMapa:emptyMap}, emergencyContact:"", emergencyRelation:"", emergencyPhone:"", company:"", companies:[], businessUnit:"", establishment:"", costCenter:"", sector:"", position:"", positionId:"", puestoId:"", puestoNombre:"", receiptCategory:"", internalCategory:"", agreement:"", healthInsurance:"", directManager:"", directManagerFrom:"", directManagerTo:"", directManagerStatus:"", directManagerNotes:"", timeResponsible:"", timeResponsibleRole:"Nivel 3 - Administrativo de Carga Horaria", timeResponsibleFrom:"", timeResponsibleTo:"", timeResponsibleStatus:"", timeResponsibleNotes:"", startDate:"", endDate:"", exitReason:"", workday:"8 h", shift:"Mañana", transport:false, transportRoute:"", transportNotes:"", mapLocation:"", locationMap:emptyMap, enabledHours:["Hora normal"], settlementType:"Normal", affectsSettlement:true, exportable:true, attendanceBonus:true, award:false, productiveGoals:false, humanGoals:false, settlementNotes:"", status:"Activo", laborMovements:[], novelties:[], documents:[], historyEvents:[], audit:[], routeHistory:[] };
function EmployeeCreatePage() {
  const {user}=useAuth(); const navigate=useNavigate(); const [value,setValue]=useState<Employee>({...blankEmployee,id:crypto.randomUUID()}); const [error,setError]=useState(""); const [tab,setTab]=useState(0); const [entryReason,setEntryReason]=useState(entryReasons[0]); const [entryObservation,setEntryObservation]=useState("");
  const upd=(field:keyof Employee,next:Employee[keyof Employee])=>setValue({...value,[field]:next});
  const save=(e:FormEvent)=>{e.preventDefault();const all=employeeMockService.getAll();if(!value.legajoInterno||!value.dni||!value.cuil||!value.firstName||!value.lastName||!value.company||!value.costCenter||!value.startDate)return setError("Completá los campos obligatorios de Información General y Datos Laborales, incluida la fecha de alta.");if(!entryReason)return setError("El motivo de alta es obligatorio.");if(all.some(x=>x.legajoInterno===value.legajoInterno))return setError("Ya existe un colaborador con este Legajo Interno.");if(value.legajoFinnegans&&all.some(x=>x.legajoFinnegans===value.legajoFinnegans))return setError("Ya existe un colaborador con este Legajo Finnegans.");if(all.some(x=>x.dni===value.dni))return setError("El DNI ya existe.");const laborMovements=[{id:crypto.randomUUID(),type:"ALTA" as const,effectiveFrom:value.startDate,reason:entryReason,observation:entryObservation,createdAt:new Date().toISOString(),createdByUserId:user!.id,createdByUserName:user!.name}];const created={...value,companies:value.companies?.length?value.companies:[value.company],legajo:value.legajoInterno,address:value.addressStreet,endDate:"",exitReason:"",laborMovements,status:calculateEmployeeStatus({...value,laborMovements}),historyEvents:[{id:crypto.randomUUID(),date:new Date().toLocaleDateString("es-AR"),type:"Alta",description:"Se creó el legajo del colaborador.",user:user!.name}]};employeeMockService.create(created,user!);navigate(`/legajos/${created.id}`,{state:{created:true}});};
  const sections=["Información General","Contacto y Domicilio","Datos Laborales","Responsables / Asignaciones","Transporte","Configuración Horaria"];
  return <><PageHeader eyebrow="ALTA DE PERSONAL" title="Crear nuevo legajo" description="Cargá la ficha integral del colaborador. Los datos quedarán disponibles inmediatamente en el detalle."/><form onSubmit={save}><div className="tabs create-tabs">{sections.map((section,index)=><button type="button" className={tab===index?"active":""} onClick={()=>setTab(index)} key={section}>{index+1}. {section}</button>)}</div><Section title={sections[tab]} subtitle="Los campos marcados con * son obligatorios.">
    {tab===0&&<div className="form-grid"><Field label="Legajo Interno *" value={value.legajoInterno} set={v=>upd("legajoInterno",v)}/><Field label="Legajo Finnegans" value={value.legajoFinnegans||""} set={v=>upd("legajoFinnegans",v)}/><Field label="Apellido *" value={value.lastName} set={v=>upd("lastName",v)}/><Field label="Nombre *" value={value.firstName} set={v=>upd("firstName",v)}/><Field label="DNI *" value={value.dni} set={v=>upd("dni",v)}/><Field label="CUIL *" value={value.cuil} set={v=>upd("cuil",v)}/><Field label="Fecha de nacimiento" type="date" value={value.birthDate} set={v=>upd("birthDate",v)}/><Select label="Sexo" value={value.gender} set={v=>upd("gender",v)} options={["Femenino","Masculino","Otro"]}/><Field label="Estado civil" value={value.civilStatus} set={v=>upd("civilStatus",v)}/><Field label="Nacionalidad" value={value.nationality} set={v=>upd("nationality",v)}/></div>}
    {tab===1&&<ContactAddressFields value={value} setValue={setValue}/>}
    {tab===2&&<><div className="info-note"><b>Alta laboral</b><p>La baja no se carga en el alta inicial. El estado laboral se calculará luego desde los movimientos de Alta / Baja laboral.</p></div><div className="form-grid"><CompanyMultiCreateField value={value} setValue={setValue}/><Select label="Unidad de negocio" value={value.businessUnit} set={v=>upd("businessUnit",v)} options={laborSelectOptions("businessUnit",value.businessUnit)}/><Select label="Establecimiento" value={value.establishment} set={v=>upd("establishment",v)} options={laborSelectOptions("establishment",value.establishment)}/><Select label="Centro de costo *" value={value.costCenter} set={v=>upd("costCenter",v)} options={structureSelectOptions("costCenter",value.costCenter)}/><Select label="Sector" value={value.sector} set={v=>upd("sector",v)} options={laborSelectOptions("sector",value.sector)}/><EmployeePositionCreateField value={value} setValue={setValue}/><Select label="Categoría de recibo" value={value.receiptCategory} set={v=>upd("receiptCategory",v)} options={laborSelectOptions("receiptCategory",value.receiptCategory)}/><Select label="Categoría interna" value={value.internalCategory} set={v=>upd("internalCategory",v)} options={laborSelectOptions("internalCategory",value.internalCategory)}/><SalaryRangeValidationCard employee={value}/><Field label="Convenio" value={value.agreement} set={v=>upd("agreement",v)}/><Field label="Obra Social" value={value.healthInsurance} set={v=>upd("healthInsurance",v)}/><Field label="Fecha desde / Fecha de alta *" type="date" value={value.startDate} set={v=>upd("startDate",v)}/><Select label="Motivo de alta *" value={entryReason} set={setEntryReason} options={entryReasons}/><Field label="Observación de alta" value={entryObservation} set={setEntryObservation}/></div></>}
    {tab===3&&<div className="assignment-create"><div><h3>A. Encargado directo</h3><p>Responsable jerárquico o funcional. Se utiliza para organigramas.</p><div className="form-grid"><PeopleMultiSearch label="Encargados directos" selected={value.directManagers?.length?value.directManagers:[value.directManager].filter(Boolean)} onChange={names=>setValue({...value,directManagers:names,directManager:names[0]||""})} excludeId={value.id}/><Field label="Fecha desde" type="date" value={value.directManagerFrom} set={v=>upd("directManagerFrom",v)}/><Field label="Observacion" value={value.directManagerNotes} set={v=>upd("directManagerNotes",v)}/></div></div><div><h3>B. Responsable de carga horaria</h3><p>Usuario autorizado a visualizar y cargar horas, ausencias y novedades del empleado.</p><div className="form-grid"><PeopleMultiSearch label="Responsables de carga horaria" selected={value.timeResponsibles?.length?value.timeResponsibles:[value.timeResponsible].filter(Boolean)} onChange={names=>setValue({...value,timeResponsibles:names,timeResponsible:names[0]||""})} excludeId={value.id}/><Select label="Rol" value={value.timeResponsibleRole} set={v=>upd("timeResponsibleRole",v)} options={userRoleOptions(value.timeResponsibleRole)}/><Field label="Fecha desde" type="date" value={value.timeResponsibleFrom} set={v=>upd("timeResponsibleFrom",v)}/><Field label="Observacion" value={value.timeResponsibleNotes} set={v=>upd("timeResponsibleNotes",v)}/></div></div></div>}
    {tab===4&&<div className="form-grid"><Select label="Utiliza transporte de la empresa" value={value.transport?"Sí":"No"} set={v=>setValue({...value,transport:v==="Sí",transportRoute:""})} options={["Sí","No"]}/>{value.transport&&<Field label="Ciudad de origen" value={value.city} set={v=>upd("city",v)}/>}<Field label="Observaciones de transporte" value={value.transportNotes} set={v=>upd("transportNotes",v)}/></div>}
    {tab===5&&<><p className="info-note">Las horas seleccionadas serán las opciones disponibles al cargar horas para este legajo. Las novedades se cargan por separado.</p><div className="check-grid">{hourOptions().map(hour=><label className="check-card" key={hour}><input type="checkbox" checked={value.enabledHours.includes(hour)} onChange={event=>upd("enabledHours",event.target.checked?[...value.enabledHours,hour]:value.enabledHours.filter(item=>item!==hour))}/>{hour}</label>)}</div></>}
    {error&&<p className="error create-error">{error}</p>}<div className="form-actions create-actions"><Link to="/legajos" className="button subtle">Cancelar</Link>{tab>0&&<button type="button" className="button subtle" onClick={()=>setTab(tab-1)}>Anterior</button>}{tab<sections.length-1&&<button type="button" className="button subtle" onClick={()=>setTab(tab+1)}>Siguiente</button>}<button className="button primary">Guardar nuevo legajo</button></div>
  </Section></form></>;
}
function Field({label,value,set,type="text",disabled}:{label:string;value:string;set:(v:string)=>void;type?:string;disabled?:boolean}) {return <label>{label}<input type={type} value={value} disabled={disabled} onChange={e=>set(e.target.value)}/></label>}
function Select({label,value,set,options,disabled}:{label:string;value:string;set:(v:string)=>void;options:string[];disabled?:boolean}) {return <label>{label}<select value={value} disabled={disabled} onChange={e=>set(e.target.value)}><option value="">Seleccionar</option>{options.map(o=><option key={o}>{o}</option>)}</select></label>}
function AutoSelect({label,value,options,onSelect,disabled=false}:{label:string;value:string;options:{id:string;label:string}[];onSelect:(option:{id:string;label:string})=>void;disabled?:boolean}) {
  const listId = `${label.replace(/\s+/g,"-").toLowerCase()}-${options.length}`;
  const [query, setQuery] = useState(value);
  useEffect(() => setQuery(value), [value]);
  return <label>{label}<input disabled={disabled} value={query} list={listId} placeholder={disabled ? "Seleccioná el campo anterior" : "Buscar o seleccionar"} onChange={(event)=>{setQuery(event.target.value); const selected=options.find((option)=>option.label===event.target.value); if(selected) onSelect(selected);}}/><datalist id={listId}>{options.map((option)=><option key={option.id} value={option.label}/>)}</datalist></label>;
}

function ContactAddressFields({value,setValue,readOnly=false}:{value:Employee;setValue:(employee:Employee)=>void;readOnly?:boolean}) {
  const upd=(field:keyof Employee,next:Employee[keyof Employee])=>setValue({...value,[field]:next});
  const setAddress = (patch: Partial<Employee["domicilio"]>) => {
    const nextAddress = { ...value.domicilio, ...patch, ...(patch.ubicacionMapa?.source==="MANUAL"?{fuenteGeocoding:"MANUAL_MARKER" as const}:null) };
    setValue({ ...value, domicilio: nextAddress, addressStreet: nextAddress.calle, address: nextAddress.calle, addressNumber: nextAddress.numero, province: nextAddress.provinciaNombre, department: nextAddress.departamentoNombre, city: nextAddress.localidadNombre, zip: nextAddress.codigoPostal, locationMap: nextAddress.ubicacionMapa, mapLocation: nextAddress.ubicacionMapa.label });
  };
  return <><div className="form-grid"><Field label="Teléfono" value={value.phone} set={v=>upd("phone",v)}/><Field label="Celular" value={value.mobile} set={v=>upd("mobile",v)}/><Field label="Email" value={value.email} set={v=>upd("email",v)}/><div className="form-wide"><GeoAddressFields value={value.domicilio} onChange={address=>setAddress(address)} readOnly={readOnly}/></div><Field label="Contacto de emergencia" value={value.emergencyContact} set={v=>upd("emergencyContact",v)}/><Field label="Parentesco" value={value.emergencyRelation} set={v=>upd("emergencyRelation",v)}/><Field label="Teléfono de emergencia" value={value.emergencyPhone} set={v=>upd("emergencyPhone",v)}/></div><LocationMapPicker provinceName={value.domicilio.provinciaNombre} departmentName={value.domicilio.departamentoNombre} localityName={value.domicilio.localidadNombre} addressStreet={value.domicilio.calle} addressNumber={value.domicilio.numero} value={value.domicilio.ubicacionMapa} readOnly={readOnly} onChange={(ubicacionMapa)=>setAddress({ubicacionMapa})}/></>;
}

function EmployeeDetailPage() {
  const {id}=useParams();const {user}=useAuth();const location=useLocation();const level=roleLevel(user!.role);const [tab,setTab]=useState(0);const [employee,setEmployee]=useState(()=>employeeMockService.getById(id!)!);const [notice,setNotice]=useState(location.state?.created?"Legajo creado correctamente.":"");
  if(!employee)return <Navigate to="/legajos"/>; const editable=level===1;
  const save=()=>{const all=employeeMockService.getAll().filter(item=>item.id!==employee.id);if(!employee.legajoInterno)return setNotice("Legajo Interno es obligatorio.");if(!employee.startDate)return setNotice("Fecha de alta / ingreso es obligatoria.");if(employee.endDate&&employee.startDate&&employee.endDate<employee.startDate)return setNotice("Fecha de baja / egreso no puede ser anterior a la fecha de alta.");if(employee.endDate&&!employee.exitReason)return setNotice("Si cargás fecha de baja / egreso, debés indicar el motivo.");if(all.some(item=>item.legajoInterno===employee.legajoInterno))return setNotice("Ya existe un colaborador con este Legajo Interno.");if(employee.legajoFinnegans&&all.some(item=>item.legajoFinnegans===employee.legajoFinnegans))return setNotice("Ya existe un colaborador con este Legajo Finnegans.");const updated=employeeMockService.update({...employee,legajo:employee.legajoInterno,address:employee.addressStreet},user!);setEmployee(updated);setNotice("Cambios guardados correctamente.");setTimeout(()=>setNotice(""),2200);};
  const laborStatus=calculateEmployeeStatus(employee);
  return <><div className="detail-hero"><Link to="/legajos" className="back-link">← Volver a legajos</Link><div><div className="avatar">{employee.firstName[0]}{employee.lastName[0]}</div><div><p className="eyebrow">LEGAJO {displayLegajo(employee)}</p><h1>{employee.firstName} {employee.lastName}</h1><p>{employee.cuil} · {employee.company} · {employee.costCenter}</p></div></div><div className="hero-actions"><span className={statusClass(laborStatus)}>{laborStatus}</span>{editable&&<button className="button primary" onClick={save}>Guardar cambios</button>}</div></div>
    {notice&&<div className="toast">{notice}</div>}<div className="tabs">{tabs.filter((_,i)=>i!==9||level===1).map((t,i)=><button className={tab===i?"active":""} onClick={()=>setTab(i)} key={t}>{t}</button>)}</div><Section title={tabs[tab]} subtitle={tab===3?"Separación explícita entre jerarquía funcional y permisos de carga.":"Información consolidada del colaborador."}><fieldset className="readonly-scope" disabled={!editable}>{renderEmployeeTab(tab,employee,setEmployee,editable,user!)}</fieldset></Section>{![2,3,4,5,6,7].includes(tab)&&tabSections[tab]&&<SectionChangeHistory employeeId={employee.id} section={tabSections[tab]} title="Historial de cambios de esta sección" />}</>;
}
function renderEmployeeTab(tab:number,e:Employee,set:(e:Employee)=>void,editable:boolean,user:User):ReactNode {
  const upd=(field:keyof Employee,v:Employee[keyof Employee])=>set({...e,[field]:v});
  if(tab===0)return <div className="form-grid"><Field label="Legajo Interno" value={e.legajoInterno} set={v=>set({...e,legajoInterno:v,legajo:v})}/><Field label="Legajo Finnegans" value={e.legajoFinnegans||""} set={v=>upd("legajoFinnegans",v)}/><Field label="Apellido" value={e.lastName} set={v=>upd("lastName",v)}/><Field label="Nombre" value={e.firstName} set={v=>upd("firstName",v)}/><Field label="DNI" value={e.dni} set={v=>upd("dni",v)}/><Field label="CUIL" value={e.cuil} set={v=>upd("cuil",v)}/><Field label="Fecha nacimiento" type="date" value={e.birthDate} set={v=>upd("birthDate",v)}/><Select label="Sexo" value={e.gender} set={v=>upd("gender",v)} options={["Femenino","Masculino","Otro"]}/><Field label="Estado civil" value={e.civilStatus} set={v=>upd("civilStatus",v)}/><Field label="Nacionalidad" value={e.nationality} set={v=>upd("nationality",v)}/></div>;
  if(tab===1)return <><div className="form-grid"><Field label="Teléfono" value={e.phone} set={v=>upd("phone",v)}/><Field label="Celular" value={e.mobile} set={v=>upd("mobile",v)}/><Field label="Email" value={e.email} set={v=>upd("email",v)}/><Field label="Contacto de emergencia" value={e.emergencyContact} set={v=>upd("emergencyContact",v)}/><Field label="Parentesco" value={e.emergencyRelation} set={v=>upd("emergencyRelation",v)}/><Field label="Teléfono de emergencia" value={e.emergencyPhone} set={v=>upd("emergencyPhone",v)}/></div><div className="block-wrap"><AddressEditBlock employee={e} user={user} canEdit={editable} onSaved={set}/></div></>;
  if(tab===2)return <><LaborStatusCard employee={e}/><LaborMovementPanel employee={e} user={user} canEdit={editable} onSaved={set}/><div className="tracked-grid"><MultiCompanyField employee={e} canEdit={editable} user={user} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="businessUnit" label="Unidad de negocio" value={e.businessUnit} canEdit={editable} user={user} options={laborSelectOptions("businessUnit",e.businessUnit)} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="establishment" label="Establecimiento" value={e.establishment} canEdit={editable} user={user} options={laborSelectOptions("establishment",e.establishment)} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="costCenter" label="Centro de costo" value={e.costCenter} canEdit={editable} user={user} options={structureSelectOptions("costCenter",e.costCenter)} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="sector" label="Sector" value={e.sector} canEdit={editable} user={user} options={laborSelectOptions("sector",e.sector)} onSaved={set}/><EmployeePositionField employee={e} canEdit={editable} user={user} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="receiptCategory" label="Categoría de recibo" value={e.receiptCategory} canEdit={editable} user={user} options={laborSelectOptions("receiptCategory",e.receiptCategory)} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="internalCategory" label="Categoría interna" value={e.internalCategory} canEdit={editable} user={user} options={laborSelectOptions("internalCategory",e.internalCategory)} onSaved={set}/><SalaryRangeValidationCard employee={e}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="agreement" label="Convenio" value={e.agreement} canEdit={editable} user={user} onSaved={set}/><FieldWithHistory employee={e} section="DATOS_LABORALES" field="healthInsurance" label="Obra Social" value={e.healthInsurance} canEdit={editable} user={user} onSaved={set}/></div></>;
  if(tab===3)return <div className="block-wrap two"><AssignmentBlock employee={e} user={user} canEdit={editable} onSaved={set} kind="MANAGER"/><AssignmentBlock employee={e} user={user} canEdit={editable} onSaved={set} kind="TIME"/></div>;
  if(tab===4)return <div className="block-wrap"><TransportBlock employee={e} user={user} canEdit={editable} onSaved={set}/></div>;
  if(tab===5)return <div className="block-wrap"><HoursSpecialBlock employee={e} user={user} canEdit={editable} onSaved={set}/></div>;
  if(tab===6)return <EmployeeNoveltiesPanel employee={e} user={user} onSaved={set}/>;
  if(tab===7)return <EmployeeDocumentsPanel employee={e} user={user} onSaved={set}/>;
  if(tab===8)return <div className="timeline">{e.historyEvents.map(event=><div key={event.id}><i/><b>{event.type}</b><span>{event.date}</span><p>{event.description} · {event.user}</p></div>)}</div>;
  return <TableShell minWidth={860}><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Valor anterior</th><th>Valor nuevo</th></tr></thead><tbody>{auditMockService.getAll().filter(a=>a.entity.includes(displayLegajo(e))).map(a=><tr key={a.id}><td>{a.date} {a.time}</td><td>{a.user}</td><td>{a.action}</td><td><OverflowCell value={a.previous} /></td><td><OverflowCell value={a.next} /></td></tr>)}</tbody></table></TableShell>;
}
function MiniTable({title,text,rows}:{title:string;text:string;rows:string[][]}){return <div className="mini-panel"><h3>{title}</h3><p>{text}</p><TableShell minWidth={520}><table><tbody>{rows.map(r=><tr key={r[0]}>{r.map(c=><td key={c}><OverflowCell value={c} /></td>)}</tr>)}</tbody></table></TableShell><button className="button subtle"><Plus size={15}/> Asignar</button></div>}

function EmployeeNoveltiesPanel({employee,user,onSaved}:{employee:Employee;user:User;onSaved:(employee:Employee)=>void}) {
  const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0);
  const rows=noveltyMockService.getByEmployee(employee.id); void refresh;
  const saved=()=>{const updated={...employee,historyEvents:[{id:crypto.randomUUID(),date:new Date().toLocaleDateString("es-AR"),type:"Novedad registrada",description:"Se registró una novedad de ausentismo / horario.",user:user.name},...(employee.historyEvents||[])]};onSaved(employeeMockService.update(updated,user));setRefresh(x=>x+1);setOpen(false);};
  return <><div className="form-actions"><button className="button primary" onClick={()=>setOpen(true)}><Plus size={15}/> Nueva novedad</button></div><NoveltyTable rows={rows} employees={[employee]} currentUser={user} onChanged={()=>setRefresh(x=>x+1)}/>{open&&<NoveltyModal employees={[employee]} close={()=>setOpen(false)} saved={saved}/>}</>;
}

function isoToday(){return new Date().toISOString().slice(0,10)}
function isoAddDays(days:number){const date=new Date();date.setDate(date.getDate()+days);return date.toISOString().slice(0,10)}
function defaultDocumentExpiration(category?:DocumentCategory){return category?.rules.expires&&category.rules.defaultValidityDays?isoAddDays(category.rules.defaultValidityDays):""}
function documentStatusByExpiration(expiresAt:string){if(!expiresAt)return "Vigente";const today=isoToday();const days=Math.ceil((new Date(`${expiresAt}T00:00:00`).getTime()-new Date(`${today}T00:00:00`).getTime())/86400000);return days<0?"Vencido":days<=30?"Por vencer":"Vigente"}

function DocumentUploadModal({employees,fixedEmployee,user,close,saved}:{employees:Employee[];fixedEmployee?:Employee;user:User;close:()=>void;saved:(employee?:Employee)=>void}) {
  const categories=documentCategoryMockService.getActive();
  const [employeeId,setEmployeeId]=useState(fixedEmployee?.id||employees[0]?.id||"");
  const [categoryId,setCategoryId]=useState(categories[0]?.id||"");
  const selectedCategory=categories.find(item=>item.id===categoryId);
  const [fileName,setFileName]=useState("");
  const [expiresAt,setExpiresAt]=useState(defaultDocumentExpiration(selectedCategory));
  const [status,setStatus]=useState(documentStatusByExpiration(defaultDocumentExpiration(selectedCategory)));
  const [notes,setNotes]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{const next=defaultDocumentExpiration(selectedCategory);setExpiresAt(next);setStatus(documentStatusByExpiration(next));setError("");},[categoryId]);
  const save=()=>{const employee=employees.find(item=>item.id===employeeId)||fixedEmployee;if(!employee)return setError("Seleccioná un legajo para asociar el documento.");if(!selectedCategory)return setError("Seleccioná una categoría documental.");if(!fileName)return setError("Adjuntá un archivo para guardar el documento.");documentMockService.create({id:crypto.randomUUID(),employeeId:employee.id,category:selectedCategory.name,categoryId:selectedCategory.id,fileName,uploadedAt:isoToday(),expiresAt:expiresAt||undefined,status,notes:notes||undefined},user);if(fixedEmployee){const updated={...fixedEmployee,historyEvents:[{id:crypto.randomUUID(),date:new Date().toLocaleDateString("es-AR"),type:"Documento cargado",description:`${selectedCategory.name}: ${fileName}`,user:user.name},...(fixedEmployee.historyEvents||[])]};saved(employeeMockService.update(updated,user));return;}saved(employee);};
  return <Modal title="Agregar documento" close={close}><div className="form-stack">{categories.length?<><div className="form-grid">{!fixedEmployee&&<label>Legajo asociado<select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>{employees.map(employee=><option key={employee.id} value={employee.id}>{displayLegajo(employee)} · {fullName(employee)}</option>)}</select></label>}<label>Categoría documental<select value={categoryId} onChange={event=>setCategoryId(event.target.value)}>{categories.map(category=><option key={category.id} value={category.id}>{category.code} · {category.name}</option>)}</select></label></div>{selectedCategory&&<div className="info-note compact"><b>{selectedCategory.name}</b><p>{selectedCategory.description}</p><small>Ámbitos: {selectedCategory.scopes.join(", ")} · Vence: {selectedCategory.rules.expires?"Sí":"No"} · Aprobación: {selectedCategory.rules.requiresApproval?"Sí":"No"}</small></div>}<div className="document-upload-card"><b>Archivo documental</b><p>Seleccioná el archivo que queda asociado al legajo y a la categoría documental elegida.</p><label>Adjuntar documento<input type="file" onChange={event=>{setFileName(event.target.files?.[0]?.name||"");setError("");}}/></label>{fileName&&<small>Archivo seleccionado: {fileName}</small>}</div><div className="form-grid"><Field label="Fecha vencimiento" type="date" value={expiresAt} set={value=>{setExpiresAt(value);setStatus(documentStatusByExpiration(value));}}/><Select label="Estado" value={status} set={setStatus} options={["Vigente","Por vencer","Vencido"]}/></div><label>Observación documental<textarea value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Detalle opcional del archivo o circuito documental"/></label>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={close}>Cancelar</button><button className="button primary" onClick={save}>Guardar documento</button></div></>:<div className="empty">No hay categorías documentales activas. Cargalas desde Configuración &gt; Categorías documentales.</div>}</div></Modal>;
}

function EmployeeDocumentsPanel({employee,user,onSaved}:{employee:Employee;user:User;onSaved:(employee:Employee)=>void}) {
  const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0);
  const docs=documentMockService.getByEmployee(employee.id); void refresh;
  const saved=(updated?:Employee)=>{if(updated)onSaved(updated);setRefresh(x=>x+1);setOpen(false);};
  return <><div className="form-actions"><button className="button primary" onClick={()=>setOpen(true)}><Plus size={15}/> Agregar documento</button></div>{docs.length?<TableShell minWidth={960}><table><thead><tr><th>Categoría</th><th>Archivo</th><th>Fecha carga</th><th>Vencimiento</th><th>Estado</th><th>Observación</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}><td><OverflowCell value={d.category} /></td><td><OverflowCell value={d.fileName} /></td><td>{d.uploadedAt}</td><td>{d.expiresAt||"-"}</td><td><span className={statusClass(d.status)}>{d.status}</span></td><td><OverflowCell value={d.notes||"-"} /></td></tr>)}</tbody></table></TableShell>:<Empty text="Todavía no hay documentos cargados."/>}{open&&<DocumentUploadModal employees={[employee]} fixedEmployee={employee} user={user} close={()=>setOpen(false)} saved={saved}/>}</>;
}

function HoursPage({pendingOnly=false}:{pendingOnly?:boolean}) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const period = searchParams.get("period") || timeEntryMockService.getDefaultPeriod();
  const [costCenter, setCostCenter] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<{ entry: TimeEntry; action: "reject" | "return" }>();
  const [reviewReason, setReviewReason] = useState("");
  const entries = timeEntryMockService.getAll();
  void refresh;

  const baseEmployees = timeEntryMockService.getEmployeesFor(user!);
  const costCenters = uniqueOptions(baseEmployees.map((employee) => employee.costCenter));
  const employees = baseEmployees.filter((employee) => {
    const searchText = `${displayLegajo(employee)} ${employee.legajoFinnegans} ${employee.dni} ${employee.cuil} ${employee.firstName} ${employee.lastName}`.toLowerCase();
    return (!costCenter || employee.costCenter === costCenter) && searchText.includes(search.toLowerCase());
  });
  const employeeIds = new Set(employees.map((employee) => employee.id));
  const periodEntries = timeEntryMockService.getByPeriod(period).filter((entry) => employeeIds.has(entry.employeeId));
  const reviewEntries = periodEntries.filter((entry) => entry.status === "En revisión");
  const canReview = timeEntryMockService.canReview(user!);
  const summary = (employeeId: string) => timeEntryMockService.getEmployeePeriodSummary(employeeId, period);
  const shown = pendingOnly ? employees.filter((employee) => reviewEntries.some((entry) => entry.employeeId === employee.id)) : employees;
  const exportRows = timeEntryMockService.getPeriodExportRows(period, shown);
  const employeeFor = (entry: TimeEntry) => baseEmployees.find((employee) => employee.id === entry.employeeId);
  const approvedHours = periodEntries.filter((entry) => timeEntryMockService.isCountableStatus(entry.status)).reduce((sum, entry) => sum + entry.hours, 0);

  const setPeriodValue = (value: string) => setSearchParams(value ? { period: value } : {});
  const approve = (entry: TimeEntry) => { timeEntryMockService.approve(entry.id, user!); setRefresh((value) => value + 1); };
  const openReview = (entry: TimeEntry, action: "reject" | "return") => { setReview({ entry, action }); setReviewReason(""); };
  const confirmReview = () => {
    if (!reviewReason.trim() || !review) return;
    if (review.action === "reject") timeEntryMockService.reject(review.entry.id, user!, reviewReason.trim());
    else timeEntryMockService.returnForCorrection(review.entry.id, user!, reviewReason.trim());
    setReview(undefined);
    setReviewReason("");
    setRefresh((value) => value + 1);
  };

  return <>
    <PageHeader
      eyebrow="CONTROL HORARIO"
      title={pendingOnly ? "Bandeja de revisión" : "Carga de horas"}
      description={pendingOnly ? "Revisá, aprobá, rechazá o devolvé las horas enviadas a revisión." : "Seleccioná el período y buscá personas asignadas. Los totales visibles cuentan horas aprobadas y en revisión."}
      action={!pendingOnly && <button className="button subtle" type="button" disabled={!exportRows.length} onClick={() => buildHoursExportWorkbook(exportRows, period)}><FileBarChart size={16}/> Exportar horas</button>}
    />
    <div className="stat-grid">
      <StatCard label="Personas visibles" value={employees.length} icon={Users}/>
      <StatCard label="Pendientes" value={employees.filter((employee) => summary(employee.id).status === "Pendiente").length} icon={Clock3} tone="orange"/>
      <StatCard label="En revisión" value={new Set(reviewEntries.map((entry) => entry.employeeId)).size} icon={ClipboardList} tone="purple"/>
      <StatCard label="Horas contables" value={`${approvedHours} h`} icon={BarChart3} tone="green"/>
    </div>
    {pendingOnly && <Section title="Horas enviadas a revisión" subtitle={`${reviewEntries.length} registros pendientes de resolución`}>
      <div className="filters">
        <label>Período<input type="month" value={period} onChange={(event) => setPeriodValue(event.target.value)}/></label>
        <label className="search-field"><Search size={17}/><input placeholder="Buscar por legajo, DNI, CUIL, apellido o nombre" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <select value={costCenter} onChange={(event) => setCostCenter(event.target.value)}>
          <option value="">Todos los centros de costo</option>
          {costCenters.map((center) => <option key={center} value={center}>{center}</option>)}
        </select>
      </div>
      {reviewEntries.length ? <TableShell minWidth={1080}><table><thead><tr><th>Legajo</th><th>Empleado</th><th>Día</th><th>Concepto</th><th>Horas</th><th>Observación</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{reviewEntries.map((entry) => {
        const employee = employeeFor(entry);
        return <tr key={entry.id}><td><b>{displayLegajo(employee)}</b></td><td><OverflowCell value={employee ? fullName(employee) : "-"} /></td><td>{formatPeriodDay(entry.period, entry.day)}</td><td><OverflowCell value={entry.type} /></td><td><b>{entry.hours} h</b></td><td className="observation-cell"><OverflowCell value={entry.notes || "-"} /></td><td><span className={statusClass(entry.status)}>{entry.status}</span></td><td>{canReview ? <div className="table-actions"><button className="table-link table-icon-action" title="Aprobar" aria-label="Aprobar" onClick={() => approve(entry)}><CheckCircle2 size={14}/><span>Aprobar</span></button><button className="table-link table-icon-action danger-link" title="Rechazar" aria-label="Rechazar" onClick={() => openReview(entry, "reject")}><X size={14}/><span>Rechazar</span></button><button className="table-link table-icon-action" title="Devolver" aria-label="Devolver" onClick={() => openReview(entry, "return")}><RefreshCcw size={14}/><span>Devolver</span></button></div> : <span className="table-sub">Solo lectura</span>}</td></tr>;
      })}</tbody></table></TableShell> : <Empty text="No hay horas en revisión para los filtros seleccionados."/>}
    </Section>}
    <Section title={pendingOnly ? "Personas con registros en revisión" : "Personas habilitadas para carga"} subtitle="La asignación del responsable y del encargado directo determina quién aparece en este listado.">
      <div className="filters">
        <label>Período<input type="month" value={period} onChange={(event) => setPeriodValue(event.target.value)}/></label>
        <label className="search-field"><Search size={17}/><input placeholder="Buscar persona por legajo, DNI, CUIL, apellido o nombre" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
        <select value={costCenter} onChange={(event) => setCostCenter(event.target.value)}>
          <option value="">Todos los centros de costo</option>
          {costCenters.map((center) => <option key={center} value={center}>{center}</option>)}
        </select>
      </div>
      <TableShell minWidth={1120}><table><thead><tr><th>Legajo</th><th>Empleado</th><th>Empresa</th><th>Centro de costo</th><th>Responsable de carga</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{shown.map((employee) => {
        const periodSummary = summary(employee.id);
        return <tr key={employee.id}><td><b>{displayLegajo(employee)}</b></td><td><OverflowCell value={fullName(employee)} /></td><td><OverflowCell value={employee.company} /></td><td><OverflowCell value={employee.costCenter} /></td><td><OverflowCell value={(employee.timeResponsibles?.length ? employee.timeResponsibles : [employee.timeResponsible]).filter(Boolean).join(", ") || "-"} /></td><td>{periodSummary.total} h</td><td><span className={statusClass(periodSummary.status)}>{periodSummary.status}</span></td><td><Link className="table-link table-icon-action" title="Cargar / Ver" aria-label="Cargar / Ver" to={`/horas/${employee.id}?period=${period}`}><Eye size={14}/><span>Cargar / Ver</span></Link></td></tr>;
      })}</tbody></table></TableShell>
    </Section>
    {review && <Modal title={review.action === "reject" ? "Rechazar carga horaria" : "Devolver carga horaria"} close={() => setReview(undefined)}><div className="form-stack"><div className="info-note compact"><b>{review.entry.type} · {formatPeriodDay(review.entry.period, review.entry.day)}</b><p>{review.action === "reject" ? "El registro quedará rechazado y se conservará para auditoría." : "El registro vuelve a Pendiente para que pueda corregirse."}</p></div><label>Observación obligatoria<textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Indicá el motivo para dejar trazabilidad"/></label>{!reviewReason.trim() && <p className="error">La observación es obligatoria.</p>}<div className="form-actions"><button className="button subtle" onClick={() => setReview(undefined)}>Cancelar</button><button className={review.action === "reject" ? "button danger-button" : "button primary"} onClick={confirmReview}>{review.action === "reject" ? "Rechazar" : "Devolver"}</button></div></div></Modal>}
  </>;
}

const noveltyTone = (novelty?: Novelty, uiColor?: string) => novelty ? noveltyColorClass(uiColor, novelty.noveltyTypeId || novelty.type) : "";

function EmployeeHoursPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const employee = employeeMockService.getById(id!)!;
  const period = searchParams.get("period") || timeEntryMockService.getDefaultPeriod();
  const [selected, setSelected] = useState<{ day: number; concept: string }>();
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [refresh, setRefresh] = useState(0);
  const noveltyTypes = noveltyTypeMockService.getAll();
  const activeTypes = noveltyTypes.filter((item) => item.status === "ACTIVO");
  const noveltyTypesById = new Map(noveltyTypes.map((item) => [item.id, item]));
  const noveltyTypesByName = new Map(noveltyTypes.map((item) => [item.name.trim().toLowerCase(), item]));
  const [noveltyTypeId, setNoveltyTypeId] = useState("");
  const [noveltyFrom, setNoveltyFrom] = useState(monthDate(period, 1));
  const [noveltyTo, setNoveltyTo] = useState(monthDate(period, 1));
  const [noveltyHours, setNoveltyHours] = useState("1");
  const [fileName, setFileName] = useState("");
  const [docNotes, setDocNotes] = useState("");
  const [error, setError] = useState("");
  const entries = timeEntryMockService.getByEmployee(id!, period);
  const monthDays = getMonthDays(period);
  void refresh;

  const catalog = hourConceptMockService.getActive();
  const enabledNames = new Set(employee.enabledHours?.length ? employee.enabledHours : ["Hora normal"]);
  const concepts = catalog.filter((concept) => enabledNames.has(concept.name) || concept.name === "Hora normal");
  const periodNovelties = noveltyMockService.getByEmployee(id!).filter((novelty) => novelty.from.startsWith(period) || (novelty.to || novelty.from).startsWith(period));
  const selectedType = activeTypes.find((item) => item.id === noveltyTypeId);
  const activeLink = selectedType?.finnegansLinks.find((link) => link.status === "ACTIVO");
  const noveltyVisualClass = (novelty?: Novelty) => {
    if (!novelty) return "";
    const type = (novelty.noveltyTypeId ? noveltyTypesById.get(novelty.noveltyTypeId) : undefined) || noveltyTypesByName.get(novelty.type.trim().toLowerCase());
    return noveltyTone(novelty, type?.uiColor);
  };
  const dayNovelties = (day: number) => periodNovelties.filter((novelty) => {
    const fromDay = Number(novelty.from.slice(8, 10));
    const toDay = Number((novelty.to || novelty.from).slice(8, 10));
    return day >= fromDay && day <= toDay;
  });
  const conceptNovelties = (day: number, conceptName: string) => dayNovelties(day).filter((novelty) => novelty.blocksTimeEntry || novelty.timeImpact === "BLOQUEA_CARGA_DIA" ? true : novelty.targetHourConceptName ? novelty.targetHourConceptName === conceptName : novelty.timeImpact === "REGISTRA_HORAS_NO_TRABAJADAS" ? conceptName === "Hora normal" : false);
  const entryFor = (day: number, conceptName: string) => entries.find((entry) => entry.day === day && entry.type === conceptName);
  const conceptTotal = (conceptName: string) => entries.filter((entry) => entry.type === conceptName && timeEntryMockService.isCountableStatus(entry.status)).reduce((sum, entry) => sum + entry.hours, 0);
  const isBlocked = (day: number) => dayNovelties(day).some((novelty) => novelty.blocksTimeEntry || novelty.timeImpact === "BLOQUEA_CARGA_DIA");
  const openCell = (day: number, concept: string, entry?: TimeEntry) => {
    const date = monthDate(period, day);
    setSelected({ day, concept });
    setHours(String(entry?.hours ?? (isBlocked(day) && concept === "Hora normal" ? 0 : concept === "Hora normal" ? 8 : 1)));
    setNotes(entry?.notes || "");
    setNoveltyTypeId("");
    setNoveltyFrom(date);
    setNoveltyTo(date);
    setNoveltyHours("1");
    setFileName("");
    setDocNotes("");
    setError("");
  };
  const selectedEntry = selected ? entryFor(selected.day, selected.concept) : undefined;
  const selectedLocked = selectedEntry ? !timeEntryMockService.canEdit(selectedEntry) : false;
  const noveltyRange = () => {
    const start = new Date(`${noveltyFrom}T00:00:00`);
    const end = new Date(`${selectedType?.rules.allowsDateTo ? noveltyTo : noveltyFrom}T00:00:00`);
    const days: number[] = [];
    for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) if (current.getMonth() === start.getMonth()) days.push(current.getDate());
    return days;
  };
  const save = (status: TimeStatus) => {
    if (!selected) return;
    if (selectedLocked) return setError("La carga ya fue aprobada. Para modificarla primero hay que reabrirla.");
    if (selectedType?.rules.requiresDocumentation && !fileName) return setError("Adjuntá la documentación requerida para guardar esta novedad.");
    if (selectedType?.rules.hasValidity && selectedType.rules.allowsDateTo && noveltyTo < noveltyFrom) return setError("La fecha hasta no puede ser anterior a la fecha desde.");
    const concept = catalog.find((item) => item.name === selected.concept);
    const nextHours = Number(hours) || 0;
    if (concept?.rules.maxDailyHours && nextHours > concept.rules.maxDailyHours) return setError(`El concepto ${concept.name} permite hasta ${concept.rules.maxDailyHours} h por día.`);
    const savedEntry = timeEntryMockService.save({ employeeId: id!, period, day: selected.day, type: selected.concept, hours: nextHours, notes, status, conceptId: concept?.id, isSpecial: selected.concept !== "Hora normal", origin: "MANUAL" }, user!);
    if (!savedEntry) return setError("La carga no se pudo guardar porque el registro está bloqueado para edición.");
    if (selectedType) {
      const hoursImpact = selectedType.rules.allowsHours ? Number(noveltyHours) || 0 : 0;
      const quantity = selectedType.rules.allowsHours ? `${noveltyHours} h` : selectedType.rules.allowsDateTo ? `${Math.max(1, noveltyRange().length)} días` : "1 día";
      noveltyMockService.create({ employeeId: id!, type: selectedType.name, noveltyTypeId: selectedType.id, from: noveltyFrom, to: selectedType.rules.allowsDateTo ? noveltyTo : noveltyFrom, quantity, affectsSettlement: selectedType.rules.exportsToFinnegans, status: selectedType.rules.requiresApproval ? "Pendiente" : "Aprobado", createdBy: user!.name, documentationFileName: fileName || undefined, documentationNotes: docNotes || undefined, origin: selectedType.origin, timeImpact: selectedType.rules.timeImpact, hoursImpact, targetHourConceptId: concept?.id, targetHourConceptName: selected.concept, blocksTimeEntry: selectedType.rules.blocksTimeEntry, setsWorkedHoursToZero: selectedType.rules.setsWorkedHoursToZero, exportsToFinnegans: selectedType.rules.exportsToFinnegans, finnegansCode: activeLink?.code, finnegansName: activeLink?.name, valor1: selectedType.rules.allowsHours ? String(hoursImpact) : String(Math.max(1, noveltyRange().length)), fechaAplicacion: noveltyFrom, hasValidity: selectedType.rules.hasValidity }, user!.role);
      if (selectedType.rules.setsWorkedHoursToZero) noveltyRange().forEach((day) => timeEntryMockService.save({ employeeId: id!, period: noveltyFrom.slice(0, 7), day, type: `Novedad: ${selectedType.name}`, hours: 0, notes: "Generado automáticamente por novedad que bloquea carga horaria.", status: "En revisión", origin: "NOVEDAD" }, user!));
      if (fileName) documentMockService.create({ id: crypto.randomUUID(), employeeId: id!, category: `Novedad - ${selectedType.name}`, fileName, uploadedAt: new Date().toISOString().slice(0, 10), status: "Vigente" }, user!);
    }
    setRefresh((value) => value + 1);
    setSelected(undefined);
  };
  const periodSummary = timeEntryMockService.getEmployeePeriodSummary(id!, period);
  const total = periodSummary.total;
  const specialTotal = periodSummary.specialHours;
  const blockedDays = monthDays.filter((day) => isBlocked(day)).length;
  const exportableNovelties = periodNovelties.filter((novelty) => novelty.status !== "Rechazado" && (novelty.exportsToFinnegans || novelty.finnegansCode)).length;

  return <>
    <div className="detail-hero compact"><Link to={`/horas?period=${period}`} className="back-link">← Volver a carga de horas</Link><div><div className="avatar">{employee.firstName[0]}{employee.lastName[0]}</div><div><p className="eyebrow">{formatPeriodLabel(period)} · LEGAJO {displayLegajo(employee)}</p><h1>{employee.firstName} {employee.lastName}</h1><p>{employee.company} · {employee.costCenter} · {employee.cuil}</p></div></div><div className="hero-actions"><span className={statusClass(periodSummary.status)}>{periodSummary.status}</span></div></div>
    <div className="stat-grid"><StatCard label="Horas trabajadas" value={`${total} h`} icon={Clock3}/><StatCard label="Horas especiales" value={`${specialTotal} h`} icon={AlertTriangle} tone="orange"/><StatCard label="Días con carga" value={periodSummary.daysWithEntries} icon={CalendarDays} tone="blue"/><StatCard label="Novedades Finnegans" value={exportableNovelties} icon={Bell} tone="purple"/></div>
    <Section title="Grilla mensual por concepto" subtitle={`Cada celda permite cargar horas y, si corresponde, una novedad asociada a esa misma hora para ${formatPeriodLabel(period)}.`}><div className="hours-grid"><table><thead><tr><th>Concepto</th>{monthDays.map((day) => <th key={day}>{day}</th>)}<th>Total</th></tr></thead><tbody>{concepts.map((concept) => <tr key={concept.id}><td><b>{concept.name}</b><span className="table-sub">{concept.name === "Hora normal" ? "Hora trabajada base" : "Hora especial"}</span></td>{monthDays.map((day) => {const entry = entryFor(day, concept.name); const novelties = conceptNovelties(day, concept.name); const mainNovelty = novelties[0]; const cellClass = ["hour-cell", entry ? "filled" : "", isBlocked(day) ? "blocked" : "", noveltyVisualClass(mainNovelty)].filter(Boolean).join(" "); return <td key={`${concept.id}-${day}`}><button className={cellClass} title={novelties.map((novelty) => novelty.type).join(", ")} onClick={() => openCell(day, concept.name, entry)}><span>{entry?.hours ?? (isBlocked(day) && concept.name === "Hora normal" ? "0" : "+")}</span>{mainNovelty ? <small>{mainNovelty.type.slice(0, 3)}</small> : null}</button></td>; })}<td><b>{conceptTotal(concept.name)}</b></td></tr>)}</tbody></table></div></Section>
    {selected && <Modal title={`Cargar ${selected.concept} · ${formatPeriodDay(period, selected.day)}`} close={() => setSelected(undefined)}><div className="form-stack"><div className="context-hour-card"><div><b>{selected.concept}</b><span>{fullName(employee)} · {monthDate(period, selected.day)}</span></div><span className="badge neutral">{conceptNovelties(selected.day, selected.concept).length ? `${conceptNovelties(selected.day, selected.concept).length} novedad(es)` : "Sin novedad cargada"}</span></div>{selectedLocked && <div className="info-note compact"><b>Registro aprobado</b><p>Esta carga ya fue aprobada y quedó bloqueada para edición directa.</p></div>}<div className="form-grid"><label>Fecha<input value={formatPeriodDay(period, selected.day)} disabled/></label><label>Cantidad de horas<input type="number" min="0" step="0.5" value={hours} disabled={selectedLocked} onChange={(event) => setHours(event.target.value)}/></label><label className="form-wide">Observaciones<textarea value={notes} disabled={selectedLocked} onChange={(event) => setNotes(event.target.value)}/></label></div><div className="context-novelty-card"><div><b>Novedad asociada a esta hora</b><span>Opcional. Si cargás una novedad acá, queda marcada solo en esta fila de la grilla.</span></div><div className="form-grid"><label>Tipo de novedad<select value={noveltyTypeId} disabled={selectedLocked} onChange={(event) => { setNoveltyTypeId(event.target.value); setFileName(""); setDocNotes(""); setError(""); }}><option value="">Sin novedad</option>{activeTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>{selectedType && <Field label="Desde" type="date" value={noveltyFrom} set={setNoveltyFrom} disabled={selectedLocked}/>} {selectedType?.rules.allowsDateTo && <Field label="Hasta" type="date" value={noveltyTo} set={setNoveltyTo} disabled={selectedLocked}/>} {selectedType?.rules.allowsHours && <Field label="Cantidad de horas" type="number" value={noveltyHours} set={setNoveltyHours} disabled={selectedLocked}/>}</div>{selectedType?.uiColor ? <div className="novelty-color-preview"><span className={`cell-novelty-pill ${noveltyColorClass(selectedType.uiColor, selectedType.id)}`}>Color aplicado: {selectedType.name}</span></div> : null}{selectedType?.rules.requiresDocumentation && <div className="document-upload-card"><b>Documentación requerida</b><p>Adjuntá el comprobante o certificado respaldatorio.</p><label>Adjuntar documento<input type="file" disabled={selectedLocked} onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}/></label>{fileName && <small>Archivo seleccionado: {fileName}</small>}<label>Observación documental<textarea value={docNotes} disabled={selectedLocked} onChange={(event) => setDocNotes(event.target.value)} placeholder="Detalle opcional del documento adjunto"/></label></div>}{conceptNovelties(selected.day, selected.concept).length ? <div className="cell-novelty-list">{conceptNovelties(selected.day, selected.concept).map((novelty) => <span className={`cell-novelty-pill ${noveltyVisualClass(novelty)}`} key={novelty.id}>{novelty.type} · {novelty.quantity}</span>)}</div> : null}</div>{error && <p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={() => setSelected(undefined)}>Cancelar</button>{!selectedLocked && <><button className="button subtle" onClick={() => save("Borrador")}>Guardar borrador</button><button className="button primary" onClick={() => save("En revisión")}>Enviar a revisión</button></>}</div></div></Modal>}
  </>;
}
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) { return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={close}><X/></button></div><div className="modal-body">{children}</div></div></div>; }

function NoveltiesPage() {
  const {user}=useAuth();const [open,setOpen]=useState(false);const [refresh,setRefresh]=useState(0);const employees=timeEntryMockService.getEmployeesFor(user!);const ids=new Set(employees.map(e=>e.id));const novelties=noveltyMockService.getAll().filter(n=>ids.has(n.employeeId));void refresh;
  return <><PageHeader eyebrow="AUSENTISMO Y NOVEDADES" title="Novedades" description="Registro centralizado de ausencias, licencias y novedades horarias." action={<button className="button primary" onClick={()=>setOpen(true)}><Plus size={16}/> Nueva novedad</button>}/><Section title="Novedades registradas" subtitle={`${novelties.length} registros visibles según tu perfil`}><NoveltyTable rows={novelties} employees={employees} currentUser={user!} onChanged={()=>setRefresh(x=>x+1)}/></Section>{open&&<NoveltyModal employees={employees} close={()=>setOpen(false)} saved={()=>{setRefresh(x=>x+1);setOpen(false)}}/>}</>;
}
function NoveltyTable({rows,employees,currentUser,onChanged}:{rows:Novelty[];employees:Employee[];currentUser:User;onChanged:()=>void}) { const approve=(id:string)=>{if(noveltyMockService.approve(id,currentUser))onChanged()};const reject=(id:string)=>{if(noveltyMockService.reject(id,currentUser))onChanged()};return rows.length?<TableShell minWidth={1220}><table><thead><tr><th>Legajo</th><th>Empleado</th><th>Novedad</th><th>Origen</th><th>Vigencia</th><th>Cantidad</th><th>Impacto horas</th><th>Finnegans</th><th>Documentación</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map(n=>{const e=employees.find(x=>x.id===n.employeeId);const code=n.finnegansCode||"-";const canApprove=n.status==="Pendiente"&&noveltyMockService.canApprove(n,currentUser);return <tr key={n.id}><td>{displayLegajo(e)}</td><td><OverflowCell value={e?fullName(e):"-"} /></td><td><b>{n.type}</b></td><td><span className="badge neutral">{n.origin||"INTERNA"}</span></td><td>{n.from}{n.to&&n.to!==n.from?<span className="table-sub">Hasta {n.to}</span>:null}</td><td>{n.quantity}</td><td><OverflowCell value={`${n.timeImpact||"NO_AFECTA_HORAS"}${n.targetHourConceptName?`\nAplica sobre ${n.targetHourConceptName}`:""}${n.blocksTimeEntry?"\nBloquea carga · 0 hs":""}`} /></td><td>{n.exportsToFinnegans&&n.status!=="Rechazado"?<><b>{code}</b><span className="table-sub">Exporta</span></>:"No exporta"}</td><td><OverflowCell value={n.documentationFileName||"-"} /></td><td><span className={statusClass(n.status)}>{n.status}</span></td><td>{canApprove?<div className="table-actions"><button className="table-link table-icon-action" title="Aprobar" aria-label="Aprobar" onClick={()=>approve(n.id)}><CheckCircle2 size={14}/><span>Aprobar</span></button><button className="table-link table-icon-action danger-link" title="Rechazar" aria-label="Rechazar" onClick={()=>reject(n.id)}><X size={14}/><span>Rechazar</span></button></div>:"-"}</td></tr>})}</tbody></table></TableShell>:<Empty text="Todavía no hay novedades registradas."/> }
function NoveltyModal({employees,close,saved}:{employees:Employee[];close:()=>void;saved:()=>void}) {const {user}=useAuth();const activeTypes=noveltyTypeMockService.getActive();const defaultPeriod=timeEntryMockService.getDefaultPeriod();const defaultDate=`${defaultPeriod}-01`;const [employeeIds,setEmployeeIds]=useState<string[]>(employees[0]?.id?[employees[0].id]:[]);const [typeId,setTypeId]=useState(activeTypes[0]?.id||"");const [from,setFrom]=useState(defaultDate);const [to,setTo]=useState(defaultDate);const [hours,setHours]=useState("1");const [targetHour,setTargetHour]=useState("Hora normal");const [fileName,setFileName]=useState("");const [docNotes,setDocNotes]=useState("");const [error,setError]=useState("");const selectedType=activeTypes.find(item=>item.id===typeId);const activeLink=selectedType?.finnegansLinks.find(link=>link.status==="ACTIVO");const selectedEmployees=employees.filter(employee=>employeeIds.includes(employee.id));const targetHourOptions=Array.from(new Set(selectedEmployees.flatMap(employee=>["Hora normal",...(employee.enabledHours||[])]))).filter(Boolean);const normalizedTargetHour=targetHourOptions.includes(targetHour)?targetHour:(targetHourOptions[0]||"Hora normal");const requiresTargetHour=Boolean(selectedType?.rules.allowsHours||selectedType?.rules.timeImpact==="REGISTRA_HORAS_NO_TRABAJADAS");const dateRange=()=>{const start=new Date(`${from}T00:00:00`);const end=new Date(`${selectedType?.rules.allowsDateTo?to:from}T00:00:00`);const days:number[]=[];for(const current=new Date(start);current<=end;current.setDate(current.getDate()+1))if(current.getMonth()===start.getMonth())days.push(current.getDate());return days;};const quantity=selectedType?.rules.allowsHours?`${hours} h`:selectedType?.rules.allowsDateTo?`${Math.max(1,dateRange().length)} días`:"1 día";const toggleEmployee=(id:string)=>setEmployeeIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);const save=()=>{if(!selectedType)return;if(!employeeIds.length)return setError("Seleccioná al menos un legajo.");if(requiresTargetHour&&!normalizedTargetHour)return setError("Seleccioná sobre qué tipo de hora aplica esta novedad.");if(selectedType.rules.requiresDocumentation&&!fileName)return setError("Adjuntá la documentación requerida para guardar esta novedad.");if(selectedType.rules.hasValidity&&selectedType.rules.allowsDateTo&&to<from)return setError("La fecha hasta no puede ser anterior a la fecha desde.");const hoursImpact=selectedType.rules.allowsHours?Number(hours)||0:0;const targetConcept=hourConceptMockService.getActive().find(concept=>concept.name===normalizedTargetHour);employeeIds.forEach(employeeId=>{noveltyMockService.create({employeeId,type:selectedType.name,noveltyTypeId:selectedType.id,from,to:selectedType.rules.allowsDateTo?to:from,quantity,affectsSettlement:selectedType.rules.exportsToFinnegans,status:selectedType.rules.requiresApproval?"Pendiente":"Aprobado",createdBy:user!.name,documentationFileName:fileName||undefined,documentationNotes:docNotes||undefined,origin:selectedType.origin,timeImpact:selectedType.rules.timeImpact,hoursImpact,targetHourConceptId:requiresTargetHour?targetConcept?.id:undefined,targetHourConceptName:requiresTargetHour?normalizedTargetHour:undefined,blocksTimeEntry:selectedType.rules.blocksTimeEntry,setsWorkedHoursToZero:selectedType.rules.setsWorkedHoursToZero,exportsToFinnegans:selectedType.rules.exportsToFinnegans,finnegansCode:activeLink?.code,finnegansName:activeLink?.name,valor1:selectedType.rules.allowsHours?String(hoursImpact):String(Math.max(1,dateRange().length)),fechaAplicacion:from,hasValidity:selectedType.rules.hasValidity},user!.role);if(selectedType.rules.setsWorkedHoursToZero)dateRange().forEach(day=>timeEntryMockService.save({employeeId,period:from.slice(0,7),day,type:`Novedad: ${selectedType.name}`,hours:0,notes:"Generado automáticamente por novedad que bloquea carga horaria.",status:"En revisión",origin:"NOVEDAD"},user!));if(fileName)documentMockService.create({id:crypto.randomUUID(),employeeId,category:`Novedad - ${selectedType.name}`,fileName,uploadedAt:new Date().toISOString().slice(0,10),status:"Vigente"},user!);});saved()};return <Modal title="Nueva novedad" close={close}><div className="form-stack">{activeTypes.length?<><label>Tipo de novedad<select value={typeId} onChange={event=>{setTypeId(event.target.value);setFileName("");setDocNotes("");setError("");}}>{activeTypes.map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><div className="document-upload-card"><b>Legajos alcanzados</b><p>Podés cargar la misma novedad para una o varias personas. Se genera un registro individual por legajo.</p><div className="check-grid">{employees.map(e=><label className="mini-check" key={e.id}><input type="checkbox" checked={employeeIds.includes(e.id)} onChange={()=>toggleEmployee(e.id)}/>{displayLegajo(e)} · {fullName(e)}</label>)}</div></div>{selectedType&&<div className="novelty-impact-card"><b>{selectedType.name}</b><p>{selectedType.description}</p><div><span>Origen: {selectedType.origin}</span><span>Horas: {selectedType.rules.timeImpact}</span><span>{selectedType.rules.blocksTimeEntry?"Bloquea carga diaria":"Convive con horas"}</span><span>Finnegans: {activeLink?.code||"No exporta"}</span></div></div>}<div className="form-grid"><Field label="Desde" type="date" value={from} set={setFrom}/>{selectedType?.rules.allowsDateTo&&<Field label="Hasta" type="date" value={to} set={setTo}/>} {selectedType?.rules.allowsHours&&<Field label="Cantidad de horas" type="number" value={hours} set={setHours}/>} {requiresTargetHour&&<Select label="Aplica sobre hora" value={normalizedTargetHour} set={setTargetHour} options={targetHourOptions.length?targetHourOptions:["Hora normal"]}/>}</div>{selectedType?.rules.requiresDocumentation&&<div className="document-upload-card"><b>Documentación requerida</b><p>Adjuntá el comprobante, certificado o archivo respaldatorio de esta novedad.</p><label>Adjuntar documento<input type="file" onChange={event=>setFileName(event.target.files?.[0]?.name||"")}/></label>{fileName&&<small>Archivo seleccionado: {fileName}</small>}<label>Observación documental<textarea value={docNotes} onChange={event=>setDocNotes(event.target.value)} placeholder="Detalle opcional del documento adjunto"/></label></div>}{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={close}>Cancelar</button><button className="button primary" onClick={save}>Guardar novedad</button></div></>:<div className="empty">No hay tipos de novedades activos. Cargalos desde Configuración &gt; Tipos de novedades.</div>}</div></Modal>}

function DocumentsPage(){const {user}=useAuth();const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0);const docs=documentMockService.getAll(),employees=employeeMockService.getAll();void refresh;return <><PageHeader eyebrow="GESTIÓN DOCUMENTAL" title="Documentación" description="Seguimiento de documentación laboral, certificados y vencimientos." action={<button className="button primary" onClick={()=>setOpen(true)}><Plus size={16}/> Agregar documento</button>}/><Section title="Documentos del personal" subtitle="Repositorio simulado para validar categorías y alertas">{docs.length?<TableShell minWidth={1120}><table><thead><tr><th>Legajo</th><th>Empleado</th><th>Categoría</th><th>Archivo</th><th>Fecha carga</th><th>Vencimiento</th><th>Estado</th><th>Observación</th></tr></thead><tbody>{docs.map(d=>{const employee=employees.find(e=>e.id===d.employeeId);return <tr key={d.id}><td>{displayLegajo(employee)}</td><td><OverflowCell value={employee?fullName(employee):"-"} /></td><td><OverflowCell value={d.category} /></td><td><OverflowCell value={d.fileName} /></td><td>{d.uploadedAt}</td><td>{d.expiresAt||"-"}</td><td><span className={statusClass(d.status)}>{d.status}</span></td><td><OverflowCell value={d.notes||"-"} /></td></tr>})}</tbody></table></TableShell>:<Empty text="Todavía no hay documentos cargados."/>}</Section>{open&&<DocumentUploadModal employees={employees} user={user!} close={()=>setOpen(false)} saved={()=>{setRefresh(x=>x+1);setOpen(false)}}/>}</>}
function UsersPage(){
  const [users,setUsers]=useState(userMockService.getAll());
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState<Omit<User,"id">>({name:"",email:"",password:"",role:"Nivel 3 - Administrativo de Carga Horaria",status:"Activo",company:"",sector:""});
  const [error,setError]=useState("");
  const sectorOptions=orgStructureMockService.getOptions().sectors;
  const reset=()=>{setDraft({name:"",email:"",password:"",role:"Nivel 3 - Administrativo de Carga Horaria",status:"Activo",company:"",sector:""});setError("");};
  const close=()=>{setOpen(false);reset();};
  const save=()=>{
    const email=draft.email.trim().toLowerCase();
    if(!draft.name.trim())return setError("Ingresá el nombre y apellido del usuario.");
    if(!email.includes("@"))return setError("Ingresá un email válido.");
    if(users.some(user=>user.email.toLowerCase()===email))return setError("Ya existe un usuario con ese email.");
    if(draft.password.trim().length<4)return setError("La contraseña debe tener al menos 4 caracteres.");
    userMockService.create({...draft,id:crypto.randomUUID(),name:draft.name.trim(),email,password:draft.password.trim(),company:draft.company||undefined,sector:draft.sector||undefined});
    setUsers(userMockService.getAll());
    close();
  };
  return <>
    <PageHeader eyebrow="SEGURIDAD Y ACCESOS" title="Usuarios y roles" description="Administrá usuarios reales de acceso, roles y alcance organizacional." action={<button className="button primary" onClick={()=>setOpen(true)}><Plus size={16}/> Crear usuario</button>}/>
    <Section title="Usuarios habilitados" subtitle={`${users.length} perfiles configurados`}>
      <TableShell minWidth={940}><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Empresa / Área</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><b>{u.name}</b></td><td>{u.email}</td><td><OverflowCell value={u.role} /></td><td><span className={statusClass(u.status)}>{u.status}</span></td><td><OverflowCell value={`${u.company||"Acceso global"} ${u.sector?`· ${u.sector}`:""}`.trim()} /></td></tr>)}</tbody></table></TableShell>
    </Section>
    {open&&<Modal title="Crear usuario" close={close}><div className="form-stack"><div className="info-note compact"><b>Alta de usuario</b><p>Este usuario podrá ingresar con el email y contraseña definidos. El rol determina permisos y visibilidad dentro del sistema.</p></div><Field label="Nombre y apellido *" value={draft.name} set={name=>setDraft({...draft,name})}/><Field label="Email de acceso *" type="email" value={draft.email} set={email=>setDraft({...draft,email})}/><Field label="Contraseña inicial *" type="password" value={draft.password} set={password=>setDraft({...draft,password})}/><Select label="Rol *" value={draft.role} set={role=>setDraft({...draft,role:role as Role})} options={userRoleOptions(draft.role)}/><Select label="Estado" value={draft.status} set={status=>setDraft({...draft,status:status as User["status"]})} options={["Activo","Inactivo"]}/><Select label="Empresa / alcance" value={draft.company||""} set={company=>setDraft({...draft,company})} options={companies()}/><Select label="Sector / área" value={draft.sector||""} set={sector=>setDraft({...draft,sector})} options={sectorOptions}/>{error&&<p className="error">{error}</p>}<div className="form-actions"><button className="button subtle" onClick={close}>Cancelar</button><button className="button primary" onClick={save}>Guardar usuario</button></div></div></Modal>}
  </>;
}
function AuditPage(){const audits=auditMockService.getAll();return <><PageHeader eyebrow="TRAZABILIDAD" title="Auditoría" description="Registro central de movimientos generados por los servicios mock."/><Section title="Historial de actividad" subtitle={`${audits.length} eventos registrados`}><TableShell minWidth={1280}><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Entidad</th><th>Campo</th><th>Valor anterior</th><th>Valor nuevo</th><th>Motivo</th></tr></thead><tbody>{audits.map(a=><tr key={a.id}><td>{a.date} · {a.time}</td><td>{a.user}</td><td><OverflowCell value={a.role} /></td><td>{a.action}</td><td><OverflowCell value={a.entity} /></td><td><OverflowCell value={a.field || "-"} /></td><td><OverflowCell value={a.previous} /></td><td><OverflowCell value={a.next} /></td><td><OverflowCell value={a.reason} /></td></tr>)}</tbody></table></TableShell></Section></>}
function SettingsPage(){const cards=[{name:"Empresas y estructura",icon:<Building2/>,path:"/configuracion/empresas-estructura"},{name:"Tipos de novedades",icon:<ClipboardList/>,path:"/configuracion/tipos-novedades"},{name:"Horas especiales",icon:<Clock3/>,path:"/configuracion/conceptos-horarios"},{name:"Exportación Finnegans",icon:<FileText/>,path:"/configuracion/liquidacion"},{name:"Categorías documentales",icon:<FolderOpen/>,path:"/configuracion/categorias-documentales"},{name:"Parámetros de auditoría",icon:<ShieldCheck/>,path:"/configuracion/parametros-auditoria"}];return <><PageHeader eyebrow="CONFIGURACIÓN GENERAL" title="Parámetros del sistema" description="Pantalla mock para validar la futura administración funcional."/><div className="settings-grid">{cards.map((card)=><div className="setting-card" key={card.name}><span>{card.icon}</span><h3>{card.name}</h3><p>{card.name==="Exportación Finnegans"?"Preparar novedades exportables, sin calcular sueldos.":"Configurar catálogos, estados y reglas disponibles para la operación."}</p>{card.path?<Link className="table-link" to={card.path}>Administrar <ChevronRight size={15}/></Link>:<button className="table-link">Administrar <ChevronRight size={15}/></button>}</div>)}</div></>}
function ReportsPage(){const metrics=dashboardMetricsMockService.getMetrics();return <><PageHeader eyebrow="INDICADORES DE GESTIÓN" title="Reportes de gestión" description="Panel visual calculado desde legajos, novedades, transporte, documentación y carga horaria."/><div className="stat-grid"><StatCard label="Ausentismo mensual" value={`${metrics.absenceRate}%`} detail={`${metrics.absenceDays} días registrados`} icon={Activity} tone="orange"/><StatCard label="Rotación anual" value={`${metrics.turnoverRate}%`} detail={`${metrics.exits} egresos en 2026`} icon={Users}/><StatCard label="Cargas pendientes" value={metrics.pendingLoads} detail={`${metrics.reviewLoads} personas en revisión`} icon={Clock3} tone="red"/><StatCard label="Personas transportadas" value={metrics.transported} detail="Según legajos activos" icon={Building2} tone="green"/></div><div className="dashboard-grid"><Section title="Dotación por sector" subtitle="Distribución calculada desde legajos activos"><DashboardBars rows={metrics.headcountBySector}/></Section><Section title="Documentación crítica" subtitle="Alertas documentales vinculadas a legajos"><div className="alerts"><Alert label="Documentos vencidos" value={`${metrics.expiredDocuments} registros`} tone="red"/><Alert label="Documentos por vencer" value={`${metrics.expiringDocuments} registros`} tone="orange"/><Alert label="Novedades pendientes" value={`${metrics.pendingNovelties} registros`} tone="purple"/></div></Section></div><Section title="Transporte por localidad" subtitle="Personas con transporte de empresa en legajo"><DashboardBars rows={metrics.transportByCity}/></Section></>}




