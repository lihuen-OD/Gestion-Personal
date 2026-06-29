import { z } from "zod";

export const documentCategoryStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);
export const documentCategoryKindSchema = z.enum([
  "PERSONAL",
  "LABORAL",
  "MEDICA",
  "LIQUIDACION",
  "TRANSPORTE",
  "CAPACITACION",
  "LEGAL",
  "NOVEDAD",
  "OTRO",
]);
export const documentCategoryScopeSchema = z.enum(["LEGAJO", "NOVEDAD", "LIQUIDACION", "TRANSPORTE", "ALTA_BAJA", "PUESTO"]);

const roleSchema = z.enum([
  "Nivel 1 - RRHH",
  "Nivel 2 - Supervisión / Gestión",
  "Nivel 3 - Administrativo de Carga Horaria",
]);

const rulesSchema = z.object({
  expires: z.boolean().default(false),
  defaultValidityDays: z.number().int().positive().max(3650).optional(),
  alertBeforeDays: z.number().int().min(0).max(3650).default(0),
  mandatory: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  allowMultipleFiles: z.boolean().default(true),
});

const externalLinkSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.enum(["FINNEGANS", "CARPETA_RED", "OTRO"]),
  code: z.string().trim().max(80),
  name: z.string().trim().max(160),
  status: documentCategoryStatusSchema.default("ACTIVO"),
  notes: z.string().trim().max(600).optional(),
});

export const listDocumentCategoriesQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: documentCategoryKindSchema.optional(),
  scope: documentCategoryScopeSchema.optional(),
  status: documentCategoryStatusSchema.optional(),
  mandatory: z.coerce.boolean().optional(),
  expires: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
});

export const createDocumentCategorySchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  kind: documentCategoryKindSchema.default("PERSONAL"),
  status: documentCategoryStatusSchema.default("ACTIVO"),
  description: z.string().trim().min(2).max(800),
  scopes: z.array(documentCategoryScopeSchema).min(1).default(["LEGAJO"]),
  rules: rulesSchema.default({}),
  uploadRoles: z.array(roleSchema).min(1).default(["Nivel 1 - RRHH"]),
  viewRoles: z.array(roleSchema).min(1).default(["Nivel 1 - RRHH"]),
  approvalRoles: z.array(roleSchema).default(["Nivel 1 - RRHH"]),
  externalLinks: z.array(externalLinkSchema).default([]),
  notes: z.string().trim().max(1200).optional().nullable(),
});

export const updateDocumentCategorySchema = createDocumentCategorySchema.partial();

export type ListDocumentCategoriesQuery = z.infer<typeof listDocumentCategoriesQuerySchema>;
export type CreateDocumentCategoryInput = z.infer<typeof createDocumentCategorySchema>;
export type UpdateDocumentCategoryInput = z.infer<typeof updateDocumentCategorySchema>;
