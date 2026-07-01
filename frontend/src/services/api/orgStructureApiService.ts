import { apiRequest } from "./apiClient";
import type {
  OrgArea,
  OrgBusinessUnit,
  OrgCompany,
  OrgCostCenter,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureStatus,
} from "../../types/orgStructure.types";

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
  companies?: Array<{ companyId: string }>;
};

type ApiEstablishment = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  companyId: string;
  businessUnitId?: string | null;
  companies?: Array<{ companyId: string }>;
  businessUnits?: Array<{ businessUnitId: string }>;
  province?: string | null;
  department?: string | null;
  city?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  postalCode?: string | null;
};

type ApiArea = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  establishmentId?: string | null;
  establishment?: ApiEstablishment | null;
  businessUnits?: Array<{ businessUnitId: string }>;
  establishments?: Array<{ establishmentId: string }>;
};

type ApiSector = {
  id: string;
  code: string;
  name: string;
  status: OrgStructureStatus;
  areaId?: string | null;
  area?: ApiArea | null;
  areas?: Array<{ areaId: string }>;
  establishments?: Array<{ establishmentId: string }>;
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
    establishments: ApiEstablishment[];
    areas: ApiArea[];
    sectors: ApiSector[];
    costCenters: ApiCostCenter[];
  };
};

let catalogCache: Promise<OrgStructureCatalog> | null = null;

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
    companyIds: compactIds([item.companyId, ...(item.companies || []).map((link) => link.companyId)]),
    status: item.status,
  };
}

function mapEstablishment(item: ApiEstablishment): OrgEstablishment {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    companyIds: compactIds([item.companyId, ...(item.companies || []).map((link) => link.companyId)]),
    businessUnitIds: compactIds([item.businessUnitId, ...(item.businessUnits || []).map((link) => link.businessUnitId)]),
    province: item.province || "",
    department: item.department || "",
    locality: item.city || "",
    address: [item.street, item.streetNumber].filter(Boolean).join(" "),
    status: item.status,
  };
}

function mapArea(item: ApiArea): OrgArea {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    businessUnitIds: compactIds([item.establishment?.businessUnitId, ...(item.businessUnits || []).map((link) => link.businessUnitId)]),
    establishmentIds: compactIds([item.establishmentId, ...(item.establishments || []).map((link) => link.establishmentId)]),
    status: item.status,
  };
}

function mapSector(item: ApiSector): OrgSector {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    areaIds: compactIds([item.areaId, ...(item.areas || []).map((link) => link.areaId)]),
    establishmentIds: compactIds([item.area?.establishmentId, ...(item.establishments || []).map((link) => link.establishmentId)]),
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
    establishments: response.data.establishments.map(mapEstablishment),
    areas: response.data.areas.map(mapArea),
    sectors: response.data.sectors.map(mapSector),
    costCenters: response.data.costCenters.map(mapCostCenter),
  };
}

function clearCatalogCache() {
  catalogCache = null;
}

async function writeAndRefresh<T>(request: Promise<T>) {
  try {
    return await request;
  } finally {
    clearCatalogCache();
  }
}

export const orgStructureApiService = {
  async getCatalog(): Promise<OrgStructureCatalog> {
    catalogCache ??= apiRequest<ApiOrgStructureResponse>("/org-structure").then(mapCatalog);
    return catalogCache;
  },

  clearCache: clearCatalogCache,

  createCompany: (item: OrgCompany) => writeAndRefresh(apiRequest("/org-structure/companies", { method: "POST", body: { code: item.code, name: item.name, status: item.status } })),
  updateCompany: (item: OrgCompany) => writeAndRefresh(apiRequest(`/org-structure/companies/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status } })),

  createBusinessUnit: (item: OrgBusinessUnit) => writeAndRefresh(apiRequest("/org-structure/business-units", { method: "POST", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds } })),
  updateBusinessUnit: (item: OrgBusinessUnit) => writeAndRefresh(apiRequest(`/org-structure/business-units/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds } })),

  createEstablishment: (item: OrgEstablishment) => writeAndRefresh(apiRequest("/org-structure/establishments", { method: "POST", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, province: item.province, department: item.department, city: item.locality, street: item.address } })),
  updateEstablishment: (item: OrgEstablishment) => writeAndRefresh(apiRequest(`/org-structure/establishments/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, province: item.province, department: item.department, city: item.locality, street: item.address } })),

  createArea: (item: OrgArea) => writeAndRefresh(apiRequest("/org-structure/areas", { method: "POST", body: { code: item.code, name: item.name, status: item.status, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds } })),
  updateArea: (item: OrgArea) => writeAndRefresh(apiRequest(`/org-structure/areas/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds } })),

  createSector: (item: OrgSector) => writeAndRefresh(apiRequest("/org-structure/sectors", { method: "POST", body: { code: item.code, name: item.name, status: item.status, areaIds: item.areaIds, establishmentIds: item.establishmentIds } })),
  updateSector: (item: OrgSector) => writeAndRefresh(apiRequest(`/org-structure/sectors/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, areaIds: item.areaIds, establishmentIds: item.establishmentIds } })),

  createCostCenter: (item: OrgCostCenter) => writeAndRefresh(apiRequest("/org-structure/cost-centers", { method: "POST", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds, areaIds: item.areaIds, sectorIds: item.sectorIds } })),
  updateCostCenter: (item: OrgCostCenter) => writeAndRefresh(apiRequest(`/org-structure/cost-centers/${item.id}`, { method: "PATCH", body: { code: item.code, name: item.name, status: item.status, companyIds: item.companyIds, businessUnitIds: item.businessUnitIds, establishmentIds: item.establishmentIds, areaIds: item.areaIds, sectorIds: item.sectorIds } })),
};
