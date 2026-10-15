// Estructura en transición (docs/decisions/ORG_LOCATION_REORGANIZATION.md):
//   Organización: Empresa → Unidad de negocio → Sector → Área
//   Ubicaciones:  Provincia → Zona → Establecimiento → Unidad (opcional)
// Los padres del modelo anterior (Sector.areaId, Area.establishmentId,
// Establishment.companyId/businessUnitId) se conservan SÓLO de lectura para
// los consumidores que todavía los usan (Puestos, Legajos; se adaptan en
// A5–A7). `pendingReload` marca un registro de la estructura anterior: no
// tiene padre del modelo nuevo y la limpieza controlada lo va a eliminar.

export type OrgStructureStatus = "ACTIVO" | "INACTIVO";
export type OrgStructureEntityType = "COMPANY" | "BUSINESS_UNIT" | "SECTOR" | "AREA" | "PROVINCE" | "ZONE" | "ESTABLISHMENT" | "ESTABLISHMENT_UNIT" | "COST_CENTER";

export interface OrgCompany {
  id: string;
  code: string;
  name: string;
  legalName: string;
  cuit: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgBusinessUnit {
  id: string;
  code: string;
  name: string;
  companyId: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgSector {
  id: string;
  code: string;
  name: string;
  /** Padre del modelo nuevo. */
  businessUnitId?: string;
  /** Legado de lectura (modelo anterior). */
  areaId?: string;
  pendingReload?: boolean;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgArea {
  id: string;
  code: string;
  name: string;
  /** Padre del modelo nuevo. */
  sectorId?: string;
  /** Legado de lectura (modelo anterior). */
  establishmentId?: string;
  pendingReload?: boolean;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgProvince {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgZone {
  id: string;
  code: string;
  name: string;
  /** Vacío sólo en zonas anteriores a la provincia: pendientes de recarga (no se infiere). */
  provinceId?: string;
  status: OrgStructureStatus;
  notes?: string;
}

/** Unidad física dentro de un establecimiento (lote, galpón...). Opcional. */
export interface OrgEstablishmentUnit {
  id: string;
  code: string;
  name: string;
  establishmentId: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgEstablishment {
  id: string;
  code: string;
  name: string;
  /** Padre del modelo nuevo (árbol de Ubicaciones). */
  zoneId?: string;
  /** Legado de lectura (modelo anterior). */
  companyId?: string;
  /** Legado de lectura (modelo anterior). */
  businessUnitId?: string;
  pendingReload?: boolean;
  province: string;
  department: string;
  locality: string;
  address: string;
  streetNumber?: string;
  postalCode?: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgCostCenter {
  id: string;
  code: string;
  name: string;
  companyIds: string[];
  businessUnitIds: string[];
  establishmentIds: string[];
  areaIds: string[];
  sectorIds: string[];
  finnegansCode?: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgStructureCatalog {
  companies: OrgCompany[];
  businessUnits: OrgBusinessUnit[];
  sectors: OrgSector[];
  areas: OrgArea[];
  zones: OrgZone[];
  establishments: OrgEstablishment[];
  costCenters: OrgCostCenter[];
  /** Siempre presentes en el catálogo de la API; opcionales para catálogos armados a mano. */
  provinces?: OrgProvince[];
  establishmentUnits?: OrgEstablishmentUnit[];
}

export interface OrgStructureFilters {
  search: string;
  status: string;
}

export type OrgStructureEntity = OrgCompany | OrgBusinessUnit | OrgSector | OrgArea | OrgProvince | OrgZone | OrgEstablishment | OrgEstablishmentUnit | OrgCostCenter;
