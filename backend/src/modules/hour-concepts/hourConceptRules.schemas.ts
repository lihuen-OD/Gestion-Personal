import { z } from "zod";

export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

// HH:MM, 00:00 a 23:59 — dos dígitos obligatorios, 24:00 no es válido.
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido, usar HH:MM (00:00 a 23:59)");

export const listHourConceptRulesQuerySchema = z.object({
  hourConceptId: z.string().uuid().optional(),
  status: recordStatusSchema.optional(),
  crossesMidnight: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

export const createHourConceptRuleSchema = z
  .object({
    hourConceptId: z.string().uuid(),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    crossesMidnight: z.boolean().default(false),
    status: recordStatusSchema.default("ACTIVO"),
  })
  .refine((value) => value.startTime !== value.endTime, {
    message: "startTime y endTime no pueden ser iguales",
  });

export const updateHourConceptRuleSchema = z
  .object({
    hourConceptId: z.string().uuid().optional(),
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
    crossesMidnight: z.boolean().optional(),
    status: recordStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" })
  .refine((value) => !value.startTime || !value.endTime || value.startTime !== value.endTime, {
    message: "startTime y endTime no pueden ser iguales",
  });

export const updateHourConceptRuleStatusSchema = z.object({
  status: recordStatusSchema,
});

export type ListHourConceptRulesQuery = z.infer<typeof listHourConceptRulesQuerySchema>;
export type CreateHourConceptRuleInput = z.infer<typeof createHourConceptRuleSchema>;
export type UpdateHourConceptRuleInput = z.infer<typeof updateHourConceptRuleSchema>;
export type UpdateHourConceptRuleStatusInput = z.infer<typeof updateHourConceptRuleStatusSchema>;
