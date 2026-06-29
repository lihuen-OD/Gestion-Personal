import { z } from "zod";

export const hourConceptKindSchema = z.enum(["NORMAL", "EXTRA", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "FERIADO", "OTRO"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listHourConceptsQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: hourConceptKindSchema.optional(),
  status: recordStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const createHourConceptSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  kind: hourConceptKindSchema,
  status: recordStatusSchema.default("ACTIVO"),
  countsAsWorked: z.boolean().default(true),
});

export const updateHourConceptSchema = createHourConceptSchema.partial();

export type ListHourConceptsQuery = z.infer<typeof listHourConceptsQuerySchema>;
export type CreateHourConceptInput = z.infer<typeof createHourConceptSchema>;
export type UpdateHourConceptInput = z.infer<typeof updateHourConceptSchema>;
