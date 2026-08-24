import { z } from "zod";

export const hourConceptKindSchema = z.enum(["NORMAL", "EXTRA", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "FERIADO", "OTRO"]);
export const additionalHourConceptKindSchema = z.enum(["EXTRA", "NOCTURNA", "GUARDIA", "SERENO", "TRANSPORTE", "FERIADO", "OTRO"]);
export const hourConceptLoadModeSchema = z.enum(["MANUAL", "AUTOMATIC", "BOTH"]);
export const recordStatusSchema = z.enum(["ACTIVO", "INACTIVO"]);

export const listHourConceptsQuerySchema = z.object({
  search: z.string().trim().optional(),
  kind: hourConceptKindSchema.optional(),
  status: recordStatusSchema.optional(),
  // Etapa 8P: por default el catálogo oculta los eliminados lógicamente
  // (deletedAt != null) — "se siente eliminado" sin perder el historial.
  includeDeleted: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(100),
});

// Eliminación forzada (Etapa 8P): force=true permite eliminar un concepto
// con uso histórico real — ver hourConcepts.service.ts::remove para la
// decisión completa (baja lógica, nunca toca TimeEntry/TimeSegment/WorkShift/Novelty).
export const removeHourConceptQuerySchema = z.object({
  force: z.coerce.boolean().default(false),
});

export const createHourConceptSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  kind: additionalHourConceptKindSchema,
  status: recordStatusSchema.default("ACTIVO"),
  loadMode: hourConceptLoadModeSchema,
});

export const updateHourConceptSchema = createHourConceptSchema.partial();

// "status" acá es el status del EMPLEADO (ACTIVO/INACTIVO), no del concepto —
// EmployeeHourConcept no tiene status propio (ver hourConcepts.repository.ts).
// Reutiliza recordStatusSchema porque los valores son literalmente los
// mismos, no porque sean el mismo concepto de dominio.
export const listHourConceptEmployeesQuerySchema = z.object({
  search: z.string().trim().optional(),
  sectorId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: recordStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(50),
});

// Habilitar empleados para el concepto desde la propia pantalla de
// Conceptos Horarios (Etapa 8N) — mismo límite que createShiftAssignmentSchema
// para un batch de asignación.
export const enableHourConceptEmployeesSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1).max(500),
});

export type ListHourConceptsQuery = z.infer<typeof listHourConceptsQuerySchema>;
export type RemoveHourConceptQuery = z.infer<typeof removeHourConceptQuerySchema>;
export type CreateHourConceptInput = z.infer<typeof createHourConceptSchema>;
export type UpdateHourConceptInput = z.infer<typeof updateHourConceptSchema>;
export type ListHourConceptEmployeesQuery = z.infer<typeof listHourConceptEmployeesQuerySchema>;
export type EnableHourConceptEmployeesInput = z.infer<typeof enableHourConceptEmployeesSchema>;
