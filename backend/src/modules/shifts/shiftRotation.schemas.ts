import { z } from "zod";
import { MAX_ROTATION_CYCLE_WEEKS } from "./rotationPlan";
import { normalizeShiftGroupText } from "./shiftGroup.schemas";

/**
 * API de administración de rotaciones — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * Fechas: siempre fechas calendario "YYYY-MM-DD" (las vigencias son @db.Date
 * inclusivas); nunca instantes. La regla de fecha mínima (mañana, o hoy en una
 * rotación INACTIVA) la valida el servicio, que conoce "hoy" en Argentina.
 * Códigos: normalizados como los grupos (sin espacios en los extremos ni
 * repetidos) y en MAYÚSCULAS; la unicidad sin mayúsculas la garantiza la base.
 */
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usá una fecha con formato AAAA-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no existe");

const code = (max: number) => z.string().transform((value) => normalizeShiftGroupText(value).toUpperCase()).pipe(z.string().min(1, "Indicá un código").max(max));
const name = z.string().transform(normalizeShiftGroupText).pipe(z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(80));
const observation = z.string().trim().max(500).optional().nullable();
const uuid = z.string().uuid();

export const listRotationsQuerySchema = z.object({
  status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
  shiftGroupId: uuid.optional(),
});

export const createRotationSchema = z.object({
  code: code(30),
  name,
  shiftGroupId: uuid,
  observation,
});

export const updateRotationSchema = z
  .object({ code: code(30), name, shiftGroupId: uuid, observation })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

export const createCrewSchema = z.object({
  code: code(20),
  name,
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const updateCrewSchema = z
  .object({ name, sortOrder: z.coerce.number().int().min(0).max(9999), status: z.enum(["ACTIVO", "INACTIVO"]) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Indicá al menos un dato para actualizar" });

const blockSchema = z.object({
  blockIndex: z.number().int().min(0).max(9),
  shiftTemplateId: uuid,
});

const daySchema = z
  .object({
    crewId: uuid,
    cycleWeekIndex: z.number().int().min(0).max(MAX_ROTATION_CYCLE_WEEKS - 1),
    weekday: z.number().int().min(0, "Día de semana: 0 = domingo … 6 = sábado").max(6, "Día de semana: 0 = domingo … 6 = sábado"),
    kind: z.enum(["SHIFT", "REST"]),
    blocks: z.array(blockSchema).max(10).default([]),
  })
  .refine((day) => (day.kind === "REST" ? day.blocks.length === 0 : day.blocks.length > 0), {
    message: "Un día de trabajo necesita al menos un bloque y un día de descanso no puede tener bloques",
  });

const versionBody = {
  effectiveFrom: dateKey,
  cycleLengthWeeks: z.number().int().min(1).max(MAX_ROTATION_CYCLE_WEEKS),
  anchorWeekStart: dateKey,
  days: z.array(daySchema).min(1).max(MAX_ROTATION_CYCLE_WEEKS * 7 * 20),
};

/** La grilla va COMPLETA en un solo cuerpo: una versión nunca se arma de a partes. */
export const createVersionSchema = z.object(versionBody);

export const updateVersionSchema = z.object({
  ...versionBody,
  /** Concurrencia optimista opcional: el `updatedAt` que leyó quien edita. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export const listMembersQuerySchema = z.object({
  at: dateKey.optional(),
  history: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});

export const addMembersSchema = z
  .object({
    employeeIds: z.array(uuid).min(1).max(50),
    effectiveFrom: dateKey,
    effectiveTo: dateKey.optional().nullable(),
    /** Opción C (§24.11): cerrar explícitamente los turnos fijos superpuestos. */
    closeFixedAssignments: z.boolean().default(false),
  })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "La fecha de fin no puede ser anterior a la de inicio" });

export const closeMemberSchema = z.object({ lastDay: dateKey });

export const moveMemberSchema = z.object({ toCrewId: uuid, effectiveFrom: dateKey });

export const finalizePreviewSchema = z.object({ lastDay: dateKey });

export const finalizeSchema = z.object({
  lastDay: dateKey,
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirmá la finalización (confirm: true)" }) }),
  confirmationToken: z.string().regex(/^[0-9a-f]{64}$/, "Token de confirmación inválido"),
});

export type ListRotationsQuery = z.infer<typeof listRotationsQuerySchema>;
export type CreateRotationInput = z.infer<typeof createRotationSchema>;
export type UpdateRotationInput = z.infer<typeof updateRotationSchema>;
export type CreateCrewInput = z.infer<typeof createCrewSchema>;
export type UpdateCrewInput = z.infer<typeof updateCrewSchema>;
export type VersionDayInput = z.infer<typeof daySchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type UpdateVersionInput = z.infer<typeof updateVersionSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type AddMembersInput = z.infer<typeof addMembersSchema>;
export type CloseMemberInput = z.infer<typeof closeMemberSchema>;
export type MoveMemberInput = z.infer<typeof moveMemberSchema>;
export type FinalizeInput = z.infer<typeof finalizeSchema>;
