import { z } from "zod";

export const shiftAssignmentStatusSchema = z.enum(["HABILITADO", "DESHABILITADO"]);

export const listShiftAssignmentsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  shiftTemplateId: z.string().uuid().optional(),
  status: shiftAssignmentStatusSchema.optional(),
});

// Mismo criterio que DoubleHourRule.weekdays (workforce.schemas.ts) y
// TimeSegment.date.getDay(): 0 = domingo, 1 = lunes, ..., 6 = sábado — NO
// 1=lunes..7=domingo. weekdays vacío significa "todos los días" (ver
// comentario en schema.prisma sobre ShiftAssignment.weekdays).
export const shiftAssignmentWeekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((value) => new Set(value).size === value.length, { message: "No repitas el mismo día de la semana" });

export const createShiftAssignmentSchema = z
  .object({
    employeeIds: z.array(z.string().uuid()).min(1).max(500),
    shiftTemplateId: z.string().uuid(),
    observation: z.string().trim().max(500).optional().nullable(),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional().nullable(),
    weekdays: shiftAssignmentWeekdaysSchema.default([]),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo no puede ser anterior a effectiveFrom",
  });

export const updateShiftAssignmentSchema = z
  .object({
    status: shiftAssignmentStatusSchema.optional(),
    observation: z.string().trim().max(500).optional().nullable(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional().nullable(),
    weekdays: shiftAssignmentWeekdaysSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" })
  .refine((value) => !value.effectiveFrom || !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
    message: "effectiveTo no puede ser anterior a effectiveFrom",
  });

export type ListShiftAssignmentsQuery = z.infer<typeof listShiftAssignmentsQuerySchema>;
export type CreateShiftAssignmentInput = z.infer<typeof createShiftAssignmentSchema>;
export type UpdateShiftAssignmentInput = z.infer<typeof updateShiftAssignmentSchema>;
