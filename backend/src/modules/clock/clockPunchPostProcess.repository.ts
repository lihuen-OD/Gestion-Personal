import { Prisma, type ClockPunchPostProcessJob, type ClockPunchPostProcessKind } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";

/**
 * PERF-5D (docs/decisions/F12_PERF_5.md): outbox durable del post-proceso de
 * una fichada. El job nace en la MISMA transacción que su AttendancePunch y lo
 * procesa clockPunchPostProcess.worker fuera del request.
 *
 * - Orden por jornada: un job EXIT sólo se reclama cuando todo job de entrada
 *   (ENTRY / ROLLOVER_ENTRY) de su misma jornada está COMPLETED. Lo decide la
 *   misma sentencia del claim, así que sobrevive reinicios, reintentos y
 *   workers concurrentes.
 * - Fencing: cada paso bloquea la fila y exige el attemptCount de su claim; un
 *   worker cuyo lease venció y fue reclamado por otro ya no escribe nada.
 */
export type ClockPunchPostProcessScope = {
  employeeIds?: string[];
  workShiftId?: string;
  // Drenado en línea (cierre mensual, cierre manual): también reintenta
  // FAILED y no espera el backoff de un PENDING.
  includeFailed?: boolean;
  ignoreBackoff?: boolean;
  // Jobs que este drenado ya intentó: no se vuelven a tomar en la misma pasada.
  excludeIds?: string[];
};

export type ClaimedClockPunchPostProcessJob = ClockPunchPostProcessJob;

export class ClockPunchPostProcessLeaseLost extends Error {
  constructor(readonly jobId: string) {
    super("CLOCK_POSTPROCESS_LEASE_LOST");
  }
}

const TABLE = Prisma.raw(`"ClockPunchPostProcessJob"`);

export const clockPunchPostProcessRepository = {
  enqueue(tx: PrismaTransactionClient, input: { attendancePunchId: string; workShiftId: string; employeeId: string; kind: ClockPunchPostProcessKind; periods: string[]; payload: Prisma.InputJsonValue }) {
    return tx.clockPunchPostProcessJob.create({ data: input, select: { id: true } });
  },

  async claimNext(now: Date, leaseMs: number, scope: ClockPunchPostProcessScope = {}): Promise<ClaimedClockPunchPostProcessJob | null> {
    const claimable = [
      scope.ignoreBackoff ? Prisma.sql`c."status" = 'PENDING'` : Prisma.sql`(c."status" = 'PENDING' AND c."nextAttemptAt" <= ${now})`,
      Prisma.sql`(c."status" = 'PROCESSING' AND c."leaseExpiresAt" < ${now})`,
      ...(scope.includeFailed ? [Prisma.sql`c."status" = 'FAILED'`] : []),
    ];
    const filters = [
      ...(scope.employeeIds ? [Prisma.sql`c."employeeId" = ANY(${scope.employeeIds}::text[])`] : []),
      ...(scope.workShiftId ? [Prisma.sql`c."workShiftId" = ${scope.workShiftId}`] : []),
      ...(scope.excludeIds?.length ? [Prisma.sql`NOT (c."id" = ANY(${scope.excludeIds}::text[]))`] : []),
    ];
    const rows = await prisma.$queryRaw<ClaimedClockPunchPostProcessJob[]>(Prisma.sql`
      UPDATE ${TABLE} AS j
      SET "status" = 'PROCESSING',
          "attemptCount" = j."attemptCount" + 1,
          "leaseExpiresAt" = ${new Date(now.getTime() + leaseMs)},
          "startedAt" = COALESCE(j."startedAt", ${now}),
          "updatedAt" = ${now}
      WHERE j."id" = (
        SELECT c."id" FROM ${TABLE} AS c
        WHERE (${Prisma.join(claimable, " OR ")})
          ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
          AND NOT EXISTS (
            SELECT 1 FROM ${TABLE} AS p
            WHERE c."kind" = 'EXIT'
              AND p."workShiftId" = c."workShiftId"
              AND p."kind" <> 'EXIT'
              AND p."status" <> 'COMPLETED'
          )
        ORDER BY c."nextAttemptAt" ASC, c."createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j.*
    `);
    return rows[0] ?? null;
  },

  /**
   * Abre un paso: bloquea la fila del job (hasta el fin de la transacción del
   * paso) y verifica que el lease siga siendo de este claim. Devuelve los pasos
   * ya confirmados.
   */
  async lockForStep(tx: PrismaTransactionClient, jobId: string, attemptCount: number) {
    const [row] = await tx.$queryRaw<Array<{ status: string; attemptCount: number; stepsCompleted: string[] }>>(Prisma.sql`
      SELECT "status", "attemptCount", "stepsCompleted" FROM ${TABLE} WHERE "id" = ${jobId} FOR UPDATE
    `);
    if (!row || row.status !== "PROCESSING" || row.attemptCount !== attemptCount) throw new ClockPunchPostProcessLeaseLost(jobId);
    return row.stepsCompleted;
  },

  // En la misma transacción que los efectos del paso; también renueva el lease.
  markStep(tx: PrismaTransactionClient, jobId: string, step: string, leaseExpiresAt: Date) {
    return tx.clockPunchPostProcessJob.update({ where: { id: jobId }, data: { stepsCompleted: { push: step }, leaseExpiresAt }, select: { id: true } });
  },

  complete(id: string, attemptCount: number, payload: Prisma.InputJsonValue, now: Date) {
    return prisma.clockPunchPostProcessJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "COMPLETED", completedAt: now, leaseExpiresAt: null, lastErrorCode: null, lastErrorMessage: null, payload },
    });
  },

  retry(id: string, attemptCount: number, nextAttemptAt: Date, code: string, message: string) {
    return prisma.clockPunchPostProcessJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "PENDING", nextAttemptAt, leaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: message },
    });
  },

  fail(id: string, attemptCount: number, code: string, message: string) {
    return prisma.clockPunchPostProcessJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "FAILED", leaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: message },
    });
  },

  // Tomados por otro worker con lease vigente (un drenado puede esperarlos).
  countHeldElsewhere(scope: { employeeIds?: string[]; workShiftId?: string; excludeIds: string[] }, now: Date) {
    return prisma.clockPunchPostProcessJob.count({
      where: {
        status: "PROCESSING",
        leaseExpiresAt: { gte: now },
        id: { notIn: scope.excludeIds },
        ...(scope.employeeIds ? { employeeId: { in: scope.employeeIds } } : {}),
        ...(scope.workShiftId ? { workShiftId: scope.workShiftId } : {}),
      },
    });
  },

  // Jobs sin terminar que tocan alguno de estos legajos en `period`.
  countUnfinished(db: Pick<PrismaTransactionClient, "clockPunchPostProcessJob">, employeeIds: string[], period: string) {
    return db.clockPunchPostProcessJob.count({ where: { employeeId: { in: employeeIds }, status: { not: "COMPLETED" }, periods: { has: period } } });
  },
};
