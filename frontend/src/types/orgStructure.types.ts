export type OrgStructureStatus = "ACTIVO" | "INACTIVO";
export type OrgStructureEntityType = "COMPANY" | "BUSINESS_UNIT" | "ESTABLISHMENT" | "AREA" | "SECTOR" | "COST_CENTER";

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
  companyIds: string[];
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgEstablishment {
  id: string;
  code: string;
  name: string;
  companyIds: string[];
  businessUnitIds: string[];
  province: string;
  department: string;
  locality: string;
  address: string;
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgArea {
  id: string;
  code: string;
  name: string;
  businessUnitIds: string[];
  establishmentIds: string[];
  status: OrgStructureStatus;
  notes?: string;
}

export interface OrgSector {
  id: string;
  code: string;
  name: string;
  areaIds: string[];
  establishmentIds: string[];
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
  establishments: OrgEstablishment[];
  areas: OrgArea[];
  sectors: OrgSector[];
  costCenters: OrgCostCenter[];
}

export interface OrgStructureFilters {
  search: string;
  status: string;
}
