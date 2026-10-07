import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type {
  OrgArea,
  OrgBusinessUnit,
  OrgCompany,
  OrgCostCenter,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureEntityType,
  OrgStructureStatus,
  OrgZone,
} from "../../types/orgStructure.types";

// Contrato de GET/POST/PATCH /api/org-structure (docs/BACKEND_API_CONTRACTS.md,
// etapa A2 de docs/decisions/ORG_LOCATION_REORGANIZATION.md). El overview
// trae el padre del modelo nuevo de cada nodo y, hasta M2, los padres del
// modelo anterior sólo de lectura. Las altas/ediciones envían únicamente el
// padre del modelo nuevo.

type ApiCompany = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
};

type ApiBusinessUnit = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  companyId: string;
};

type ApiSector = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  businessUnitId?: string | null;
  areaId?: string | null;
};

type ApiArea = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  sectorId?: string | null;
  establishmentId?: string | null;
};

type ApiZone = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
};

type ApiEstablishment = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  zoneId?: string | null;
  companyId?: string | null;
  businessUnitId?: string | null;
  province?: string | null;
  department?: string | null;
  city?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  postalCode?: string | null;
};

type ApiCostCenter = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  companies?: Array<{ companyId: string }>;
  businessUnits?: Array<{ businessUnitId: string }>;
  establishments?: Array<{ establishmentId: string }>;
  areas?: Array<{ areaId: string }>;
  sectors?: Array<{ sectorId: string }>;
};

type ApiOrgStructureResponse = {
  data: {
    companies: ApiCompany[];
    businessUnits: ApiBusinessUnit[];
    sectors: ApiSector[];
    areas: ApiArea[];
    zones?: ApiZone[];
    establishments: ApiEstablishment[];
    costCenters: ApiCostCenter[];
  };
};

function compactIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

function mapCompany(item: ApiCompany): OrgCompany {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    legalName: item.name,
    cuit: "",
    status: item.status,
  };
}

function mapBusinessUnit(item: ApiBusinessUnit): OrgBusinessUnit {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    companyId: item.companyId,
    status: item.status,
  };
}

function mapSector(item: ApiSector): OrgSector {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    businessUnitId: item.businessUnitId || undefined,
    areaId: item.areaId || undefined,
    pendingReload: !item.businessUnitId,
    status: item.status,
  };
}

function mapArea(item: ApiArea): OrgArea {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    sectorId: item.sectorId || undefined,
    establishmentId: item.establishmentId || undefined,
    pendingReload: !item.sectorId,
    status: item.status,
  };
}

function mapZone(item: ApiZone): OrgZone {
  return { id: item.id, code: item.code, name: item.name, status: item.status };
}

function mapEstablishment(item: ApiEstablishment): OrgEstablishment {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    zoneId: item.zoneId || undefined,
    companyId: item.companyId || undefined,
    businessUnitId: item.businessUnitId || undefined,
    pendingReload: !item.zoneId,
    province: item.province || "",
    department: item.department || "",
    locality: item.city || "",
    address: item.street || "",
    streetNumber: item.streetNumber || "",
    postalCode: item.postalCode || "",
    status: item.status,
  };
}

function mapCostCenter(item: ApiCostCenter): OrgCostCenter {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    companyIds: compactIds((item.companies || []).map((link) => link.companyId)),
    businessUnitIds: compactIds((item.businessUnits || []).map((link) => link.businessUnitId)),
    establishmentIds: compactIds((item.establishments || []).map((link) => link.establishmentId)),
    areaIds: compactIds((item.areas || []).map((link) => link.areaId)),
    sectorIds: compactIds((item.sectors || []).map((link) => link.sectorId)),
    finnegansCode: item.code,
    status: item.status,
  };
}

function mapCatalog(response: ApiOrgStructureResponse): OrgStructureCatalog {
  return {
    companies: response.data.companies.map(mapCompany),
    businessUnits: response.data.businessUnits.map(mapBusinessUnit),
    sectors: response.data.sectors.map(mapSector),
    areas: response.data.areas.map(mapArea),
    zones: (response.data.zones ?? []).map(mapZone),
    establishments: response.data.establishments.map(mapEstablishment),
    costCenters: response.data.costCenters.map(mapCostCenter),
  };
}

function isOrgStructureCatalog(value: OrgStructureCatalog): boolean {
  return Boolean(
    value
      && Array.isArray(value.companies)
      && Array.isArray(value.businessUnits)
      && Array.isArray(value.establishments)
      && Array.isArray(value.areas)
      && Array.isArray(value.sectors)
      && Array.isArray(value.zones)
      && Array.isArray(value.costCenters),
  );
}

