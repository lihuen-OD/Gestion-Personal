import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "./employeeAccess";
import { argentinaPeriodBounds, calculateAutomaticBreakdowns } from "./automaticHourConceptBreakdowns";
import { automaticHourConceptBreakdownsRepository as repository } from "./automaticHourConceptBreakdowns.repository";

function isConcurrencyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export const automaticHourConceptBreakdownsService = {
  async recalculate(employeeId: string, period: string, user: Express.AuthUser, audit?: AuditContext) {
    const employee = await repository.findEmployee(employeeId, employeeAccessWhere(user));
    if (!employee) throw new AppError("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
    const closure = await repository.findClosure(employeeId, period);
    if (closure && ["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"].includes(closure.status)) {
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
      result = await repository.replaceAutomatic(employeeId, period, rows, audit?.userId);
    } catch (error) {
      if (!isConcurrencyError(error)) throw error;
      try {
        result = await repository.replaceAutomatic(employeeId, period, rows, audit?.userId);
      } catch (retryError) {
        if (isConcurrencyError(retryError)) throw new AppError("Concurrent automatic recalculation; retry the operation", 409, "AUTOMATIC_BREAKDOWN_CONCURRENT_CONFLICT");
        throw retryError;
      }
    }

    const response = { employeeId, period, processedShifts: completeShifts.length, eligibleConcepts: assignments.length, generated: result.created, removed: result.deleted };
    await auditService.register({ ...audit, action: "UPDATE", entity: "HourConceptBreakdown", entityId: employeeId, description: `Recalculó desgloses automáticos de ${period}`, after: response });
    return response;
  },
};
