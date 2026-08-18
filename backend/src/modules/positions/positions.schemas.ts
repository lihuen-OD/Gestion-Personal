import { z } from "zod";

export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

const jsonArraySchema = z.array(z.unknown()).default([]);
const nullableText = z.string().trim().max(1000).optional().nullable();

export const listPositionsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: recordStatusSchema.optional(),
  sectorId: z.string().uuid().optional(),
  salaryRangeCategory: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(200),
});

export const positionWorkConditionsSchema = z.object({
  modality: z.string().trim().default("PRESENCIAL"),
  workload: z.string().trim().default(""),
  workplace: z.string().trim().default(""),
  relationType: z.string().trim().default(""),
  observations: z.string().trim().optional().default(""),
});

export const createPositionSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  status: recordStatusSchema.default("ACTIVO"),
  mission: nullableText,
  description: nullableText,
  lastUpdatedAt: z.coerce.date().optional().nullable(),
  responsibilities: jsonArraySchema,
  internalRelations: jsonArraySchema,
  externalRelations: jsonArraySchema,
  competencies: jsonArraySchema,
  workConditions: positionWorkConditionsSchema.default({ modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" }),
  performanceIndicators: jsonArraySchema,
  evaluationCriteria: jsonArraySchema,
  sectorId: z.string().uuid().optional().nullable(),
  salaryCategoryIds: z.array(z.string().uuid()).default([]),
});

export const updatePositionSchema = createPositionSchema.partial();

export type ListPositionsQuery = z.infer<typeof listPositionsQuerySchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
