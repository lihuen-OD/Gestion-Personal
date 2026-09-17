import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "./employeeAccess";
import { isMonthlyClosureLocked } from "../../shared/monthlyClosure/closureLock";
import { argentinaPeriodBounds, calculateAutomaticBreakdowns } from "./automaticHourConceptBreakdowns";
import { automaticHourConceptBreakdownsRepository as repository } from "./automaticHourConceptBreakdowns.repository";

function isConcurrencyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export type RecalculateForEmployeePeriodInput = {
  employeeId: string;
  period: string;
  createdByUserId?: string | null;
  audit?: AuditContext;
};

/**
 * Etapa 15M.2 (docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md): núcleo
 * funcional de Motor B, sin ninguna verificación de autorización HTTP. Antes
 * de esta etapa esta lógica vivía inline dentro de `recalculate` (que sí
 * valida scope/rol vía `Express.AuthUser`) y era el único punto de entrada —
 * eso obligaba a cualquier disparo interno del sistema (ej. al cerrar una
 * jornada) a fabricar un `Express.AuthUser` ficticio sólo para pasar la
 * validación de scope, que no tiene sentido para una operación que el propio
 * sistema ya autorizó al procesar la fichada/cierre. Ahora este core es la
 * única implementación real (`findEligibleConcepts`/`findProcessedShifts`/
 * `calculateAutomaticBreakdowns`/`replaceAutomatic` no se duplican en ningún
 * otro lugar) y lo reutilizan tanto `recalculate` (endpoint administrativo)
 * como `syncAutomaticBreakdownsAfterProcessedShift` (`timeEntries.service.ts`,
 * sincronización automática post-cierre).
 */
async function recalculateForEmployeePeriod({ employeeId, period, createdByUserId, audit }: RecalculateForEmployeePeriodInput) {
  // Etapa 15E: a diferencia de la carga MANUAL (ver validateManualBreakdownContext
  // en employees.service.ts), el recálculo AUTOMÁTICO sigue bloqueado sin
  // excepción para cualquier rol, RRHH incluido — es una regeneración
  // masiva derivada de WorkShift, no una corrección puntual con motivo
  // documentado, así que no encaja en el patrón correctionReason. Fuera de
  // alcance explícito de 15E (ver docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md).
  // Etapa 15M.2: esta política NO cambia para el disparo automático — una
  // fichada que cierra sobre un período ya bloqueado sigue creando su
  // TimeEntry normal (eso no lo controla este módulo), pero el breakdown
  // automático de ese período queda sin regenerar hasta que el cierre se
  // reabra o hasta el próximo recálculo manual — deuda documentada, ver 15M.1 §26/15M.2.
  const closure = await repository.findClosure(employeeId, period);
  if (isMonthlyClosureLocked(closure)) {
    throw new AppError("The period is closed for recalculation", 409, "PERIOD_CLOSED");
  }

  const bounds = argentinaPeriodBounds(period);
  const [assignments, shifts] = await Promise.all([
    repository.findEligibleConcepts(employeeId),
    repository.findProcessedShifts(employeeId, bounds.startAt, bounds.endAt),
  ]);
  const rules = assignments.flatMap(({ hourConcept }) => hourConcept.rules).filter((rule) =>
    assignments.some(({ hourConcept }) => hourConcept.id === rule.hourConceptId && ["AUTOMATIC", "BOTH"].includes(hourConcept.loadMode || "")),
  );
  const completeShifts = shifts.flatMap((shift) => shift.endAt ? [{ ...shift, endAt: shift.endAt }] : []);
  const rows = calculateAutomaticBreakdowns(period, completeShifts, rules);

  let result;
  try {
    result = await repository.replaceAutomatic(employeeId, period, rows, createdByUserId);
  } catch (error) {
    if (!isConcurrencyError(error)) throw error;
    try {
      result = await repository.replaceAutomatic(employeeId, period, rows, createdByUserId);
    } catch (retryError) {
      if (isConcurrencyError(retryError)) throw new AppError("Concurrent automatic recalculation; retry the operation", 409, "AUTOMATIC_BREAKDOWN_CONCURRENT_CONFLICT");
      throw retryError;
    }
  }

  const response = { employeeId, period, processedShifts: completeShifts.length, eligibleConcepts: assignments.length, generated: result.created, removed: result.deleted };
  await auditService.register({ ...audit, action: "UPDATE", entity: "HourConceptBreakdown", entityId: employeeId, description: `Recalculó desgloses automáticos de ${period}`, after: response });
  return response;
}

export const automaticHourConceptBreakdownsService = {
  recalculateForEmployeePeriod,

  async recalculate(employeeId: string, period: string, user: Express.AuthUser, audit?: AuditContext) {
    const employee = await repository.findEmployee(employeeId, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    return recalculateForEmployeePeriod({ employeeId, period, createdByUserId: audit?.userId, audit });
  },
};
