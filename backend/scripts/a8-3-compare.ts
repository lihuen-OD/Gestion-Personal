/**
 * Verificación de la etapa A8-3 sobre la copia `org-location-reorg`
 * (docs/decisions/A8_M2_PREPARATION.md §3.4). Tres modos, todos de datos ya
 * capturados salvo `verify-sector`, que sólo lee:
 *
 *   npx tsx scripts/a8-3-compare.ts engine --before=<reporte> --after=<reporte> --out=<resumen.json>
 *     Equivalencia del motor por par fecha-legajo: mismas claves y misma
 *     etiqueta/detalle. MISSING = MISSING sigue siendo igual (no se completa
 *     historia). Exit 2 si algún par cambió o falta.
 *
 *   npx tsx scripts/a8-3-compare.ts manifest --before=<manifiesto> --after=<manifiesto> --out=<resumen.json>
 *     Manifiesto por ID/contenido: única incorporación permitida = columna
 *     `Sector.isLegacy` (mismas filas) y una fila nueva en `_prisma_migrations`
 *     (mismas filas existentes intactas). Todo lo demás idéntico, con los
 *     cierres informados por ID y contenido. Exit 2 ante cualquier violación.
 *
 *   npx tsx scripts/a8-3-compare.ts verify-sector --env-file=<archivo> --expected-host=<host> --backup-pre=<respaldo> --out=<reporte.json>
 *     La columna clasifica con el criterio previo, es NOT NULL y sin DEFAULT;
 *     padres/datos de cada sector y el conjunto de migraciones aplicadas son
 *     idénticos al respaldo previo. Exit 2 ante cualquier discrepancia.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, readOnly } from "./org-reorg/lib";
import type { RowManifest } from "../src/modules/org-structure/reorg/manifest";

const AUTHORIZED_MIGRATION = "20261008110000_sector_org_classification";

interface PairResult {
  label: string;
  multiplier: number | null;
  winners: string[];
  matchedRules: Array<{ id: string; name: string }>;
  conflicting: boolean;
  missingHistory: { dimensions: string[]; ruleId: string; ruleName: string } | null;
}

interface EngineReport { host: string; engine: string; pairs: number; missingPairs: string[]; result: Record<string, PairResult> }

function load<T>(name: string): T {
  const path = arg(name);
  if (!path) throw new Error(`Falta --${name}=<archivo.json>.`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeOut(report: unknown, ok: boolean) {
  const out = arg("out");
  if (!out) throw new Error("Falta --out=<archivo.json> (fuera del repositorio).");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...(report as Record<string, unknown>), out }, null, 2));
  if (!ok) process.exitCode = 2;
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------

function compareEngines() {
  const before = load<EngineReport>("before");
  const after = load<EngineReport>("after");
  const keysBefore = Object.keys(before.result);
  const keysAfter = Object.keys(after.result);
  const onlyBefore = keysBefore.filter((key) => !(key in after.result));
  const onlyAfter = keysAfter.filter((key) => !(key in before.result));
  const changed: Array<{ key: string; before: string; after: string; detail: string[] }> = [];
  let equal = 0;
  let missingBefore = 0;
  let missingAfter = 0;
  let missingStillMissing = 0;
  for (const key of keysBefore) {
    const a = before.result[key]!;
    const b = after.result[key];
    if (!b) continue;
    if (a.label.startsWith("MISSING:")) missingBefore += 1;
    if (b.label.startsWith("MISSING:")) missingAfter += 1;
    const detail: string[] = [];
    if (a.multiplier !== b.multiplier) detail.push(`multiplier ${a.multiplier} → ${b.multiplier}`);
    if (a.winners.join(",") !== b.winners.join(",")) detail.push(`winners ${a.winners.join(",")} → ${b.winners.join(",")}`);
    const matchedA = a.matchedRules.map((rule) => rule.id).join(",");
    const matchedB = b.matchedRules.map((rule) => rule.id).join(",");
    if (matchedA !== matchedB) detail.push(`matchedRules ${matchedA} → ${matchedB}`);
    if (a.conflicting !== b.conflicting) detail.push(`conflicting ${a.conflicting} → ${b.conflicting}`);
    if (JSON.stringify(a.missingHistory) !== JSON.stringify(b.missingHistory)) detail.push("missingHistory cambió");
    if (a.label === b.label && !detail.length) {
      equal += 1;
      if (a.label.startsWith("MISSING:")) missingStillMissing += 1;
    } else {
      changed.push({ key, before: a.label, after: b.label, detail });
    }
  }
  const hostMismatch = before.host !== after.host;
  const ok = !changed.length && !onlyBefore.length && !onlyAfter.length && !hostMismatch;
  writeOut({
    takenAt: new Date().toISOString(),
    mode: "engine",
    hostMismatch,
    host: { before: before.host, after: after.host },
    engineBefore: before.engine,
    engineAfter: after.engine,
    pairsBefore: keysBefore.length,
    pairsAfter: keysAfter.length,
    equal,
    changed: changed.length,
    onlyBefore,
    onlyAfter,
    missingBefore,
    missingAfter,
    missingStillMissing,
    changedPairs: changed,
    ok,
  }, ok);
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

function changedStable(b: RowManifest["tables"][string], a: RowManifest["tables"][string]): number {
  let count = 0;
  for (const [key, row] of Object.entries(b.rows)) {
    const now = a.rows[key];
    if (now && now.stable !== row.stable) count += 1;
  }
  return count;
}

function changedWatched(b: RowManifest["tables"][string], a: RowManifest["tables"][string]): number {
  let count = 0;
  for (const [key, row] of Object.entries(b.rows)) {
    const now = a.rows[key];
    if (now && JSON.stringify(row.watched ?? null) !== JSON.stringify(now.watched ?? null)) count += 1;
  }
  return count;
}

function compareManifests() {
  const before = load<RowManifest>("before");
  const after = load<RowManifest>("after");
  const violations: Array<{ table: string; code: string; detail: string }> = [];
  const stableChangedByTable: Record<string, number> = {};
  for (const [table, current] of Object.entries(after.tables)) {
    if (!before.tables[table]) violations.push({ table, code: "UNEXPECTED_TABLE", detail: "Apareció una tabla nueva." });
  }
  for (const [table, previous] of Object.entries(before.tables)) {
    const current = after.tables[table];
    if (!current) { violations.push({ table, code: "TABLE_MISSING", detail: "La tabla desapareció." }); continue; }
    const columnsAdded = current.columns.filter((column) => !previous.columns.includes(column));
    const columnsRemoved = previous.columns.filter((column) => !current.columns.includes(column));
    const addedKeys = Object.keys(current.rows).filter((key) => !(key in previous.rows));
    const removedKeys = Object.keys(previous.rows).filter((key) => !(key in current.rows));
    const stable = changedStable(previous, current);
    const watched = changedWatched(previous, current);
    if (stable) stableChangedByTable[table] = stable;
    if (table === "Sector") {
      if (columnsAdded.length !== 1 || columnsAdded[0] !== "isLegacy") violations.push({ table, code: "UNEXPECTED_COLUMN_CHANGE", detail: `Columnas agregadas: [${columnsAdded.join(", ")}] (se esperaba sólo isLegacy).` });
      if (columnsRemoved.length) violations.push({ table, code: "UNEXPECTED_COLUMN_CHANGE", detail: `Columnas quitadas: [${columnsRemoved.join(", ")}].` });
      if (addedKeys.length || removedKeys.length) violations.push({ table, code: "ROW_SET_CHANGED", detail: `Filas agregadas: ${addedKeys.length}, quitadas: ${removedKeys.length}.` });
      if (watched) violations.push({ table, code: "WATCHED_CHANGED", detail: `${watched} filas con columnas vigiladas cambiadas.` });
    } else if (table === "_prisma_migrations") {
      if (columnsAdded.length || columnsRemoved.length) violations.push({ table, code: "UNEXPECTED_COLUMN_CHANGE", detail: `+${columnsAdded.length}/-${columnsRemoved.length} columnas.` });
      if (addedKeys.length !== 1 || removedKeys.length) violations.push({ table, code: "MIGRATION_ROW_COUNT", detail: `Filas agregadas: ${addedKeys.length} (se esperaba 1), quitadas: ${removedKeys.length}.` });
      const existingChanged = Object.keys(previous.rows).filter((key) => current.rows[key] && current.rows[key]!.stable !== previous.rows[key]!.stable);
      if (existingChanged.length) violations.push({ table, code: "MIGRATION_HISTORY_CHANGED", detail: `${existingChanged.length} migraciones existentes cambiaron.` });
      if (watched) violations.push({ table, code: "WATCHED_CHANGED", detail: `${watched} filas cambiadas.` });
    } else {
      if (columnsAdded.length || columnsRemoved.length) violations.push({ table, code: "UNEXPECTED_COLUMN_CHANGE", detail: `+${columnsAdded.join(", ")}/-${columnsRemoved.join(", ")}.` });
      if (addedKeys.length || removedKeys.length) violations.push({ table, code: "ROW_SET_CHANGED", detail: `Filas agregadas: [${addedKeys.slice(0, 5).join(", ")}]${addedKeys.length > 5 ? "…" : ""} (${addedKeys.length}), quitadas: ${removedKeys.length}.` });
      if (stable) violations.push({ table, code: "CONTENT_CHANGED", detail: `${stable} filas cambiaron su hash de contenido.` });
      if (watched) violations.push({ table, code: "WATCHED_CHANGED", detail: `${watched} filas con columnas vigiladas cambiadas.` });
    }
  }
  const closuresBefore = before.tables.MonthlyTimeClosure;
  const closuresAfter = after.tables.MonthlyTimeClosure;
  const closures = {
    rowsBefore: closuresBefore ? Object.keys(closuresBefore.rows).length : null,
    rowsAfter: closuresAfter ? Object.keys(closuresAfter.rows).length : null,
    keysEqual: !!closuresBefore && !!closuresAfter && JSON.stringify(Object.keys(closuresBefore.rows).sort()) === JSON.stringify(Object.keys(closuresAfter.rows).sort()),
    contentEqual: !!closuresBefore && !!closuresAfter && !changedStable(closuresBefore, closuresAfter) && !changedWatched(closuresBefore, closuresAfter),
  };
  if (before.host !== after.host) violations.push({ table: "*", code: "HOST_MISMATCH", detail: `Manifiestos de destinos distintos (${before.host} / ${after.host}).` });
  const sectorRows = before.tables.Sector ? Object.keys(before.tables.Sector.rows).length : 0;
  const ok = !violations.length;
  writeOut({
    takenAt: new Date().toISOString(),
    mode: "manifest",
    host: { before: before.host, after: after.host },
    tablesBefore: Object.keys(before.tables).length,
    tablesAfter: Object.keys(after.tables).length,
    sector: {
      rows: sectorRows,
      stableChanged: stableChangedByTable.Sector ?? 0,
      expected: "Todas las filas cambian de hash porque isLegacy entra en el contenido; el set de IDs no cambia.",
    },
    migrations: { stableChangedExisting: stableChangedByTable._prisma_migrations ?? 0, expectedAdded: 1 },
    closures,
    stableChangedByTable,
    violations,
    ok,
  }, ok);
}

// ---------------------------------------------------------------------------
// verify-sector
// ---------------------------------------------------------------------------

interface BackupSectorRow {
  id: string; name: string; code: string; status: string;
  areaId: string | null; businessUnitId: string | null;
  createdAt: string; updatedAt: string;
}

interface Backup { host: string; migrations: Array<{ migration_name: string; finished_at: string | null; rolled_back_at: string | null }>; tables: Record<string, { rows: Array<Record<string, unknown>> }> }

async function verifySector() {
  const backup = load<Backup>("backup-pre");
  const target = await connectTarget();
  try {
    const report = await readOnly(target.prisma, async (tx) => {
      const live = JSON.parse(JSON.stringify(await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, name, code, status, "areaId", "businessUnitId", "isLegacy", "createdAt", "updatedAt" FROM "Sector" ORDER BY id`,
      ))) as Array<BackupSectorRow & { isLegacy: boolean }>;
      const mismatches = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Sector" WHERE "isLegacy" IS DISTINCT FROM ("businessUnitId" IS NULL)`,
      );
      const column = (await tx.$queryRawUnsafe<Array<{ is_nullable: string; column_default: string | null }>>(
        "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Sector' AND column_name = 'isLegacy'",
      ))[0];
      const applied = (await tx.$queryRawUnsafe<Array<{ migration_name: string }>>(
        'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
      )).map((row) => row.migration_name);
      const backupApplied = backup.migrations.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
      const migrationsAdded = applied.filter((name) => !backupApplied.includes(name));
      const migrationsRemoved = backupApplied.filter((name) => !applied.includes(name));

      const backupRows = new Map((backup.tables.Sector?.rows ?? []).map((row) => [row.id as string, JSON.parse(JSON.stringify(row)) as BackupSectorRow]));
      const parentsOrDataChanged: Array<{ id: string; diffs: Record<string, { before: unknown; after: unknown }> }> = [];
      const inconsistentWithPreCriterion: string[] = [];
      const unexpectedSectorRows: string[] = [];
      const fields = ["name", "code", "status", "areaId", "businessUnitId", "createdAt", "updatedAt"] as const;
      for (const row of live) {
        const previous = backupRows.get(row.id);
        if (!previous) { unexpectedSectorRows.push(row.id); continue; }
        backupRows.delete(row.id);
        const diffs: Record<string, { before: unknown; after: unknown }> = {};
        for (const field of fields) if (previous[field] !== row[field]) diffs[field] = { before: previous[field], after: row[field] };
        if (Object.keys(diffs).length) parentsOrDataChanged.push({ id: row.id, diffs });
        if (row.isLegacy !== (previous.businessUnitId === null)) inconsistentWithPreCriterion.push(row.id);
      }
      const ok =
        !mismatches.length && !parentsOrDataChanged.length && !inconsistentWithPreCriterion.length &&
        !unexpectedSectorRows.length && !backupRows.size &&
        column?.is_nullable === "NO" && column?.column_default === null &&
        migrationsAdded.length === 1 && migrationsAdded[0] === AUTHORIZED_MIGRATION && !migrationsRemoved.length;
      return {
        takenAt: new Date().toISOString(),
        mode: "verify-sector",
        host: target.host,
        sector: { rows: live.length, legacyTrue: live.filter((row) => row.isLegacy).length, businessUnitNull: live.filter((row) => row.businessUnitId === null).length },
        column: column ?? null,
        notNull: column?.is_nullable === "NO",
        noDefault: column?.column_default === null,
        criterionMismatches: mismatches.map((row) => row.id),
        inconsistentWithPreCriterion,
        parentsOrDataChanged,
        unexpectedSectorRows,
        sectorsMissingVsBackup: [...backupRows.keys()],
        migrations: { added: migrationsAdded, removed: migrationsRemoved, expectedAdded: AUTHORIZED_MIGRATION },
        ok,
      };
    });
    writeOut(report, report.ok);
  } finally {
    await target.prisma.$disconnect();
  }
}

const mode = process.argv[2];
(mode === "engine" ? Promise.resolve(compareEngines())
  : mode === "manifest" ? Promise.resolve(compareManifests())
  : mode === "verify-sector" ? verifySector()
  : Promise.reject(new Error("Modo: engine | manifest | verify-sector"))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
