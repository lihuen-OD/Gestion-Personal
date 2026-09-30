import { z } from "zod";
import { sortQueryShape } from "../../shared/validation/listSort";

export const documentStatusSchema = z.enum(["PENDIENTE", "VIGENTE", "POR_VENCER", "VENCIDO", "RECHAZADO"]);

export const documentListSortKeys = ["legajo", "employee", "category", "fileName", "createdAt", "expiresAt", "status"] as const;

export const listDocumentsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  status: documentStatusSchema.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(200),
  ...sortQueryShape(documentListSortKeys),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
