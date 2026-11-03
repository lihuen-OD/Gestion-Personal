import type { PrismaTransactionClient } from "../../shared/prisma/client";

export type EmployeeDay = { employeeId: string; dateKey: string };

/**
 * Advisory lock transaccional por empleado + fecha
 * (docs/decisions/EMPLOYEE_DAY_OFF.md §5 y §9). Lo toman, dentro de su
 * transacción, todos los que deciden algo sobre el franco de ese día: el
 * guardado de francos, el guardado de convocatorias a feriado y el paso del
 * post-proceso de fichada que crea la alerta. Así nunca quedan franco y
 * convocatoria activos a la vez, ni dos alertas/notificaciones por la misma
 * jornada. Orden estable (sin deadlocks); se libera al terminar la transacción.
 */
export async function lockEmployeeDays(db: Pick<PrismaTransactionClient, "$executeRaw">, days: EmployeeDay[]) {
  const keys = [...new Set(days.map((day) => `employee-day:${day.employeeId}:${day.dateKey}`))].sort();
  if (!keys.length) return;
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM unnest(${keys}::text[]) AS k`;
}
