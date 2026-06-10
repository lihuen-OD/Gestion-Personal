import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { GeoAddressFields } from "../components/GeoAddressFields";
import { useAuth } from "../context/AuthContext";
import { orgStructureMockService } from "../services/orgStructureMockService";
import type { EmployeeAddress, Role } from "../types";
import type { OrgArea, OrgBusinessUnit, OrgCompany, OrgCostCenter, OrgEstablishment, OrgSector, OrgStructureEntityType, OrgStructureStatus } from "../types/orgStructure.types";

type Tab = OrgStructureEntityType;
type Editable = OrgCompany | OrgBusinessUnit | OrgEstablishment | OrgArea | OrgSector | OrgCostCenter;

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "COMPANY", label: "Empresas" },
  { id: "BUSINESS_UNIT", label: "Unidades de negocio" },
  { id: "ESTABLISHMENT", label: "Establecimientos" },
  { id: "AREA", label: "Areas / Departamentos" },
  { id: "SECTOR", label: "Sectores" },
  { id: "COST_CENTER", label: "Centros de costo" },
];

const roleLevel = (role: Role) => role.startsWith("Nivel 1") ? 1 : role.startsWith("Nivel 2") ? 2 : 3;
const uid = () => crypto.randomUUID();
const uniqueIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-header"><div className="page-title-block"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</div>;
}

function blank(type: Tab): Editable {
  const code = orgStructureMockService.nextCode(type);
  if (type === "COMPANY") return { id: uid(), code, name: "", legalName: "", cuit: "", status: "ACTIVO" };
  if (type === "BUSINESS_UNIT") return { id: uid(), code, name: "", companyIds: [], status: "ACTIVO" };
  if (type === "ESTABLISHMENT") return { id: uid(), code, name: "", companyIds: [], businessUnitIds: [], province: "", department: "", locality: "", address: "", status: "ACTIVO" };
  if (type === "AREA") return { id: uid(), code, name: "", businessUnitIds: [], establishmentIds: [], status: "ACTIVO" };
  if (type === "SECTOR") return { id: uid(), code, name: "", areaIds: [], establishmentIds: [], status: "ACTIVO" };
  return { id: uid(), code, name: "", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: [], finnegansCode: "", status: "ACTIVO" };
}

