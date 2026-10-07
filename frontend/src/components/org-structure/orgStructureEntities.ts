import type {
  OrgArea,
  OrgBusinessUnit,
  OrgCostCenter,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureEntity,
  OrgStructureEntityType,
} from "../../types/orgStructure.types";
import { sortItems } from "../../utils/sort";
import { orgParentType } from "./orgStructureTree";

// Configuración por tipo de la pantalla Empresas y estructura
// (docs/decisions/ORG_LOCATION_REORGANIZATION.md, etapa A4). Las tres
// secciones se administran por separado: Organización, Ubicaciones y Centros
// de costo.

export type OrgSectionKey = "ORGANIZATION" | "LOCATION" | "COST_CENTERS";

export const orgSections: Array<{ key: OrgSectionKey; label: string; types: OrgStructureEntityType[]; subtitle: string }> = [
  { key: "ORGANIZATION", label: "Organización", types: ["COMPANY", "BUSINESS_UNIT", "SECTOR", "AREA"], subtitle: "Empresa → Unidad de negocio → Sector → Área. Define el alcance organizativo de los puestos." },
  { key: "LOCATION", label: "Ubicaciones", types: ["ZONE", "ESTABLISHMENT"], subtitle: "Zona → Establecimiento. Lugares físicos donde trabajan las personas, independientes de la organización." },
  { key: "COST_CENTERS", label: "Centros de costo", types: ["COST_CENTER"], subtitle: "Catálogo financiero vinculable a elementos de ambos árboles." },
];

export function sectionOf(type: OrgStructureEntityType): OrgSectionKey {
  return orgSections.find((section) => section.types.includes(type))!.key;
}

export const orgTypeTabLabels: Record<OrgStructureEntityType, string> = {
  COMPANY: "Empresas",
  BUSINESS_UNIT: "Unidades de negocio",
  SECTOR: "Sectores",
  AREA: "Áreas",
  ZONE: "Zonas",
  ESTABLISHMENT: "Establecimientos",
  COST_CENTER: "Centros de costo",
};

export const newButtonLabels: Record<OrgStructureEntityType, string> = {
  COMPANY: "Nueva empresa",
  BUSINESS_UNIT: "Nueva unidad de negocio",
  SECTOR: "Nuevo sector",
  AREA: "Nueva área",
  ZONE: "Nueva zona",
  ESTABLISHMENT: "Nuevo establecimiento",
  COST_CENTER: "Nuevo centro de costo",
};

export const savedMessages: Record<OrgStructureEntityType, string> = {
  COMPANY: "Empresa guardada correctamente.",
  BUSINESS_UNIT: "Unidad de negocio guardada correctamente.",
  SECTOR: "Sector guardado correctamente.",
  AREA: "Área guardada correctamente.",
  ZONE: "Zona guardada correctamente.",
  ESTABLISHMENT: "Establecimiento guardado correctamente.",
  COST_CENTER: "Centro de costo guardado correctamente.",
};

export const deletedMessages: Record<OrgStructureEntityType, string> = {
  COMPANY: "Empresa eliminada correctamente.",
  BUSINESS_UNIT: "Unidad de negocio eliminada correctamente.",
  SECTOR: "Sector eliminado correctamente.",
  AREA: "Área eliminada correctamente.",
  ZONE: "Zona eliminada correctamente.",
  ESTABLISHMENT: "Establecimiento eliminado correctamente.",
  COST_CENTER: "Centro de costo eliminado correctamente.",
};

export const catalogListKey: Record<OrgStructureEntityType, keyof OrgStructureCatalog> = {
  COMPANY: "companies",
  BUSINESS_UNIT: "businessUnits",
  SECTOR: "sectors",
  AREA: "areas",
  ZONE: "zones",
  ESTABLISHMENT: "establishments",
  COST_CENTER: "costCenters",
};

/** Campo del padre del modelo nuevo en cada tipo. */
export const parentField: Partial<Record<OrgStructureEntityType, "companyId" | "businessUnitId" | "sectorId" | "zoneId">> = {
  BUSINESS_UNIT: "companyId",
  SECTOR: "businessUnitId",
  AREA: "sectorId",
  ESTABLISHMENT: "zoneId",
};

const codePrefix: Record<OrgStructureEntityType, string> = {
  COMPANY: "EMP",
  BUSINESS_UNIT: "UN",
  SECTOR: "SEC",
  AREA: "AREA",
  ZONE: "ZN",
  ESTABLISHMENT: "EST",
  COST_CENTER: "CC",
};

export function itemsOf(catalog: OrgStructureCatalog, type: OrgStructureEntityType): OrgStructureEntity[] {
  return catalog[catalogListKey[type]] as OrgStructureEntity[];
}

