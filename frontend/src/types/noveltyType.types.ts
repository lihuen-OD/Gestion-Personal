import type { Role } from "./index";

export type NoveltyTypeStatus = "ACTIVO" | "INACTIVO";
export type NoveltyTypeKind = "AUSENCIA" | "LICENCIA" | "HORARIA" | "ACCIDENTE" | "VACACIONES" | "SANCION" | "OTRO";
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
// Etapa 15L.2A: fuente de verdad del comportamiento en carga horaria.
// Etapa 15L.6 (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md): retiró
// los campos legacy que reemplazaba (blocksTimeEntry/setsWorkedHoursToZero/
// timeImpact).
export type NoveltyTimeEntryBehavior = "NO_BLOQUEA" | "BLOQUEA_NUEVA_CARGA";
// Etapa 15L.2A: unidad real de "Valor 1" para exportación Finnegans. null =
// todavía sin determinar (no se infiere sin evidencia).
export type FinnegansValueUnit = "HOURS" | "DAYS" | "UNIT";

export interface NoveltyTypeRules {
  exportsToFinnegans: boolean;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  allowsHours: boolean;
  timeEntryBehavior: NoveltyTimeEntryBehavior;
  allowsDateRange: boolean;
  finnegansValueUnit: FinnegansValueUnit | null;
  finnegansRequiresValidity: boolean;
}

export interface NoveltyType {
  id: string;
  code: string;
  name: string;
  uiColor: NoveltyUiColor;
  kind: NoveltyTypeKind;
  description: string;
  status: NoveltyTypeStatus;
  rules: NoveltyTypeRules;
  allowedLoadRoles: Role[];
  approvalRoles: Role[];
  // Etapa 15L.6: reemplaza FinnegansNoveltyLink (1:N) -- 1:1 físico, igual
  // que finnegansValueUnit/finnegansRequiresValidity en NoveltyTypeRules.
  finnegansCode: string | null;
  finnegansName: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface NoveltyTypeFilters {
  search: string;
  kind: string;
  exportsToFinnegans: string;
  requiresApproval: string;
  status: string;
}
