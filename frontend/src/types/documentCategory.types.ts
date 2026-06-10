import type { Role } from "./index";

export type DocumentCategoryStatus = "ACTIVO" | "INACTIVO";
export type DocumentCategoryKind = "PERSONAL" | "LABORAL" | "MEDICA" | "LIQUIDACION" | "TRANSPORTE" | "CAPACITACION" | "LEGAL" | "NOVEDAD" | "OTRO";
export type DocumentCategoryScope = "LEGAJO" | "NOVEDAD" | "LIQUIDACION" | "TRANSPORTE" | "ALTA_BAJA" | "PUESTO";

export interface DocumentCategoryRule {
  expires: boolean;
  defaultValidityDays?: number;
  alertBeforeDays: number;
  mandatory: boolean;
  requiresApproval: boolean;
  allowMultipleFiles: boolean;
}

export interface ExternalDocumentLink {
  id: string;
  provider: "FINNEGANS" | "CARPETA_RED" | "OTRO";
  code: string;
  name: string;
  status: DocumentCategoryStatus;
  notes?: string;
}

export interface DocumentCategoryHistoryRecord {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
}

export interface DocumentCategory {
  id: string;
  code: string;
  name: string;
  kind: DocumentCategoryKind;
  status: DocumentCategoryStatus;
  description: string;
  scopes: DocumentCategoryScope[];
  rules: DocumentCategoryRule;
  uploadRoles: Role[];
  viewRoles: Role[];
  approvalRoles: Role[];
  externalLinks: ExternalDocumentLink[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  history: DocumentCategoryHistoryRecord[];
}

export interface DocumentCategoryFilters {
  search: string;
  kind: string;
  scope: string;
  mandatory: string;
  expires: string;
  status: string;
}
