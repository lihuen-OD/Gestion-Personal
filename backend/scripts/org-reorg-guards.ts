/**
 * Guardas G1-G9 y fases F0/F1/F2 del ensayo de reorganización
 * (docs/decisions/A8_M2_PREPARATION.md §12.3, §12.5, AT-9). SÓLO LECTURA: todo
 * corre en una transacción READ ONLY; no escribe en la base ni en el repo.
 *
 *   npx tsx scripts/org-reorg-guards.ts --phase=F0|F1|F2 \
 *     --env-file=<archivo> --expected-host=<host> \
 *     [--neon-project-id=<id> --expected-branch-id=<id> --expected-branch-name=<nombre>]   (NEON_API_KEY en el entorno)
 *     --inventory=<reporte de org-reorg-inventory> --company-mode=C1|C2 \
 *     [--backup=<respaldo de org-reorg-cleanup --apply>]   (F1 y F2) \
 *     --report=<archivo.json>
 *
 * Fases (columna "Punto del §7.2" de §12.5):
 *   F0 — paso 3, antes de escribir: G1, G2/F0 (formas sin mirar archivedAt),
 *        G8 (outsideInventory = ∅ y ningún referenciado entre los eliminables
 *        del plan congelado).
 *   F1 — paso 5, después de la limpieza: G2/F1 (formas finales), G3, G4, G5
 *        (admite sólo R3 aprobadas del respaldo), G7 (contra el snapshot del
 *        respaldo), G8 (congelado + historia viva).
 *   F2 — paso 8, post-M2 y recarga: G1, G5, G6 (CHECKs de forma validados +
 *        `prisma migrate diff` vacío), G7, G8, G9 (índices + EXPLAIN).
 *
 * Exit 0 = todas verdes; 2 = alguna guarda falló (ver reporte); 1 = error.
 * El reporte contiene IDs de catálogo e historia: guardarlo fuera del repo.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { arg, connectTarget, discoverForeignKeys, loadArchivedIds, loadArchivedLinks, loadCheckConstraints, loadListingPerformance, loadLiveHistoryIds, loadPresentIds, loadShapeRows, captureHistorySnapshot, readOnly } from "./org-reorg/lib";
import { DELETE_ORDER, type CompanyMode, type HistoryReference, type R3Reference, type TargetTable } from "../src/modules/org-structure/reorg/cleanupPlan";
import { evaluateF0, evaluateF1Shapes, g1Violations } from "../src/modules/org-structure/reorg/shapes";
import { evaluateG3, evaluateG4, evaluateG5, evaluateG6, evaluateG7, evaluateG8, evaluateG9, type GuardResult, type HistorySnapshot } from "../src/modules/org-structure/reorg/guards";

type Phase = "F0" | "F1" | "F2";

interface InventoryReport {
  target: { host: string };
  C1: { inventory: { history: HistoryReference[] }; plan: { deletable: Record<TargetTable, string[]> } };
  C2: { inventory: { history: HistoryReference[] }; plan: { deletable: Record<TargetTable, string[]> } };
}
interface CleanupBackup {
  host: string;
  companyMode: CompanyMode;
  archived: Array<{ table: TargetTable; id: string }>;
  plan: { deletable: Record<TargetTable, string[]>; retained: Array<{ table: TargetTable; id: string }>; r3References: R3Reference[] };
  historySnapshot: HistorySnapshot;
}

function load<T>(name: string, what: string): T {
  const path = arg(name);
  if (!path) throw new Error(`Falta --${name}=<${what}>.`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * `prisma migrate diff` entre la base destino y el schema del repo, con un
 * schema temporal cuya URL sale de una variable propia: ni la URL viaja por
 * argv ni el CLI puede caer en el `.env` habitual. `true` = sin diferencias.
 */
