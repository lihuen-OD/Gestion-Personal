import type { Role } from "./index";

export type HourConceptStatus = "ACTIVO" | "INACTIVO";
export type HourConceptKind = "NORMAL" | "EXTRA" | "FERIADO" | "NOCTURNA" | "GUARDIA" | "SERENO" | "TRANSPORTE" | "OTRO";
export type HourConceptUnit = "HORAS";

export interface HourConceptRules {
  defaultUnit: HourConceptUnit;
}

export interface HourConceptHistoryRecord {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
}

export interface HourConcept {
  id: string;
  code: string;
  name: string;
  kind: HourConceptKind;
  description: string;
  status: HourConceptStatus;
  rules: HourConceptRules;
  allowedLoadRoles: Role[];
  approvalRoles: Role[];
  finnegansLinks?: never[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  history: HourConceptHistoryRecord[];
}

export interface HourConceptFilters {
  search: string;
  kind: string;
  status: string;
}
