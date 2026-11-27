import type { MonthlyClosureStatus } from "@prisma/client";

const LOCKED_STATUSES: ReadonlySet<MonthlyClosureStatus> = new Set(["CERRADO"]);

export interface MonthlyClosureLockInfo {
  status: MonthlyClosureStatus;
}

export function isMonthlyClosureLocked(closure: MonthlyClosureLockInfo | null | undefined): boolean {
  return !!closure && LOCKED_STATUSES.has(closure.status);
}

/** La exportación definitiva exige un cierre terminal. */
export function isMonthlyClosureApproved(closure: MonthlyClosureLockInfo | null | undefined): boolean {
  return closure?.status === "CERRADO";
}

/**
 * De un conjunto de `employeeId` con (o sin) cierre para un mismo período,
 * devuelve los que NO tienen un cierre `APROBADO` — sea porque no tienen
 * ningún `MonthlyTimeClosure` para ese período, o porque lo tienen en otro
 * estado. Lista vacía = todos aprobados = la exportación definitiva puede
 * seguir. Un export multi-empleado nunca se genera parcialmente: si esta
 * lista no está vacía, el caller debe rechazar el export completo.
 */
export function findUnapprovedEmployeeIdsForExport(
  employeeIds: readonly string[],
  closuresByEmployeeId: ReadonlyMap<string, MonthlyClosureLockInfo | undefined>,
): string[] {
  return employeeIds.filter((employeeId) => !isMonthlyClosureApproved(closuresByEmployeeId.get(employeeId)));
}
