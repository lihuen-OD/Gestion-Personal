import { Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { GeoAddressFields } from "../components/GeoAddressFields";
import { OverflowCell } from "../components/ui/OverflowCell";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { subscribeCacheEvent } from "../services/cache";
import type { EmployeeAddress, Role } from "../types";
import type { OrgArea, OrgBusinessUnit, OrgCompany, OrgCostCenter, OrgEstablishment, OrgSector, OrgStructureCatalog, OrgStructureEntityType, OrgStructureStatus } from "../types/orgStructure.types";
import { useAsyncAction } from "../utils/useAsyncAction";

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

function nextCodeFromCatalog(type: Tab, catalog: OrgStructureCatalog) {
  const list = type === "COMPANY" ? catalog.companies : type === "BUSINESS_UNIT" ? catalog.businessUnits : type === "ESTABLISHMENT" ? catalog.establishments : type === "AREA" ? catalog.areas : type === "SECTOR" ? catalog.sectors : catalog.costCenters;
  const prefix = type === "COMPANY" ? "EMP" : type === "BUSINESS_UNIT" ? "UN" : type === "ESTABLISHMENT" ? "EST" : type === "AREA" ? "AREA" : type === "SECTOR" ? "SEC" : "CC";
  const max = list.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function blank(type: Tab, catalog: OrgStructureCatalog): Editable {
  const code = nextCodeFromCatalog(type, catalog);
  if (type === "COMPANY") return { id: uid(), code, name: "", legalName: "", cuit: "", status: "ACTIVO" };
  if (type === "BUSINESS_UNIT") return { id: uid(), code, name: "", companyIds: [], status: "ACTIVO" };
  if (type === "ESTABLISHMENT") return { id: uid(), code, name: "", companyIds: [], businessUnitIds: [], province: "", department: "", locality: "", address: "", streetNumber: "", postalCode: "", status: "ACTIVO" };
  if (type === "AREA") return { id: uid(), code, name: "", businessUnitIds: [], establishmentIds: [], status: "ACTIVO" };
  if (type === "SECTOR") return { id: uid(), code, name: "", areaIds: [], establishmentIds: [], status: "ACTIVO" };
  return { id: uid(), code, name: "", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: [], finnegansCode: "", status: "ACTIVO" };
}

function nameById(items: { id: string; name: string }[], ids: string[] = []) {
  return ids.map((id) => items.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "-";
}

function deriveCompanyIds(catalog: OrgStructureCatalog, businessUnitIds: string[] = []) {
  return uniqueIds(catalog.businessUnits.filter((item) => businessUnitIds.includes(item.id)).flatMap((item) => item.companyIds));
}

function normalizeDerivedRelations(type: Tab, item: Editable, catalog: OrgStructureCatalog): Editable {
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

function Editor({ type, item, catalog, onChange }: { type: Tab; item: Editable; catalog: OrgStructureCatalog; onChange: (item: Editable) => void }) {
  const normalizedItem = normalizeDerivedRelations(type, item, catalog);
  const set = (patch: Partial<Editable>) => onChange(normalizeDerivedRelations(type, { ...item, ...patch } as Editable, catalog));
  const establishmentAddress: EmployeeAddress | undefined = "province" in item ? {
    calle: item.address,
    numero: item.streetNumber || "",
    provinciaId: "",
    provinciaNombre: item.province,
    departamentoId: "",
    departamentoNombre: item.department,
    localidadId: "",
    localidadNombre: item.locality,
    codigoPostal: item.postalCode || "",
    ubicacionMapa: { lat: null, lng: null, source: "MOCK", label: "" },
  } : undefined;
  const setEstablishmentAddress = (address: EmployeeAddress) => set({
    province: address.provinciaNombre,
    department: address.departamentoNombre,
    locality: address.localidadNombre,
    address: address.calle,
    streetNumber: address.numero,
    postalCode: address.codigoPostal,
  } as Partial<Editable>);

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

function EditAction({ item, readOnly, onEdit }: { item: Editable; readOnly: boolean; onEdit: (item: Editable) => void }) {
  if (readOnly) return <Badge tone="neutral">Solo lectura</Badge>;
  return <button className="table-link table-icon-action" title="Editar" aria-label="Editar" onClick={() => onEdit(item)}><Pencil size={14}/><span>Editar</span></button>;
}

function StatusBadge({ status }: { status: OrgStructureStatus }) {
  return <Badge tone={status === "ACTIVO" ? "success" : "neutral"}>{status}</Badge>;
}

function Rows({ type, catalog, readOnly, onEdit }: { type: Tab; catalog: OrgStructureCatalog; readOnly: boolean; onEdit: (item: Editable) => void }) {
  if (type === "COMPANY") return <tbody>{catalog.companies.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.legalName}</span></td><td>{item.cuit || "-"}</td><td>-</td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "BUSINESS_UNIT") return <tbody>{catalog.businessUnits.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameById(catalog.companies, item.companyIds)} /></td><td>-</td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "ESTABLISHMENT") return <tbody>{catalog.establishments.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.locality}, {item.department}</span></td><td><OverflowCell value={nameById(catalog.companies, deriveCompanyIds(catalog, item.businessUnitIds))} /></td><td><OverflowCell value={nameById(catalog.businessUnits, item.businessUnitIds)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "AREA") return <tbody>{catalog.areas.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameById(catalog.businessUnits, item.businessUnitIds)} /></td><td><OverflowCell value={nameById(catalog.establishments, item.establishmentIds)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "SECTOR") return <tbody>{catalog.sectors.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameById(catalog.areas, item.areaIds)} /></td><td><OverflowCell value={nameById(catalog.establishments, item.establishmentIds)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  return <tbody>{catalog.costCenters.map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.finnegansCode || "Sin codigo Finnegans"}</span></td><td><OverflowCell value={nameById(catalog.companies, item.companyIds)} /></td><td><OverflowCell value={nameById(catalog.sectors, item.sectorIds)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
}

export function OrgStructurePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("COMPANY");
  const [editing, setEditing] = useState<Editable | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [apiCatalog, setApiCatalog] = useState<OrgStructureCatalog | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState(true);
  const [apiWarning, setApiWarning] = useState("");

  useEffect(() => subscribeCacheEvent("updated", (event) => {
    if (event.family === "org-structure") {
      setRefresh((value) => value + 1);
    }
  }), []);

  useEffect(() => {
    let alive = true;
    setIsLoadingApi(true);
    orgStructureApiService.getCatalog()
      .then((value) => {
        if (!alive) return;
        setApiCatalog(value);
        setApiWarning("");
      })
      .catch(() => {
        if (!alive) return;
        setApiCatalog(null);
        setApiWarning("Backend no disponible: usando estructura local editable.");
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  const catalog: OrgStructureCatalog = apiCatalog ?? { companies: [], businessUnits: [], establishments: [], areas: [], sectors: [], costCenters: [] };
  const usesApiCatalog = Boolean(apiCatalog);
  const counts = useMemo(() => [
    ["Empresas", catalog.companies.length],
    ["Unidades", catalog.businessUnits.length],
    ["Establecimientos", catalog.establishments.length],
    ["Sectores", catalog.sectors.length],
  ], [catalog]);
  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing?.name.trim()) return setNotice("Completa el nombre antes de guardar.");
    const normalized = normalizeDerivedRelations(tab, editing, catalog);
    try {
      if (usesApiCatalog) {
        const exists = [
          ...catalog.companies,
          ...catalog.businessUnits,
          ...catalog.establishments,
          ...catalog.areas,
          ...catalog.sectors,
          ...catalog.costCenters,
        ].some((item) => item.id === normalized.id);
        if (tab === "COMPANY") exists ? await orgStructureApiService.updateCompany(normalized as OrgCompany) : await orgStructureApiService.createCompany(normalized as OrgCompany);
        if (tab === "BUSINESS_UNIT") exists ? await orgStructureApiService.updateBusinessUnit(normalized as OrgBusinessUnit) : await orgStructureApiService.createBusinessUnit(normalized as OrgBusinessUnit);
        if (tab === "ESTABLISHMENT") exists ? await orgStructureApiService.updateEstablishment(normalized as OrgEstablishment) : await orgStructureApiService.createEstablishment(normalized as OrgEstablishment);
        if (tab === "AREA") exists ? await orgStructureApiService.updateArea(normalized as OrgArea) : await orgStructureApiService.createArea(normalized as OrgArea);
        if (tab === "SECTOR") exists ? await orgStructureApiService.updateSector(normalized as OrgSector) : await orgStructureApiService.createSector(normalized as OrgSector);
        if (tab === "COST_CENTER") exists ? await orgStructureApiService.updateCostCenter(normalized as OrgCostCenter) : await orgStructureApiService.createCostCenter(normalized as OrgCostCenter);
      }
      setRefresh((value) => value + 1);
      setEditing(null);
      setNotice("Estructura guardada correctamente.");
      setTimeout(() => setNotice(""), 2200);
    } catch {
      setNotice("No se pudo guardar la estructura. Revisa relaciones obligatorias o codigos duplicados.");
    }
  });
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  const activeRows = tab === "COMPANY" ? catalog.companies : tab === "BUSINESS_UNIT" ? catalog.businessUnits : tab === "ESTABLISHMENT" ? catalog.establishments : tab === "AREA" ? catalog.areas : tab === "SECTOR" ? catalog.sectors : catalog.costCenters;
  return <>
    <PageHeader eyebrow="CONFIGURACION" title="Empresas y estructura" description="Catalogo maestro de estructura organizacional para alimentar seleccionables, filtros, legajos, puestos y organigrama." action={<Button variant="primary" icon={Plus} onClick={() => setEditing(blank(tab, catalog))}>Nuevo registro</Button>} />
    {notice && <div className="toast">{notice}</div>}
    {apiWarning && <div className="info-note compact"><b>Modo local</b><p>{apiWarning}</p></div>}
    {usesApiCatalog && <div className="info-note compact"><b>Datos reales</b><p>Lectura y escritura conectadas a backend con soporte de relaciones multiples.</p></div>}
    <div className="stat-grid org-structure-summary">{counts.map(([label, value]) => <div className="stat-card" key={label}><div><small>{label}</small><strong>{value}</strong><span>Catalogo maestro</span></div></div>)}</div>
    <Tabs tabs={tabs.map((item) => ({ key: item.id, label: item.label }))} active={tab} onChange={(key) => { setTab(key as Tab); setEditing(null); }} />
    <Section title={tabs.find((item) => item.id === tab)?.label || ""} subtitle={isLoadingApi ? "Cargando estructura desde backend..." : "Administracion de relaciones y estados disponibles para operacion."}>
      <DataTable status={isLoadingApi ? "loading" : activeRows.length === 0 ? "empty" : "ready"} minWidth={940} emptyText="No hay registros cargados para esta categoria.">
        <table><thead><tr><th>Codigo</th><th>Nombre</th><th>Relacion principal</th><th>Relacion secundaria</th><th>Estado</th><th>Accion</th></tr></thead><Rows type={tab} catalog={catalog} readOnly={false} onEdit={setEditing} /></table>
      </DataTable>
    </Section>
    {editing && (
      <Section
        title={editing.code ? "Editar registro" : "Nuevo registro"}
        subtitle="Los cambios quedan disponibles para los modulos conectados."
        action={<Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar estructura"}</Button>}
      >
        <Editor type={tab} item={editing} catalog={catalog} onChange={setEditing} />
      </Section>
    )}
  </>;
}
