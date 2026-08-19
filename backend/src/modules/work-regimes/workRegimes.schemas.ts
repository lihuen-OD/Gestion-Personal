import { z } from "zod";

// Comportamientos genéricos (ver schema.prisma) — Cosecha/Riego/Campaña/etc.
// son instancias de WorkRegime, nunca valores de este enum.
export const workRegimeKindSchema = z.enum(["TURNO_OBLIGATORIO", "TURNO_FLEXIBLE", "SIN_TURNO"]);
export const openShiftOverflowActionSchema = z.enum(["ROLLOVER", "ALERT_ONLY"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listWorkRegimesQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: workRegimeKindSchema.optional(),
  status: recordStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const createWorkRegimeSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  kind: workRegimeKindSchema,
  alertOnOutOfShift: z.boolean().default(true),
  openShiftOverflowAction: openShiftOverflowActionSchema.default("ROLLOVER"),
  description: z.string().trim().max(600).optional().nullable(),
  status: recordStatusSchema.default("ACTIVO"),
});

export const updateWorkRegimeSchema = createWorkRegimeSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

export const updateWorkRegimeStatusSchema = z.object({
  status: recordStatusSchema,
});

export const assignWorkRegimeSchema = z
  .object({
    workRegimeId: z.string().uuid(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional().nullable(),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo no puede ser anterior a effectiveFrom",
  });

export const updateWorkRegimeAssignmentSchema = z
  .object({
    workRegimeId: z.string().uuid().optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" })
  .refine((value) => !value.effectiveFrom || !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo no puede ser anterior a effectiveFrom",
  });

export const closeWorkRegimeAssignmentSchema = z.object({
  effectiveTo: z.coerce.date(),
});

export const currentWorkRegimeQuerySchema = z.object({
  date: z.coerce.date().optional(),
});

export const workRegimeEmployeesVigencyStatusSchema = z.enum(["current", "historical", "future", "all"]);

export const listWorkRegimeEmployeesQuerySchema = z.object({
  status: workRegimeEmployeesVigencyStatusSchema.default("all"),
  search: z.string().trim().optional(),
  sectorId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  date: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(50),
});

export type ListWorkRegimesQuery = z.infer<typeof listWorkRegimesQuerySchema>;
export type CreateWorkRegimeInput = z.infer<typeof createWorkRegimeSchema>;
export type UpdateWorkRegimeInput = z.infer<typeof updateWorkRegimeSchema>;
export type UpdateWorkRegimeStatusInput = z.infer<typeof updateWorkRegimeStatusSchema>;
export type AssignWorkRegimeInput = z.infer<typeof assignWorkRegimeSchema>;
export type UpdateWorkRegimeAssignmentInput = z.infer<typeof updateWorkRegimeAssignmentSchema>;
export type CloseWorkRegimeAssignmentInput = z.infer<typeof closeWorkRegimeAssignmentSchema>;
export type CurrentWorkRegimeQuery = z.infer<typeof currentWorkRegimeQuerySchema>;
export type WorkRegimeEmployeesVigencyStatus = z.infer<typeof workRegimeEmployeesVigencyStatusSchema>;
export type ListWorkRegimeEmployeesQuery = z.infer<typeof listWorkRegimeEmployeesQuerySchema>;
