import { Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { GeoAddressFields } from "../components/GeoAddressFields";
import { OverflowCell } from "../components/ui/OverflowCell";
import { DataTable } from "../components/ui/DataTable";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { Section } from "../components/ui/Section";
import { StatCard } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";
import { StructureTreeView } from "../components/org-structure/StructureTreeView";
import { StructureNodeDetail } from "../components/org-structure/StructureNodeDetail";
import { buildOrgStructureTree, findNode, orgNodeTypeLabels, type OrgTreeNode } from "../components/org-structure/orgStructureTree";
import { confirmAction } from "../services/appDialog";
import { SortableHeader } from "../components/ui/SortableHeader";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { useAuth } from "../context/AuthContext";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { subscribeCacheEvent } from "../services/cache";
import type { EmployeeAddress, Role } from "../types";
import type { OrgArea, OrgBusinessUnit, OrgCompany, OrgCostCenter, OrgEstablishment, OrgSector, OrgStructureCatalog, OrgStructureEntity, OrgStructureEntityType, OrgStructureStatus } from "../types/orgStructure.types";
import { activoInactivoLabel } from "../utils/status";
import { useAsyncAction } from "../utils/useAsyncAction";
import { useSort, type SortAccessors, type SortValue } from "../utils/sort";

type Tab = OrgStructureEntityType;
type Editable = OrgStructureEntity;
type View = "tree" | "table";

const views: Array<{ key: View; label: string }> = [
  { key: "tree", label: "Vista árbol" },
  { key: "table", label: "Vista tabla" },
];

const emptyCatalog: OrgStructureCatalog = { companies: [], businessUnits: [], establishments: [], areas: [], sectors: [], costCenters: [] };

// Relación con el padre que se precarga al "Agregar ..." desde un nodo del árbol.
function childPrefill(childType: Tab, parentId: string): Partial<Editable> {
  if (childType === "BUSINESS_UNIT") return { companyId: parentId };
  if (childType === "ESTABLISHMENT") return { businessUnitId: parentId };
  if (childType === "AREA") return { establishmentId: parentId };
  if (childType === "SECTOR") return { areaId: parentId };
  if (childType === "COST_CENTER") return { sectorIds: [parentId] };
  return {};
}

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

function nextCodeFromCatalog(type: Tab, catalog: OrgStructureCatalog) {
  const list = type === "COMPANY" ? catalog.companies : type === "BUSINESS_UNIT" ? catalog.businessUnits : type === "ESTABLISHMENT" ? catalog.establishments : type === "AREA" ? catalog.areas : type === "SECTOR" ? catalog.sectors : catalog.costCenters;
  const prefix = type === "COMPANY" ? "EMP" : type === "BUSINESS_UNIT" ? "UN" : type === "ESTABLISHMENT" ? "EST" : type === "AREA" ? "AREA" : type === "SECTOR" ? "SEC" : "CC";
  const max = list.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

function blank(type: Tab, catalog: OrgStructureCatalog): Editable {
  const code = nextCodeFromCatalog(type, catalog);
  if (type === "COMPANY") return { id: uid(), code, name: "", legalName: "", cuit: "", status: "ACTIVO" };
  if (type === "BUSINESS_UNIT") return { id: uid(), code, name: "", companyId: "", status: "ACTIVO" };
  if (type === "ESTABLISHMENT") return { id: uid(), code, name: "", companyId: "", businessUnitId: undefined, province: "", department: "", locality: "", address: "", streetNumber: "", postalCode: "", status: "ACTIVO" };
  if (type === "AREA") return { id: uid(), code, name: "", establishmentId: undefined, status: "ACTIVO" };
  if (type === "SECTOR") return { id: uid(), code, name: "", areaId: undefined, status: "ACTIVO" };
  return { id: uid(), code, name: "", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: [], finnegansCode: "", status: "ACTIVO" };
}

function namesOf(items: { id: string; name: string }[], ids: string[] = []) {
  return ids.map((id) => items.find((item) => item.id === id)?.name).filter(Boolean).join(", ");
}

function nameById(items: { id: string; name: string }[], ids: string[] = []) {
  return namesOf(items, ids) || "-";
}

function nameByOne(items: { id: string; name: string }[], id: string | undefined) {
  return nameById(items, id ? [id] : []);
}

function deriveCompanyId(catalog: OrgStructureCatalog, businessUnitId: string | undefined) {
  return catalog.businessUnits.find((item) => item.id === businessUnitId)?.companyId;
}

function deriveAreaBusinessUnitId(catalog: OrgStructureCatalog, establishmentId: string | undefined) {
  const establishment = catalog.establishments.find((item) => item.id === establishmentId);
  return establishment?.businessUnitId;
}

function deriveSectorEstablishmentId(catalog: OrgStructureCatalog, areaId: string | undefined) {
  const area = catalog.areas.find((item) => item.id === areaId);
  return area?.establishmentId;
}

function normalizeDerivedRelations(type: Tab, item: Editable, catalog: OrgStructureCatalog): Editable {
  if (type === "ESTABLISHMENT" && "businessUnitId" in item) return { ...item, companyId: deriveCompanyId(catalog, item.businessUnitId) || "" } as Editable;
  return item;
}

function SingleRelation({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string | undefined; onChange: (value: string | undefined) => void }) {
  return <label>{label}<select value={value || ""} onChange={(event) => onChange(event.target.value || undefined)}>
    <option value="">-- Sin asignar --</option>
    {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></label>;
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
  return <label>Estado<select value={value} onChange={(event) => onChange(event.target.value as OrgStructureStatus)}><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>;
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

    {"companyId" in item && type === "BUSINESS_UNIT" && <SingleRelation label="Empresa asociada" options={catalog.companies} value={item.companyId} onChange={(companyId) => set({ companyId: companyId || "" } as Partial<Editable>)} />}

    {type === "ESTABLISHMENT" && "companyId" in normalizedItem && <DerivedRelation label="Empresa asociada" value={nameByOne(catalog.companies, normalizedItem.companyId)} />}
    {"businessUnitId" in item && type === "ESTABLISHMENT" && <SingleRelation label="Unidad de negocio asociada" options={catalog.businessUnits} value={item.businessUnitId} onChange={(businessUnitId) => set({ businessUnitId } as Partial<Editable>)} />}

    {"establishmentId" in item && type === "AREA" && <SingleRelation label="Establecimiento asociado" options={catalog.establishments} value={item.establishmentId} onChange={(establishmentId) => set({ establishmentId } as Partial<Editable>)} />}
    {type === "AREA" && "establishmentId" in item && <DerivedRelation label="Unidad de negocio (segun establecimiento)" value={nameByOne(catalog.businessUnits, deriveAreaBusinessUnitId(catalog, item.establishmentId))} />}

    {"areaId" in item && type === "SECTOR" && <SingleRelation label="Area / Departamento asociado" options={catalog.areas} value={item.areaId} onChange={(areaId) => set({ areaId } as Partial<Editable>)} />}
    {type === "SECTOR" && "areaId" in item && <DerivedRelation label="Establecimiento (segun area)" value={nameByOne(catalog.establishments, deriveSectorEstablishmentId(catalog, item.areaId))} />}

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
  return <button className="table-icon-action" title="Editar" aria-label="Editar" onClick={() => onEdit(item)}><Pencil size={14}/><span>Editar</span></button>;
}

function StatusBadge({ status }: { status: OrgStructureStatus }) {
  return <Badge tone={status === "ACTIVO" ? "success" : "neutral"}>{activoInactivoLabel(status)}</Badge>;
}

function Rows({ type, catalog, items, readOnly, onEdit }: { type: Tab; catalog: OrgStructureCatalog; items: readonly Editable[]; readOnly: boolean; onEdit: (item: Editable) => void }) {
  if (type === "COMPANY") return <tbody>{(items as OrgCompany[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.legalName}</span></td><td>{item.cuit || "-"}</td><td>-</td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "BUSINESS_UNIT") return <tbody>{(items as OrgBusinessUnit[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameByOne(catalog.companies, item.companyId)} /></td><td>-</td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "ESTABLISHMENT") return <tbody>{(items as OrgEstablishment[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.locality}, {item.department}</span></td><td><OverflowCell value={nameByOne(catalog.companies, item.companyId)} /></td><td><OverflowCell value={nameByOne(catalog.businessUnits, item.businessUnitId)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "AREA") return <tbody>{(items as OrgArea[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameByOne(catalog.establishments, item.establishmentId)} /></td><td><OverflowCell value={nameByOne(catalog.businessUnits, deriveAreaBusinessUnitId(catalog, item.establishmentId))} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  if (type === "SECTOR") return <tbody>{(items as OrgSector[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /></td><td><OverflowCell value={nameByOne(catalog.areas, item.areaId)} /></td><td><OverflowCell value={nameByOne(catalog.establishments, deriveSectorEstablishmentId(catalog, item.areaId))} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
  return <tbody>{(items as OrgCostCenter[]).map((item) => <tr key={item.id}><td><b>{item.code}</b></td><td><OverflowCell value={item.name} /><span className="table-sub">{item.finnegansCode || "Sin codigo Finnegans"}</span></td><td><OverflowCell value={nameById(catalog.companies, item.companyIds)} /></td><td><OverflowCell value={nameById(catalog.sectors, item.sectorIds)} /></td><td><StatusBadge status={item.status} /></td><td><EditAction item={item} readOnly={readOnly} onEdit={onEdit} /></td></tr>)}</tbody>;
}

type OrgColumnKey = "code" | "name" | "primary" | "secondary" | "status";
type RelationColumnKey = Extract<OrgColumnKey, "primary" | "secondary">;
type OrgSortAccessors = SortAccessors<Editable, OrgColumnKey>;

const orgColumns: Array<{ key: OrgColumnKey; label: string }> = [
  { key: "code", label: "Codigo" },
  { key: "name", label: "Nombre" },
  { key: "primary", label: "Relacion principal" },
  { key: "secondary", label: "Relacion secundaria" },
  { key: "status", label: "Estado" },
];

// Relaciones ordenables por pestaña, por el nombre resuelto (vacío si no hay
// relación, nunca el "-" renderizado). Sin accessor = columna no ordenable
// (ej. "Relacion secundaria" de Empresas/Unidades, siempre "-").
function relationSortAccessors(type: Tab, catalog: OrgStructureCatalog): Partial<Pick<OrgSortAccessors, RelationColumnKey>> {
  const one = (items: { id: string; name: string }[], id: string | undefined) => namesOf(items, id ? [id] : []);
  if (type === "COMPANY") return { primary: (item) => (item as OrgCompany).cuit };
  if (type === "BUSINESS_UNIT") return { primary: (item) => one(catalog.companies, (item as OrgBusinessUnit).companyId) };
  if (type === "ESTABLISHMENT") return {
    primary: (item) => one(catalog.companies, (item as OrgEstablishment).companyId),
    secondary: (item) => one(catalog.businessUnits, (item as OrgEstablishment).businessUnitId),
  };
  if (type === "AREA") return {
    primary: (item) => one(catalog.establishments, (item as OrgArea).establishmentId),
    secondary: (item) => one(catalog.businessUnits, deriveAreaBusinessUnitId(catalog, (item as OrgArea).establishmentId)),
  };
  if (type === "SECTOR") return {
    primary: (item) => one(catalog.areas, (item as OrgSector).areaId),
    secondary: (item) => one(catalog.establishments, deriveSectorEstablishmentId(catalog, (item as OrgSector).areaId)),
  };
  return {
    primary: (item) => namesOf(catalog.companies, (item as OrgCostCenter).companyIds),
    secondary: (item) => namesOf(catalog.sectors, (item as OrgCostCenter).sectorIds),
  };
}

const notSortable = (): SortValue => null;

// Montado con `key={tab}`: el orden arranca sin interacción en cada pestaña.
function OrgStructureTable({ type, catalog, items, onEdit }: { type: Tab; catalog: OrgStructureCatalog; items: readonly Editable[]; onEdit: (item: Editable) => void }) {
  const relations = useMemo(() => relationSortAccessors(type, catalog), [type, catalog]);
  const accessors = useMemo<OrgSortAccessors>(() => ({
    code: (item) => item.code,
    name: (item) => item.name,
    primary: relations.primary ?? notSortable,
    secondary: relations.secondary ?? notSortable,
    status: (item) => activoInactivoLabel(item.status),
  }), [relations]);
  const { sorted, sort, toggleSort } = useSort(items, accessors);
  const isSortable = (key: OrgColumnKey) => (key !== "primary" && key !== "secondary") || Boolean(relations[key]);
  return <table>
    <thead><tr>
      {orgColumns.map((column) => isSortable(column.key)
        ? <SortableHeader key={column.key} label={column.label} sortKey={column.key} sort={sort} onSort={toggleSort} />
        : <th key={column.key}>{column.label}</th>)}
      <th>Accion</th>
    </tr></thead>
    <Rows type={type} catalog={catalog} items={sorted} readOnly={false} onEdit={onEdit} />
  </table>;
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
  // El árbol es la vista principal para explorar; la tabla queda como vista operativa por tipo.
  const [view, setView] = useState<View>("tree");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
        setApiWarning("No pudimos actualizar la estructura compartida. Los cambios de esta sesión se mantendrán localmente.");
      })
      .finally(() => {
        if (alive) setIsLoadingApi(false);
      });
    return () => { alive = false; };
  }, [refresh]);

  const catalog = useMemo(() => apiCatalog ?? emptyCatalog, [apiCatalog]);
  const tree = useMemo(() => buildOrgStructureTree(catalog), [catalog]);
  const selectedNode = useMemo(() => findNode(tree, selectedKey), [tree, selectedKey]);
  const isExisting = useCallback((id: string) => [
    ...catalog.companies,
    ...catalog.businessUnits,
    ...catalog.establishments,
    ...catalog.areas,
    ...catalog.sectors,
    ...catalog.costCenters,
  ].some((item) => item.id === id), [catalog]);
  const usesApiCatalog = Boolean(apiCatalog);
  const counts = useMemo(() => [
    ["Empresas", catalog.companies.length],
    ["Unidades", catalog.businessUnits.length],
    ["Establecimientos", catalog.establishments.length],
    ["Sectores", catalog.sectors.length],
  ] as const, [catalog]);
  // Única vía de escritura (editor y Activar/Inactivar del árbol): crea o actualiza según exista.
  const persist = async (type: Tab, item: Editable) => {
    const normalized = normalizeDerivedRelations(type, item, catalog);
    if (!usesApiCatalog) return;
    const exists = isExisting(normalized.id);
    if (type === "COMPANY") exists ? await orgStructureApiService.updateCompany(normalized as OrgCompany) : await orgStructureApiService.createCompany(normalized as OrgCompany);
    if (type === "BUSINESS_UNIT") exists ? await orgStructureApiService.updateBusinessUnit(normalized as OrgBusinessUnit) : await orgStructureApiService.createBusinessUnit(normalized as OrgBusinessUnit);
    if (type === "ESTABLISHMENT") exists ? await orgStructureApiService.updateEstablishment(normalized as OrgEstablishment) : await orgStructureApiService.createEstablishment(normalized as OrgEstablishment);
    if (type === "AREA") exists ? await orgStructureApiService.updateArea(normalized as OrgArea) : await orgStructureApiService.createArea(normalized as OrgArea);
    if (type === "SECTOR") exists ? await orgStructureApiService.updateSector(normalized as OrgSector) : await orgStructureApiService.createSector(normalized as OrgSector);
    if (type === "COST_CENTER") exists ? await orgStructureApiService.updateCostCenter(normalized as OrgCostCenter) : await orgStructureApiService.createCostCenter(normalized as OrgCostCenter);
  };
  const flashNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 2200);
  };
  const { isRunning: isSaving, run: save } = useAsyncAction(async () => {
    if (!editing?.name.trim()) return setNotice("Completa el nombre antes de guardar.");
    try {
      await persist(tab, editing);
      setRefresh((value) => value + 1);
      setEditing(null);
      flashNotice("Estructura guardada correctamente.");
    } catch {
      setNotice("No se pudo guardar la estructura. Revisa relaciones obligatorias o codigos duplicados.");
    }
  });
  const { isRunning: isTogglingStatus, run: toggleNodeStatus } = useAsyncAction(async (node: OrgTreeNode) => {
    if (!node.entity || node.type === "UNASSIGNED") return;
    const activating = node.status === "INACTIVO";
    const verb = activating ? "activar" : "inactivar";
    const confirmed = await confirmAction(`¿Querés ${verb} ${orgNodeTypeLabels[node.type].toLowerCase()} “${node.name}”? Los elementos dependientes no se modifican.`, { title: `${activating ? "Activar" : "Inactivar"} ${orgNodeTypeLabels[node.type].toLowerCase()}`, confirmLabel: activating ? "Activar" : "Inactivar", tone: activating ? "primary" : "danger" });
    if (!confirmed) return;
    try {
      await persist(node.type, { ...node.entity, status: activating ? "ACTIVO" : "INACTIVO" } as Editable);
      setRefresh((value) => value + 1);
      flashNotice(`${node.name} quedó ${activating ? "activo" : "inactivo"}.`);
    } catch {
      setNotice("No se pudo cambiar el estado. Intentá nuevamente.");
    }
  });

  // Abrir el editor (desde el árbol o la tabla) lo trae a la vista.
  const editorRef = useRef<HTMLDivElement>(null);
  const openEditor = useCallback((type: Tab, item: Editable) => {
    setTab(type);
    setEditing(item);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }, []);
  const editNode = useCallback((node: OrgTreeNode) => {
    if (node.entity && node.type !== "UNASSIGNED") openEditor(node.type, node.entity);
  }, [openEditor]);
  const addChild = (node: OrgTreeNode, childType: Tab) => openEditor(childType, { ...blank(childType, catalog), ...childPrefill(childType, node.id) } as Editable);
  const selectNode = useCallback((node: OrgTreeNode) => setSelectedKey(node.key), []);
  if (roleLevel(user!.role) !== 1) return <Navigate to="/configuracion" />;
  const activeRows = tab === "COMPANY" ? catalog.companies : tab === "BUSINESS_UNIT" ? catalog.businessUnits : tab === "ESTABLISHMENT" ? catalog.establishments : tab === "AREA" ? catalog.areas : tab === "SECTOR" ? catalog.sectors : catalog.costCenters;
  return <>
    <PageHeader eyebrow="CONFIGURACION" title="Empresas y estructura" description="Catalogo maestro de estructura organizacional para alimentar seleccionables, filtros, legajos, puestos y organigrama." action={view === "tree"
      ? <Button variant="primary" icon={Plus} onClick={() => openEditor("COMPANY", blank("COMPANY", catalog))}>Nueva empresa</Button>
      : <Button variant="primary" icon={Plus} onClick={() => openEditor(tab, blank(tab, catalog))}>Nuevo registro</Button>} />
    {notice && <div className="toast">{notice}</div>}
    {apiWarning && <div className="info-note compact"><b>Modo local</b><p>{apiWarning}</p></div>}
    {usesApiCatalog && <div className="info-note compact"><b>Información sincronizada</b><p>Los cambios se guardan y quedan disponibles para los usuarios autorizados.</p></div>}
    <div className="stat-grid org-structure-summary">{counts.map(([label, value]) => <StatCard key={label} label={label} value={value} detail="Catalogo maestro" />)}</div>
    {view === "tree" ? (
      <Section
        title="Estructura organizacional"
        subtitle={isLoadingApi ? "Cargando estructura..." : "Empresa → Unidad de negocio → Establecimiento → Área → Sector → Centro de costo."}
        action={<Tabs className="view-switch" tabs={views} active={view} onChange={(key) => setView(key as View)} />}
      >
        {isLoadingApi && !apiCatalog ? <LoadingState variant="table" rows={6} columns={3} /> : (
          <div className="org-tree-layout">
            <StructureTreeView nodes={tree} selectedKey={selectedKey} onSelect={selectNode} />
            <StructureNodeDetail node={selectedNode} onEdit={editNode} onAddChild={addChild} onToggleStatus={toggleNodeStatus} busy={isTogglingStatus} />
          </div>
        )}
      </Section>
    ) : (
      <>
        <Tabs tabs={tabs.map((item) => ({ key: item.id, label: item.label }))} active={tab} onChange={(key) => { setTab(key as Tab); setEditing(null); }} />
        <Section
          title={tabs.find((item) => item.id === tab)?.label || ""}
          subtitle={isLoadingApi ? "Cargando estructura..." : "Administracion de relaciones y estados disponibles para operacion."}
          action={<Tabs className="view-switch" tabs={views} active={view} onChange={(key) => setView(key as View)} />}
        >
          <DataTable status={isLoadingApi ? "loading" : activeRows.length === 0 ? "empty" : "ready"} minWidth={940} emptyText="No hay registros cargados para esta categoria.">
            <OrgStructureTable key={tab} type={tab} catalog={catalog} items={activeRows} onEdit={(item) => openEditor(tab, item)} />
          </DataTable>
        </Section>
      </>
    )}
    {editing && (
      <div ref={editorRef} className="org-editor-anchor">
        <Section
          title={isExisting(editing.id) ? `Editar ${orgNodeTypeLabels[tab].toLowerCase()}` : `Nuevo registro · ${orgNodeTypeLabels[tab]}`}
          subtitle="Los cambios quedan disponibles para los modulos conectados."
          action={<div className="table-actions"><Button type="button" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" onClick={save} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar estructura"}</Button></div>}
        >
          <Editor type={tab} item={editing} catalog={catalog} onChange={setEditing} />
        </Section>
      </div>
    )}
  </>;
}
