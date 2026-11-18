import { z } from "zod";

export const roleSchema = z.enum(["NIVEL_1_RRHH", "NIVEL_2_SUPERVISION", "NIVEL_3_CARGA_HORARIA"]);
export const statusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: roleSchema.optional(),
  status: statusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

// Responsables de carga (Nivel 3) que supervisa un Nivel 2. Lista completa:
// al enviarla reemplaza la anterior; omitirla la conserva. Sin repetidos.
const supervisedUserIdsSchema = z
  .array(z.string().uuid())
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, { message: "No repitas responsables de carga." })
  .optional();

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(128),
  role: roleSchema,
  status: statusSchema.default("ACTIVO"),
  companyId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  supervisedUserIds: supervisedUserIdsSchema,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(160).optional(),
  role: roleSchema.optional(),
  status: statusSchema.optional(),
  companyId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  supervisedUserIds: supervisedUserIdsSchema,
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
