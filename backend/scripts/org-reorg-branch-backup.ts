/**
 * Respaldo de RAMA Neon de la copia de ensayo: la mitad "rama Neon" del
 * respaldo doble B0 (docs/decisions/A8_M2_PREPARATION.md §7.1.3 y §12.14.10).
 * La otra mitad es el `pg_dump` con SHA-256 y restauración probada.
 *
 *   npx tsx scripts/org-reorg/neon-admin.ts scripts/org-reorg-branch-backup.ts --record=<archivo.json fuera del repo> [--apply]
 *
 * Exige identidad Neon VERIFICADA (D-0): la rama de origen es la del endpoint
 * de la conexión, con nombre y ID esperados y nunca la rama por defecto.
 * Sin --apply sólo lee (estado de la rama de origen y ramas del proyecto) y
 * escribe el plan en --record. Con --apply crea una rama HIJA con los datos de
 * la rama de ensayo y SIN compute, verifica su origen y espera a que esté
 * lista. No toca datos de ninguna base, no reintenta un POST fallido y nunca
 * reutiliza ni pisa una rama de respaldo existente.
 */
import { writeFileSync } from "node:fs";
import { arg, connectTarget, flag } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import { createBranchBackup, planBranchBackup, verifyBranchBackup } from "../src/modules/org-structure/reorg/neonBranchBackup";
import { todayArgentinaDateKey } from "../src/shared/datetime/argentinaTime";

async function main() {
  const apply = flag("apply");
  const recordPath = arg("record");
  if (!recordPath) throw new Error("Falta --record=<archivo.json> (fuera del repositorio).");
  const apiKey = process.env.NEON_API_KEY;
  const target = await connectTarget();
  try {
    requireVerifiedIdentity(target.identity);
    const plan = await planBranchBackup({ apiKey: apiKey!, projectId: target.identity.projectId, sourceBranchId: target.identity.branchId, dateKey: todayArgentinaDateKey() });
    if (!apply) {
      writeFileSync(recordPath, JSON.stringify({ mode: "plan", identity: target.identity, plan }, null, 2));
      console.log(JSON.stringify({ modo: "plan (sólo lectura)", origen: plan.source, respaldo: plan.backupName, yaExiste: plan.existingWithSameName, ramasDelProyecto: plan.branchCount, registro: recordPath }, null, 2));
      return;
    }
    const record = await createBranchBackup(plan, { apiKey: apiKey! });
    writeFileSync(recordPath, JSON.stringify({ mode: "created", identity: target.identity, plan, record }, null, 2));
    let verified = await verifyBranchBackup(record, { apiKey: apiKey! });
    for (let attempt = 0; !verified.ready && attempt < 40; attempt += 1) {
      await new Promise((done) => setTimeout(done, 3000));
      verified = await verifyBranchBackup(record, { apiKey: apiKey! });
    }
    writeFileSync(recordPath, JSON.stringify({ mode: "created", identity: target.identity, plan, record, verified }, null, 2));
    console.log(JSON.stringify({ modo: "creada", respaldo: { id: verified.id, nombre: verified.name, origen: verified.parentId, lsn: verified.parentLsn, estado: verified.currentState }, registro: recordPath }, null, 2));
    if (!verified.ready) process.exitCode = 2;
  } finally {
    await target.prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
