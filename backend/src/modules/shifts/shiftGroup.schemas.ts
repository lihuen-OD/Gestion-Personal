import { z } from "zod";

/**
 * Grupos de turnos (R3.1, docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §23).
 * Código y nombre se normalizan antes de validar y de guardar: sin espacios
 * en los extremos y con espacios internos colapsados (la base lo exige con un
 * CHECK de forma). El código, además, se guarda en MAYÚSCULAS: es un
 * identificador, no un texto visible. La unicidad sin distinguir mayúsculas
 * la valida el servicio (shiftGroup.service.ts) y la garantizan en la base
 * los índices únicos sobre lower(code) y lower(name).
 */
export function normalizeShiftGroupText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const code = z.string().transform((value) => normalizeShiftGroupText(value).toUpperCase()).pipe(z.string().min(2, "El código debe tener al menos 2 caracteres").max(30));
const name = z.string().transform(normalizeShiftGroupText).pipe(z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(60));
const sortOrder = z.coerce.number().int().min(0).max(9999);
export const shiftGroupStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const createShiftGroupSchema = z.object({
  code,
  name,
  sortOrder: sortOrder.default(0),
});

export const updateShiftGroupSchema = z
  .object({ code, name, sortOrder, status: shiftGroupStatusSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

export const listShiftGroupsQuerySchema = z.object({
  status: shiftGroupStatusSchema.optional(),
});

export type CreateShiftGroupInput = z.infer<typeof createShiftGroupSchema>;
export type UpdateShiftGroupInput = z.infer<typeof updateShiftGroupSchema>;
export type ListShiftGroupsQuery = z.infer<typeof listShiftGroupsQuerySchema>;
