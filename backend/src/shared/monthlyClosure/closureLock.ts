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
