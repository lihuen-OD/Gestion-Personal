import { z } from "zod";

export const shiftAlertTypeSchema = z.enum([
  "INGRESO_TARDE",
  "SALIDA_ANTICIPADA",
  "SALIDA_TARDIA",
  "TURNO_NO_IDENTIFICADO",
  "SHIFT_NOT_ENABLED_FOR_EMPLOYEE",
  "POSSIBLE_SHIFT_CONFIGURATION_MISSING",
  "JORNADA_INSUFICIENTE",
  "JORNADA_EXTENDIDA",
  "DESCANSO_INSUFICIENTE",
  "POSIBLE_OLVIDO_SALIDA",
]);

export const shiftAlertSeveritySchema = z.enum(["INFO", "ADVERTENCIA", "CRITICA"]);

export const listShiftAlertsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  workShiftId: z.string().uuid().optional(),
  type: shiftAlertTypeSchema.optional(),
  severity: shiftAlertSeveritySchema.optional(),
  status: z.enum(["PENDIENTE", "RESUELTA", "DESCARTADA", "ALL"]).default("PENDIENTE"),
  search: z.string().trim().max(100).optional(),
  before: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(50).default(20),
});

export const resolveShiftAlertSchema = z.object({
  resolution: z.enum(["RESUELTA", "DESCARTADA"]),
  reason: z.string().trim().min(2).max(800),
});

export type ListShiftAlertsQuery = z.infer<typeof listShiftAlertsQuerySchema>;
export type ResolveShiftAlertInput = z.infer<typeof resolveShiftAlertSchema>;
