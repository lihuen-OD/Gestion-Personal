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
 * Una única transacción Serializable:
 *  1. Actor humano RRHH; inventario congelado (con clases) vs base; F0 + G1
 *     (formas sin mirar archivedAt, A8 §12.3); historia viva == congelada;
 *     catálogo de FKs y plan (cualquier bloqueo aborta).
 *  2. Manifiesto por fila, snapshot profundo de la historia (G7) y resolución
 *     del motor de horas especiales (antes).
 *  3. Tratamiento de reglas (R1/R2/inactivar), auditado. Verifica que ninguna
 *     regla referencie un ID a borrar; si queda alguna, aborta.
 *  4. Vacía vínculos de legajos/usuarios/dispositivos y borra las familias de
 *     borrado autorizado (A8 §12.4) hacia destinos deletable ∪ retained, y
 *     retira las filas clase 4 resueltas, auditado.
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
import type { Prisma } from "@prisma/client";
import { arg, captureHistorySnapshot, captureRowManifest, connectTarget, countReferences, discoverForeignKeys, engineOutcomes, flag, loadArchivedIds, loadArchivedLinks, loadHistoryReferences, loadLiveHistoryIds, loadPresentIds, loadRules, loadShapeRows, quoteIdent, ruleReferences, type EngineEvaluator, type Tx } from "./org-reorg/lib";
import { requireVerifiedIdentity } from "../src/modules/org-structure/reorg/targetIdentity";
import { borrableIds, buildCleanupPlan, DELETE_ORDER, treatmentOf, type ClassFourResolution, type CompanyMode, type FrozenInventory, type R1TargetState, type RuleDecision, type TargetTable } from "../src/modules/org-structure/reorg/cleanupPlan";
import { evaluateF0, evaluateF1Shapes } from "../src/modules/org-structure/reorg/shapes";
import { evaluateG3, evaluateG4, evaluateG5, evaluateG7, evaluateG8, type GuardResult } from "../src/modules/org-structure/reorg/guards";
import { verifyV1, type V1Expectation, type WatchedValues } from "../src/modules/org-structure/reorg/manifest";

class DryRunRollback extends Error {}
const REASON = "Reorganización de estructura (ORG_LOCATION_REORGANIZATION.md)";

type AuditWriter = (db: unknown, input: { action: "UPDATE" | "DELETE"; entity: string; entityId: string; description: string; userId: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue }) => Promise<unknown>;

