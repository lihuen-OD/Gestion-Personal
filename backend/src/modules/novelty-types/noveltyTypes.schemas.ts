import { z } from "zod";

export const noveltyTypeKindSchema = z.enum(["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"]);
export const noveltyTypeOriginSchema = z.enum(["INTERNA", "FINNEGANS", "MIXTA"]);
export const noveltyTimeImpactSchema = z.enum(["NO_AFECTA_HORAS", "REGISTRA_HORAS_NO_TRABAJADAS", "BLOQUEA_CARGA_DIA"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// modelo nuevo aditivo, fuente de verdad preferida sobre los campos legacy
// de arriba (timeImpact/blocksTimeEntry/setsWorkedHoursToZero).
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
  origin: noveltyTypeOriginSchema.optional(),
  status: recordStatusSchema.optional(),
  exportsToFinnegans: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const finnegansNoveltyLinkSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  // Etapa 15L.2B: deja de ser obligatorio -- auditado en 15L.1, ningún
  // exportador real lo lee (finnegansExport.service.ts sólo usa
  // link.code). La UI nueva ya no lo pide; se mantiene por compatibilidad
  // con datos existentes que sí lo tengan.
  exportConcept: z.string().trim().max(120).optional().default(""),
  priority: z.number().int().positive().max(99).default(1),
  status: recordStatusSchema.default("ACTIVO"),
  hasValidity: z.boolean().default(false),
  notes: z.string().trim().max(600).optional().nullable(),
});

export const createNoveltyTypeSchema = z.object({
  // Etapa 15L.2A: opcional -- si no viene, el backend genera el proximo
  // codigo correlativo (antes solo lo generaba el frontend). Ver
  // noveltyTypes.repository.ts::generateNextCode.
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(160),
  uiColor: noveltyColorSchema.default("blue"),
  kind: noveltyTypeKindSchema,
  origin: noveltyTypeOriginSchema,
  status: recordStatusSchema.default("ACTIVO"),
  description: z.string().trim().max(600).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
  exportsToFinnegans: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  requiresDocumentation: z.boolean().default(false),
  allowsHours: z.boolean().default(false),
  allowsDateTo: z.boolean().default(true),
  hasValidity: z.boolean().default(true),
  blocksTimeEntry: z.boolean().default(false),
  setsWorkedHoursToZero: z.boolean().default(false),
  timeImpact: noveltyTimeImpactSchema.default("NO_AFECTA_HORAS"),
  // Etapa 15L.2A: campos nuevos, sin default -- su ausencia (undefined)
  // distingue "cliente legacy, no los conoce todavia" de "cliente nuevo,
  // eligio explicitamente". La sincronizacion real vive en
  // noveltyTypes.sync.ts, no aca (ver docs/decisions/
  // NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md).
  allowsDateRange: z.boolean().optional(),
  timeEntryBehavior: noveltyTimeEntryBehaviorSchema.optional(),
  finnegansValueUnit: finnegansValueUnitSchema.optional().nullable(),
  finnegansRequiresValidity: z.boolean().optional(),
  allowedLoadRoles: z.array(roleSchema).default([
    "Nivel 1 - RRHH",
    "Nivel 2 - Supervisión / Gestión",
    "Nivel 3 - Administrativo de Carga Horaria",
  ]),
  approvalRoles: z.array(roleSchema).default(["Nivel 1 - RRHH"]),
  finnegansLinks: z.array(finnegansNoveltyLinkSchema).max(20).default([]),
});

export const updateNoveltyTypeSchema = createNoveltyTypeSchema.partial();

export type ListNoveltyTypesQuery = z.infer<typeof listNoveltyTypesQuerySchema>;
export type CreateNoveltyTypeInput = z.infer<typeof createNoveltyTypeSchema>;
export type UpdateNoveltyTypeInput = z.infer<typeof updateNoveltyTypeSchema>;
