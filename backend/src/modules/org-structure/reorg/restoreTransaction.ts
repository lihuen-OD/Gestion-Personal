/**
 * Transacción de restauración de la limpieza (ORG_LOCATION_REORGANIZATION.md
 * §7 nivel 3, A8_M2_PREPARATION.md §12.9.7). Recibe un cliente YA CONECTADO:
 * las compuertas de destino (host esperado e identidad Neon verificada, D-0)
 * las aplica `scripts/org-reorg-restore.ts` antes de llamar acá. Sólo válida
 * ANTES de M2 (columnas del modelo anterior presentes).
 *
 * Una transacción Serializable; sin `apply` se revierte al final:
 * - reinserta con los mismos IDs cada fila retirada UNA sola vez (respaldo
 *   formato 2 por tabla + PK; el formato 1 se consolida antes, ver
 *   `normalizeBackupRetired`), catálogo de padres a hijos y después vínculos;
 * - repone las columnas vaciadas SÓLO si siguen vacías;
 * - revierte el archivo en exactamente los IDs archivados del respaldo;
 * - repone alcance, estado y lista de las reglas tratadas;
 * - verifica contra el manifiesto previo que todo quedó idéntico (salvo
 *   auditoría nueva, que nunca se borra).
 */
import type { PrismaClient } from "@prisma/client";
import { captureRowManifest, quoteIdent, type Tx } from "./catalogReads";
import { DELETE_ORDER } from "./cleanupPlan";
import { verifyV1, type RowManifest } from "./manifest";
import { normalizeBackupRetired, restoreTableOrder, retiredCount, type BackupRetiredSource } from "./retirement";
import { DryRunRollback } from "./cleanupTransaction";

export const LEGACY_COLUMNS: Array<[string, string]> = [["Sector", "areaId"], ["Area", "establishmentId"], ["Establishment", "businessUnitId"], ["Position", "sectorId"], ["Employee", "sectorId"]];

export interface RestoreBackup extends BackupRetiredSource {
  host: string;
  nullified: Array<{ table: string; column: string; rows: Array<{ id: string; value: string }> }>;
  rules: Array<{ rule: Record<string, unknown>; employees: Array<{ ruleId: string; employeeId: string }> }>;
  archived?: Array<{ table: string; id: string }>;
  preManifest: RowManifest;
}

export type RestoreAuditWriter = (db: unknown, input: { userId: string; action: "UPDATE"; entity: string; description: string }) => Promise<unknown>;

export interface RestoreOutcome { status: "RESTORED" | "DRY_RUN_OK" | "ABORTED"; error?: string; summary: Record<string, unknown> }

export async function runRestore(prisma: PrismaClient, backup: RestoreBackup, input: { actorUserId: string; apply: boolean; host: string }, deps: { audit: RestoreAuditWriter }): Promise<RestoreOutcome> {
  const summary: Record<string, unknown> = { mode: input.apply ? "apply" : "dry-run", host: input.host, backupFormat: backup.format ?? 1, startedAt: new Date().toISOString() };
  try {
    if (backup.host !== input.host) throw new Error(`El respaldo es de ${backup.host}, no de ${input.host}.`);
    const retired = normalizeBackupRetired(backup);
    await prisma.$transaction(async (rawTx) => {
      const tx = rawTx as Tx;
      const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true, role: true, status: true } });
      if (!actor || actor.status !== "ACTIVO" || actor.role !== "NIVEL_1_RRHH") throw new Error("--actor-user-id debe ser un usuario RRHH activo.");
      for (const [table, column] of LEGACY_COLUMNS) {
        const [exists] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, table, column);
        if (!exists!.n) throw new Error(`Falta ${table}.${column}: M2 ya se aplicó. La reversión es restaurar la rama o el respaldo completo.`);
      }

      // Cada fila retirada, una sola vez: catálogo de padres a hijos, después vínculos.
      for (const table of restoreTableOrder(Object.keys(retired))) {
        for (const row of Object.values(retired[table]!.rows)) {
          const inserted = await tx.$executeRawUnsafe(`INSERT INTO ${quoteIdent(table)} SELECT * FROM json_populate_record(NULL::${quoteIdent(table)}, $1::json)`, JSON.stringify(row));
          if (inserted !== 1) throw new Error(`No se pudo reinsertar ${table}.`);
        }
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
      const restored = retiredCount(retired);
      summary.restored = { rows: restored, nullified: backup.nullified.reduce((sum, group) => sum + group.rows.length, 0), rules: backup.rules.length, unarchived: (backup.archived ?? []).length };
      await deps.audit(tx, {
        userId: actor.id,
        action: "UPDATE",
        entity: "OrgStructureCleanup",
        description: `Se restauró la limpieza de la estructura anterior desde su respaldo (${restored} registros, ${backup.nullified.reduce((sum, group) => sum + group.rows.length, 0)} vínculos, ${backup.rules.length} reglas, ${(backup.archived ?? []).length} registros desarchivados).`,
      });

      const post = await captureRowManifest(tx, input.host);
      const violations = verifyV1(backup.preManifest, post, { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: "ANY" });
      summary.verification = { violations };
      if (violations.length) throw new Error(`La restauración no deja la base idéntica al estado previo (${violations.length} diferencias, ver reporte). No se aplicó nada.`);
      if (!input.apply) throw new DryRunRollback();
    }, { isolationLevel: "Serializable", timeout: 900_000, maxWait: 30_000 });
    return { status: "RESTORED", summary };
  } catch (error) {
    if (error instanceof DryRunRollback) return { status: "DRY_RUN_OK", summary };
    return { status: "ABORTED", error: error instanceof Error ? error.message : String(error), summary };
  } finally {
    summary.finishedAt = new Date().toISOString();
  }
}
