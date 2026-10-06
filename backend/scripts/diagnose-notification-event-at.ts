/**
 * Diagnóstico read-only de SystemNotification.eventAt (fecha efectiva del
 * hecho de negocio — docs/decisions/NOTIFICATIONS_EVENT_ORDER.md).
 *
 *   npm run staging:notifications:event-at                              (diagnóstico)
 *   npm run staging:notifications:event-at -- --report=<archivo.json>   (+ detalle por fila)
 *
 * Antes de la migración 20261006100000_add_system_notification_event_at:
 * informa de qué fuente tomaría cada fila su eventAt (misma regla exacta que
 * el backfill SQL) y cuántas referencias huérfanas caen a createdAt.
 * Después: verifica 100% eventAt NOT NULL y compara el valor persistido con
 * el esperado. Una diferencia en ShiftAlert creada DESPUÉS de la migración es
 * esperable (eventAt queda congelado aunque un upsert mueva actualAt); se
 * reporta, no se corrige. Nunca escribe.
 */
import { writeFileSync } from "node:fs";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import { assertStagingTarget } from "../src/modules/time-entries/legacyObservationRepair";
import { argentinaDateKey, calendarDateKey } from "../src/shared/datetime/argentinaTime";

type Source = "SHIFT_ALERT" | "WORK_SHIFT" | "ATTENDANCE_INACTIVITY_INCIDENT" | "ORPHAN_CREATED_AT" | "CREATED_AT";
type Row = { id: string; entityType: string | null; entityId: string | null; createdAt: Date; operationalDate: Date | null; expectedEventAt: Date; source: Source };

// Misma regla que el backfill de la migración — mantener sincronizadas.
const PLANNED = `
  SELECT n."id", n."entityType", n."entityId", n."createdAt", i."operationalDate",
    COALESCE(a."actualAt", w."startAt", (i."operationalDate"::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'), n."createdAt") AS "expectedEventAt",
    CASE
      WHEN a."id" IS NOT NULL THEN 'SHIFT_ALERT'
      WHEN w."id" IS NOT NULL THEN 'WORK_SHIFT'
      WHEN i."id" IS NOT NULL THEN 'ATTENDANCE_INACTIVITY_INCIDENT'
      WHEN n."entityType" IN ('ShiftAlert', 'WorkShift', 'AttendanceInactivityIncident') AND n."entityId" IS NOT NULL THEN 'ORPHAN_CREATED_AT'
      ELSE 'CREATED_AT'
    END AS "source"
  FROM "SystemNotification" n
  LEFT JOIN "ShiftAlert" a ON n."entityType" = 'ShiftAlert' AND a."id" = n."entityId"
  LEFT JOIN "WorkShift" w ON n."entityType" = 'WorkShift' AND w."id" = n."entityId"
  LEFT JOIN "AttendanceInactivityIncident" i ON n."entityType" = 'AttendanceInactivityIncident' AND i."id" = n."entityId"`;

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] ?? 0) + 1 }), {});
}

async function main() {
  assertStagingTarget(env.APP_ENV, env.NODE_ENV);
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
  const [{ exists }] = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SystemNotification' AND column_name = 'eventAt') AS "exists"`,
  );
  const rows = await prisma.$queryRawUnsafe<Row[]>(PLANNED);
  const persisted = exists
    ? new Map((await prisma.$queryRawUnsafe<Array<{ id: string; eventAt: Date | null }>>(`SELECT "id", "eventAt" FROM "SystemNotification"`)).map((row) => [row.id, row.eventAt]))
    : undefined;

  // "Recuperada por catch-up" = el día argentino del hecho difiere del día de creación.
  const catchUp = rows.filter((row) => argentinaDateKey(row.expectedEventAt) !== argentinaDateKey(row.createdAt));
  const mismatches = persisted
    ? rows.filter((row) => persisted.get(row.id)?.getTime() !== row.expectedEventAt.getTime()).map((row) => ({ ...row, persistedEventAt: persisted.get(row.id) ?? null }))
    : [];
  // §C: un incidente (fecha calendario) tiene que caer en Argentina exactamente en su día operativo.
  const incidentDayShifts = rows.filter((row) => row.operationalDate && argentinaDateKey(row.expectedEventAt) !== calendarDateKey(row.operationalDate)).length;
  const summary = {
    appEnv: env.APP_ENV,
    phase: exists ? "post-migration" : "pre-migration",
    total: rows.length,
    byEntityType: countBy(rows, (row) => row.entityType ?? "(sin entityType)"),
    bySource: countBy(rows, (row) => row.source),
    orphans: rows.filter((row) => row.source === "ORPHAN_CREATED_AT").map(({ id, entityType, entityId }) => ({ id, entityType, entityId })),
    catchUpRows: catchUp.length,
    incidentDayShifts,
    ...(persisted ? {
      eventAtNull: [...persisted.values()].filter((value) => value === null).length,
      mismatches: mismatches.length,
      mismatchesBySource: countBy(mismatches, (row) => row.source),
    } : {}),
  };
  console.log(JSON.stringify({ ...summary, orphans: summary.orphans.length, orphansByEntityType: countBy(summary.orphans, (row) => row.entityType ?? "") }, null, 2));
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ ...summary, catchUp, mismatches }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
