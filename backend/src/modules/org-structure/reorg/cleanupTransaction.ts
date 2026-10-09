/**
 * Transacción de limpieza controlada del modelo organizacional anterior
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5-§6, A8_M2_PREPARATION.md
 * §7.2 paso 5 y §12). Recibe un cliente YA CONECTADO: las compuertas de
 * destino (archivo de entorno explícito, host esperado e identidad Neon
 * verificada, D-0) las aplica `scripts/org-reorg-cleanup.ts` ANTES de llamar
 * acá, y no hay forma de saltearlas desde ese comando. Separarla del script
 * permite probarla de punta a punta contra una base local desechable.
 *
 * Una única transacción Serializable; sin `apply` se revierte al final.
 *  1. Actor RRHH; congelado vs base; F0 + G1; historia viva == congelada;
 *     plan (cualquier bloqueo aborta) + revalidación de clase 4.
 *  2. Manifiesto, snapshot G7, motor (antes) y CAPTURA de todas las filas a
 *     retirar consolidadas por tabla + PK (cada fila una sola vez, sin
 *     sobrescribir) dentro de los predicados del plan; respaldo escrito antes
 *     de la primera escritura.
 *  3. Reglas R1/R2/inactivar, auditadas.
 *  4. Vaciados auditados; luego verifica que lo respaldado es EXACTAMENTE lo
 *     que los predicados encuentran y retira esas filas por PK.
 *  5. Re-chequeo de FKs; borra el catálogo deletable en orden; archiva
 *     `retained` con un único instante.
 *  6. Motor (después): cualquier cambio no aceptado aborta.
 *  7. F1 (G4, G3, formas, G7, G5, G8) y V1. Cualquier falla aborta sin cambios.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  captureHistorySnapshot, captureRowManifest, countReferences, discoverForeignKeys, engineOutcomes, loadArchivedIds, loadArchivedLinks,
  loadHistoryReferences, loadLiveHistoryIds, loadPresentIds, loadRules, loadShapeRows, quoteIdent, ruleReferences, type EngineEvaluator, type Tx,
} from "./catalogReads";
import { borrableIds, buildCleanupPlan, classFourOutsidePlan, DELETE_ORDER, treatmentOf, type ClassFourResolution, type CompanyMode, type FrozenInventory, type R1TargetState, type RuleDecision, type TargetTable } from "./cleanupPlan";
import { evaluateF0, evaluateF1Shapes } from "./shapes";
import { evaluateG3, evaluateG4, evaluateG5, evaluateG7, evaluateG8, type GuardResult, type HistorySnapshot } from "./guards";
import { todayArgentinaDateKey } from "../../../shared/datetime/argentinaTime";
import type { DateKey } from "../../labor-history/laborHistory.periods";
import { verifyV1, type RowManifest, type V1Expectation, type WatchedValues } from "./manifest";
import { addRetiredRows, BACKUP_FORMAT, retiredCount, retiredKeys, retirementPredicates, restoreTableOrder, rowKeyOf, verifyRetiredRows, type RetiredRows } from "./retirement";

export class DryRunRollback extends Error {}
const REASON = "Reorganización de estructura (ORG_LOCATION_REORGANIZATION.md)";

export type AuditWriter = (db: unknown, input: { action: "UPDATE" | "DELETE"; entity: string; entityId: string; description: string; userId: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue }) => Promise<unknown>;
export type EmployeeReferenceLoader = (db: never, employeeIds: string[]) => Promise<(employeeId: string) => string>;

export interface CleanupBackup {
  format: typeof BACKUP_FORMAT;
  takenAt: string;
  host: string;
  companyMode: CompanyMode;
  /** Filas retiradas (catálogo, familias autorizadas y clase 4), una vez por tabla + PK. */
  retired: RetiredRows;
  nullified: Array<{ table: string; column: string; rows: Array<{ id: string; value: string }> }>;
  rules: Array<{ rule: Record<string, unknown>; employees: Array<{ ruleId: string; employeeId: string }> }>;
  archived: Array<{ table: TargetTable; id: string }>;
  archivedAt: string;
  plan: { deletable: Record<TargetTable, string[]>; retained: Array<{ table: TargetTable; id: string }>; r3References: unknown[]; retireRows: unknown[] };
  historySnapshot: HistorySnapshot;
  preManifest: RowManifest;
}

