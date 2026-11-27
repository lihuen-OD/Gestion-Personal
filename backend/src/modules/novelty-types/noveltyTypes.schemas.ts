import { z } from "zod";
import { queryBoolean } from "../../shared/validation/queryBoolean";

export const noveltyTypeKindSchema = z.enum(["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
// Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md):
// fuente de verdad del comportamiento en carga horaria. Etapa 15L.6
// (docs/decisions/NOVELTY_TYPE_LEGACY_REMOVAL_15L6.md) retiró los campos
// legacy que reemplazaba (timeImpact/blocksTimeEntry/setsWorkedHoursToZero).
export const noveltyTimeEntryBehaviorSchema = z.enum(["NO_BLOQUEA", "BLOQUEA_NUEVA_CARGA"]);
export const finnegansValueUnitSchema = z.enum(["HOURS", "DAYS", "UNIT"]);
// Motor de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md). Mismos
// valores que los enums de schema.prisma; la coherencia entre campos la
// valida noveltyTypes.service.ts::assertCoverageConfigCoherent (y el CHECK
// "NoveltyType_coverage_config_check" en la base).
export const noveltyCoverageModeSchema = z.enum(["NONE", "FIXED_MINUTES", "MANUAL_MINUTES", "EXPECTED_SCHEDULE"]);
export const noveltyCoverageDayRuleSchema = z.enum(["EVERY_DAY", "SELECTED_WEEKDAYS", "WORK_OBLIGATION"]);
export const noveltyCoverageDayOffPolicySchema = z.enum(["NO_COVERAGE", "COVER"]);
export const noveltyCoverageHolidayPolicySchema = z.enum(["NO_COVERAGE", "COVER", "ONLY_IF_CONVOKED"]);
export const noveltyRealWorkCompatibilitySchema = z.enum(["COMPATIBLE", "INCOMPATIBLE"]);
// 0 = domingo .. 6 = sábado (mismo criterio que ShiftAssignment.weekdays).
// Se normaliza sin repetidos y ordenado: la base no puede exigir unicidad en
// un CHECK.
export const coverageWeekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((days) => Array.from(new Set(days)).sort((left, right) => left - right));
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
// Paleta fija de 23 colores (decisión del usuario, 2026-11-16; "navy" agregado
// al final el 2026-11-17), en el orden en que se ofrecen y se asignan. Los 15
// nombres anteriores siguen siendo válidos (son 15 de estos 23), así que ningún
// color persistido cambia de nombre.
export const NOVELTY_UI_COLORS = [
  "blue",
  "orange",
  "violet",
  "emerald",
  "red",
  "cyan",
  "fuchsia",
  "yellow",
  "pine",
  "pink",
  "indigo",
  "lime",
  "brown",
  "sky",
  "tangerine",
  "purple",
  "green",
  "rose",
  "slate",
  "amber",
  "magenta",
  "teal",
  "navy",
] as const;
export const noveltyColorSchema = z.enum(NOVELTY_UI_COLORS);

export const listNoveltyTypesQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: noveltyTypeKindSchema.optional(),
  status: recordStatusSchema.optional(),
  exportsToFinnegans: queryBoolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const createNoveltyTypeSchema = z.object({
  // Etapa 15L.2A: opcional -- si no viene, el backend genera el proximo
  // codigo correlativo (antes solo lo generaba el frontend). Ver
  // noveltyTypes.repository.ts::generateNextCode.
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(160),
  // Sin color, el alta elige uno no usado (noveltyTypeColors.ts).
  uiColor: noveltyColorSchema.optional(),
  kind: noveltyTypeKindSchema,
  status: recordStatusSchema.default("ACTIVO"),
  description: z.string().trim().max(600).optional().nullable(),
  notes: z.string().trim().max(600).optional().nullable(),
  exportsToFinnegans: z.boolean().default(false),
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
  // Cobertura horaria: defaults neutros (no registra tiempo, no suma).
  coverageMode: noveltyCoverageModeSchema.default("NONE"),
  coverageFixedMinutes: z.number().int().min(1).max(1440).optional().nullable(),
  coverageDayRule: noveltyCoverageDayRuleSchema.default("EVERY_DAY"),
  coverageWeekdays: coverageWeekdaysSchema.default([]),
  // Sin default funcional: obligatorias sólo para reglas por calendario con
  // cobertura (las exige el servicio).
  coverageOnDayOff: noveltyCoverageDayOffPolicySchema.optional().nullable(),
  coverageOnHoliday: noveltyCoverageHolidayPolicySchema.optional().nullable(),
  coverageAppliesSpecialHours: z.boolean().default(false),
  coverageCountsTowardTotal: z.boolean().default(false),
  realWorkCompatibility: noveltyRealWorkCompatibilitySchema.default("COMPATIBLE"),
  requiresObservation: z.boolean().default(false),
});

export const updateNoveltyTypeSchema = createNoveltyTypeSchema.partial();

export type ListNoveltyTypesQuery = z.infer<typeof listNoveltyTypesQuerySchema>;
export type CreateNoveltyTypeInput = z.infer<typeof createNoveltyTypeSchema>;
export type UpdateNoveltyTypeInput = z.infer<typeof updateNoveltyTypeSchema>;
