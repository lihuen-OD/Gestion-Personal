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
 * La transacción vive en `src/modules/org-structure/reorg/restoreTransaction.ts`
 * (probada contra una base local desechable); este comando aplica ANTES las
 * compuertas de destino (`--expected-host`, identidad Neon verificada, D-0).
 *
 * Sin --apply es dry-run (transacción revertida). Una transacción Serializable:
 * reinserta con los mismos IDs cada fila retirada una sola vez (respaldo
 * formato 2 por tabla + PK; un respaldo formato 1 se consolida antes), revierte el
 * archivo (`archivedAt = NULL` en exactamente los IDs archivados del respaldo,
 * A8 §12.9.7), repone las columnas vaciadas SÓLO si siguen vacías (si la
 * recarga ya les asignó otro valor, aborta y lo lista), repone el alcance,
 * estado y lista de las reglas tratadas, y verifica contra el manifiesto
 * previo a la limpieza que todo quedó idéntico (salvo auditoría nueva, que
 * nunca se borra). Es la ÚNICA vía para revertir un archivo usado: la
 * reversión SQL de 20261008150000 se niega mientras haya filas archivadas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, flag } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import type { RestoreBackup } from "../src/modules/org-structure/reorg/restoreTransaction";

async function main() {
  const apply = flag("apply");
  const reportPath = arg("report");
  const backupPath = arg("backup");
  const actorUserId = arg("actor-user-id");
  if (!reportPath || !backupPath || !actorUserId) throw new Error("Faltan --report, --backup o --actor-user-id.");
  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as RestoreBackup;

  // Compuertas de destino (D-0): sin identidad Neon VERIFICADA no corre, ni en dry-run.
  const target = await connectTarget();
  requireVerifiedIdentity(target.identity);
  if (backup.host !== target.host) throw new Error(`El respaldo es de ${backup.host}, no de ${target.host}.`);

  // Importados después de fijar DATABASE_URL al destino verificado.
  const { auditService } = await import("../src/modules/audit/audit.service");
  const { runRestore } = await import("../src/modules/org-structure/reorg/restoreTransaction");
  try {
    const outcome = await runRestore(target.prisma, backup, { actorUserId, apply, host: target.host }, { audit: auditService.registerWithin as never });
    const result = outcome.status === "RESTORED" ? "RESTAURADO" : outcome.status === "DRY_RUN_OK" ? "DRY-RUN OK (revertido)" : `ABORTADO SIN CAMBIOS: ${outcome.error}`;
    if (outcome.status === "ABORTED") process.exitCode = 1;
    writeFileSync(reportPath, JSON.stringify({ ...outcome.summary, identity: target.identity, result }, null, 2));
    console.log(JSON.stringify({ result, report: reportPath }, null, 2));
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
