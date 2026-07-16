import { z } from "zod";

export const periodQuerySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) });
export const closureSubmitSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), employeeIds: z.array(z.string().uuid()).min(1).max(500) });
export const closureBulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), note: z.string().trim().max(600).optional() });
export const returnClosureSchema = z.object({ reason: z.string().trim().min(2).max(600) });
export const correctionCreateSchema = z.object({ timeEntryId: z.string().uuid(), proposedHours: z.coerce.number().min(0).max(24), reason: z.string().trim().min(2).max(600) });
export const correctionReviewSchema = z.object({ note: z.string().trim().max(600).optional() });
export const shiftTemplateSchema = z.object({ code: z.string().trim().min(2).max(30), name: z.string().trim().min(2).max(100), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), entryToleranceMinutes: z.coerce.number().int().min(0).max(180), exitToleranceMinutes: z.coerce.number().int().min(0).max(180), detectionWindowMinutes: z.coerce.number().int().min(30).max(720), status: z.enum(["ACTIVO", "INACTIVO"]).default("ACTIVO") });
export const doubleRuleSchema = z.object({ name: z.string().trim().min(2).max(120), recurrenceType: z.enum(["FECHA", "RANGO", "SEMANAL"]), fromDate: z.coerce.date(), toDate: z.coerce.date().optional().nullable(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]), multiplier: z.coerce.number().min(1).max(5).default(2), employeeIds: z.array(z.string().uuid()).min(1).max(1000), reason: z.string().trim().min(2).max(600) });