export function nextCodeFromCatalog(type: OrgStructureEntityType, catalog: OrgStructureCatalog) {
  const prefix = codePrefix[type];
  const max = itemsOf(catalog, type)
    .filter((item) => item.code.startsWith(`${prefix}-`))
    .reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

const uid = () => crypto.randomUUID();

export function blankEntity(type: OrgStructureEntityType, catalog: OrgStructureCatalog, parentId?: string): OrgStructureEntity {
  const base = { id: uid(), code: nextCodeFromCatalog(type, catalog), name: "", status: "ACTIVO" as const };
  if (type === "COMPANY") return { ...base, legalName: "", cuit: "" };
  if (type === "BUSINESS_UNIT") return { ...base, companyId: parentId ?? "" };
  if (type === "SECTOR") return { ...base, businessUnitId: parentId, pendingReload: false };
  if (type === "AREA") return { ...base, sectorId: parentId, pendingReload: false };
  if (type === "ZONE") return base;
  if (type === "ESTABLISHMENT") return { ...base, zoneId: parentId, pendingReload: false, province: "", department: "", locality: "", address: "", streetNumber: "", postalCode: "" };
  return { ...base, companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: [], finnegansCode: "" };
}

export function parentIdOf(type: OrgStructureEntityType, item: OrgStructureEntity): string | undefined {
  const field = parentField[type];
  return field ? ((item as unknown as Record<string, string | undefined>)[field] || undefined) : undefined;
}

export function isPendingReload(item: OrgStructureEntity) {
  return "pendingReload" in item && item.pendingReload === true;
}

export interface Option { id: string; name: string; disabled?: boolean }

const byName = <T extends { name: string }>(items: readonly T[]) => sortItems(items, (item) => item.name, "asc");
const nameIn = (items: Array<{ id: string; name: string }>, id: string | undefined) => items.find((item) => item.id === id)?.name;

/**
 * Padres elegibles del modelo nuevo (el backend exige existente, ACTIVO y del
 * modelo nuevo). El padre actual inactivo se conserva en la lista para no
 * perderlo al editar otro dato.
 */
export function parentOptions(type: OrgStructureEntityType, catalog: OrgStructureCatalog, currentParentId?: string): Option[] {
  const parentType = orgParentType[type];
  if (!parentType) return [];
  const eligible = (item: { id: string; status: string; pendingReload?: boolean }) => !item.pendingReload && (item.status === "ACTIVO" || item.id === currentParentId);
  const suffix = (item: { status: string }) => (item.status === "ACTIVO" ? "" : " (inactivo)");
  if (parentType === "COMPANY") return byName(catalog.companies.filter(eligible)).map((item) => ({ id: item.id, name: `${item.name}${suffix(item)}` }));
  if (parentType === "BUSINESS_UNIT") return byName(catalog.businessUnits.filter(eligible)).map((item: OrgBusinessUnit) => ({ id: item.id, name: `${nameIn(catalog.companies, item.companyId) ?? "Sin empresa"} · ${item.name}${suffix(item)}` }));
  if (parentType === "SECTOR") return byName(catalog.sectors.filter(eligible)).map((item: OrgSector) => ({ id: item.id, name: `${nameIn(catalog.businessUnits, item.businessUnitId) ?? "Sin unidad"} · ${item.name}${suffix(item)}` }));
  return byName(catalog.zones.filter(eligible)).map((item) => ({ id: item.id, name: `${item.name}${suffix(item)}` }));
}

/** Descripción de la ubicación anterior de un registro pendiente de recarga (sólo lectura). */
export function legacyLocation(type: OrgStructureEntityType, item: OrgStructureEntity, catalog: OrgStructureCatalog): string {
  if (type === "SECTOR") return nameIn(catalog.areas, (item as OrgSector).areaId) ? `Área anterior: ${nameIn(catalog.areas, (item as OrgSector).areaId)}` : "Sin ubicación anterior";
  if (type === "AREA") return nameIn(catalog.establishments, (item as OrgArea).establishmentId) ? `Establecimiento anterior: ${nameIn(catalog.establishments, (item as OrgArea).establishmentId)}` : "Sin ubicación anterior";
  if (type === "ESTABLISHMENT") {
    const establishment = item as OrgEstablishment;
    const parts = [nameIn(catalog.companies, establishment.companyId), nameIn(catalog.businessUnits, establishment.businessUnitId)].filter(Boolean);
    return parts.length ? `Ubicación anterior: ${parts.join(" · ")}` : "Sin ubicación anterior";
  }
  return "";
}

/**
 * Opciones de vínculo de un centro de costo: elementos del modelo nuevo y,
 * sólo si ya estaban vinculados, registros anteriores (marcados). El backend
 * rechaza AGREGAR vínculos a registros anteriores; los existentes se
 * conservan o se pueden quitar.
 */
export function costCenterLinkOptions(catalog: OrgStructureCatalog, costCenter: OrgCostCenter) {
  const withLegacy = <T extends { id: string; name: string; pendingReload?: boolean }>(items: T[], linked: string[]): Option[] =>
    byName(items.filter((item) => !item.pendingReload || linked.includes(item.id)))
      .map((item) => ({ id: item.id, name: item.pendingReload ? `${item.name} (estructura anterior)` : item.name }));
  return {
    companies: byName(catalog.companies).map((item) => ({ id: item.id, name: item.name })),
    businessUnits: byName(catalog.businessUnits).map((item) => ({ id: item.id, name: `${nameIn(catalog.companies, item.companyId) ?? "Sin empresa"} · ${item.name}` })),
    sectors: withLegacy(catalog.sectors, costCenter.sectorIds),
    areas: withLegacy(catalog.areas, costCenter.areaIds),
    establishments: withLegacy(catalog.establishments, costCenter.establishmentIds),
  };
}

/** Vínculos del centro de costo con registros anteriores (se conservan hasta la limpieza). */
export function legacyCostCenterLinks(catalog: OrgStructureCatalog, costCenter: OrgCostCenter) {
  const pending = <T extends { id: string; name: string; pendingReload?: boolean }>(items: T[], ids: string[]) => items.filter((item) => item.pendingReload && ids.includes(item.id)).map((item) => item.name);
  return [...pending(catalog.sectors, costCenter.sectorIds), ...pending(catalog.areas, costCenter.areaIds), ...pending(catalog.establishments, costCenter.establishmentIds)];
}
