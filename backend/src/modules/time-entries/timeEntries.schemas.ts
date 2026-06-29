import { z } from "zod";

export const approvalStatusSchema = z.enum(["BORRADOR", "PENDIENTE", "EN_REVISION", "APROBADO", "RECHAZADO", "DEVUELTO", "CERRADO"]);

export const listTimeEntriesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  hourConceptId: z.string().uuid().optional(),
  status: approvalStatusSchema.optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(200),
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

export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesQuerySchema>;
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type RejectTimeEntryInput = z.infer<typeof rejectTimeEntrySchema>;
export type TimeEntriesExportQuery = z.infer<typeof timeEntriesExportQuerySchema>;
