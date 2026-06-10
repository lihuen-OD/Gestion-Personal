import type { Role } from "./index";

export type AuditParameterStatus = "ACTIVO" | "INACTIVO";
export type AuditEventScope = "LEGAJO" | "NOVEDAD" | "HORAS" | "LIQUIDACION" | "DOCUMENTACION" | "PUESTOS" | "CONFIGURACION" | "ORGANIGRAMA" | "USUARIOS";
export type AuditEventSeverity = "INFO" | "ADVERTENCIA" | "CRITICO";
export type AuditRetentionUnit = "DIAS" | "MESES" | "ANIOS";

export interface AuditNotificationRule {
  enabled: boolean;
  rolesToNotify: Role[];
  notifyOnCreate: boolean;
  notifyOnUpdate: boolean;
  notifyOnDeleteOrDeactivate: boolean;
  notifyOnExport: boolean;
}

export interface AuditRetentionRule {
  amount: number;
  unit: AuditRetentionUnit;
  lockAfterClose: boolean;
  allowExport: boolean;
}

export interface AuditParameterHistoryRecord {
  id: string;
  action: string;
  description: string;
  createdAt: string;
  createdByUserId: string;
  createdByUserName: string;
}

export interface AuditParameter {
  id: string;
  code: string;
  name: string;
  scope: AuditEventScope;
  severity: AuditEventSeverity;
  status: AuditParameterStatus;
  description: string;
  trackCreate: boolean;
  trackUpdate: boolean;
  trackDeleteOrDeactivate: boolean;
  trackApproval: boolean;
  trackExport: boolean;
  requiresReason: boolean;
  requiresEffectiveDate: boolean;
  visibleToRoles: Role[];
  notification: AuditNotificationRule;
  retention: AuditRetentionRule;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  history: AuditParameterHistoryRecord[];
}

export interface AuditParameterFilters {
  search: string;
  scope: string;
  severity: string;
  requiresReason: string;
  status: string;
}
