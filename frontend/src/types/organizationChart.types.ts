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

export interface OrgChartFilters {
  company: string;
  businessUnit: string;
  establishment: string;
  costCenter: string;
  sector: string;
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
