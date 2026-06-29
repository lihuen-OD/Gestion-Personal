import { z } from "zod";

export const auditParameterStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
export const auditEventScopeSchema = z.enum([
  "LEGAJO",
  "NOVEDAD",
  "HORAS",
  "LIQUIDACION",
  "DOCUMENTACION",
  "PUESTOS",
  "CONFIGURACION",
  "ORGANIGRAMA",
  "USUARIOS",
]);
export const auditEventSeveritySchema = z.enum(["INFO", "ADVERTENCIA", "CRITICO"]);
export const auditRetentionUnitSchema = z.enum(["DIAS", "MESES", "ANIOS"]);

const roleSchema = z.enum([
  "Nivel 1 - RRHH",
  "Nivel 2 - SupervisiÃ³n / GestiÃ³n",
  "Nivel 3 - Administrativo de Carga Horaria",
]);

const notificationSchema = z.object({
  enabled: z.boolean().default(false),
  rolesToNotify: z.array(roleSchema).default(["Nivel 1 - RRHH"]),
  notifyOnCreate: z.boolean().default(false),
  notifyOnUpdate: z.boolean().default(true),
  notifyOnDeleteOrDeactivate: z.boolean().default(true),
  notifyOnExport: z.boolean().default(false),
});

const retentionSchema = z.object({
  amount: z.number().int().positive().max(100),
  unit: auditRetentionUnitSchema,
  lockAfterClose: z.boolean().default(false),
  allowExport: z.boolean().default(true),
});

const historySchema = z.object({
  id: z.string().trim().min(1),
  action: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(800),
  createdAt: z.string().trim().min(1),
  createdByUserId: z.string().trim().min(1),
  createdByUserName: z.string().trim().min(1),
});

export const listAuditParametersQuerySchema = z.object({
  search: z.string().trim().optional(),
  scope: auditEventScopeSchema.optional(),
  severity: auditEventSeveritySchema.optional(),
  status: auditParameterStatusSchema.optional(),
  requiresReason: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export const createAuditParameterSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  scope: auditEventScopeSchema,
  severity: auditEventSeveritySchema,
  status: auditParameterStatusSchema.default("ACTIVO"),
  description: z.string().trim().min(2).max(1000),
  trackCreate: z.boolean().default(true),
  trackUpdate: z.boolean().default(true),
  trackDeleteOrDeactivate: z.boolean().default(false),
  trackApproval: z.boolean().default(false),
  trackExport: z.boolean().default(false),
  requiresReason: z.boolean().default(false),
  requiresEffectiveDate: z.boolean().default(false),
  visibleToRoles: z.array(roleSchema).min(1).default(["Nivel 1 - RRHH"]),
  notification: notificationSchema,
  retention: retentionSchema,
  notes: z.string().trim().max(1200).optional().nullable(),
  history: z.array(historySchema).default([]),
});

export const updateAuditParameterSchema = createAuditParameterSchema.partial();

export type ListAuditParametersQuery = z.infer<typeof listAuditParametersQuerySchema>;
export type CreateAuditParameterInput = z.infer<typeof createAuditParameterSchema>;
export type UpdateAuditParameterInput = z.infer<typeof updateAuditParameterSchema>;
