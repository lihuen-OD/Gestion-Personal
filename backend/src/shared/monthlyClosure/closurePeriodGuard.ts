import type { MonthlyClosureStatus } from "@prisma/client";
import { AppError } from "../errors/AppError";
import type { PrismaTransactionClient } from "../prisma/client";
import { isMonthlyClosureLocked } from "./closureLock";

/**
 * D-5 (docs/decisions/ORG_LOCATION_REORGANIZATION.md §18.1): los períodos
 * `CERRADO` (ver closureLock.ts) quedan protegidos: ninguna operación,
 * automática o manual, puede reconstruirlos ni modificar sus horas,
 * desgloses, tramos o snapshot. Para cambiarlos hay que reabrirlos con motivo
 * auditado (`POST /closures/:id/reopen`).
 *
 * Protocolo de concurrencia, siempre DENTRO de la transacción de escritura:
 * - quien escribe datos de un empleado + período toma un advisory lock
 *   COMPARTIDO por par y recién entonces lee el estado del cierre;
 * - quien cambia el estado de un cierre (cerrar o reabrir) toma el lock
 *   EXCLUSIVO del par.
 * Así un cierre nunca se intercala con una escritura: el que llega segundo
 * espera al commit del primero y ve su resultado. Los locks se toman en orden
 * estable para no producir deadlocks entre estos caminos; se liberan solos al
 * terminar la transacción.
 */
export type EmployeePeriod = { employeeId: string; period: string };

type Db = Pick<PrismaTransactionClient, "$executeRaw" | "monthlyTimeClosure">;

export const employeePeriodKey = (pair: EmployeePeriod) => `${pair.employeeId}:${pair.period}`;

export function uniqueEmployeePeriods(pairs: Iterable<EmployeePeriod>): EmployeePeriod[] {
  const byKey = new Map<string, EmployeePeriod>();
  for (const pair of pairs) byKey.set(employeePeriodKey(pair), { employeeId: pair.employeeId, period: pair.period });
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, pair]) => pair);
}

/** Toma los advisory locks de cierre (compartidos o exclusivos) en orden estable. */
export async function lockClosurePeriods(db: Db, pairs: Iterable<EmployeePeriod>, mode: "SHARED" | "EXCLUSIVE") {
  const keys = uniqueEmployeePeriods(pairs).map((pair) => `closure:${employeePeriodKey(pair)}`);
  if (!keys.length) return;
  // unnest conserva el orden del arreglo (ya ordenado): los locks se toman en
  // ese orden dentro de una sola sentencia.
  if (mode === "SHARED") {
    await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(k, 0)) FROM unnest(${keys}::text[]) AS k`;
  } else {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM unnest(${keys}::text[]) AS k`;
  }
}

/**
 * Para escritores: toma el lock compartido de cada par y devuelve los que
 * están protegidos (estado de cierre leído DESPUÉS del lock).
 */
export async function findProtectedClosurePeriods(db: Db, pairs: Iterable<EmployeePeriod>): Promise<Map<string, MonthlyClosureStatus>> {
  const unique = uniqueEmployeePeriods(pairs);
  if (!unique.length) return new Map();
  await lockClosurePeriods(db, unique, "SHARED");
  const closures = await db.monthlyTimeClosure.findMany({
    where: { employeeId: { in: [...new Set(unique.map((pair) => pair.employeeId))] }, period: { in: [...new Set(unique.map((pair) => pair.period))] } },
    select: { employeeId: true, period: true, status: true },
  });
  const wanted = new Set(unique.map(employeePeriodKey));
  return new Map(closures.filter((closure) => wanted.has(employeePeriodKey(closure)) && isMonthlyClosureLocked(closure)).map((closure) => [employeePeriodKey(closure), closure.status]));
}

export class ProtectedClosurePeriodError extends AppError {
  constructor(public readonly periods: Array<EmployeePeriod & { status: MonthlyClosureStatus }>, message?: string) {
    super(
      message ?? "El período está cerrado. Reabrilo antes de modificarlo.",
      409,
      "PERIOD_CLOSED",
      { periods },
    );
  }
}

/**
 * Para escrituras que no pueden hacerse sobre un período protegido (operación
 * automática o usuario sin procedimiento de corrección): lock + verificación
 * dentro de la transacción; lanza si alguno está protegido.
 * `explicitCorrection` sólo lo pasa un procedimiento explícito y auditado
 * (p. ej. corrección de RRHH con motivo): igual toma el lock compartido.
 */
export async function assertClosurePeriodsWritable(db: Db, pairs: Iterable<EmployeePeriod>, options: { explicitCorrection?: boolean; message?: string } = {}) {
  const protectedPeriods = await findProtectedClosurePeriods(db, pairs);
  if (!protectedPeriods.size || options.explicitCorrection) return protectedPeriods;
  throw new ProtectedClosurePeriodError(
    [...protectedPeriods.entries()].map(([key, status]) => {
      const [employeeId, period] = key.split(":");
      return { employeeId: employeeId!, period: period!, status };
    }),
    options.message,
  );
}
