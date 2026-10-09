/**
 * Restauración dirigida de la limpieza del modelo organizacional anterior
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §7, reversión nivel 3).
 *
 * PREPARADO EN A3 — NO EJECUTADO. Se prueba en el ensayo B1 sobre una copia
 * aislada. Sólo es válida ANTES de M2 (con las columnas del modelo anterior
 * presentes); después de M2 la reversión es restaurar la rama/respaldo.
 *
 *   npx tsx scripts/org-reorg-restore.ts \
 *     --env-file=<archivo> --expected-host=<host> \
 *     --neon-project-id=<id> --expected-branch-id=<id> --expected-branch-name=<nombre>   (NEON_API_KEY en el entorno)
 *     --backup=<respaldo escrito por org-reorg-cleanup --apply> --actor-user-id=<uuid> \
 *     --report=<archivo.json> [--apply]
 *
 * Sin --apply es dry-run (transacción revertida). Una transacción Serializable:
 * reinserta con los mismos IDs los registros y las familias de borrado
 * autorizado (`backup.deleted["<Tabla>.<columna>"]`, A8 §12.4), revierte el
 * archivo (`archivedAt = NULL` en exactamente los IDs archivados del respaldo,
 * A8 §12.9.7), repone las columnas vaciadas SÓLO si siguen vacías (si la
 * recarga ya les asignó otro valor, aborta y lo lista), repone el alcance,
 * estado y lista de las reglas tratadas, y verifica contra el manifiesto
 * previo a la limpieza que todo quedó idéntico (salvo auditoría nueva, que
 * nunca se borra). Es la ÚNICA vía para revertir un archivo usado: la
 * reversión SQL de 20261008150000 se niega mientras haya filas archivadas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, captureRowManifest, connectTarget, flag, quoteIdent, type Tx } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import { DELETE_ORDER } from "../src/modules/org-structure/reorg/cleanupPlan";
import { verifyV1, type RowManifest } from "../src/modules/org-structure/reorg/manifest";

class DryRunRollback extends Error {}

interface Backup {
  host: string;
  deleted: Record<string, Array<Record<string, unknown>>>;
  nullified: Array<{ table: string; column: string; rows: Array<{ id: string; value: string }> }>;
  rules: Array<{ rule: Record<string, unknown>; employees: Array<{ ruleId: string; employeeId: string }> }>;
  /** A8 §12.1: conjunto archivado por la limpieza (`retained` del plan). */
  archived?: Array<{ table: string; id: string }>;
  preManifest: RowManifest;
}

const LEGACY_COLUMNS: Array<[string, string]> = [["Sector", "areaId"], ["Area", "establishmentId"], ["Establishment", "businessUnitId"], ["Position", "sectorId"], ["Employee", "sectorId"]];

async function insertRows(tx: Tx, table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    await tx.$executeRawUnsafe(`INSERT INTO ${quoteIdent(table)} SELECT * FROM json_populate_record(NULL::${quoteIdent(table)}, $1::json)`, JSON.stringify(row));
  }
}

