/**
 * Repara observaciones legadas de TimeEntry con un id técnico
 * ("fusionada en TimeEntry <uuid>"), sólo cuando es inequívoco. La lógica y
 * sus reglas viven en src/modules/time-entries/legacyObservationRepair.ts.
 *
 *   npm run staging:time-entry-observations                                  (dry-run)
 *   npm run staging:time-entry-observations -- --report=<archivo.json>      (dry-run + propuestas)
 *   npm run staging:time-entry-observations:apply -- --backup=<archivo.json> [--report=<archivo.json>]
 *
 * Sólo staging (aborta en production). --apply escribe primero el backup
 * {id, observation} y aplica todo-o-nada: si alguna fila cambió desde la
 * lectura, no se aplica ninguna. Sólo toca la columna observation.
 */
import { writeFileSync } from "node:fs";
import { env } from "../src/config/env";
import { prisma } from "../src/shared/prisma/client";
import {
  applyObservationRepairs,
  assertStagingTarget,
  proposeObservationRepair,
  referencedTechnicalIds,
  type ReferencedEntry,
} from "../src/modules/time-entries/legacyObservationRepair";

async function main() {
  assertStagingTarget(env.APP_ENV, env.NODE_ENV);
  const apply = process.argv.includes("--apply");
  const backupPath = process.argv.find((arg) => arg.startsWith("--backup="))?.slice("--backup=".length);
  const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
  if (apply && !backupPath) throw new Error("--apply requiere --backup=<archivo.json>");

  const affected = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "TimeEntry"
    WHERE observation ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'`;
  const rows = await prisma.timeEntry.findMany({
    where: { id: { in: affected.map((row) => row.id) } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: { id: true, employeeId: true, date: true, observation: true },
  });

  // Una sola consulta para todos los TimeEntry referenciados.
  const referencedIds = Array.from(new Set(rows.flatMap((row) => referencedTechnicalIds(row.observation).map((id) => id.toLowerCase()))));
  const references = await prisma.timeEntry.findMany({
    where: { id: { in: referencedIds } },
    select: { id: true, employeeId: true, date: true, hourConcept: { select: { systemRole: true } } },
  });
  const referencesById = new Map<string, ReferencedEntry>(references.map((entry) => [
    entry.id.toLowerCase(),
    { id: entry.id, employeeId: entry.employeeId, date: entry.date, isNormalBase: entry.hourConcept.systemRole === "NORMAL_BASE" },
  ]));

  const proposals = rows.map((row) => proposeObservationRepair(row, referencesById));
  const repairs = proposals.flatMap((proposal) => (proposal.status === "repair" ? [proposal] : []));
  const skipped = proposals.filter((proposal) => proposal.status === "skip");

  console.log(JSON.stringify({ appEnv: env.APP_ENV, mode: apply ? "apply" : "dry-run", found: rows.length, repairable: repairs.length, skipped: skipped.length, skippedDetail: skipped }, null, 2));
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), appEnv: env.APP_ENV, repairs, skipped }, null, 2));
  if (!apply || !repairs.length) return;

  writeFileSync(backupPath!, JSON.stringify(repairs.map(({ id, before }) => ({ id, observation: before })), null, 2));
  const updated = await applyObservationRepairs(prisma, repairs);
  console.log(JSON.stringify({ updated, backup: backupPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
