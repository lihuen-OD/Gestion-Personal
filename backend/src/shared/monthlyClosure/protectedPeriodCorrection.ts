import type { PrismaTransactionClient } from "../prisma/client";
import { findProtectedClosurePeriods, ProtectedClosurePeriodError, type EmployeePeriod } from "./closurePeriodGuard";

type Db = Pick<PrismaTransactionClient, "$executeRaw" | "monthlyTimeClosure">;

/**
 * Guardados operativos que cambian la obligación o las horas de un día
 * (francos, convocatorias a feriado). Toma los locks compartidos de cierre y
 * rechaza con `409 PERIOD_CLOSED` si algún par está `CERRADO`, para todos los
 * roles, hasta su reapertura auditada (`POST /closures/:id/reopen`).
 */
export async function assertPeriodsNotClosed(db: Db, pairs: Iterable<EmployeePeriod>, message: string): Promise<void> {
  const list = [...pairs];
  // Sin cambios efectivos no hay nada que proteger (ni locks que tomar).
  if (!list.length) return;
  const protectedPeriods = await findProtectedClosurePeriods(db, list);
  if (!protectedPeriods.size) return;
  throw new ProtectedClosurePeriodError(
    [...protectedPeriods.entries()].map(([key, status]) => {
      const [employeeId, period] = key.split(":") as [string, string];
      return { employeeId, period, status };
    }),
    message,
  );
}
