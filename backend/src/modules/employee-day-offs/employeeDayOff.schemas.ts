import { z } from "zod";

// Fecha calendario estricta "YYYY-MM-DD" (nunca un instante): el franco es de
// un día, igual que `EmployeeDayOff.date @db.Date`.
// zod sigue evaluando el refine aunque falle el regex: se valida todo junto
// para que un valor mal formado sea un 400, nunca un RangeError.
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dateKeySchema = z.string().refine((value) => {
  if (!DATE_KEY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Usá una fecha válida con formato AAAA-MM-DD");

export const employeeDayOffStatusSchema = z.enum(["ACTIVO", "CANCELADO"]);

export const listEmployeeDayOffsQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  status: employeeDayOffStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(500).default(200),
});

// Modal "Gestionar francos": personas activas del alcance para una fecha.
export const employeeDayOffsByDateQuerySchema = z.object({
  date: dateKeySchema,
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().max(10000).default(1),
  take: z.coerce.number().int().positive().max(200).default(50),
});

// Cada ítem es un upsert independiente de (employeeId, date): nunca
// "reemplaza la fecha" (mismo criterio que las convocatorias a feriado). Sin
// `notes` se conserva la nota guardada; `null` o vacío la borra.
const employeeDayOffItemSchema = z.object({
  employeeId: z.string().uuid(),
  status: employeeDayOffStatusSchema,
  notes: z.string().trim().max(500).nullable().optional(),
});

export const saveEmployeeDayOffsSchema = z.object({
  date: dateKeySchema,
  // Obligatorio sólo para que RRHH corrija un período enviado/aprobado
  // (EMPLOYEE_DAY_OFF.md §12); queda en la auditoría.
  correctionReason: z.string().trim().max(500).nullable().optional(),
  employees: z.array(employeeDayOffItemSchema).min(1).max(500),
});

export type ListEmployeeDayOffsQuery = z.infer<typeof listEmployeeDayOffsQuerySchema>;
export type EmployeeDayOffsByDateQuery = z.infer<typeof employeeDayOffsByDateQuerySchema>;
export type SaveEmployeeDayOffsInput = z.infer<typeof saveEmployeeDayOffsSchema>;
export type EmployeeDayOffItemInput = z.infer<typeof employeeDayOffItemSchema>;
