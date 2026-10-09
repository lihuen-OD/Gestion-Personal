/**
 * Limpieza controlada del modelo organizacional anterior
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5 y §6).
 *
 * PREPARADO EN A3 — NO EJECUTADO. Se corre recién en el ensayo B1 (copia
 * aislada) y, tras revisar su reporte, en B2/B3 (development). Nunca en
 * producción.
 *
 *   npx tsx scripts/org-reorg-cleanup.ts \
 *     --env-file=<archivo> --expected-host=<host> \
 *     --neon-project-id=<id> --expected-branch-id=<id> --expected-branch-name=<nombre>   (NEON_API_KEY en el entorno)
 *     --company-mode=C1|C2 --inventory=<reporte de org-reorg-inventory.json> \
 *     --decisions=<decisiones.json> --actor-user-id=<uuid> \
 *     --report=<archivo.json> [--accept-engine-changes=<archivo.json>] \
 *     [--apply --backup=<archivo.json>]
 *
 * Sin --apply es dry-run: ejecuta todo dentro de una transacción que se
 * revierte al final. Con --apply exige --backup y escribe el respaldo ANTES de
 * la primera escritura. Ambos modos exigen identidad Neon VERIFICADA (sin
 * NEON_API_KEY no corre: no hay flag para saltearlo).
 *
 * `--decisions` acepta el formato del ADR §12.4 (`[{ ruleId, treatment, … }]`)
 * o `{ "rules": [...], "classFour": [{ table, column, target, retain, retire }] }`
 * cuando hay filas clase 4 que retirar (A8 §12.4: sólo `PositionOrgScope`).
 *
 * La transacción vive en `src/modules/org-structure/reorg/cleanupTransaction.ts`
 * (probada de punta a punta contra una base local desechable); este comando
 * aplica ANTES las compuertas de destino — `--env-file`, `--expected-host` e
 * identidad Neon verificada (D-0) — y no hay flag para saltearlas.
 *
 * Una única transacción Serializable:
 *  1. Actor humano RRHH; inventario congelado (con clases) vs base; F0 + G1
 *     (formas sin mirar archivedAt, A8 §12.3); historia viva == congelada;
 *     catálogo de FKs y plan (cualquier bloqueo aborta).
 *  2. Manifiesto por fila, snapshot profundo de la historia (G7) y resolución
 *     del motor de horas especiales (antes).
 *  3. Tratamiento de reglas (R1/R2/inactivar), auditado. Verifica que ninguna
 *     regla referencie un ID a borrar; si queda alguna, aborta.
 *  4. Vacía vínculos de legajos/usuarios/dispositivos; verifica que el
 *     respaldo (filas consolidadas por tabla + PK) coincide EXACTAMENTE con
 *     las filas a retirar y retira por PK las familias de borrado autorizado
 *     (A8 §12.4) y las filas clase 4 resueltas, auditado.
 *  5. Re-chequea TODAS las FKs del catálogo contra los IDs a borrar y borra la
 *     cadena en orden (Position → … → Company), auditado. Ningún CASCADE ni
 *     SET NULL de la base llega a dispararse. Archiva `retained` (único
 *     escritor de archivedAt, un mismo instante), auditado.
 *  6. Resolución del motor (después): cualquier cambio no aceptado aborta.
 *  7. F1 (A8 §12.3): G3, G4, formas finales, G5, G7, G8; y V1 (F1.4) por
 *     manifiesto: sólo cambió lo autorizado. Cualquier falla aborta sin
 *     cambios.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { arg, connectTarget, flag, type EngineEvaluator } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import { DELETE_ORDER, type ClassFourResolution, type CompanyMode, type FrozenInventory, type RuleDecision, type TargetTable } from "../src/modules/org-structure/reorg/cleanupPlan";

function readJson<T>(path: string | undefined, what: string): T {
  if (!path) throw new Error(`Falta ${what}.`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function main() {
  const apply = flag("apply");
  const backupPath = arg("backup");
  const reportPath = arg("report");
  const companyMode = arg("company-mode") as CompanyMode | undefined;
  if (companyMode !== "C1" && companyMode !== "C2") throw new Error("--company-mode debe ser C1 (conservar empresas) o C2 (eliminarlas). Es la decisión D-1.");
  if (apply && !backupPath) throw new Error("--apply requiere --backup=<archivo.json>.");
  if (!reportPath) throw new Error("Falta --report=<archivo.json>.");
  const actorUserId = arg("actor-user-id");
  if (!actorUserId) throw new Error("Falta --actor-user-id (usuario humano RRHH que ejecuta y queda en la auditoría).");

  // Compuertas de destino (D-0): sin identidad Neon VERIFICADA no corre, ni en dry-run.
  const target = await connectTarget();
  requireVerifiedIdentity(target.identity);

  const inventoryReport = readJson<Record<string, { inventory: Record<TargetTable, { records: FrozenInventory["records"][TargetTable] }> & { history?: FrozenInventory["history"] } }> & { target: { host: string } }>(arg("inventory"), "--inventory=<reporte de inventario>");
  if (inventoryReport.target.host !== target.host) throw new Error(`El inventario se tomó en ${inventoryReport.target.host}, no en ${target.host}.`);
  if (!inventoryReport[companyMode]!.inventory.history) throw new Error("El inventario congelado no tiene `history` con IDs exactos (A8 §12.2). Re-inventariar con el script actualizado.");
  const frozen: FrozenInventory = {
    companyMode,
    records: Object.fromEntries(DELETE_ORDER.map((table) => [table, inventoryReport[companyMode]!.inventory[table].records])) as FrozenInventory["records"],
    history: inventoryReport[companyMode]!.inventory.history,
  };
  const decisionsFile = readJson<RuleDecision[] | { rules: RuleDecision[]; classFour?: ClassFourResolution[] }>(arg("decisions"), "--decisions=<archivo.json> (puede ser [] si el inventario no tiene reglas que decidir)");
  const accepted = new Set(arg("accept-engine-changes") ? readJson<Array<{ employeeId: string; date: string }>>(arg("accept-engine-changes"), "cambios aceptados").map((item) => `${item.employeeId}|${item.date}`) : []);

  // Importados después de fijar DATABASE_URL al destino verificado.
  const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
  const { auditService } = await import("../src/modules/audit/audit.service");
  const { loadEmployeeReferences } = await import("../src/shared/audit/employeeReference");
  const { runCleanup } = await import("../src/modules/org-structure/reorg/cleanupTransaction");
  try {
    const outcome = await runCleanup(target.prisma, {
      companyMode, frozen,
      decisions: Array.isArray(decisionsFile) ? decisionsFile : decisionsFile.rules,
      classFour: Array.isArray(decisionsFile) ? [] : decisionsFile.classFour ?? [],
      acceptedEngineChanges: accepted, actorUserId, apply, host: target.host,
      writeBackup: (backup) => writeFileSync(backupPath!, JSON.stringify(backup, null, 2)),
    }, {
      evaluate: evaluateSpecialHourRulesByDate as unknown as EngineEvaluator,
      audit: auditService.registerWithin as never,
      loadEmployeeReferences: loadEmployeeReferences as never,
    });
    const result = outcome.status === "APPLIED" ? "APLICADO" : outcome.status === "DRY_RUN_OK" ? "DRY-RUN OK (revertido)" : `ABORTADO SIN CAMBIOS: ${outcome.error}`;
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
