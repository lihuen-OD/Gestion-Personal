/**
 * Reconciliación de Horas Especiales: alinea las cargas ya existentes con el
 * estado VIGENTE de las reglas de Hora Especial y de las convocatorias de
 * feriado (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15 y §16), con el
 * mismo motor central que usa cualquier cambio (reinterpretSpecialHoursOnDates).
 * Corrige filas que quedaron con el multiplicador de un momento anterior (p. ej.
 * un feriado agregado antes de que existiera la reinterpretación).
 *
 *   npm run staging:special-hours:reconcile                                     (dry-run)
 *   npm run staging:special-hours:reconcile -- --report=<archivo.json>         (dry-run + detalle)
 *   npm run staging:special-hours:reconcile:apply -- --backup=<archivo.json> [--report=<archivo.json>]
 *
 * Sólo staging (aborta en production). Sólo cambia appliedMultiplier, la traza
 * por tramo y los snapshots de cierre — nunca minutos, estados ni fechas.
 * El dry-run calcula todo dentro de una transacción que se revierte. --apply
 * escribe primero el backup (valores actuales) y aborta sin escribir si los
 * cambios ya no coinciden con los del dry-run.
 */
import { writeFileSync } from "node:fs";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { loadEmployeeReferences } from "../src/shared/audit/employeeReference";
import { auditService } from "../src/modules/audit/audit.service";
import { assertStagingTarget } from "../src/modules/time-entries/legacyObservationRepair";
import { auditClosureRecalculations } from "../src/modules/workforce-management/closureRecalculationAudit";
import { reinterpretSpecialHoursOnDates, type SpecialHourReinterpretation } from "../src/modules/workforce-management/specialHourReinterpretation";
import { describeReinterpretation, reinterpretationMetadata } from "../src/modules/workforce-management/specialHourReinterpretationSummary";

class DryRunRollback extends Error {}
const TRANSACTION_OPTIONS = { timeout: 120_000 };
const RECALCULATION = { reason: "SPECIAL_HOUR_RECONCILIATION" } as const;

async function reconcile(dates: Date[], write: boolean, expected?: SpecialHourReinterpretation["changes"]) {
  let result: SpecialHourReinterpretation | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      result = await reinterpretSpecialHoursOnDates(tx, dates, RECALCULATION);
      if (expected && JSON.stringify(result.changes) !== JSON.stringify(expected)) {
        throw new Error("Los datos cambiaron desde el dry-run: no se aplicó nada. Volvé a correr el dry-run.");
      }
      if (!write) throw new DryRunRollback();
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return result!;
}

async function main() {
  assertStagingTarget(env.APP_ENV, env.NODE_ENV);
  const apply = process.argv.includes("--apply");
  const backupPath = process.argv.find((arg) => arg.startsWith("--backup="))?.slice("--backup=".length);
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
  if (apply && !backupPath) throw new Error("--apply requiere --backup=<archivo.json>");

  // Todas las fechas con horas, desgloses o tramos.
  const rows = await prisma.$queryRaw<Array<{ date: Date }>>`
    SELECT date FROM "TimeEntry" UNION SELECT date FROM "HourConceptBreakdown" UNION SELECT date FROM "TimeSegment"`;
  const dates = rows.map((row) => row.date);

  const planned = await reconcile(dates, false);
  const employeeIds = [...new Set([...planned.changes.timeEntries, ...planned.changes.breakdowns].map((change) => change.employeeId))];
  const referenceOf = await loadEmployeeReferences(prisma, employeeIds);
  const readable = (changes: SpecialHourReinterpretation["changes"]["timeEntries"]) => changes.map((change) => ({ ...change, empleado: referenceOf(change.employeeId) }));
  const report = {
    appEnv: env.APP_ENV,
    mode: apply ? "apply" : "dry-run",
    dates: dates.length,
    summary: { ...reinterpretationMetadata(planned), description: describeReinterpretation(planned) },
    timeEntries: readable(planned.changes.timeEntries),
    breakdowns: readable(planned.changes.breakdowns),
    segments: planned.changes.segments,
    closures: planned.rebuiltClosures.map((closure) => ({ id: closure.id, empleado: referenceOf(closure.employeeId), period: closure.period })),
  };
  console.log(JSON.stringify({ ...report, timeEntries: report.timeEntries.length, breakdowns: report.breakdowns.length, segments: report.segments.length }, null, 2));
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (!apply) return;
  if (!planned.timeEntries && !planned.breakdowns && !planned.segments) {
    console.log("Nada que reconciliar.");
    return;
  }

  writeFileSync(backupPath!, JSON.stringify({
    takenAt: new Date().toISOString(),
    timeEntries: planned.changes.timeEntries.map(({ id, from }) => ({ id, appliedMultiplier: from })),
    breakdowns: planned.changes.breakdowns.map(({ id, from }) => ({ id, appliedMultiplier: from })),
    segments: planned.changes.segments.map(({ id, fromIsSpecial, fromTrace }) => ({ id, isSpecial: fromIsSpecial, trace: fromTrace })),
    closures: planned.rebuiltClosures.map((closure) => ({ id: closure.id, snapshot: closure.before })),
  }, null, 2));
  const applied = await reconcile(dates, true, planned.changes);

  await auditService.register({
    action: "UPDATE",
    entity: "TimeEntry",
    description: `Reconciliación de Horas Especiales con las reglas y convocatorias de feriado vigentes. ${describeReinterpretation(applied)}`,
    after: reinterpretationMetadata(applied) as never,
  });
  await auditClosureRecalculations(applied.rebuiltClosures, "reconciliación de Horas Especiales", undefined, (ids) => loadEmployeeReferences(prisma, ids));
  console.log(JSON.stringify({ applied: reinterpretationMetadata(applied), backup: backupPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
