import { z } from "zod";

export const shiftAssignmentStatusSchema = z.enum(["HABILITADO", "DESHABILITADO"]);

export const listShiftAssignmentsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  shiftTemplateId: z.string().uuid().optional(),
  status: shiftAssignmentStatusSchema.optional(),
});

export const createShiftAssignmentSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(500),
  shiftTemplateId: z.string().uuid(),
  observation: z.string().trim().max(500).optional().nullable(),
});

export const updateShiftAssignmentSchema = z
  .object({
    status: shiftAssignmentStatusSchema.optional(),
    observation: z.string().trim().max(500).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

export type ListShiftAssignmentsQuery = z.infer<typeof listShiftAssignmentsQuerySchema>;
export type CreateShiftAssignmentInput = z.infer<typeof createShiftAssignmentSchema>;
export type UpdateShiftAssignmentInput = z.infer<typeof updateShiftAssignmentSchema>;
