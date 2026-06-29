import { z } from "zod";

export const noveltyTypeKindSchema = z.enum(["AUSENCIA", "LICENCIA", "HORARIA", "ACCIDENTE", "VACACIONES", "SANCION", "OTRO"]);
export const noveltyTypeOriginSchema = z.enum(["INTERNA", "FINNEGANS", "MIXTA"]);
export const noveltyTimeImpactSchema = z.enum(["NO_AFECTA_HORAS", "REGISTRA_HORAS_NO_TRABAJADAS", "BLOQUEA_CARGA_DIA"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
export const roleSchema = z.enum([
  "Nivel 1 - RRHH",
  "Nivel 2 - Supervisión / Gestión",
  "Nivel 3 - Administrativo de Carga Horaria",
]);
export const noveltyColorSchema = z.enum([
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "teal",
  "cyan",
  "indigo",
  "pink",
  "orange",
  "lime",
  "slate",
  "rose",
  "emerald",
  "sky",
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
  exportConcept: z.string().trim().min(2).max(120),
  priority: z.number().int().positive().max(99).default(1),
  status: recordStatusSchema.default("ACTIVO"),
  hasValidity: z.boolean().default(false),
  notes: z.string().trim().max(600).optional().nullable(),
});

export const createNoveltyTypeSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  uiColor: noveltyColorSchema.default("blue"),
  kind: noveltyTypeKindSchema,
  origin: noveltyTypeOriginSchema,
  status: recordStatusSchema.default("ACTIVO"),
  description: z.string().trim().max(600).optional().nullable(),
  exportsToFinnegans: z.boolean().default(false),
  requiresApproval: z.boolean().default(true),
  requiresDocumentation: z.boolean().default(false),
  allowsHours: z.boolean().default(false),
  allowsDateTo: z.boolean().default(true),
  hasValidity: z.boolean().default(true),
  blocksTimeEntry: z.boolean().default(false),
  setsWorkedHoursToZero: z.boolean().default(false),
  timeImpact: noveltyTimeImpactSchema.default("NO_AFECTA_HORAS"),
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
