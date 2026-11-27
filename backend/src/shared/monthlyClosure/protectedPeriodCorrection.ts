import type { MonthlyClosureStatus } from "@prisma/client";
import { AppError } from "../errors/AppError";
import type { PrismaTransactionClient } from "../prisma/client";
import { roles } from "../security/roles";
import { findProtectedClosurePeriods, ProtectedClosurePeriodError, type EmployeePeriod } from "./closurePeriodGuard";

type Db = Pick<PrismaTransactionClient, "$executeRaw" | "monthlyTimeClosure">;

/**
 * Corrección manual sobre un período enviado/aprobado (EMPLOYEE_DAY_OFF.md
 * §12, mismo criterio que la corrección de una hora): sólo RRHH y con motivo.
 * Única implementación para los guardados operativos que cambian la
 * obligación o las horas de un día (francos, convocatorias a feriado). Toma
 * los locks compartidos de cierre y devuelve los pares protegidos (para
 * auditar el motivo y no reconstruir sus snapshots).
 */
export async function assertProtectedPeriodCorrection(
  db: Db,
  pairs: Iterable<EmployeePeriod>,
  input: { role: string; correctionReason: string | null; forbiddenMessage: string; reasonRequiredCode: string },
): Promise<Map<string, MonthlyClosureStatus>> {
  const list = [...pairs];
  // Sin cambios efectivos no hay nada que proteger (ni locks que tomar).
  if (!list.length) return new Map();
  const protectedPeriods = await findProtectedClosurePeriods(db, list);
  if (!protectedPeriods.size) return protectedPeriods;
  if (input.role !== roles.rrhh) {
    throw new ProtectedClosurePeriodError(
      [...protectedPeriods.entries()].map(([key, status]) => {
        const [employeeId, period] = key.split(":") as [string, string];
        return { employeeId, period, status };
      }),
      input.forbiddenMessage,
    );
  }
  if (!input.correctionReason) throw new AppError("Indicá el motivo de la corrección: el período ya fue enviado a cierre.", 400, input.reasonRequiredCode);
  return protectedPeriods;
}
