import type { MonthlyClosureStatus } from "@prisma/client";

/**
 * Etapa 15E (docs/decisions/TIME_CLOSURE_CONSISTENCY_15E.md): estados de
 * `MonthlyTimeClosure` que bloquean edición/creación directa de horas para
 * roles no-RRHH — el período ya fue enviado a revisión y su integridad de
 * liquidación debe protegerse.
 *
 * `ABIERTO` y `DEVUELTO` quedan afuera a propósito: `DEVUELTO` significa que
 * RRHH lo reabrió explícitamente (`POST /closures/:id/return`) para que
 * vuelva a operarse con flujo normal — no es un estado "cerrado".
 *
 * `MonthlyClosureStatus` no tiene un valor `CERRADO` separado: `APROBADO`
 * es el estado terminal real de un cierre en este modelo (ver
 * `workforceService.approveClosures`). No confundir con
 * `TimeEntry.status`/`HourConceptBreakdown.status`, que sí usan
 * `ApprovalStatus.CERRADO` para una fila individual — ese es un concepto
 * distinto (estado de la fila), no del cierre mensual.
 */
const LOCKED_STATUSES: ReadonlySet<MonthlyClosureStatus> = new Set(["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"]);

export interface MonthlyClosureLockInfo {
  status: MonthlyClosureStatus;
}

export function isMonthlyClosureLocked(closure: MonthlyClosureLockInfo | null | undefined): boolean {
  return !!closure && LOCKED_STATUSES.has(closure.status);
}

/**
 * Etapa 15E.2 (docs/decisions/TIME_EXPORT_CLOSURE_GATE_15E2.md): la
 * exportación DEFINITIVA de horas (para liquidación) exige el estado
 * terminal exacto `APROBADO` — a diferencia de `isMonthlyClosureLocked`
 * (que además trata `ENVIADO`/`CORRECCION_PENDIENTE` como "bloqueado para
 * edición directa"), acá esos dos estados siguen sin ser exportables: el
 * período todavía puede cambiar. Sin cierre, `ABIERTO` y `DEVUELTO` tampoco
 * habilitan la exportación definitiva.
 */
export function isMonthlyClosureApproved(closure: MonthlyClosureLockInfo | null | undefined): boolean {
  return closure?.status === "APROBADO";
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
