import { z } from "zod";
import { sortQueryShape } from "../../shared/validation/listSort";
import { queryBoolean } from "../../shared/validation/queryBoolean";

export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

const jsonArraySchema = z.array(z.unknown()).default([]);
const nullableText = z.string().trim().max(1000).optional().nullable();

// A5 reemplaza la cadena de filtros basada en sectorId legado por un nodo y
// una relación explícita: WITHIN (igual/descendiente) o COVERS
// (igual/ancestro). Los tres parámetros deben viajar juntos.
export const positionListSortKeys = ["name", "status"] as const;

export const orgScopeLevelSchema = z.enum(["COMPANY", "BUSINESS_UNIT", "SECTOR", "AREA"]);
export const positionOrgScopeInputSchema = z.object({
  level: orgScopeLevelSchema,
  nodeId: z.string().uuid(),
});

export const listPositionsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: recordStatusSchema.optional(),
  scopeLevel: orgScopeLevelSchema.optional(),
  scopeNodeId: z.string().uuid().optional(),
  scopeMode: z.enum(["WITHIN", "COVERS"]).optional(),
  salaryRangeCategory: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(200),
  ...sortQueryShape(positionListSortKeys),
}).superRefine((value, context) => {
  const supplied = [value.scopeLevel, value.scopeNodeId, value.scopeMode].filter(Boolean).length;
  if (supplied !== 0 && supplied !== 3) context.addIssue({ code: "custom", message: "Indicá nivel, nodo y modo del filtro de alcance." });
});

// Etapa 14D.4: query del catálogo liviano (`GET /positions/options`) — sólo
// lo que los selects/catálogos de Legajos realmente filtran hoy (ninguno
// pasa `search`, así que no se agregó — evitar parámetros sin caller real).
// Etapa 14H.7: `includeAssignedCount` opcional (default false, no rompe a
// los 3 callers de Legajos que ya usaban este endpoint) — agrega `_count.
// employees` al select cuando se pide, para que PuestosPage.tsx pueda usar
// este mismo catálogo liviano para sus tarjetas de resumen/filtro de rango
// salarial en vez de `getAll()` (positionInclude completo, 9 columnas JSON +
// company/businessUnit completos que ninguno de esos 2 usos lee) — ver
// docs/decisions/POSITIONS_MODULE_PERFORMANCE_14H7.md.
// Personas asignadas a un puesto (PuestoAssignedPeopleTab): antes `take: 500`
// fijo sin meta — con la 501ª persona la pestaña y el contador del puesto la
// perdían en silencio. Ahora paginado real con total.
export const listPositionEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(100).default(25),
  ...sortQueryShape(["legajo", "employee"] as const),
});

export const listPositionOptionsQuerySchema = z.object({
  status: recordStatusSchema.optional(),
  includeAssignedCount: queryBoolean().optional(),
  // Sin `take` = catálogo completo explícito: lo consumen los selects de
  // Legajos y las tarjetas de resumen de Puestos, que asumen el catálogo
  // entero (antes default 300 recortaba en silencio). Los puestos son un
  // catálogo administrado a mano por RRHH (4 filas reales al auditar), no un
  // dato operativo — mismo criterio de docs/PERFORMANCE_STANDARDS.md §6.
  take: z.coerce.number().int().positive().max(500).optional(),
});

// D-5 (ORG_LOCATION_REORGANIZATION.md §19): el alcance de un puesto tiene
// historia por fecha. Clave de calendario "YYYY-MM-DD" (nunca coerce.date).
const calendarDateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Fecha inválida");

export const positionWorkConditionsSchema = z.object({
  modality: z.string().trim().default("PRESENCIAL"),
  workload: z.string().trim().default(""),
  workplace: z.string().trim().default(""),
  relationType: z.string().trim().default(""),
  observations: z.string().trim().optional().default(""),
});

export const createPositionSchema = z.object({
  // A8-1 (A8_M2_PREPARATION.md §12.1 I1, AT-3): `archivedAt` sólo lo escribe
  // la transacción de limpieza. Ninguna entrada de API lo admite: si el
  // payload lo trae, la validación falla con 400 en vez de ignorarlo.
  archivedAt: z.never().optional(),
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
  orgScopes: z.array(positionOrgScopeInputSchema).min(1, "Seleccioná al menos un alcance organizacional."),
  // Desde cuándo rige el alcance inicial. Por defecto, hoy (Argentina); nunca futura.
  orgScopesEffectiveFrom: calendarDateKeySchema.optional(),
  salaryCategoryIds: z.array(z.string().uuid()).default([]),
});

export const updatePositionSchema = createPositionSchema.omit({ orgScopesEffectiveFrom: true }).partial().extend({
  orgScopes: z.array(positionOrgScopeInputSchema).min(1, "Seleccioná al menos un alcance organizacional.").optional(),
  // Obligatorio sólo si `orgScopes` difiere del alcance vigente: fecha desde la
  // que rige el alcance nuevo para TODOS los ocupantes y motivo del cambio.
  orgScopesChange: z.object({
    effectiveFrom: calendarDateKeySchema,
    reason: z.string().trim().min(2).max(600),
  }).optional(),
});

export type ListPositionsQuery = z.infer<typeof listPositionsQuerySchema>;
export type ListPositionOptionsQuery = z.infer<typeof listPositionOptionsQuerySchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type ListPositionEmployeesQuery = z.infer<typeof listPositionEmployeesQuerySchema>;
export type PositionOrgScopeInput = z.infer<typeof positionOrgScopeInputSchema>;