function nameById(items: { id: string; name: string }[], ids: string[] = []) {
  return ids.map((id) => items.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "-";
}

function deriveCompanyIds(catalog: ReturnType<typeof orgStructureMockService.getCatalog>, businessUnitIds: string[] = []) {
  return uniqueIds(catalog.businessUnits.filter((item) => businessUnitIds.includes(item.id)).flatMap((item) => item.companyIds));
}

function normalizeDerivedRelations(type: Tab, item: Editable, catalog: ReturnType<typeof orgStructureMockService.getCatalog>): Editable {
  if (type === "ESTABLISHMENT" && "businessUnitIds" in item) return { ...item, companyIds: deriveCompanyIds(catalog, item.businessUnitIds) } as Editable;
  return item;
}

function MultiRelation({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (value: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  return <div className="catalog-check-block"><small>{label}</small><div className="check-grid inline">{options.map((option) => <label className="check-card" key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={() => toggle(option.id)} />{option.name}</label>)}</div></div>;
}

function DerivedRelation({ label, value }: { label: string; value: string }) {
  return <div className="derived-relation-card"><small>{label}</small><b>{value}</b><span>Se calcula automaticamente segun la relacion seleccionada.</span></div>;
}

function TextField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function StatusField({ value, onChange }: { value: OrgStructureStatus; onChange: (value: OrgStructureStatus) => void }) {
  return <label>Estado<select value={value} onChange={(event) => onChange(event.target.value as OrgStructureStatus)}><option>ACTIVO</option><option>INACTIVO</option></select></label>;
}

function Editor({ type, item, onChange }: { type: Tab; item: Editable; onChange: (item: Editable) => void }) {
  const catalog = orgStructureMockService.getCatalog();
  const normalizedItem = normalizeDerivedRelations(type, item, catalog);
  const set = (patch: Partial<Editable>) => onChange(normalizeDerivedRelations(type, { ...item, ...patch } as Editable, catalog));
  const establishmentAddress: EmployeeAddress | undefined = "province" in item ? { calle: item.address, numero: "", provinciaId: "", provinciaNombre: item.province, departamentoId: "", departamentoNombre: item.department, localidadId: "", localidadNombre: item.locality, codigoPostal: "", ubicacionMapa: { lat: null, lng: null, source: "MOCK", label: "" } } : undefined;
  const setEstablishmentAddress = (address: EmployeeAddress) => set({ province: address.provinciaNombre, department: address.departamentoNombre, locality: address.localidadNombre, address: [address.calle, address.numero].filter(Boolean).join(" ") } as Partial<Editable>);

  return <div className="org-structure-editor">
    <div className="form-grid">
      <TextField label="Codigo" value={item.code} disabled onChange={() => undefined} />
      <TextField label="Nombre *" value={item.name} onChange={(name) => set({ name } as Partial<Editable>)} />
      <StatusField value={item.status} onChange={(status) => set({ status } as Partial<Editable>)} />
      {"legalName" in item && <TextField label="Razon social" value={item.legalName} onChange={(legalName) => set({ legalName } as Partial<Editable>)} />}
      {"cuit" in item && <TextField label="CUIT" value={item.cuit} onChange={(cuit) => set({ cuit } as Partial<Editable>)} />}
      {"finnegansCode" in item && <TextField label="Codigo Finnegans" value={item.finnegansCode || ""} onChange={(finnegansCode) => set({ finnegansCode } as Partial<Editable>)} />}
      <div className="form-wide"><label>Observaciones<textarea value={item.notes || ""} onChange={(event) => set({ notes: event.target.value } as Partial<Editable>)} /></label></div>
    </div>
    {establishmentAddress && <div className="form-wide org-geo-panel"><GeoAddressFields value={establishmentAddress} onChange={setEstablishmentAddress} showGeoActions={false} /></div>}

    {"companyIds" in item && type === "BUSINESS_UNIT" && <MultiRelation label="Empresas asociadas" options={catalog.companies} value={item.companyIds} onChange={(companyIds) => set({ companyIds } as Partial<Editable>)} />}

    {type === "ESTABLISHMENT" && "companyIds" in normalizedItem && <DerivedRelation label="Empresas asociadas" value={nameById(catalog.companies, normalizedItem.companyIds)} />}
    {"businessUnitIds" in item && type === "ESTABLISHMENT" && <MultiRelation label="Unidades de negocio asociadas" options={catalog.businessUnits} value={item.businessUnitIds} onChange={(businessUnitIds) => set({ businessUnitIds } as Partial<Editable>)} />}

    {"businessUnitIds" in item && type === "AREA" && <MultiRelation label="Unidades de negocio asociadas" options={catalog.businessUnits} value={item.businessUnitIds} onChange={(businessUnitIds) => set({ businessUnitIds } as Partial<Editable>)} />}
    {"establishmentIds" in item && type === "AREA" && <MultiRelation label="Establecimientos asociados" options={catalog.establishments} value={item.establishmentIds} onChange={(establishmentIds) => set({ establishmentIds } as Partial<Editable>)} />}

    {"establishmentIds" in item && type === "SECTOR" && <MultiRelation label="Establecimientos asociados" options={catalog.establishments} value={item.establishmentIds} onChange={(establishmentIds) => set({ establishmentIds } as Partial<Editable>)} />}
    {"areaIds" in item && type === "SECTOR" && <MultiRelation label="Areas / Departamentos asociados" options={catalog.areas} value={item.areaIds} onChange={(areaIds) => set({ areaIds } as Partial<Editable>)} />}

    {"companyIds" in item && type === "COST_CENTER" && <MultiRelation label="Empresas asociadas" options={catalog.companies} value={item.companyIds} onChange={(companyIds) => set({ companyIds } as Partial<Editable>)} />}
    {"businessUnitIds" in item && type === "COST_CENTER" && <MultiRelation label="Unidades de negocio asociadas" options={catalog.businessUnits} value={item.businessUnitIds} onChange={(businessUnitIds) => set({ businessUnitIds } as Partial<Editable>)} />}
    {"establishmentIds" in item && type === "COST_CENTER" && <MultiRelation label="Establecimientos asociados" options={catalog.establishments} value={item.establishmentIds} onChange={(establishmentIds) => set({ establishmentIds } as Partial<Editable>)} />}
    {"areaIds" in item && type === "COST_CENTER" && <MultiRelation label="Areas / Departamentos asociados" options={catalog.areas} value={item.areaIds} onChange={(areaIds) => set({ areaIds } as Partial<Editable>)} />}
    {"sectorIds" in item && <MultiRelation label="Sectores asociados" options={catalog.sectors} value={item.sectorIds} onChange={(sectorIds) => set({ sectorIds } as Partial<Editable>)} />}

    <div className="info-note compact"><b>Uso en modulos</b><p>Estos valores alimentan Legajos, Puestos, Organigrama, Carga Horaria, Reportes y Dashboard. En Establecimientos, las empresas se calculan automaticamente desde las unidades de negocio asociadas.</p></div>
  </div>;
}

function Rows({ type, onEdit }: { type: Tab; onEdit: (item: Editable) => void }) {
  const catalog = orgStructureMockService.getCatalog();
  if (type === "COMPANY") return <tbody>{catalog.companies.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.legalName}</span></td><td>{item.cuit || "-"}</td><td>-</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
  if (type === "BUSINESS_UNIT") return <tbody>{catalog.businessUnits.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}</td><td>{nameById(catalog.companies, item.companyIds)}</td><td>-</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
  if (type === "ESTABLISHMENT") return <tbody>{catalog.establishments.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.locality}, {item.department}</span></td><td>{nameById(catalog.companies, deriveCompanyIds(catalog, item.businessUnitIds))}</td><td>{nameById(catalog.businessUnits, item.businessUnitIds)}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
  if (type === "AREA") return <tbody>{catalog.areas.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}</td><td>{nameById(catalog.businessUnits, item.businessUnitIds)}</td><td>{nameById(catalog.establishments, item.establishmentIds)}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
  if (type === "SECTOR") return <tbody>{catalog.sectors.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}</td><td>{nameById(catalog.areas, item.areaIds)}</td><td>{nameById(catalog.establishments, item.establishmentIds)}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
  return <tbody>{catalog.costCenters.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td>{item.name}<span className="table-sub">{item.finnegansCode || "Sin codigo Finnegans"}</span></td><td>{nameById(catalog.companies, item.companyIds)}</td><td>{nameById(catalog.sectors, item.sectorIds)}</td><td><span className={item.status === "ACTIVO" ? "badge success" : "badge neutral"}>{item.status}</span></td><td><button className="table-link" onClick={() => onEdit(item)}>Editar</button></td></tr>)}</tbody>;
}

export function OrgStructurePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("COMPANY");
  const [editing, setEditing] = useState<Editable | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const catalog = orgStructureMockService.getCatalog();
  const counts = useMemo(() => [
    ["Empresas", catalog.companies.length],
    ["Unidades", catalog.businessUnits.length],
    ["Establecimientos", catalog.establishments.length],
    ["Sectores", catalog.sectors.length],
  ], [catalog, refresh]);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  const save = () => {
    if (!editing?.name.trim()) return setNotice("Completa el nombre antes de guardar.");
    orgStructureMockService.upsert(tab, normalizeDerivedRelations(tab, editing, catalog));
    setRefresh((value) => value + 1);
    setEditing(null);
    setNotice("Estructura guardada correctamente.");
    setTimeout(() => setNotice(""), 2200);
  };
  return <>
    <PageHeader eyebrow="CONFIGURACION" title="Empresas y estructura" description="Catalogo maestro de estructura organizacional para alimentar seleccionables, filtros, legajos, puestos y organigrama." action={<button className="button primary" onClick={() => setEditing(blank(tab))}><Plus size={16} /> Nuevo registro</button>} />
    {notice && <div className="toast">{notice}</div>}
    <div className="stat-grid org-structure-summary">{counts.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Catalogo maestro</span></div></div>)}</div>
    <div className="tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setEditing(null); }}>{item.label}</button>)}</div>
    <section className="panel"><div className="panel-head"><div><h3>{tabs.find((item) => item.id === tab)?.label}</h3><p>Administracion de relaciones y estados disponibles para operacion.</p></div></div><div className="panel-body"><table><thead><tr><th>Codigo</th><th>Nombre</th><th>Relacion principal</th><th>Relacion secundaria</th><th>Estado</th><th>Accion</th></tr></thead><Rows type={tab} onEdit={setEditing} /></table></div></section>
    {editing && <section className="panel"><div className="panel-head"><div><h3>{editing.code ? "Editar registro" : "Nuevo registro"}</h3><p>Los cambios quedan disponibles para los modulos conectados.</p></div><button className="button primary" onClick={save}>Guardar estructura</button></div><div className="panel-body"><Editor type={tab} item={editing} onChange={setEditing} /></div></section>}
  </>;
}
