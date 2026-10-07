import type { Employee, EmployeeStatus } from "./index";

export type OrgCategoryGroup = "DIRECCION" | "ESPECIAL" | "ADMINISTRATIVO" | "ENCARGADO" | "OPERARIO" | "SIN_CATEGORIA";

export interface OrgCategory {
  id: string;
  label: string;
  order: number;
  group: OrgCategoryGroup;
  backgroundColor: string;
  nodeColor: string;
}

// A7: la cadena anterior (unidad de negocio / establecimiento / sector
// derivados del sector del legajo) dejó de filtrarse acá; alcance del puesto,
// ubicación y sector anterior se filtran en el backend (EmployeeStructureFilterValue).
export interface OrgChartFilters {
  company: string;
  costCenter: string;
  position: string;
  internalCategory: string;
  receiptCategory: string;
  status: "" | EmployeeStatus;
  directManager: string;
  timeResponsible: string;
  search: string;
}

export interface OrgEmployeeNode {
  id: string;
  employee: Employee;
  category: OrgCategory;
  x: number;
  y: number;
  orphan: boolean;
}

export interface OrgEdge {
  id: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  path: string;
}

export interface OrgChartModel {
  employees: Employee[];
  categories: OrgCategory[];
  nodes: OrgEmployeeNode[];
  edges: OrgEdge[];
  width: number;
  height: number;
}