export interface CleanupInput {
  companyMode: CompanyMode;
  frozen: FrozenInventory;
  decisions: RuleDecision[];
  classFour: ClassFourResolution[];
  /** Claves `employeeId|fecha` cuyo cambio de resolución del motor fue aceptado. */
  acceptedEngineChanges: Set<string>;
  actorUserId: string;
  apply: boolean;
  host: string;
  /**
   * Fecha civil (America/Argentina) a la que se congela la población de R2.
   * Por defecto, la de la corrida; queda en el reporte y en `ruleOperations`.
   */
  populationDate?: DateKey;
  /** Persistir el respaldo (con `apply`): se llama ANTES de la primera escritura. */
  writeBackup?: (backup: CleanupBackup) => void;
}

export interface CleanupDeps { evaluate: EngineEvaluator; audit: AuditWriter; loadEmployeeReferences: EmployeeReferenceLoader }

export interface CleanupOutcome { status: "APPLIED" | "DRY_RUN_OK" | "ABORTED"; error?: string; summary: Record<string, unknown>; backup?: CleanupBackup }

async function rowsAsJson(tx: Tx, table: string, column: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(`SELECT row_to_json(t) AS row FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} = ANY($1::text[])`, ids);
  return rows.map((item) => item.row);
}

async function keysWhere(tx: Tx, table: string, key: string[], column: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.$queryRawUnsafe<Array<{ k: string }>>(
    `SELECT concat_ws('|', ${key.map((name) => `t.${quoteIdent(name)}::text`).join(", ")}) AS k FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} = ANY($1::text[])`, ids,
  );
  return rows.map((row) => row.k);
}

/** Borra exactamente UNA fila por su clave primaria; cualquier otra cantidad aborta. */
async function deleteByKey(tx: Tx, table: string, key: string[], row: Record<string, unknown>) {
  const deleted = await tx.$executeRawUnsafe(
    `DELETE FROM ${quoteIdent(table)} WHERE ${key.map((column, index) => `${quoteIdent(column)}::text = $${index + 1}`).join(" AND ")}`,
    ...key.map((column) => String(row[column])),
  );
  if (deleted !== 1) throw new Error(`Se esperaba borrar 1 fila de ${table} ${rowKeyOf(key, row)} y se borraron ${deleted}. No se aplicó nada.`);
}