function readJson<T>(path: string | undefined, what: string): T {
  if (!path) throw new Error(`Falta ${what}.`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function keysWhere(tx: Tx, table: string, key: string[], column: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.$queryRawUnsafe<Array<{ k: string }>>(
    `SELECT concat_ws('|', ${key.map((name) => `t.${quoteIdent(name)}::text`).join(", ")}) AS k FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} = ANY($1::text[])`, ids,
  );
  return rows.map((row) => row.k);
}

async function rowsAsJson(tx: Tx, table: string, column: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT row_to_json(t) AS row FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} = ANY($1::text[])`, ids);
  return rows.map((item) => item.row);
}

async function r1TargetStates(tx: Tx, decisions: RuleDecision[], frozen: Set<string>): Promise<Record<string, R1TargetState>> {
  const states: Record<string, R1TargetState> = {};
  for (const decision of decisions) {
    if (decision.treatment !== "R1") continue;
    for (const [dimension, id] of Object.entries(decision.targets)) {
      if (!id) continue;
      if (dimension === "sectorId") {
        // Un sector del modelo anterior (sin unidad de negocio) nunca es destino válido.
        const sector = await tx.sector.findUnique({ where: { id }, select: { businessUnitId: true } });
        states[id] = { exists: Boolean(sector), legacyOrInventory: frozen.has(id) || sector?.businessUnitId === null };
      } else {
        const found = dimension === "companyId"
          ? await tx.company.findUnique({ where: { id }, select: { id: true } })
          : await tx.position.findUnique({ where: { id }, select: { id: true } });
        states[id] = { exists: Boolean(found), legacyOrInventory: frozen.has(id) };
      }
    }
  }
  return states;
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

  const target = await connectTarget();
  requireVerifiedIdentity(target.identity);

  const inventoryReport = readJson<Record<string, { inventory: Record<TargetTable, { records: FrozenInventory["records"][TargetTable] }> & { history?: FrozenInventory["history"] } }> & { target: { host: string } }>(arg("inventory"), "--inventory=<reporte de inventario>");
  if (inventoryReport.target.host !== target.host) throw new Error(`El inventario se tomó en ${inventoryReport.target.host}, no en ${target.host}.`);
  if (!inventoryReport[companyMode]!.inventory.history) {
    throw new Error("El inventario congelado no tiene `history` con IDs exactos (A8 §12.2). Re-inventariar con el script actualizado.");
  }
  const frozen: FrozenInventory = {
    companyMode,
    records: Object.fromEntries(DELETE_ORDER.map((table) => [table, inventoryReport[companyMode]!.inventory[table].records])) as FrozenInventory["records"],
    history: inventoryReport[companyMode]!.inventory.history,
  };
  const decisionsFile = readJson<RuleDecision[] | { rules: RuleDecision[]; classFour?: ClassFourResolution[] }>(arg("decisions"), "--decisions=<archivo.json> (puede ser [] si el inventario no tiene reglas que decidir)");
  const decisions = Array.isArray(decisionsFile) ? decisionsFile : decisionsFile.rules;
  const classFour = Array.isArray(decisionsFile) ? [] : decisionsFile.classFour ?? [];
  const accepted = new Set(arg("accept-engine-changes") ? readJson<Array<{ employeeId: string; date: string }>>(arg("accept-engine-changes"), "cambios aceptados").map((item) => `${item.employeeId}|${item.date}`) : []);

  // Importados después de fijar DATABASE_URL al destino verificado.
  const { evaluateSpecialHourRulesByDate } = await import("../src/modules/time-entries/timeEntries.repository");
  const { auditService } = await import("../src/modules/audit/audit.service");
  const { loadEmployeeReferences } = await import("../src/shared/audit/employeeReference");
  const evaluate = evaluateSpecialHourRulesByDate as unknown as EngineEvaluator;
  const audit = auditService.registerWithin as unknown as AuditWriter;

  const summary: Record<string, unknown> = { mode: apply ? "apply" : "dry-run", companyMode, host: target.host, identity: target.identity, startedAt: new Date().toISOString() };
  try {
    await target.prisma.$transaction(async (rawTx) => {
      const tx = rawTx as Tx;
      // 1. Actor, inventario congelado y plan.
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true, status: true, name: true } });
      if (!actor || actor.status !== "ACTIVO" || actor.role !== "NIVEL_1_RRHH") throw new Error("--actor-user-id debe ser un usuario RRHH activo.");
      // Sólo `borrable` es "inventario" para destinos R1 y conteo de dependencias (A8 §12.2).
      const frozenByTable = borrableIds(frozen);
      const frozenIds = new Set(DELETE_ORDER.flatMap((table) => frozenByTable[table]));
      for (const table of DELETE_ORDER) {
        const ids = frozen.records[table].map((record) => record.id);
        const existing = ids.length ? await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${quoteIdent(table)} WHERE id = ANY($1::text[])`, ids) : [{ n: 0 }];
        if (existing[0]!.n !== ids.length) throw new Error(`El inventario congelado de ${table} ya no coincide con la base (${existing[0]!.n}/${ids.length}). Volver a inventariar.`);
      }
      // F0 + G1 (A8 §12.3): compuerta del tratamiento — con formas mezcladas no se escribe nada.
      const f0 = evaluateF0(await loadShapeRows(tx));
      summary.f0 = f0;
      if (!f0.ok) throw new Error(`F0 detectó ${f0.violations.length} fila(s) con forma mezclada o G1 violado (ver reporte). No se escribió nada.`);
      const foreignKeys = await discoverForeignKeys(tx);
      const references = await countReferences(tx, foreignKeys, frozenByTable);
      const rules = await ruleReferences(tx, await loadRules(tx));
      // A8 §12.2: la historia se re-verifica en la transacción contra el
      // congelado (fail closed): si divergieron, el inventario está viejo.
      const liveHistory = await loadHistoryReferences(tx, frozen);
      if (JSON.stringify(liveHistory) !== JSON.stringify(frozen.history)) {
        throw new Error("La historia (§12.2) del inventario congelado no coincide con la base. Re-inventariar.");
      }
      const plan = buildCleanupPlan({ inventory: frozen, references, rules, decisions, classFour, history: liveHistory, r1Targets: await r1TargetStates(tx, decisions, frozenIds) });
      summary.plan = { issues: plan.issues, roots: plan.roots, retained: plan.retained, deletable: plan.deletable, r3References: plan.r3References, retireRows: plan.retireRows, ruleOperations: plan.ruleOperations };
      if (plan.blocking) throw new Error(`Plan bloqueado: ${plan.issues.filter((issue) => issue.blocking).map((issue) => issue.code).join(", ")}. No se escribió nada.`);
      const deletable = plan.deletable;
      // A8 §12.1: conjunto autorizado de archivo (I2) = retained del manifiesto.
      const retainedByTable = Object.fromEntries(DELETE_ORDER.map((table) => [table, plan.retained.filter((entry) => entry.table === table).map((entry) => entry.id)])) as Record<TargetTable, string[]>;
      // A8 §12.4: los vínculos de configuración se borran hacia destinos
      // deletable ∪ retained (archivado), antes de F1 y de G5.
      const linkTargets = (target: TargetTable) => [...deletable[target], ...retainedByTable[target]];

      // 2. Estado previo: manifiesto, motor y respaldo (antes de cualquier escritura).
      const pre = await captureRowManifest(tx, target.host);
      // G7 (§12.6): snapshot completo de las siete tablas de historia, antes de escribir.
      const historyBefore = await captureHistorySnapshot(tx);
      // D-5: el motor resuelve con la historia temporal; una fecha sin historia
      // suficiente queda como MISSING antes y después (la limpieza no la cambia).
      const enginePre = await engineOutcomes(tx, evaluate);
      const expectation: V1Expectation = { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: 0, archived: {} };
      // Un único instante de archivo para todo `retained` (I2/I5).
      const archivedAt = new Date();
      const backup: Record<string, unknown> = {
        takenAt: new Date().toISOString(), host: target.host, companyMode, deleted: {}, nullified: [], rules: [],
        archived: plan.retained, archivedAt: archivedAt.toISOString(),
        plan: { deletable: plan.deletable, retained: plan.retained, r3References: plan.r3References, retireRows: plan.retireRows },
        historySnapshot: historyBefore,
      };
      for (const table of DELETE_ORDER) (backup.deleted as Record<string, unknown>)[table] = await rowsAsJson(tx, table, "id", deletable[table]);
      for (const op of plan.deleteLinks) (backup.deleted as Record<string, unknown>)[`${op.table}.${op.column}`] = await rowsAsJson(tx, op.table, op.column, linkTargets(op.target));
      for (const op of plan.retireRows) (backup.deleted as Record<string, unknown>)[`${op.table}.${op.column}`] = await rowsAsJson(tx, op.table, op.column, op.ids);
      for (const op of plan.nullify) {
        const rows = linkTargets(op.target).length ? await tx.$queryRawUnsafe<Array<{ id: string; value: string }>>(`SELECT id, ${quoteIdent(op.column)} AS value FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::text[])`, linkTargets(op.target)) : [];
        (backup.nullified as unknown[]).push({ table: op.table, column: op.column, rows });
      }
      const touchedRules = [...new Set(plan.ruleOperations.map((op) => op.ruleId))];
      for (const ruleId of touchedRules) (backup.rules as unknown[]).push({ rule: (await rowsAsJson(tx, "DoubleHourRule", "id", [ruleId]))[0], employees: await rowsAsJson(tx, "DoubleHourRuleEmployee", "ruleId", [ruleId]) });
      if (apply) writeFileSync(backupPath!, JSON.stringify({ ...backup, preManifest: pre }, null, 2));
      let auditRows = 0;
      const auditOf = async (input: Omit<Parameters<AuditWriter>[1], "userId">) => { await audit(tx, { ...input, userId: actor.id }); auditRows += 1; };

      // 3. Reglas: R1 / R2 / inactivar. Nunca NULL sin lista, nunca borrar la regla.
      for (const op of plan.ruleOperations) {
        const before = await tx.doubleHourRule.findUniqueOrThrow({ where: { id: op.ruleId }, select: { name: true, companyId: true, sectorId: true, positionId: true, status: true } });
        const change: WatchedValues = expectation.ruleChanges[op.ruleId] ?? {};
        if (op.kind === "R1") {
          await tx.doubleHourRule.update({ where: { id: op.ruleId }, data: op.set });
          Object.assign(change, op.set);
        } else if (op.kind === "R2") {
          const keep = new Set(op.employeeIds);
          const current = (await tx.doubleHourRuleEmployee.findMany({ where: { ruleId: op.ruleId }, select: { employeeId: true } })).map((row) => row.employeeId);
          const removed = current.filter((id) => !keep.has(id));
          const added = op.employeeIds.filter((id) => !current.includes(id));
          if (removed.length) await tx.doubleHourRuleEmployee.deleteMany({ where: { ruleId: op.ruleId, employeeId: { in: removed } } });
          if (added.length) await tx.doubleHourRuleEmployee.createMany({ data: added.map((employeeId) => ({ ruleId: op.ruleId, employeeId })) });
          // Recién con la lista no vacía se quita la dimensión: la regla no se amplía.
          await tx.doubleHourRule.update({ where: { id: op.ruleId }, data: Object.fromEntries(op.clear.map((dimension) => [dimension, null])) });
          for (const dimension of op.clear) change[dimension] = null;
          expectation.deleted.DoubleHourRuleEmployee = [...(expectation.deleted.DoubleHourRuleEmployee ?? []), ...removed.map((id) => `${op.ruleId}|${id}`)];
          expectation.newRows.DoubleHourRuleEmployee = [...(expectation.newRows.DoubleHourRuleEmployee ?? []), ...added.map((id) => `${op.ruleId}|${id}`)];
        } else {
          await tx.doubleHourRule.update({ where: { id: op.ruleId }, data: { status: "INACTIVO" } });
          change.status = "INACTIVO";
        }
        expectation.ruleChanges[op.ruleId] = change;
        await auditOf({ action: "UPDATE", entity: "DoubleHourRule", entityId: op.ruleId, description: `Regla de horas especiales "${before.name}": tratamiento ${op.kind} por la reorganización de estructura.`, before: before as Prisma.InputJsonValue, after: change as Prisma.InputJsonValue });
      }
      const stillReferenced = await tx.doubleHourRule.count({ where: { OR: [{ companyId: { in: deletable.Company } }, { sectorId: { in: deletable.Sector } }, { positionId: { in: deletable.Position } }] } });
      if (stillReferenced) throw new Error(`${stillReferenced} regla(s) siguen referenciando registros a borrar después del tratamiento. No se borra nada.`);

      // 4. Vínculos de legajos/usuarios/dispositivos y filas de vínculo.
      const employeeRefs = await loadEmployeeReferences(tx as never, (await tx.employee.findMany({ where: { OR: [{ positionId: { in: linkTargets("Position") } }, { sectorId: { in: linkTargets("Sector") } }] }, select: { id: true } })).map((row) => row.id));
      for (const op of plan.nullify) {
        const targets = linkTargets(op.target);
        const rows = targets.length ? await tx.$queryRawUnsafe<Array<{ id: string; value: string }>>(`SELECT id, ${quoteIdent(op.column)} AS value FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::text[])`, targets) : [];
        for (const row of rows) {
          await tx.$executeRawUnsafe(`UPDATE ${quoteIdent(op.table)} SET ${quoteIdent(op.column)} = NULL WHERE id = $1`, row.id);
          expectation.nullified[op.table] = { ...(expectation.nullified[op.table] ?? {}), [row.id]: [...(expectation.nullified[op.table]?.[row.id] ?? []), op.column] };
          const who = op.table === "Employee" ? employeeRefs(row.id) : op.table === "User" ? "un usuario" : "un dispositivo de fichada";
          await auditOf({ action: "UPDATE", entity: op.table, entityId: row.id, description: `Se desvinculó ${op.column} de ${who} por la reorganización de estructura (${REASON}).`, before: { [op.column]: row.value }, after: { [op.column]: null } });
        }
      }
      for (const op of plan.deleteLinks) {
        // C2: la empresa empleadora es un dato visible del legajo; se audita por legajo.
        if (op.table === "EmployeeCompany" && linkTargets("Company").length) {
          const links = await tx.employeeCompany.findMany({ where: { companyId: { in: linkTargets("Company") } }, select: { employeeId: true, companyId: true, isPrimary: true } });
          const byEmployee = new Map<string, typeof links>();
          for (const link of links) byEmployee.set(link.employeeId, [...(byEmployee.get(link.employeeId) ?? []), link]);
          const refs = await loadEmployeeReferences(tx as never, [...byEmployee.keys()]);
          for (const [employeeId, employeeLinks] of byEmployee) {
            await auditOf({ action: "UPDATE", entity: "Employee", entityId: employeeId, description: `Se desvinculó la empresa empleadora de ${refs(employeeId)} por la reorganización de estructura (${REASON}).`, before: { employerCompanies: employeeLinks } as Prisma.InputJsonValue, after: { employerCompanies: [] } });
          }
        }
        const key = pre.tables[op.table]!.key;
        const targets = linkTargets(op.target);
        const keys = await keysWhere(tx, op.table, key, op.column, targets);
        if (keys.length) await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::text[])`, targets);
        expectation.deleted[op.table] = [...(expectation.deleted[op.table] ?? []), ...keys];
      }

      // 4b. Retiro de filas clase 4 (fila nueva que dependía de un registro
      // retirado): borrado autorizado de fila, con respaldo (A8 §12.4).
      for (const op of plan.retireRows) {
        const key = pre.tables[op.table]!.key;
        const keys = await keysWhere(tx, op.table, key, op.column, op.ids);
        if (keys.length) await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::text[])`, op.ids);
        expectation.deleted[op.table] = [...(expectation.deleted[op.table] ?? []), ...keys];
      }

      // 5. Re-chequeo de TODAS las FKs del catálogo y borrado de la cadena en orden.
      const remaining = await countReferences(tx, foreignKeys, deletable);
      // Cadena interna: sólo puede quedar si la fila que referencia también se borra.
      // Cualquier otra FK (vínculos ya tratados, reglas, registros nuevos o no
      // clasificados) debe quedar en cero.
      const pending = remaining.filter((reference) => (treatmentOf(reference.table, reference.column) === "CHAIN" ? reference.rowsOutsideInventory > 0 : reference.rowsToInventory > 0));
      if (pending.length) throw new Error(`Quedan referencias a registros a borrar: ${pending.map((reference) => `${reference.table}.${reference.column} (${reference.rowsToInventory})`).join(", ")}. No se borra nada.`);
      for (const table of DELETE_ORDER) {
        for (const record of frozen.records[table].filter((item) => deletable[table].includes(item.id))) {
          await tx.$executeRawUnsafe(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, record.id);
          await auditOf({ action: "DELETE", entity: table, entityId: record.id, description: `Se eliminó ${record.code} - ${record.name} de la estructura anterior (${REASON}).`, before: record as unknown as Prisma.InputJsonValue });
        }
        expectation.deleted[table] = [...(expectation.deleted[table] ?? []), ...deletable[table]];
      }

      // 5b. Archivo de retained (A8 §12.1): único escritor (I1), conjunto
      // autorizado = retained del manifiesto (I2), AuditLog en la misma
      // transacción (I5). Ningún input de API escribe esta columna.
      for (const entry of plan.retained) {
        const record = frozen.records[entry.table].find((item) => item.id === entry.id)!;
        const updated = await tx.$executeRawUnsafe(`UPDATE ${quoteIdent(entry.table)} SET "archivedAt" = $2 WHERE id = $1 AND "archivedAt" IS NULL`, entry.id, archivedAt);
        if (!updated) throw new Error(`No se pudo archivar ${entry.table} ${entry.id}: la fila no existe o ya estaba archivada.`);
        expectation.archived![entry.table] = [...(expectation.archived![entry.table] ?? []), entry.id];
        await auditOf({
          action: "UPDATE", entity: entry.table, entityId: entry.id,
          description: `Se archivó ${record.code} - ${record.name} (A8 §12.1, conjunto retained del manifiesto de reorganización).`,
          before: { archivedAt: null }, after: { archivedAt: archivedAt.toISOString() },
        });
      }

      // 6. Equivalencia del motor de horas especiales.
      const enginePost = await engineOutcomes(tx, evaluate);
      const engineChanges = [...enginePre].filter(([key, value]) => enginePost.get(key) !== value).map(([key, value]) => ({ key, before: value, after: enginePost.get(key) ?? null }));
      const unaccepted = engineChanges.filter((change) => !accepted.has(change.key));
      summary.engineChanges = engineChanges;
      if (unaccepted.length) throw new Error(`La limpieza cambiaría ${unaccepted.length} resolución(es) de horas especiales no aceptadas (ver reporte). No se aplicó nada.`);

      // 7. F1 (A8 §12.3) antes del commit: compuerta de M2.
      const archivedNow = await loadArchivedIds(tx);
      const shapes = evaluateF1Shapes(await loadShapeRows(tx));
      const f1: GuardResult[] = [
        evaluateG4(plan.retained, archivedNow), // F1.1
        evaluateG3(deletable, await loadPresentIds(tx, deletable)), // F1.2
        { guard: "F1.3", ok: shapes.ok, detail: { violations: shapes.violations, counts: shapes.counts } },
        evaluateG7(historyBefore, await captureHistorySnapshot(tx)), // F1.5
        evaluateG5(await loadArchivedLinks(tx, foreignKeys, archivedNow), plan.r3References), // F1.6
        evaluateG8(liveHistory, deletable, await loadLiveHistoryIds(tx)),
      ];
      summary.f1 = f1;
      const failed = f1.filter((result) => !result.ok).map((result) => result.guard);
      if (failed.length) throw new Error(`F1 falló (${failed.join(", ")}; ver reporte). No se aplicó nada.`);

      // V1 (F1.4) antes del commit.
      const post = await captureRowManifest(tx, target.host);
      expectation.newAuditRows = auditRows;
      const violations = verifyV1(pre, post, expectation);
      summary.v1 = { violations, expectedAuditRows: auditRows };
      if (violations.length) throw new Error(`V1 detectó ${violations.length} cambio(s) fuera de lo autorizado (ver reporte). No se aplicó nada.`);
      if (!apply) throw new DryRunRollback();
    }, { isolationLevel: "Serializable", timeout: 900_000, maxWait: 30_000 });
    summary.result = apply ? "APLICADO" : "DRY-RUN OK (revertido)";
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
