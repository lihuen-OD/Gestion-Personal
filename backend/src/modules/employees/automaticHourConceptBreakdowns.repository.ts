import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { assertClosurePeriodsWritable } from "../../shared/monthlyClosure/closurePeriodGuard";
import type { CalculatedAutomaticBreakdown } from "./automaticHourConceptBreakdowns";

export const automaticHourConceptBreakdownsRepository = {
  findEmployee(id: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: { id: true } });
  },

  findClosure(employeeId: string, period: string) {
    return prisma.monthlyTimeClosure.findUnique({
      where: { employeeId_period: { employeeId, period } },
      select: { status: true },
    });
  },

  findEligibleConcepts(employeeId: string) {
    return prisma.employeeHourConcept.findMany({
      where: {
        employeeId,
        hourConcept: {
          systemRole: null,
          status: "ACTIVO",
          loadMode: { in: ["AUTOMATIC", "BOTH"] },
        },
      },
      select: {
        hourConcept: {
          select: {
            id: true,
            loadMode: true,
            rules: {
              where: { status: "ACTIVO" },
              select: { id: true, hourConceptId: true, startTime: true, endTime: true, crossesMidnight: true },
            },
          },
        },
      },
    });
  },

  findProcessedShifts(employeeId: string, startAt: Date, endAt: Date) {
    return prisma.workShift.findMany({
      where: { employeeId, status: "PROCESADO", endAt: { not: null, gt: startAt }, startAt: { lt: endAt } },
      select: { id: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
    });
  },

  // Deshabilitar un concepto conserva su historia (WORKED_TIME_ACCOUNTING_MODEL.md
  // §14): sólo se regeneran los desgloses de conceptos activos. Los de un
  // concepto INACTIVO quedan tal cual — sin esto, la próxima jornada cerrada
  // en el período los borraba sin volver a crearlos.
  // `afterWrite` (PERF-5D): corre en ESTA transacción después de reemplazar los
  // desgloses — el post-proceso de una fichada escribe ahí la auditoría y la
  // marca de su paso, así que efectos, auditoría y marca se confirman juntos
  // (también en el reintento por conflicto de serialización).
  replaceAutomatic(employeeId: string, period: string, rows: Array<CalculatedAutomaticBreakdown & { appliedMultiplier: number }>, createdByUserId?: string | null, afterWrite?: (tx: PrismaTransactionClient, outcome: { deleted: number; created: number }) => Promise<void>) {
    return prisma.$transaction(async (tx) => {
      // D-5: un recálculo automático nunca modifica un período protegido;
      // verificado dentro de la transacción (contempla un envío concurrente).
      await assertClosurePeriodsWritable(tx, [{ employeeId, period }], { message: "The period is closed for recalculation" });
      const deleted = await tx.hourConceptBreakdown.deleteMany({ where: { employeeId, period, source: "AUTOMATIC", hourConcept: { status: "ACTIVO" } } });
      if (rows.length) {
        await tx.hourConceptBreakdown.createMany({
          data: rows.map((row) => ({ ...row, employeeId, source: "AUTOMATIC", status: "BORRADOR", createdByUserId: createdByUserId || null })),
        });
      }
      const outcome = { deleted: deleted.count, created: rows.length };
      if (afterWrite) await afterWrite(tx, outcome);
      return outcome;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};
