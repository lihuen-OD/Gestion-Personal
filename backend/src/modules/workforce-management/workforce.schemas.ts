import { z } from "zod";

export const periodQuerySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });
export const closureSubmitSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), employeeIds: z.array(z.string().uuid()).min(1).max(500) });
export const closureBulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), note: z.string().trim().max(600).optional() });
export const returnClosureSchema = z.object({ reason: z.string().trim().min(2).max(600) });
export const correctionCreateSchema = z.object({ timeEntryId: z.string().uuid(), proposedHours: z.coerce.number().min(0).max(24), reason: z.string().trim().min(2).max(600) });
export const correctionReviewSchema = z.object({ note: z.string().trim().max(600).optional() });
// Etapa 9I: page/take real (antes take:200 fijo, sin paginación) — mismo
// tope máximo de take que shiftAlerts/otras listas chicas de la app (no hace
// falta un take grande acá, la campanita sólo necesita las últimas 10-20).
export const listNotificationsQuerySchema = z.object({
  status: z.enum(["NO_LEIDA", "LEIDA"]).optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(100).default(20),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
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
// Etapa 12B: clasificación estructurada, independiente del nombre libre
// (`name` sigue siendo sólo texto visible, nunca se usa para lógica). Sin
// `kind` en el body, queda en OTRO — mismo valor seguro que aplica la
// migración a las reglas existentes, nunca se infiere por nombre.
export const doubleHourRuleKindSchema = z.enum(["FERIADO", "DOMINGO", "JORNADA_ESPECIAL", "OTRO"]);
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
  kind: doubleHourRuleKindSchema.default("OTRO"),
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
// Etapa 8C: la misma exigencia de doubleRuleSchema (FECHA necesita >=1 fecha)
// también aplica acá — sin esto, un PATCH que cambia recurrenceType a FECHA
// sin mandar `dates` dejaba la regla activa pero sin ninguna fecha que
// pudiera matchear jamás (ruleMatchesDate siempre false). El frontend ya
// manda `dates` junto con recurrenceType=FECHA en cada submit (nunca dispara
// esto en uso normal); esto sólo cierra el hueco para un caller directo.
export const updateDoubleRuleSchema = doubleRuleBaseSchema.partial().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Indicá al menos un dato para actualizar" });
  }
  if (value.recurrenceType === "FECHA" && !value.dates?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Una regla de fechas específicas necesita al menos una fecha cargada.", path: ["dates"] });
  }
});
// Etapa 12B: `kind` opcional — sin mandarlo, calendarPreview se comporta
// exactamente igual que antes (sin filtro). Con `kind=FERIADO`, sólo
// devuelve reglas clasificadas como feriado — es el filtro que consumiría a
// futuro la pantalla de asignaciones de feriado de Turnos.
export const calendarRangeQuerySchema = z.object({ from: z.coerce.date(), to: z.coerce.date(), kind: doubleHourRuleKindSchema.optional() }).refine((value) => value.to >= value.from, { message: "'to' debe ser posterior o igual a 'from'" }).refine((value) => (value.to.getTime() - value.from.getTime()) / 86_400_000 <= 400, { message: "El rango de calendario no puede superar los 400 días" });
