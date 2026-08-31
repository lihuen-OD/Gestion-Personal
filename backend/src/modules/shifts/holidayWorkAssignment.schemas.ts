import { z } from "zod";

// Etapa 12D: mismo límite/criterio que calendarRangeQuerySchema
// (workforce-management) para el rango de fechas — no se reinventa acá,
// sólo se repite el mismo tope porque ambos schemas viven en módulos
// distintos y no hay un lugar compartido de query schemas hoy.
export const holidayDatesQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((value) => value.to >= value.from, { message: "'to' debe ser posterior o igual a 'from'" })
  .refine((value) => (value.to.getTime() - value.from.getTime()) / 86_400_000 <= 400, { message: "El rango no puede superar los 400 días" });

export const holidayWorkAssignmentsByDateQuerySchema = z.object({ date: z.coerce.date() });

export const holidayWorkCandidatesQuerySchema = z.object({
  sectorId: z.string().uuid().optional(),
  shiftTemplateId: z.string().uuid().optional(),
  withoutShift: z.coerce.boolean().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(100),
});

export const holidayWorkAssignmentStatusSchema = z.enum(["ACTIVA", "CANCELADA"]);

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

// Etapa 12D: cada entrada es un upsert explícito para (date, employeeId) —
// nunca "reemplaza todo lo de la fecha". Guardar sólo toca los employeeId
// incluidos en el array; cualquier otra convocatoria ya guardada para esa
// fecha (por ejemplo, cargada por otro usuario filtrando otro sector) queda
// intacta. Ver docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md §6 para el
// razonamiento completo de por qué se descartó "reemplazar toda la fecha".
const holidayWorkAssignmentItemSchema = z.object({
  employeeId: z.string().uuid(),
  status: holidayWorkAssignmentStatusSchema.default("ACTIVA"),
  shiftTemplateId: z.string().uuid().optional().nullable(),
  expectedStartTime: timeSchema.optional().nullable(),
  expectedEndTime: timeSchema.optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const saveHolidayWorkAssignmentsSchema = z.object({
  date: z.coerce.date(),
  assignments: z.array(holidayWorkAssignmentItemSchema).min(1).max(500),
});

export type HolidayDatesQuery = z.infer<typeof holidayDatesQuerySchema>;
export type HolidayWorkAssignmentsByDateQuery = z.infer<typeof holidayWorkAssignmentsByDateQuerySchema>;
export type HolidayWorkCandidatesQuery = z.infer<typeof holidayWorkCandidatesQuerySchema>;
export type SaveHolidayWorkAssignmentsInput = z.infer<typeof saveHolidayWorkAssignmentsSchema>;
export type HolidayWorkAssignmentItemInput = z.infer<typeof holidayWorkAssignmentItemSchema>;
