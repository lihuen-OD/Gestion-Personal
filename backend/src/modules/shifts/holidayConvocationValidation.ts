/**
 * Validación del horario de las convocatorias que se guardan ACTIVAS
 * (WORKED_TIME_ACCOUNTING_MODEL.md §20, D9): ninguna convocatoria ACTIVA queda
 * sin horario resoluble, porque sin horario no hay falta de ingreso ni alertas
 * por ausencia (defecto de la simulación de Planta).
 *
 * | Horario real del día            | Sin plantilla                         | Con plantilla válida            |
 * |---------------------------------|---------------------------------------|---------------------------------|
 * | Turno fijo / rotación con turno | OK (usa ese turno)                    | OK (la plantilla lo reemplaza)  |
 * | Descanso o día sin configurar   | 422 HOLIDAY_WORK_SCHEDULE_REQUIRED    | OK                              |
 * | Sin turno aplicable / SIN_TURNO | 422 HOLIDAY_WORK_SCHEDULE_REQUIRED    | OK                              |
 * | Rotación con conflicto          | 422 HOLIDAY_WORK_ROTATION_CONFLICT    | OK + aviso (no se oculta)       |
 * | Plantilla inactiva / sin horario| —                                     | 422 HOLIDAY_WORK_TEMPLATE_INVALID |
 */
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { conflictText, resolveConvocationSchedules, scheduleRequiresTemplate, type ConvocationScheduleReader } from "./holidayConvocationSchedule";
import { isTemplateUsable } from "./rotationPlan";

type Db = ConvocationScheduleReader & Pick<PrismaTransactionClient, "shiftTemplate" | "employee">;

/** Devuelve el aviso por legajo (rotación con conflicto resuelta con plantilla explícita). */
export async function validateConvocationSchedules(db: Db, dateKey: string, activated: Array<{ employeeId: string; shiftTemplateId: string | null }>): Promise<Map<string, string>> {
  const warnings = new Map<string, string>();
  if (!activated.length) return warnings;
  const dateLabel = formatArgentinaDate(dateKey);
  const templateIds = [...new Set(activated.flatMap((item) => (item.shiftTemplateId ? [item.shiftTemplateId] : [])))];
  const [templates, schedules] = await Promise.all([
    templateIds.length
      ? db.shiftTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, code: true, startTime: true, endTime: true, crossesMidnight: true, status: true } })
      : Promise.resolve([]),
    resolveConvocationSchedules(db, activated.map((item) => item.employeeId), dateKey),
  ]);
  const usable = new Set(templates.filter(isTemplateUsable).map((template) => template.id));

  const invalidTemplate = activated.filter((item) => item.shiftTemplateId && !usable.has(item.shiftTemplateId));
  const conflictWithout = activated.filter((item) => !item.shiftTemplateId && schedules.get(item.employeeId)?.kind === "ROTATION_CONFLICT");
  const withoutSchedule = activated.filter((item) => !item.shiftTemplateId && scheduleRequiresTemplate(schedules.get(item.employeeId)?.kind ?? "NONE") && schedules.get(item.employeeId)?.kind !== "ROTATION_CONFLICT");
  if (invalidTemplate.length || conflictWithout.length || withoutSchedule.length) {
    const reference = await loadEmployeeReferences(db, [...invalidTemplate, ...conflictWithout, ...withoutSchedule].map((item) => item.employeeId));
    const list = (items: typeof activated) => items.map((item) => reference(item.employeeId)).join("; ");
    if (invalidTemplate.length) {
      throw new AppError(`El turno elegido para ${list(invalidTemplate)} no está activo o no tiene un horario válido. Elegí otro turno.`, 422, "HOLIDAY_WORK_TEMPLATE_INVALID");
    }
    if (conflictWithout.length) {
      const detail = conflictWithout.map((item) => `${reference(item.employeeId)} (${conflictText(schedules.get(item.employeeId)!.planReason)})`).join("; ");
      throw new AppError(`La rotación de ${detail} tiene un conflicto el ${dateLabel}: elegí el turno de la convocatoria o corregí la rotación.`, 422, "HOLIDAY_WORK_ROTATION_CONFLICT");
    }
    throw new AppError(`${list(withoutSchedule)} no tiene un turno para el ${dateLabel} (descanso, día sin configurar o sin turno asignado): elegí el turno de la convocatoria.`, 422, "HOLIDAY_WORK_SCHEDULE_REQUIRED");
  }

  for (const item of activated) {
    const schedule = schedules.get(item.employeeId);
    if (item.shiftTemplateId && schedule?.kind === "ROTATION_CONFLICT") warnings.set(item.employeeId, `La rotación tiene un conflicto ese día (${conflictText(schedule.planReason)}); rige el turno de la convocatoria.`);
  }
  return warnings;
}
