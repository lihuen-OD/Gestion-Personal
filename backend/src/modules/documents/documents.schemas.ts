import { z } from "zod";

export const documentStatusSchema = z.enum(["PENDIENTE", "VIGENTE", "POR_VENCER", "VENCIDO", "RECHAZADO"]);

export const listDocumentsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  status: documentStatusSchema.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(200),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
