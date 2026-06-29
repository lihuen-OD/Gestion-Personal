import { z } from "zod";

export const approvalStatusSchema = z.enum(["BORRADOR", "PENDIENTE", "EN_REVISION", "APROBADO", "RECHAZADO", "DEVUELTO", "CERRADO"]);

export const listNoveltiesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  noveltyTypeId: z.string().uuid().optional(),
  status: approvalStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  exportable: z.coerce.boolean().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export const createNoveltySchema = z
  .object({
    employeeIds: z.array(z.string().uuid()).min(1).max(250),
    noveltyTypeId: z.string().uuid(),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date().optional().nullable(),
    quantityHours: z.coerce.number().positive().max(744).optional().nullable(),
    quantityDays: z.coerce.number().positive().max(366).optional().nullable(),
    observation: z.string().trim().max(800).optional().nullable(),
    targetHourConceptId: z.string().uuid().optional().nullable(),
  })
  .refine((value) => !value.toDate || value.toDate >= value.fromDate, {
    message: "toDate must be greater than or equal to fromDate",
    path: ["toDate"],
  });

export const rejectNoveltySchema = z.object({
  reason: z.string().trim().min(2).max(600),
});

export type ListNoveltiesQuery = z.infer<typeof listNoveltiesQuerySchema>;
export type CreateNoveltyInput = z.infer<typeof createNoveltySchema>;
export type RejectNoveltyInput = z.infer<typeof rejectNoveltySchema>;
