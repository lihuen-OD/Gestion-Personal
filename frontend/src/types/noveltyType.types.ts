import type { Role } from "./index";

export type NoveltyTypeStatus = "ACTIVO" | "INACTIVO";
export type NoveltyTypeKind = "AUSENCIA" | "LICENCIA" | "HORARIA" | "ACCIDENTE" | "VACACIONES" | "SANCION" | "OTRO";
export type NoveltyTypeOrigin = "INTERNA" | "FINNEGANS" | "MIXTA";
export type NoveltyTimeImpact = "NO_AFECTA_HORAS" | "REGISTRA_HORAS_NO_TRABAJADAS" | "BLOQUEA_CARGA_DIA";
export type NoveltyUiColor =
  | "blue"
  | "sky"
  | "cyan"
  | "teal"
  | "emerald"
  | "green"
  | "lime"
  | "amber"
  | "orange"
  | "red"
  | "rose"
  | "pink"
  | "violet"
  | "purple"
  | "slate";

export interface FinnegansNoveltyLink {
  id: string;
  code: string;
  name: string;
  exportConcept: string;
  settlementConcept?: string;
  priority: number;
  status: NoveltyTypeStatus;
  notes?: string;
  hasValidity?: boolean;
}

export interface NoveltyTypeRules {
  exportsToFinnegans: boolean;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  allowsHours: boolean;
  allowsDateTo: boolean;
  hasValidity: boolean;
  blocksTimeEntry: boolean;
  setsWorkedHoursToZero: boolean;
  timeImpact: NoveltyTimeImpact;
  affectsSettlement?: boolean;
  settlementImpact?: string;
  hourConceptName?: string;
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
  uiColor: NoveltyUiColor;
  kind: NoveltyTypeKind;
  origin: NoveltyTypeOrigin;
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
  exportsToFinnegans: string;
  requiresApproval: string;
  status: string;
}
