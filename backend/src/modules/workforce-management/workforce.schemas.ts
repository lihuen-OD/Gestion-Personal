import { z } from "zod";

export const periodQuerySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });
export const closureSubmitSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), employeeIds: z.array(z.string().uuid()).min(1).max(500) });
export const closureBulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), note: z.string().trim().max(600).optional() });
export const returnClosureSchema = z.object({ reason: z.string().trim().min(2).max(600) });
export const correctionCreateSchema = z.object({ timeEntryId: z.string().uuid(), proposedHours: z.coerce.number().min(0).max(24), reason: z.string().trim().min(2).max(600) });
export const correctionReviewSchema = z.object({ note: z.string().trim().max(600).optional() });
export const shiftTemplateSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  categoryName: z.string().trim().max(60).optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  entryToleranceBeforeMinutes: z.coerce.number().int().min(0).max(180),
  entryToleranceAfterMinutes: z.coerce.number().int().min(0).max(180),
  exitToleranceBeforeMinutes: z.coerce.number().int().min(0).max(180),
  exitToleranceAfterMinutes: z.coerce.number().int().min(0).max(180),
  minimumMinutesForCompliance: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  maximumInformativeMinutes: z.coerce.number().int().min(0).max(1440).optional().nullable(),
  missingOutAlertAfterMinutes: z.coerce.number().int().min(0).max(600).optional().nullable(),
  absoluteOpenShiftLimitMinutes: z.coerce.number().int().min(60).max(1440).default(1200),
  status: z.enum(["ACTIVO", "INACTIVO"]).default("ACTIVO"),
});
export const updateShiftTemplateSchema = shiftTemplateSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });
// Etapa 8B: employeeIds ya no es obligatorio — [] significa "sin restricción
// por persona" (alcanza a todos dentro del resto del alcance configurado).
// companyId/sectorId/costCenterId/positionId son todos opcionales y
// combinan con AND entre sí y con employeeIds (ver doubleHourRuleScopeWhere
// en timeEntries.repository.ts). `dates` sólo aplica cuando recurrenceType
// es FECHA — reemplaza el uso de fromDate como "la única fecha" de esas
// reglas (feriados, fechas manuales).
const doubleRuleBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  recurrenceType: z.enum(["FECHA", "RANGO", "SEMANAL"]),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date().optional().nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  multiplier: z.coerce.number().min(1).max(5).default(2),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  companyId: z.string().uuid().optional().nullable(),
  sectorId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  positionId: z.string().uuid().optional().nullable(),
  dates: z.array(z.object({ date: z.coerce.date(), isActive: z.boolean().default(true) })).max(500).optional(),
  employeeIds: z.array(z.string().uuid()).max(1000).default([]),
  reason: z.string().trim().min(2).max(600),
  status: z.enum(["ACTIVO", "INACTIVO"]).default("ACTIVO"),
});
export const doubleRuleSchema = doubleRuleBaseSchema.superRefine((value, ctx) => {
  if (value.recurrenceType === "FECHA" && !value.dates?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Una regla de fechas específicas necesita al menos una fecha cargada.", path: ["dates"] });
  }
});
export const updateDoubleRuleSchema = doubleRuleBaseSchema.partial().refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });
export const calendarRangeQuerySchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((value) => value.to >= value.from, { message: "'to' debe ser posterior o igual a 'from'" }).refine((value) => (value.to.getTime() - value.from.getTime()) / 86_400_000 <= 400, { message: "El rango de calendario no puede superar los 400 días" });