async function writeAndRefresh<T>(request: Promise<T>) {
  try {
    return await request;
  } finally {
    await invalidateCacheFamily("org-structure", "org-structure mutation");
    await invalidateCacheFamily("positions", "org-structure mutation");
    await invalidateCacheFamily("employees", "org-structure mutation");
    await invalidateCacheFamily("dashboard", "org-structure mutation");
  }
}

// PATCH: el padre del modelo nuevo se envía sólo si el registro lo tiene. Un
// registro de la estructura anterior (sin padre nuevo) puede corregir código,
// nombre o estado sin enviar padre; el backend no lo reubica (409).
function parentPatch(field: "businessUnitId" | "sectorId" | "zoneId", value: string | undefined) {
  return value ? { [field]: value } : {};
}

function establishmentAddress(item: OrgEstablishment) {
  return { province: item.province, department: item.department, city: item.locality, street: item.address, streetNumber: item.streetNumber || null, postalCode: item.postalCode || null };
}

export const orgStructureApiService = {
  async getCatalog(): Promise<OrgStructureCatalog> {
    return cachedData({
      requestKey: "GET:/org-structure",
      policy: cachePolicies.orgStructureCatalog,
      fetcher: () => apiRequest<ApiOrgStructureResponse>("/org-structure", { apiCache: false }).then(mapCatalog),
      validate: isOrgStructureCatalog,
    });
  },

  clearCache: () => invalidateCacheFamily("org-structure", "manual clear"),

  createCompany: (item: OrgCompany) => writeAndRefresh(apiRequest("/org-structure/companies", { method: "POST", body: { code: item.code, name: item.name, status: item.status } })),
  updateCompany: (item: OrgCompany) => writeAndRefresh(apiRequest(`/org-structure/companies/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status } })),

  createBusinessUnit: (item: OrgBusinessUnit) => writeAndRefresh(apiRequest("/org-structure/business-units", { method: "POST", body: { code: item.code, name: item.name, status: item.status, companyId: item.companyId } })),
  updateBusinessUnit: (item: OrgBusinessUnit) => writeAndRefresh(apiRequest(`/org-structure/business-units/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, companyId: item.companyId } })),

  createSector: (item: OrgSector) => writeAndRefresh(apiRequest("/org-structure/sectors", { method: "POST", body: { code: item.code, name: item.name, status: item.status, businessUnitId: item.businessUnitId } })),
  updateSector: (item: OrgSector) => writeAndRefresh(apiRequest(`/org-structure/sectors/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, ...parentPatch("businessUnitId", item.businessUnitId) } })),

  createArea: (item: OrgArea) => writeAndRefresh(apiRequest("/org-structure/areas", { method: "POST", body: { code: item.code, name: item.name, status: item.status, sectorId: item.sectorId } })),
  updateArea: (item: OrgArea) => writeAndRefresh(apiRequest(`/org-structure/areas/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, ...parentPatch("sectorId", item.sectorId) } })),

  createZone: (item: OrgZone) => writeAndRefresh(apiRequest("/org-structure/zones", { method: "POST", body: { code: item.code, name: item.name, status: item.status } })),
  updateZone: (item: OrgZone) => writeAndRefresh(apiRequest(`/org-structure/zones/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status } })),

  createEstablishment: (item: OrgEstablishment) => writeAndRefresh(apiRequest("/org-structure/establishments", { method: "POST", body: { code: item.code, name: item.name, status: item.status, zoneId: item.zoneId, ...establishmentAddress(item) } })),
  updateEstablishment: (item: OrgEstablishment) => writeAndRefresh(apiRequest(`/org-structure/establishments/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, ...parentPatch("zoneId", item.zoneId), ...establishmentAddress(item) } })),

  createCostCenter: (item: OrgCostCenter) => writeAndRefresh(apiRequest("/org-structure/cost-centers", { method: "POST", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds, areaIds: item.areaIds, sectorIds: item.sectorIds } })),
  updateCostCenter: (item: OrgCostCenter) => writeAndRefresh(apiRequest(`/org-structure/cost-centers/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds, areaIds: item.areaIds, sectorIds: item.sectorIds } })),

  // Eliminación definitiva (sólo registros sin dependencias; si las tiene, el
  // backend responde 409 con el motivo de negocio).
  deleteEntity: (type: OrgStructureEntityType, id: string) => writeAndRefresh(apiRequest(`/org-structure/${orgEntityPaths[type]}/${encodeURIComponent(id)}`, { method: "DELETE" })),
};

const orgEntityPaths: Record<OrgStructureEntityType, string> = {
  COMPANY: "companies",
  BUSINESS_UNIT: "business-units",
  SECTOR: "sectors",
  AREA: "areas",
  ZONE: "zones",
  ESTABLISHMENT: "establishments",
  COST_CENTER: "cost-centers",
};
