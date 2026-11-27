import { z } from "zod";
import { sortQueryShape } from "../../shared/validation/listSort";
import { queryBoolean } from "../../shared/validation/queryBoolean";
import { createEmployeeDocumentSchema } from "../employees/employees.schemas";

export const approvalStatusSchema = z.enum(["BORRADOR", "PENDIENTE", "EN_REVISION", "APROBADO", "RECHAZADO", "DEVUELTO", "CERRADO"]);

export const noveltyListSortKeys = ["legajo", "employee", "noveltyType", "fromDate", "status"] as const;

export const listNoveltiesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  noveltyTypeId: z.string().uuid().optional(),
  status: approvalStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Etapa 15M.15 (docs/decisions/... pendiente): "YYYY-MM" -- distinto de
  // `from`/`to` de arriba (esos filtran sólo por `fromDate`, sin intersección
  // de rango; ver novelties.repository.ts::buildWhere). `period` selecciona
  // por vigencia real intersectando el mes completo, igual que la grilla de
  // horas/`noveltyCoversDay` tratan un rango de novedad.
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM")
    .optional(),
  exportable: queryBoolean().optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(300).default(100),
  ...sortQueryShape(noveltyListSortKeys),
});

const createNoveltyFields = {
  employeeIds: z.array(z.string().uuid()).min(1).max(250),
  noveltyTypeId: z.string().uuid(),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date().optional().nullable(),
  quantityHours: z.coerce.number().positive().max(744).optional().nullable(),
  quantityDays: z.coerce.number().positive().max(366).optional().nullable(),
  observation: z.string().trim().max(800).optional().nullable(),
  targetHourConceptId: z.string().uuid().optional().nullable(),
};

const toDateNotBeforeFrom = (value: { fromDate: Date; toDate?: Date | null }) => !value.toDate || value.toDate >= value.fromDate;
const toDateNotBeforeFromIssue = { message: "toDate must be greater than or equal to fromDate", path: ["toDate"] };

export const createNoveltySchema = z.object(createNoveltyFields).refine(toDateNotBeforeFrom, toDateNotBeforeFromIssue);
export const updateNoveltySchema = z.object({
  noveltyTypeId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional().nullable(),
  quantityHours: z.coerce.number().positive().max(744).optional().nullable(),
  quantityDays: z.coerce.number().positive().max(366).optional().nullable(),
  observation: z.string().trim().max(800).optional().nullable(),
  targetHourConceptId: z.string().uuid().optional().nullable(),
}).refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

// Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15.1): el documento obligatorio viaja
// con el alta (POST /novelties/with-document), mismos límites que un
// documento de legajo (POST /employees/:id/documents).
export const noveltyDocumentSchema = createEmployeeDocumentSchema.pick({ fileName: true, fileMimeType: true, fileSizeBytes: true, fileBase64: true, notes: true });

export const createNoveltyWithDocumentSchema = z.object({ ...createNoveltyFields, document: noveltyDocumentSchema }).refine(toDateNotBeforeFrom, toDateNotBeforeFromIssue);

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usá el formato AAAA-MM-DD");

// Vista previa de cobertura: el mismo motor que la persistencia, sin escribir.
export const noveltyCoveragePreviewSchema = z
  .object({
    employeeIds: z.array(z.string().uuid()).min(1).max(50),
    noveltyTypeId: z.string().uuid(),
    fromDate: z.coerce.date(),
    toDate: z.coerce.date().optional().nullable(),
    quantityHours: z.coerce.number().positive().max(24).optional().nullable(),
  })
  .refine((value) => !value.toDate || value.toDate >= value.fromDate, {
    message: "toDate must be greater than or equal to fromDate",
    path: ["toDate"],
  });

export const noveltyCoverageDayParamsSchema = z.object({ date: dateKeySchema });

// Resolución manual de un día en revisión. No existe "aceptar con trabajo
// real": sólo confirmar 0 h o indicar las horas base que correspondían.
export const noveltyCoverageResolutionSchema = z
  .object({
    resolution: z.enum(["CONFIRMED_ZERO", "SET_BASE_MINUTES", "RESTORE_AUTOMATIC"]),
    baseMinutes: z.number().int().min(1).max(1440).optional().nullable(),
    note: z.string().trim().min(5).max(600),
  })
  .refine((value) => (value.resolution === "SET_BASE_MINUTES" ? value.baseMinutes != null : value.baseMinutes == null), {
    message: "Indicá las horas base sólo al resolver con horas",
    path: ["baseMinutes"],
  });

export const rejectNoveltySchema = z.object({
  reason: z.string().trim().min(2).max(600),
});
export const bulkApproveNoveltiesSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(250) });

export type ListNoveltiesQuery = z.infer<typeof listNoveltiesQuerySchema>;
export type CreateNoveltyInput = z.infer<typeof createNoveltySchema>;
export type UpdateNoveltyInput = z.infer<typeof updateNoveltySchema>;
export type NoveltyDocumentInput = z.infer<typeof noveltyDocumentSchema>;
export type CreateNoveltyWithDocumentInput = z.infer<typeof createNoveltyWithDocumentSchema>;
// Lo que el servicio persiste: el input validado más las cantidades que
// deriva el backend (quantityMinutes, docs/decisions/NOVELTY_COVERAGE_ENGINE.md).
// quantityMinutes no es un campo del body: el cliente nunca lo manda.
export type CreateNoveltyCommand = CreateNoveltyInput & { quantityMinutes?: number | null };
export type RejectNoveltyInput = z.infer<typeof rejectNoveltySchema>;
export type NoveltyCoveragePreviewInput = z.infer<typeof noveltyCoveragePreviewSchema>;
export type NoveltyCoverageResolutionInput = z.infer<typeof noveltyCoverageResolutionSchema>;
