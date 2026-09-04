import { z } from "zod";

export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

const jsonArraySchema = z.array(z.unknown()).default([]);
const nullableText = z.string().trim().max(1000).optional().nullable();

// Etapa 9E: businessUnitId/establishmentId/areaId se agregan para que
// PuestosPage.tsx pueda paginar de verdad con los 6 filtros que ya expone en
// UI (antes sólo sectorId/salaryRangeCategory se resolvían server-side; los
// otros 3 se filtraban en el cliente sobre un fetch-all, lo que hubiera dado
// resultados incorrectos al combinarlos con paginación real).
export const listPositionsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: recordStatusSchema.optional(),
  sectorId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  establishmentId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
  salaryRangeCategory: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(200),
});

// Etapa 14D.4: query del catálogo liviano (`GET /positions/options`) — sólo
// lo que los selects/catálogos de Legajos realmente filtran hoy (ninguno
// pasa `search`, así que no se agregó — evitar parámetros sin caller real).
export const listPositionOptionsQuerySchema = z.object({
  status: recordStatusSchema.optional(),
  take: z.coerce.number().int().positive().max(500).default(300),
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
export type ListPositionOptionsQuery = z.infer<typeof listPositionOptionsQuerySchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
