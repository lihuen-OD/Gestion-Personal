import type { Role } from "./index";

export type HourConceptStatus = "ACTIVO" | "INACTIVO";
export type HourConceptKind = "NORMAL" | "EXTRA" | "FERIADO" | "NOCTURNA" | "FRANCO" | "GUARDIA" | "AUSENCIA_HORARIA" | "LLEGADA_TARDE" | "OTRO";
export type HourConceptUnit = "HORAS" | "DIAS" | "EVENTOS";

export interface HourConceptRules {
  affectsAttendance: boolean;
  affectsSettlement: boolean;
  requiresApproval: boolean;
  requiresObservation: boolean;
  allowsManualLoad: boolean;
  allowsRange: boolean;
  allowsQuantity: boolean;
  defaultUnit: HourConceptUnit;
  multiplier: number;
  maxDailyHours?: number;
}

export interface FinnegansHourConceptLink {
  id: string;
  code: string;
  name: string;
  settlementConcept: string;
  priority: number;
  status: HourConceptStatus;
  notes?: string;
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
  finnegansLinks: FinnegansHourConceptLink[];
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
  affectsSettlement: string;
  requiresApproval: string;
  status: string;
}
