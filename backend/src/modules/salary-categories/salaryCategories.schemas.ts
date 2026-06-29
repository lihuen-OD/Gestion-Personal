import { z } from "zod";

export const salaryCategoryStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listSalaryCategoriesQuerySchema = z.object({
  search: z.string().trim().optional(),
  family: z.string().trim().optional(),
  status: salaryCategoryStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export const createSalaryCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  family: z.string().trim().min(2).max(80).optional().nullable(),
  order: z.number().int().min(0).max(10000),
  status: salaryCategoryStatusSchema.default("ACTIVO"),
});

export const updateSalaryCategorySchema = createSalaryCategorySchema.partial();

export type ListSalaryCategoriesQuery = z.infer<typeof listSalaryCategoriesQuerySchema>;
export type CreateSalaryCategoryInput = z.infer<typeof createSalaryCategorySchema>;
export type UpdateSalaryCategoryInput = z.infer<typeof updateSalaryCategorySchema>;