async function r1TargetStates(tx: Tx, decisions: RuleDecision[], frozen: Set<string>): Promise<Record<string, R1TargetState>> {
  const states: Record<string, R1TargetState> = {};
  for (const decision of decisions) {
    if (decision.treatment !== "R1") continue;
    for (const [dimension, id] of Object.entries(decision.targets)) {
      if (!id) continue;
      if (dimension === "sectorId") {
        // Un sector del modelo anterior nunca es destino válido (clasificación persistida, A8-3).
        const sector = await tx.sector.findUnique({ where: { id }, select: { isLegacy: true } });
        states[id] = { exists: Boolean(sector), legacyOrInventory: frozen.has(id) || sector?.isLegacy === true };
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

export async function runCleanup(prisma: PrismaClient, input: CleanupInput, deps: CleanupDeps): Promise<CleanupOutcome> {
  const { frozen, decisions, classFour, apply } = input;
  const summary: Record<string, unknown> = { mode: apply ? "apply" : "dry-run", companyMode: input.companyMode, host: input.host, startedAt: new Date().toISOString() };
  let backup: CleanupBackup | undefined;
  try {
    await prisma.$transaction(async (rawTx) => {
      const tx = rawTx as Tx;
      // 1. Actor, inventario congelado y plan.
      const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { id: true, role: true, status: true } });
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
      const populationDate = input.populationDate ?? todayArgentinaDateKey();
      summary.populationDate = populationDate;
      const rules = await ruleReferences(tx, await loadRules(tx), { populationDate, inventory: frozen });
      // A8 §12.2: la historia se re-verifica contra el congelado (fail closed).
      const liveHistory = await loadHistoryReferences(tx, frozen);
      if (JSON.stringify(liveHistory) !== JSON.stringify(frozen.history)) throw new Error("La historia (§12.2) del inventario congelado no coincide con la base. Re-inventariar.");
      const plan = buildCleanupPlan({ inventory: frozen, references, rules, decisions, classFour, history: liveHistory, r1Targets: await r1TargetStates(tx, decisions, frozenIds) });
      summary.plan = { issues: plan.issues, roots: plan.roots, retained: plan.retained, deletable: plan.deletable, r3References: plan.r3References, retireRows: plan.retireRows, ruleOperations: plan.ruleOperations };
      if (plan.blocking) throw new Error(`Plan bloqueado: ${plan.issues.filter((issue) => issue.blocking).map((issue) => issue.code).join(", ")}. No se escribió nada.`);
      // §12.4: la transacción vuelve a validar los retiros de clase 4 contra el plan antes de capturar nada.
      const outsidePlan = classFourOutsidePlan(plan.retireRows, plan.deletable, plan.retained);
      if (outsidePlan.length) throw new Error(`Retiros de clase 4 fuera del alcance autorizado: ${outsidePlan.map((issue) => issue.message).join(" ")}`);
      const deletable = plan.deletable;
      const retainedByTable = Object.fromEntries(DELETE_ORDER.map((table) => [table, plan.retained.filter((entry) => entry.table === table).map((entry) => entry.id)])) as Record<TargetTable, string[]>;
      const linkTargets = (target: TargetTable) => [...deletable[target], ...retainedByTable[target]];

      // 2. Estado previo y captura (antes de cualquier escritura).
      const pre = await captureRowManifest(tx, input.host);
      const historyBefore = await captureHistorySnapshot(tx);
      const enginePre = await engineOutcomes(tx, deps.evaluate);
      const expectation: V1Expectation = { deleted: {}, nullified: {}, ruleChanges: {}, newRows: {}, newAuditRows: 0, archived: {} };
      const archivedAt = new Date();
      // Filas a retirar: una vez por tabla + PK, sin sobrescribir, sólo dentro de los predicados del plan.
      const predicates = retirementPredicates(plan);
      const retired: RetiredRows = {};
      const conflicts: string[] = [];
      for (const predicate of predicates) {
        const key = pre.tables[predicate.table]?.key;
        if (!key) throw new Error(`${predicate.table} no está en el manifiesto previo.`);
        conflicts.push(...addRetiredRows(retired, predicate.table, key, await rowsAsJson(tx, predicate.table, predicate.column, predicate.ids)));
      }
      if (conflicts.length) throw new Error(`Captura inconsistente (misma PK con contenido distinto): ${conflicts.join("; ")}.`);
      const unauthorized = verifyRetiredRows(retired, predicates);
      if (unauthorized.length) throw new Error(`Captura fuera de los predicados autorizados: ${unauthorized.map((violation) => `${violation.table} ${violation.key ?? ""} ${violation.code}`).join("; ")}.`);
      summary.retired = Object.fromEntries(Object.entries(retiredKeys(retired)).map(([table, keys]) => [table, keys.length]));
      backup = {
        format: BACKUP_FORMAT, takenAt: new Date().toISOString(), host: input.host, companyMode: input.companyMode,
        retired, nullified: [], rules: [], archived: plan.retained, archivedAt: archivedAt.toISOString(),
        plan: { deletable: plan.deletable, retained: plan.retained, r3References: plan.r3References, retireRows: plan.retireRows },
        historySnapshot: historyBefore, preManifest: pre,
      };
      for (const op of plan.nullify) {
        const rows = linkTargets(op.target).length ? await tx.$queryRawUnsafe<Array<{ id: string; value: string }>>(`SELECT id, ${quoteIdent(op.column)} AS value FROM ${quoteIdent(op.table)} WHERE ${quoteIdent(op.column)} = ANY($1::text[])`, linkTargets(op.target)) : [];
        backup.nullified.push({ table: op.table, column: op.column, rows });
      }
      for (const ruleId of [...new Set(plan.ruleOperations.map((op) => op.ruleId))]) {
        backup.rules.push({ rule: (await rowsAsJson(tx, "DoubleHourRule", "id", [ruleId]))[0]!, employees: (await rowsAsJson(tx, "DoubleHourRuleEmployee", "ruleId", [ruleId])) as Array<{ ruleId: string; employeeId: string }> });
      }
      if (apply) input.writeBackup?.(backup);
      let auditRows = 0;
      const auditOf = async (entry: Omit<Parameters<AuditWriter>[1], "userId">) => { await deps.audit(tx, { ...entry, userId: actor.id }); auditRows += 1; };

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

      // 4. Vaciados de legajos/usuarios/dispositivos, auditados.
      const employeeRefs = await deps.loadEmployeeReferences(tx as never, (await tx.employee.findMany({ where: { OR: [{ positionId: { in: linkTargets("Position") } }, { sectorId: { in: linkTargets("Sector") } }] }, select: { id: true } })).map((row) => row.id));
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

      // 4b. Lo respaldado es EXACTAMENTE lo que los predicados encuentran ahora.
      const expectedKeys: Record<string, string[]> = {};
      for (const predicate of predicates) {
        const key = pre.tables[predicate.table]!.key;
        expectedKeys[predicate.table] = [...new Set([...(expectedKeys[predicate.table] ?? []), ...await keysWhere(tx, predicate.table, key, predicate.column, predicate.ids)])];
      }
      const mismatch = verifyRetiredRows(retired, predicates, expectedKeys);
      if (mismatch.length) throw new Error(`El respaldo no coincide con las filas a retirar: ${mismatch.map((violation) => `${violation.table} ${violation.key ?? ""} ${violation.code}`).join("; ")}. No se aplicó nada.`);

      // 4c. Retiro de familias autorizadas y clase 4 (no catálogo), por PK.
      // C2: la empresa empleadora es un dato visible del legajo; se audita por legajo.
      const employerLinks = Object.values(retired.EmployeeCompany?.rows ?? {}) as Array<{ employeeId: string; companyId: string; isPrimary: boolean }>;
      if (employerLinks.length) {
        const byEmployee = new Map<string, typeof employerLinks>();
        for (const link of employerLinks) byEmployee.set(link.employeeId, [...(byEmployee.get(link.employeeId) ?? []), link]);
        const refs = await deps.loadEmployeeReferences(tx as never, [...byEmployee.keys()]);
        for (const [employeeId, links] of byEmployee) {
          await auditOf({ action: "UPDATE", entity: "Employee", entityId: employeeId, description: `Se desvinculó la empresa empleadora de ${refs(employeeId)} por la reorganización de estructura (${REASON}).`, before: { employerCompanies: links.map(({ employeeId: owner, companyId, isPrimary }) => ({ employeeId: owner, companyId, isPrimary })) } as Prisma.InputJsonValue, after: { employerCompanies: [] } });
        }
      }
      const retiredTables = restoreTableOrder(Object.keys(retired)).reverse();
      for (const table of retiredTables.filter((name) => !(DELETE_ORDER as readonly string[]).includes(name))) {
        const entry = retired[table]!;
        for (const row of Object.values(entry.rows)) await deleteByKey(tx, table, entry.key, row);
        expectation.deleted[table] = [...(expectation.deleted[table] ?? []), ...Object.keys(entry.rows)];
      }

      // 5. Re-chequeo de TODAS las FKs del catálogo y borrado de la cadena en orden.
      const remaining = await countReferences(tx, foreignKeys, deletable);
      const pending = remaining.filter((reference) => (treatmentOf(reference.table, reference.column) === "CHAIN" ? reference.rowsOutsideInventory > 0 : reference.rowsToInventory > 0));
      if (pending.length) throw new Error(`Quedan referencias a registros a borrar: ${pending.map((reference) => `${reference.table}.${reference.column} (${reference.rowsToInventory})`).join(", ")}. No se borra nada.`);
      for (const table of DELETE_ORDER) {
        const entry = retired[table];
        for (const record of frozen.records[table].filter((item) => deletable[table].includes(item.id))) {
          await deleteByKey(tx, table, ["id"], { id: record.id });
          await auditOf({ action: "DELETE", entity: table, entityId: record.id, description: `Se eliminó ${record.code} - ${record.name} de la estructura anterior (${REASON}).`, before: record as unknown as Prisma.InputJsonValue });
        }
        if (Object.keys(entry?.rows ?? {}).length !== deletable[table].length) throw new Error(`El respaldo de ${table} no cubre exactamente los ${deletable[table].length} registros a borrar.`);
        expectation.deleted[table] = [...(expectation.deleted[table] ?? []), ...deletable[table]];
      }

      // 5b. Archivo de retained (A8 §12.1): único escritor, un mismo instante, auditado.
      for (const entry of plan.retained) {
        const record = frozen.records[entry.table].find((item) => item.id === entry.id)!;
        const updated = await tx.$executeRawUnsafe(`UPDATE ${quoteIdent(entry.table)} SET "archivedAt" = $2 WHERE id = $1 AND "archivedAt" IS NULL`, entry.id, archivedAt);
        if (!updated) throw new Error(`No se pudo archivar ${entry.table} ${entry.id}: la fila no existe o ya estaba archivada.`);
        expectation.archived![entry.table] = [...(expectation.archived![entry.table] ?? []), entry.id];
        await auditOf({ action: "UPDATE", entity: entry.table, entityId: entry.id, description: `Se archivó ${record.code} - ${record.name} (A8 §12.1, conjunto retained del manifiesto de reorganización).`, before: { archivedAt: null }, after: { archivedAt: archivedAt.toISOString() } });
      }

      // 6. Equivalencia del motor de horas especiales.
      const enginePost = await engineOutcomes(tx, deps.evaluate);
      const engineChanges = [...enginePre].filter(([key, value]) => enginePost.get(key) !== value).map(([key, value]) => ({ key, before: value, after: enginePost.get(key) ?? null }));
      summary.engineChanges = engineChanges;
      const unaccepted = engineChanges.filter((change) => !input.acceptedEngineChanges.has(change.key));
      if (unaccepted.length) throw new Error(`La limpieza cambiaría ${unaccepted.length} resolución(es) de horas especiales no aceptadas (ver reporte). No se aplicó nada.`);

      // 7. F1 (A8 §12.3) + V1 antes del commit: compuerta de M2.
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
      const post = await captureRowManifest(tx, input.host);
      expectation.newAuditRows = auditRows;
      const violations = verifyV1(pre, post, expectation);
      summary.v1 = { violations, expectedAuditRows: auditRows, retiredRows: retiredCount(retired) };
      if (violations.length) throw new Error(`V1 detectó ${violations.length} cambio(s) fuera de lo autorizado (ver reporte). No se aplicó nada.`);
      if (!apply) throw new DryRunRollback();
    }, { isolationLevel: "Serializable", timeout: 900_000, maxWait: 30_000 });
    return { status: "APPLIED", summary, backup };
  } catch (error) {
    if (error instanceof DryRunRollback) return { status: "DRY_RUN_OK", summary, backup };
    return { status: "ABORTED", error: error instanceof Error ? error.message : String(error), summary };
  } finally {
    summary.finishedAt = new Date().toISOString();
  }
}
