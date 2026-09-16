import { z } from "zod";

export const noveltyTypeKindSchema = z.enum(["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// fuente de verdad del comportamiento en carga horaria. Etapa 15L.6
// (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md) retiró los campos
// legacy que reemplazaba (timeImpact/blocksTimeEntry/setsWorkedHoursToZero).
export const noveltyTimeEntryBehaviorSchema = z.enum(["NO_BLOQUEA", "BLOQUEA_NUEVA_CARGA"]);
export const finnegansValueUnitSchema = z.enum(["HOURS", "DAYS", "UNIT"]);
export const roleSchema = z.enum([
  "Nivel 1 - RRHH",
  "Nivel 2 - Supervisión / Gestión",
  "Nivel 3 - Administrativo de Carga Horaria",
]);
// Etapa 15L.2B: catálogo único de colores, alineado 1:1 con
// frontend/src/types/noveltyType.types.ts::NoveltyUiColor -- antes el
// backend aceptaba "indigo" (nunca usado por ningún cliente real) y no
// aceptaba "purple" (el frontend lo mapeaba a "violet" antes de mandarlo).
// Confirmado contra la base real: ningún NoveltyType existente usa
// "indigo", así que quitarlo del enum no pierde ningún dato.
export const noveltyColorSchema = z.enum([
  "blue",
  "sky",
  "cyan",
  "teal",
  "emerald",
  "green",
  "lime",
  "amber",
  "orange",
  "red",
  "rose",
  "pink",
  "violet",
  "purple",
  "slate",
]);

export const listNoveltyTypesQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: noveltyTypeKindSchema.optional(),
  status: recordStatusSchema.optional(),
  exportsToFinnegans: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const createNoveltyTypeSchema = z.object({
  // Etapa 15L.2A: opcional -- si no viene, el backend genera el proximo
  // codigo correlativo (antes solo lo generaba el frontend). Ver
  // noveltyTypes.repository.ts::generateNextCode.
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(160),
  uiColor: noveltyColorSchema.default("blue"),
  kind: noveltyTypeKindSchema,
  status: recordStatusSchema.default("ACTIVO"),
  description: z.string().trim().max(600).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
  exportsToFinnegans: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  requiresDocumentation: z.boolean().default(false),
  allowsHours: z.boolean().default(false),
  // Etapa 15L.6: antes opcional (sin default real, sincronizado por
  // noveltyTypes.sync.ts a partir de los campos legacy ya eliminados).
  // Ahora el propio schema es la única fuente del default.
  allowsDateRange: z.boolean().default(true),
  timeEntryBehavior: noveltyTimeEntryBehaviorSchema.default("NO_BLOQUEA"),
  finnegansValueUnit: finnegansValueUnitSchema.optional().nullable(),
  finnegansRequiresValidity: z.boolean().default(false),
  // Etapa 15L.6: reemplaza FinnegansNoveltyLink (1:N) -- 1:1 físico, igual
  // que finnegansValueUnit/finnegansRequiresValidity.
  finnegansCode: z.string().trim().min(1).max(40).optional().nullable(),
  finnegansName: z.string().trim().min(2).max(160).optional().nullable(),
  allowedLoadRoles: z.array(roleSchema).default([
    "Nivel 1 - RRHH",
    "Nivel 2 - Supervisión / Gestión",
    "Nivel 3 - Administrativo de Carga Horaria",
  ]),
  approvalRoles: z.array(roleSchema).default(["Nivel 1 - RRHH"]),
});

export const updateNoveltyTypeSchema = createNoveltyTypeSchema.partial();

export type ListNoveltyTypesQuery = z.infer<typeof listNoveltyTypesQuerySchema>;
export type CreateNoveltyTypeInput = z.infer<typeof createNoveltyTypeSchema>;
export type UpdateNoveltyTypeInput = z.infer<typeof updateNoveltyTypeSchema>;
