import type { Role } from "./index";

export type SettlementConfigStatus = "ACTIVO" | "INACTIVO";
export type SettlementPeriodicity = "MENSUAL" | "QUINCENAL" | "SEMANAL" | "EVENTUAL";
export type SettlementTypeKind = "NORMAL" | "SAC" | "FINAL" | "AJUSTE" | "VACACIONES" | "PREMIO" | "OTRO";
export type SettlementProcessStatus = "BORRADOR" | "PRELIQUIDADO" | "CERRADO" | "EXPORTADO";

export interface SettlementValidationRule {
  id: string;
  name: string;
  description: string;
  severity: "INFO" | "ADVERTENCIA" | "BLOQUEANTE";
  enabled: boolean;
}

export interface FinnegansSettlementLink {
  id: string;
  code: string;
  name: string;
  exportCode: string;
  status: SettlementConfigStatus;
  notes?: string;
}

export interface SettlementConfigHistoryRecord {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
}

export interface SettlementConfig {
  id: string;
  code: string;
  name: string;
  kind: SettlementTypeKind;
  periodicity: SettlementPeriodicity;
  status: SettlementConfigStatus;
  description: string;
  defaultProcessStatus: SettlementProcessStatus;
  closesAttendance: boolean;
  exportsToFinnegans: boolean;
  includesNovelties: boolean;
  includesHourConcepts: boolean;
  includesDocumentsValidation: boolean;
  allowedRoles: Role[];
  approvalRoles: Role[];
  noveltyTypeIds: string[];
  hourConceptIds: string[];
  validationRules: SettlementValidationRule[];
  finnegansLinks: FinnegansSettlementLink[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  history: SettlementConfigHistoryRecord[];
}

export interface SettlementConfigFilters {
  search: string;
  kind: string;
  periodicity: string;
  exportsToFinnegans: string;
  status: string;
}
