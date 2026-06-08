import type { Role } from "./index";

export type NoveltyTypeStatus = "ACTIVO" | "INACTIVO";
export type NoveltyTypeKind = "AUSENCIA" | "LICENCIA" | "HORARIA" | "ACCIDENTE" | "VACACIONES" | "SANCION" | "OTRO";

export interface FinnegansNoveltyLink {
  id: string;
  code: string;
  name: string;
  settlementConcept: string;
  priority: number;
  status: NoveltyTypeStatus;
  notes?: string;
}

export interface NoveltyTypeRules {
  affectsAttendance: boolean;
  affectsSettlement: boolean;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  allowsFullDay: boolean;
  allowsHalfDay: boolean;
  allowsHours: boolean;
  allowsDateTo: boolean;
  allowsQuantityDays: boolean;
  allowsQuantityHours: boolean;
}

export interface NoveltyTypeHistoryRecord {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
}

export interface NoveltyType {
  id: string;
  code: string;
  name: string;
  kind: NoveltyTypeKind;
  description: string;
  status: NoveltyTypeStatus;
  rules: NoveltyTypeRules;
  allowedLoadRoles: Role[];
  approvalRoles: Role[];
  finnegansLinks: FinnegansNoveltyLink[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  history: NoveltyTypeHistoryRecord[];
}

export interface NoveltyTypeFilters {
  search: string;
  kind: string;
  affectsSettlement: string;
  requiresApproval: string;
  status: string;
}
