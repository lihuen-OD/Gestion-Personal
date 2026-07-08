import { z } from "zod";

export const approvalStatusSchema = z.enum(["BORRADOR", "PENDIENTE", "EN_REVISION", "APROBADO", "RECHAZADO", "DEVUELTO", "CERRADO"]);

export const listTimeEntriesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  hourConceptId: z.string().uuid().optional(),
  status: approvalStatusSchema.optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  search: z.string().trim().optional(),
  costCenterId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(200),
});

export const timeEntriesSummaryQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const attendanceSummaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const timeEntriesPeriodEmployeesQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  search: z.string().trim().optional(),
  costCenterId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(100).default(25),
});

export const createTimeEntrySchema = z.object({
  employeeId: z.string().uuid(),
  hourConceptId: z.string().uuid(),
  date: z.coerce.date(),
  hours: z.coerce.number().min(0).max(24),
  observation: z.string().trim().max(800).optional().nullable(),
});

export const updateTimeEntrySchema = z.object({
  hourConceptId: z.string().uuid().optional(),
  date: z.coerce.date().optional(),
  hours: z.coerce.number().min(0).max(24).optional(),
  observation: z.string().trim().max(800).optional().nullable(),
});

export const rejectTimeEntrySchema = z.object({
  reason: z.string().trim().min(2).max(600),
});

export const timeEntriesExportQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  employeeId: z.string().uuid().optional(),
  includeInReview: z.coerce.boolean().default(false),
});

export const workShiftSourceSchema = z.enum(["ADMIN", "PORTAL_DNI", "KIOSK", "BIOTIME", "FACIAL"]);

const workShiftBaseSchema = z.object({
  employeeId: z.string().uuid().optional(),
  dni: z.string().trim().min(6).max(20).optional(),
  hourConceptId: z.string().uuid().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  source: workShiftSourceSchema.default("ADMIN"),
  observation: z.string().trim().max(800).optional().nullable(),
});

export const previewWorkShiftSchema = workShiftBaseSchema.refine((value) => Boolean(value.employeeId || value.dni), {
  message: "employeeId or dni is required",
  path: ["employeeId"],
});

export const createWorkShiftSchema = workShiftBaseSchema.extend({
  confirm: z.literal(true).default(true),
}).refine((value) => Boolean(value.employeeId || value.dni), {
  message: "employeeId or dni is required",
  path: ["employeeId"],
});

export const clockByDniSchema = z.object({
  dni: z.string().trim().min(6).max(20),
});

export const clockEmployeeSearchQuerySchema = z.object({
  search: z.string().trim().min(2).max(80),
});

export const clockByEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
});

export const adminCloseWorkShiftSchema = z.object({
  endAt: z.coerce.date(),
  reason: z.string().trim().min(2).max(800),
});

export const adminWorkShiftReasonSchema = z.object({
  reason: z.string().trim().min(2).max(800),
});

export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesQuerySchema>;
export type TimeEntriesSummaryQuery = z.infer<typeof timeEntriesSummaryQuerySchema>;
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;
export type TimeEntriesPeriodEmployeesQuery = z.infer<typeof timeEntriesPeriodEmployeesQuerySchema>;
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type RejectTimeEntryInput = z.infer<typeof rejectTimeEntrySchema>;
export type TimeEntriesExportQuery = z.infer<typeof timeEntriesExportQuerySchema>;
export type PreviewWorkShiftInput = z.infer<typeof previewWorkShiftSchema>;
export type CreateWorkShiftInput = z.infer<typeof createWorkShiftSchema>;
export type ClockByDniInput = z.infer<typeof clockByDniSchema>;
export type ClockEmployeeSearchQuery = z.infer<typeof clockEmployeeSearchQuerySchema>;
export type ClockByEmployeeInput = z.infer<typeof clockByEmployeeSchema>;
export type AdminCloseWorkShiftInput = z.infer<typeof adminCloseWorkShiftSchema>;
export type AdminWorkShiftReasonInput = z.infer<typeof adminWorkShiftReasonSchema>;
