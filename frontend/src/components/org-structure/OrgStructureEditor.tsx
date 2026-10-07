import { GeoAddressFields } from "../GeoAddressFields";
import { Badge } from "../ui/Badge";
import type { EmployeeAddress } from "../../types";
import type { OrgCostCenter, OrgStructureCatalog, OrgStructureEntity, OrgStructureEntityType, OrgStructureStatus } from "../../types/orgStructure.types";
import { costCenterLinkOptions, isPendingReload, legacyCostCenterLinks, legacyLocation, parentField, parentIdOf, parentOptions, type Option } from "./orgStructureEntities";
import { knownMoveBlockers, orgNodeTypeLabels, orgParentType, PENDING_RELOAD_LABEL } from "./orgStructureTree";

function TextField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <label>{label}<input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function StatusField({ value, onChange }: { value: OrgStructureStatus; onChange: (value: OrgStructureStatus) => void }) {
  return <label>Estado<select value={value} onChange={(event) => onChange(event.target.value as OrgStructureStatus)}><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option></select></label>;
}

function MultiRelation({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (value: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  return <div className="catalog-check-block"><small>{label}</small>{options.length
    ? <div className="check-grid inline">{options.map((option) => <label className="check-card" key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={() => toggle(option.id)} />{option.name}</label>)}</div>
    : <p className="org-parent-hint">Todavía no hay elementos cargados en la estructura nueva.</p>}</div>;
}

const parentPhrase: Partial<Record<OrgStructureEntityType, [indefinite: string, active: string]>> = {
  COMPANY: ["una empresa", "activa"],
  BUSINESS_UNIT: ["una unidad de negocio", "activa"],
  SECTOR: ["un sector", "activo"],
  ZONE: ["una zona", "activa"],
};

function joinSpanish(parts: string[]) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/**
 * Padre del modelo nuevo. Reglas del backend (A2):
 * - obligatorio, activo y del modelo nuevo;
 * - un registro de la estructura anterior no se reubica (sólo se corrige
 *   código, nombre o estado);
 * - D-9 (ratificada): un nodo en uso no cambia de padre.
 */
function ParentField({ type, item, catalog, isNew, onChange }: { type: OrgStructureEntityType; item: OrgStructureEntity; catalog: OrgStructureCatalog; isNew: boolean; onChange: (parentId: string | undefined) => void }) {
  const parentType = orgParentType[type];
  if (!parentType) return null;
  const label = `${orgNodeTypeLabels[parentType]} *`;
  if (isPendingReload(item)) {
    return <div className="org-parent-block">
      <small>Ubicación en la estructura</small>
      <div><Badge tone="warning">{PENDING_RELOAD_LABEL}</Badge></div>
      <p className="org-parent-hint">{legacyLocation(type, item, catalog)}. Este registro pertenece a la estructura anterior: no se ubica en la estructura nueva. Cargá {type === "AREA" ? "una nueva" : "uno nuevo"} con su {orgNodeTypeLabels[parentType].toLowerCase()} correspondiente; acá sólo se corrigen código, nombre o estado.</p>
    </div>;
  }
  const current = parentIdOf(type, item);
  const blockers = isNew ? [] : knownMoveBlockers(type, item.id, catalog);
  const locked = blockers.length > 0;
  return <div className="org-parent-block">
    <small>Ubicación en la estructura</small>
    <label>{label}<select aria-label={label} value={current || ""} disabled={locked} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">Seleccioná {parentPhrase[parentType]![0]}</option>
      {parentOptions(type, catalog, current).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select></label>
    {locked
      ? <p className="org-parent-hint blocked" role="note">No se puede mover porque tiene {joinSpanish(blockers)}. Moverlo cambiaría su alcance para todos ellos; reorganizar elementos en uso requiere una operación específica.</p>
      : <p className="org-parent-hint">{isNew ? `Elegí ${parentPhrase[parentType]![0]} ${parentPhrase[parentType]![1]} de la estructura nueva.` : "Sólo se puede cambiar mientras no tenga elementos asociados. Si alguno existe (por ejemplo alcances de puestos o reglas de horas especiales), el sistema lo rechaza e informa el motivo."}</p>}
  </div>;
}

function CostCenterLinks({ item, catalog, onChange }: { item: OrgCostCenter; catalog: OrgStructureCatalog; onChange: (patch: Partial<OrgCostCenter>) => void }) {
  const options = costCenterLinkOptions(catalog, item);
  const legacy = legacyCostCenterLinks(catalog, item);
  return <>
    <MultiRelation label="Empresas" options={options.companies} value={item.companyIds} onChange={(companyIds) => onChange({ companyIds })} />
    <MultiRelation label="Unidades de negocio" options={options.businessUnits} value={item.businessUnitIds} onChange={(businessUnitIds) => onChange({ businessUnitIds })} />
    <MultiRelation label="Sectores" options={options.sectors} value={item.sectorIds} onChange={(sectorIds) => onChange({ sectorIds })} />
    <MultiRelation label="Áreas" options={options.areas} value={item.areaIds} onChange={(areaIds) => onChange({ areaIds })} />
    <MultiRelation label="Establecimientos" options={options.establishments} value={item.establishmentIds} onChange={(establishmentIds) => onChange({ establishmentIds })} />
    {legacy.length ? <div className="info-note compact"><b>Vínculos con la estructura anterior</b><p>{legacy.join(", ")}. Se conservan hasta la limpieza controlada; se pueden quitar, pero no se pueden agregar vínculos nuevos a registros anteriores.</p></div> : null}
  </>;
}

export function OrgStructureEditor({ type, item, catalog, isNew, onChange }: { type: OrgStructureEntityType; item: OrgStructureEntity; catalog: OrgStructureCatalog; isNew: boolean; onChange: (item: OrgStructureEntity) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...item, ...patch } as OrgStructureEntity);
  const field = parentField[type];
  const address: EmployeeAddress | undefined = "province" in item ? {
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

  return <div className="org-structure-editor">
    <div className="form-grid">
      <TextField label="Código" value={item.code} disabled onChange={() => undefined} />
      <TextField label="Nombre *" value={item.name} onChange={(name) => set({ name })} />
      <StatusField value={item.status} onChange={(status) => set({ status })} />
      {"legalName" in item && <TextField label="Razón social" value={item.legalName} onChange={(legalName) => set({ legalName })} />}
      {"cuit" in item && <TextField label="CUIT" value={item.cuit} onChange={(cuit) => set({ cuit })} />}
      {"finnegansCode" in item && <TextField label="Código Finnegans" value={item.finnegansCode || ""} onChange={(finnegansCode) => set({ finnegansCode })} />}
      <div className="form-wide"><label>Observaciones<textarea value={item.notes || ""} onChange={(event) => set({ notes: event.target.value })} /></label></div>
    </div>
    {field ? <ParentField type={type} item={item} catalog={catalog} isNew={isNew} onChange={(parentId) => set({ [field]: parentId })} /> : null}
    {address && <div className="form-wide org-geo-panel"><GeoAddressFields value={address} onChange={(value) => set({ province: value.provinciaNombre, department: value.departamentoNombre, locality: value.localidadNombre, address: value.calle, streetNumber: value.numero, postalCode: value.codigoPostal })} showGeoActions={false} /></div>}
    {type === "COST_CENTER" && "companyIds" in item ? <CostCenterLinks item={item} catalog={catalog} onChange={set} /> : null}
  </div>;
}

/** Validación previa al guardado (el backend vuelve a validar todo). */
export function editorValidationError(type: OrgStructureEntityType, item: OrgStructureEntity): string | null {
  if (!item.name.trim()) return "Completá el nombre antes de guardar.";
  const parentType = orgParentType[type];
  if (parentType && !isPendingReload(item) && !parentIdOf(type, item)) return `Elegí ${parentPhrase[parentType]![0]} antes de guardar.`;
  return null;
}