async function main() {
  const apply = flag("apply");
  const reportPath = arg("report");
  const backupPath = arg("backup");
  const actorUserId = arg("actor-user-id");
  if (!reportPath || !backupPath || !actorUserId) throw new Error("Faltan --report, --backup o --actor-user-id.");
  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as Backup;

  const target = await connectTarget();
  requireVerifiedIdentity(target.identity);
  if (backup.host !== target.host) throw new Error(`El respaldo es de ${backup.host}, no de ${target.host}.`);
  const { auditService } = await import("../src/modules/audit/audit.service");

  const summary: Record<string, unknown> = { mode: apply ? "apply" : "dry-run", host: target.host, identity: target.identity, startedAt: new Date().toISOString() };
  try {
    await target.prisma.$transaction(async (rawTx) => {
      const tx = rawTx as Tx;
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true, status: true } });
      if (!actor || actor.status !== "ACTIVO" || actor.role !== "NIVEL_1_RRHH") throw new Error("--actor-user-id debe ser un usuario RRHH activo.");
      for (const [table, column] of LEGACY_COLUMNS) {
        const [exists] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, table, column);
        if (!exists!.n) throw new Error(`Falta ${table}.${column}: M2 ya se aplicó. La reversión es restaurar la rama o el respaldo completo.`);
      }

      // Padres antes que hijos (orden inverso al borrado), luego las filas de vínculo.
      let restored = 0;
      for (const table of [...DELETE_ORDER].reverse()) {
        const rows = backup.deleted[table] ?? [];
        await insertRows(tx, table, rows);
        restored += rows.length;
      }
      for (const [key, rows] of Object.entries(backup.deleted)) {
        if (!key.includes(".")) continue;
        await insertRows(tx, key.split(".")[0]!, rows);
        restored += rows.length;
      }
      const conflicts: string[] = [];
      for (const group of backup.nullified) {
        for (const row of group.rows) {
          const updated = await tx.$executeRawUnsafe(`UPDATE ${quoteIdent(group.table)} SET ${quoteIdent(group.column)} = $1 WHERE id = $2 AND ${quoteIdent(group.column)} IS NULL`, row.value, row.id);
          if (updated !== 1) conflicts.push(`${group.table}.${group.column} de ${row.id}`);
        }
      }
      if (conflicts.length) throw new Error(`No se puede reponer ${conflicts.length} valor(es) porque ya no están vacíos (la recarga los cambió): ${conflicts.slice(0, 10).join("; ")}.`);
      // A8 §12.9.7: revertir el archivo — exactamente los IDs archivados por la limpieza.
      const notArchived: string[] = [];
      for (const entry of backup.archived ?? []) {
        if (!(DELETE_ORDER as readonly string[]).includes(entry.table)) throw new Error(`Respaldo inválido: ${entry.table} no es una tabla de archivo.`);
        const updated = await tx.$executeRawUnsafe(`UPDATE ${quoteIdent(entry.table)} SET "archivedAt" = NULL WHERE id = $1 AND "archivedAt" IS NOT NULL`, entry.id);
        if (updated !== 1) notArchived.push(`${entry.table} ${entry.id}`);
      }
      if (notArchived.length) throw new Error(`No se puede revertir el archivo de ${notArchived.length} registro(s) que ya no están archivados (o no existen): ${notArchived.slice(0, 10).join("; ")}.`);
      for (const { rule, employees } of backup.rules) {
        await tx.doubleHourRule.update({ where: { id: String(rule.id) }, data: { companyId: (rule.companyId as string | null) ?? null, sectorId: (rule.sectorId as string | null) ?? null, positionId: (rule.positionId as string | null) ?? null, status: rule.status as "ACTIVO" | "INACTIVO" } });
        await tx.doubleHourRuleEmployee.deleteMany({ where: { ruleId: String(rule.id) } });
        if (employees.length) await tx.doubleHourRuleEmployee.createMany({ data: employees.map((item) => ({ ruleId: item.ruleId, employeeId: item.employeeId })) });
      }
      await auditService.registerWithin(tx as never, {
        userId: actor.id,
        action: "UPDATE",
        entity: "OrgStructureCleanup",
        description: `Se restauró la limpieza de la estructura anterior desde su respaldo (${restored} registros, ${backup.nullified.reduce((sum, group) => sum + group.rows.length, 0)} vínculos, ${backup.rules.length} reglas, ${(backup.archived ?? []).length} registros desarchivados).`,
      });

      const post = await captureRowManifest(tx, target.host);
      const violations = verifyV1(backup.preManifest, post, { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: "ANY" });
      summary.verification = { violations };
      if (violations.length) throw new Error(`La restauración no deja la base idéntica al estado previo (${violations.length} diferencias, ver reporte). No se aplicó nada.`);
      if (!apply) throw new DryRunRollback();
    }, { isolationLevel: "Serializable", timeout: 900_000, maxWait: 30_000 });
    summary.result = "RESTAURADO";
  } catch (error) {
    summary.result = error instanceof DryRunRollback ? "DRY-RUN OK (revertido)" : `ABORTADO SIN CAMBIOS: ${error instanceof Error ? error.message : String(error)}`;
    if (!(error instanceof DryRunRollback)) process.exitCode = 1;
  } finally {
    summary.finishedAt = new Date().toISOString();
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ result: summary.result, report: reportPath }, null, 2));
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
