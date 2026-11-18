/**
 * Reconciliación de la cobertura diaria de novedades
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §10): recalcula
 * `NoveltyDayCoverage` de las novedades no rechazadas con el mismo motor que
 * el alta (`persistNoveltyCoverageWithin`, modo SKIP: nunca toca días de
 * períodos ya enviados a cierre y conserva las resoluciones manuales que
 * siguen valiendo). Sirve para generar la cobertura de novedades históricas
 * cuando se autorice.
 *
 * Uso (SÓLO PostgreSQL local; nunca Neon ni una base compartida):
 *   npm run novelties:coverage:reconcile                                   (dry-run)
 *   npm run novelties:coverage:reconcile -- --from=2026-01-01 --to=2026-12-31
 *   npm run novelties:coverage:reconcile -- --apply --backup=<archivo.json>
 *
 * El dry-run calcula todo dentro de transacciones que se revierten: no escribe
 * nada. --apply exige --backup=<archivo nuevo>: antes de escribir guarda ahí
 * las filas actuales de cobertura de las novedades alcanzadas.
 */
import { existsSync, writeFileSync } from "node:fs";
import { prisma } from "../src/shared/prisma/client";
import { calendarDateKey } from "../src/shared/datetime/argentinaTime";
import { persistNoveltyCoverageWithin, type CoveragePersistSummary } from "../src/modules/novelties/noveltyCoverage.service";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];
const CHUNK_SIZE = 25;
const TRANSACTION_OPTIONS = { timeout: 60_000 };

class DryRunRollback extends Error {
  constructor(public readonly summary: CoveragePersistSummary) {
    super("dry-run");
  }
}

export function assertLocalTarget(databaseUrl: string | undefined, environment: { NODE_ENV?: string; APP_ENV?: string }) {
  if (environment.NODE_ENV === "production" || environment.APP_ENV === "production") throw new Error("La reconciliación de cobertura nunca corre en producción.");
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatoria.");
  const { hostname } = new URL(databaseUrl);
  if (!LOCAL_HOSTS.includes(hostname)) throw new Error("La reconciliación de cobertura sólo corre contra PostgreSQL local (nunca Neon ni una base compartida).");
}

function argument(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function dateArgument(name: string) {
  const value = argument(name);
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${name} debe tener el formato AAAA-MM-DD.`);
  return new Date(`${value}T00:00:00.000Z`);
}

async function processChunk(ids: string[], apply: boolean): Promise<CoveragePersistSummary> {
  try {
    return await prisma.$transaction(async (tx) => {
      const summary = await persistNoveltyCoverageWithin(tx, ids, { protectedPeriods: "SKIP" });
      if (!apply) throw new DryRunRollback(summary);
      return summary;
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  }
}

async function main() {
  assertLocalTarget(process.env.DATABASE_URL, process.env);
  const apply = process.argv.includes("--apply");
  const backupPath = argument("backup");
  if (apply && !backupPath) throw new Error("--apply requiere --backup=<archivo.json>.");
  if (backupPath && existsSync(backupPath)) throw new Error("El archivo de backup ya existe: indicá uno nuevo.");
  const from = dateArgument("from");
  const to = dateArgument("to");

  const novelties = await prisma.novelty.findMany({
    where: { status: { not: "RECHAZADO" }, ...(from || to ? { fromDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    select: { id: true, fromDate: true, employee: { select: { legajo: true } }, noveltyType: { select: { code: true } } },
    orderBy: [{ fromDate: "asc" }, { id: "asc" }],
  });
  const ids = novelties.map((novelty) => novelty.id);
  const rowsBefore = await prisma.noveltyDayCoverage.count({ where: { noveltyId: { in: ids } } });

  if (apply) {
    const backup = await prisma.noveltyDayCoverage.findMany({ where: { noveltyId: { in: ids } } });
    writeFileSync(backupPath!, JSON.stringify({ createdAt: new Date().toISOString(), novelties: ids.length, rows: backup }, null, 2));
  }

  const totals = { novelties: 0, days: 0, pendingReviewDays: 0, droppedResolutions: 0, protectedPeriods: new Set<string>() };
  const failures: Array<{ legajo: string; tipo: string; desde: string; error: string }> = [];
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE);
    const add = (summary: CoveragePersistSummary) => {
      totals.novelties += summary.novelties;
      totals.days += summary.days;
      totals.pendingReviewDays += summary.pendingReviewDays;
      totals.droppedResolutions += summary.droppedResolutions;
      for (const pair of summary.protectedPeriods) totals.protectedPeriods.add(`${pair.employeeId}:${pair.period}`);
    };
    try {
      add(await processChunk(chunk, apply));
    } catch {
      // Una novedad que no se puede calcular (p. ej. historia laboral faltante)
      // no frena al resto: se procesa de a una y se informa.
      for (const id of chunk) {
        try {
          add(await processChunk([id], apply));
        } catch (error) {
          const novelty = novelties.find((item) => item.id === id)!;
          failures.push({ legajo: novelty.employee.legajo, tipo: novelty.noveltyType.code, desde: calendarDateKey(novelty.fromDate), error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  const rowsAfter = apply ? await prisma.noveltyDayCoverage.count({ where: { noveltyId: { in: ids } } }) : null;
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        noveltiesInScope: ids.length,
        noveltiesWithCoverage: totals.novelties,
        coverageDaysBefore: rowsBefore,
        coverageDaysCalculated: totals.days,
        coverageDaysAfter: rowsAfter,
        pendingReviewDays: totals.pendingReviewDays,
        droppedResolutions: totals.droppedResolutions,
        protectedEmployeePeriodsSkipped: totals.protectedPeriods.size,
        failures,
        ...(apply ? { backup: backupPath } : {}),
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