function migrateDiffEmpty(databaseUrl: string): boolean {
  const backend = resolve(__dirname, "..");
  const schema = readFileSync(join(backend, "prisma", "schema.prisma"), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "reorg-guard-"));
  try {
    writeFileSync(join(dir, "schema.prisma"), schema.replace('url      = env("DATABASE_URL")', 'url      = env("REORG_GUARD_DATABASE_URL")'));
    execFileSync(join(backend, "node_modules", ".bin", "prisma"), ["migrate", "diff", "--from-schema-datasource", join(dir, "schema.prisma"), "--to-schema-datamodel", join(backend, "prisma", "schema.prisma"), "--exit-code"], {
      cwd: dir, env: { ...process.env, REORG_GUARD_DATABASE_URL: databaseUrl }, stdio: "pipe",
    });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 2) return false;
    throw new Error(`prisma migrate diff no pudo ejecutarse: ${(error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const phase = arg("phase") as Phase | undefined;
  if (phase !== "F0" && phase !== "F1" && phase !== "F2") throw new Error("--phase debe ser F0 (paso 3), F1 (paso 5) o F2 (paso 8).");
  const companyMode = arg("company-mode") as CompanyMode | undefined;
  if (companyMode !== "C1" && companyMode !== "C2") throw new Error("--company-mode debe ser C1 o C2 (D-1).");
  const reportPath = arg("report");
  if (!reportPath) throw new Error("Falta --report=<archivo.json> (fuera del repositorio).");
  const inventory = load<InventoryReport>("inventory", "reporte de org-reorg-inventory");
  const backup = phase === "F0" ? null : load<CleanupBackup>("backup", "respaldo de org-reorg-cleanup --apply");

  const target = await connectTarget();
  if (inventory.target.host !== target.host) throw new Error(`El inventario se tomó en ${inventory.target.host}, no en ${target.host}.`);
  if (backup && backup.host !== target.host) throw new Error(`El respaldo es de ${backup.host}, no de ${target.host}.`);
  if (backup && backup.companyMode !== companyMode) throw new Error(`El respaldo es del modo ${backup.companyMode}, no ${companyMode}.`);
  const frozenHistory = inventory[companyMode].inventory.history;
  const deletable = backup?.plan.deletable ?? inventory[companyMode].plan.deletable;

  try {
    // G6: fuera de la transacción (proceso aparte, sólo introspección del destino).
    const diffEmpty = phase === "F2" ? migrateDiffEmpty(target.databaseUrl) : null;
    const guards = await readOnly(target.prisma, async (tx) => {
      const results: GuardResult[] = [];
      const shapeRows = await loadShapeRows(tx);
      if (phase === "F0" || phase === "F2") {
        const g1 = g1Violations(shapeRows.Sector);
        results.push({ guard: "G1", ok: g1.length === 0, detail: { violations: g1 } });
      }
      if (phase === "F0") {
        const f0 = evaluateF0(shapeRows);
        results.push({ guard: "G2/F0", ok: f0.ok, detail: f0 });
        results.push(evaluateG8(frozenHistory, deletable));
        return results;
      }
      const archived = await loadArchivedIds(tx);
      const foreignKeys = await discoverForeignKeys(tx);
      if (phase === "F1") {
        const f1 = evaluateF1Shapes(shapeRows);
        results.push({ guard: "G2/F1", ok: f1.ok, detail: f1 });
        results.push(evaluateG3(deletable, await loadPresentIds(tx, deletable)));
        results.push(evaluateG4(backup!.plan.retained, archived));
      }
      results.push(evaluateG5(await loadArchivedLinks(tx, foreignKeys, archived), backup!.plan.r3References));
      results.push(evaluateG7(backup!.historySnapshot, await captureHistorySnapshot(tx)));
      results.push(evaluateG8(frozenHistory, deletable, await loadLiveHistoryIds(tx)));
      if (phase === "F2") {
        results.push(evaluateG6(await loadCheckConstraints(tx), diffEmpty));
        const performance = await loadListingPerformance(tx);
        results.push(evaluateG9(performance.indexes, performance.plans));
      }
      return results;
    });
    const ok = guards.every((guard) => guard.ok);
    writeFileSync(reportPath, JSON.stringify({ phase, companyMode, host: target.host, identity: target.identity, readOnly: true, takenAt: new Date().toISOString(), ok, guards, deleteOrder: DELETE_ORDER }, null, 2));
    console.log(JSON.stringify({ phase, host: target.host, ok, guardas: Object.fromEntries(guards.map((guard) => [guard.guard, guard.ok])), reporte: reportPath }, null, 2));
    if (!ok) process.exitCode = 2;
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
