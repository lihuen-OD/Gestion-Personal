// Filas que la limpieza retira (borra) y su respaldo, consolidados por TABLA
// y CLAVE PRIMARIA (docs/decisions/A8_M2_PREPARATION.md §12.4 y §12.9.7).
// Funciones puras: la transacción de limpieza captura con ellas, verifica que
// lo respaldado es exactamente lo que va a borrar, y la restauración reinserta
// cada fila una sola vez.
//
// Por qué por tabla+PK y no por "tabla.columna": una misma tabla puede tener
// varias familias o resoluciones (p. ej. `PositionOrgScope.companyId` y
// `.businessUnitId`, o dos resoluciones de la misma columna), y una fila puede
// estar alcanzada por más de una. Con claves por columna, la última asignación
// pisaba a las anteriores y una fila podía reinsertarse dos veces.

import { DELETE_ORDER, isAuthorizedClassFour, type CleanupPlan, type TargetTable } from "./cleanupPlan";
import type { RowManifest } from "./manifest";

export type RetiredRow = Record<string, unknown>;
/** Filas retiradas de una tabla, por clave primaria (concat de columnas de la PK con "|"). */
export interface RetiredTable { key: string[]; rows: Record<string, RetiredRow> }
export type RetiredRows = Record<string, RetiredTable>;

/** Formato del respaldo de `org-reorg-cleanup --apply`. 2 = `retired` por tabla+PK. */
export const BACKUP_FORMAT = 2;

export const rowKeyOf = (key: string[], row: RetiredRow) => key.map((column) => String(row[column])).join("|");

/**
 * Agrega filas a la captura SIN sobrescribir: una fila ya capturada se ignora
 * si es idéntica y es un conflicto si difiere (misma PK, contenido distinto).
 * Devuelve las claves en conflicto.
 */
export function addRetiredRows(set: RetiredRows, table: string, key: string[], rows: RetiredRow[]): string[] {
  if (!rows.length) return [];
  const entry = set[table] ?? { key, rows: {} };
  if (entry.key.join(",") !== key.join(",")) return [`${table}: clave primaria inconsistente (${entry.key.join(",")} vs ${key.join(",")})`];
  set[table] = entry;
  const conflicts: string[] = [];
  for (const row of rows) {
    const pk = rowKeyOf(key, row);
    const existing = entry.rows[pk];
    if (!existing) entry.rows[pk] = row;
    else if (JSON.stringify(existing) !== JSON.stringify(row)) conflicts.push(`${table} ${pk}`);
  }
  return conflicts;
}

export const retiredKeys = (set: RetiredRows): Record<string, string[]> =>
  Object.fromEntries(Object.entries(set).map(([table, entry]) => [table, Object.keys(entry.rows).sort()]));

export const retiredCount = (set: RetiredRows) => Object.values(set).reduce((sum, entry) => sum + Object.keys(entry.rows).length, 0);

/** Qué filas autoriza a retirar el plan: `table.column ∈ ids`. */
export interface RetirementPredicate { table: string; column: string; ids: string[]; family: "CATALOG" | "DELETE_LINKS" | "CLASS_FOUR" }

/**
 * Predicados de retiro autorizados por el plan (A8 §12.4), la ÚNICA fuente
 * para capturar, borrar y verificar:
 * - catálogo: IDs `deletable` de cada tabla de DELETE_ORDER;
 * - familias de configuración (DELETE_LINKS): filas hacia deletable ∪ retained;
 * - clase 4: sólo combinaciones de la lista cerrada, hacia los IDs del plan.
 */
export function retirementPredicates(plan: Pick<CleanupPlan, "deletable" | "retained" | "deleteLinks" | "retireRows">): RetirementPredicate[] {
  const leaving = (target: TargetTable) => [...new Set([...plan.deletable[target], ...plan.retained.filter((entry) => entry.table === target).map((entry) => entry.id)])].sort();
  return [
    ...DELETE_ORDER.map((table) => ({ table, column: "id", ids: [...plan.deletable[table]].sort(), family: "CATALOG" as const })),
    ...plan.deleteLinks.map((op) => ({ table: op.table, column: op.column, ids: leaving(op.target), family: "DELETE_LINKS" as const })),
    ...plan.retireRows.filter((op) => isAuthorizedClassFour(op.table, op.column, op.target)).map((op) => ({ table: op.table, column: op.column, ids: [...op.ids].sort(), family: "CLASS_FOUR" as const })),
  ].filter((predicate) => predicate.ids.length);
}

export interface RetirementViolation { table: string; key?: string; code: string; message: string }

/**
 * Lo respaldado es EXACTAMENTE lo que se va a retirar:
 * - cada fila capturada cumple al menos un predicado autorizado de su tabla;
 * - (con `expected`) las claves capturadas coinciden una a una con las que
 *   los predicados encuentran justo antes de borrar: ni faltan ni sobran.
 */
export function verifyRetiredRows(set: RetiredRows, predicates: RetirementPredicate[], expected?: Record<string, string[]>): RetirementViolation[] {
  const violations: RetirementViolation[] = [];
  for (const [table, entry] of Object.entries(set)) {
    const own = predicates.filter((predicate) => predicate.table === table);
    if (!own.length) { violations.push({ table, code: "RETIRE_TABLE_NOT_AUTHORIZED", message: "Tabla sin predicado de retiro autorizado." }); continue; }
    for (const [pk, row] of Object.entries(entry.rows)) {
      if (!own.some((predicate) => predicate.ids.includes(String(row[predicate.column])))) violations.push({ table, key: pk, code: "RETIRE_ROW_NOT_AUTHORIZED", message: "Fila capturada fuera de los predicados del plan." });
    }
  }
  if (expected) {
    const captured = retiredKeys(set);
    for (const table of new Set([...Object.keys(captured), ...Object.keys(expected)])) {
      const have = new Set(captured[table] ?? []);
      const want = new Set(expected[table] ?? []);
      for (const pk of want) if (!have.has(pk)) violations.push({ table, key: pk, code: "RETIRE_NOT_BACKED_UP", message: "Fila a retirar que no está en el respaldo." });
      for (const pk of have) if (!want.has(pk)) violations.push({ table, key: pk, code: "RETIRE_BACKUP_EXTRA", message: "Fila respaldada que no se va a retirar." });
    }
  }
  return violations;
}

/**
 * Orden de reinserción: primero el catálogo de padres a hijos (inverso a
 * DELETE_ORDER), después las demás tablas (vínculos y alcances, que apuntan al
 * catálogo). El borrado usa el orden inverso.
 */
export function restoreTableOrder(tables: string[]): string[] {
  const catalog = [...DELETE_ORDER].reverse().filter((table) => tables.includes(table));
  const others = tables.filter((table) => !(DELETE_ORDER as readonly string[]).includes(table)).sort();
  return [...catalog, ...others];
}

export interface BackupRetiredSource {
  format?: number;
  retired?: RetiredRows;
  /** Formato 1 (anterior): filas por "Tabla" o "Tabla.columna", sin consolidar. */
  deleted?: Record<string, RetiredRow[]>;
  preManifest: Pick<RowManifest, "tables">;
}

/**
 * Compatibilidad explícita de formato: el 2 se usa tal cual; el 1 (claves
 * "Tabla.columna") se consolida por tabla+PK con la PK del manifiesto previo —
 * una fila repetida idéntica entra una vez, y una misma PK con contenidos
 * distintos aborta (el respaldo no es confiable).
 */
export function normalizeBackupRetired(backup: BackupRetiredSource): RetiredRows {
  if (backup.format === BACKUP_FORMAT) {
    if (!backup.retired) throw new Error("Respaldo formato 2 sin `retired`.");
    return backup.retired;
  }
  if (backup.format !== undefined) throw new Error(`Formato de respaldo ${backup.format} no soportado.`);
  const set: RetiredRows = {};
  const conflicts: string[] = [];
  for (const [entry, rows] of Object.entries(backup.deleted ?? {})) {
    const table = entry.split(".")[0]!;
    const key = backup.preManifest.tables[table]?.key;
    if (!key?.length) throw new Error(`Respaldo formato 1: ${table} no está en el manifiesto previo (sin clave primaria).`);
    conflicts.push(...addRetiredRows(set, table, key, rows));
  }
  if (conflicts.length) throw new Error(`Respaldo formato 1 inconsistente: misma clave con contenido distinto (${conflicts.slice(0, 10).join("; ")}).`);
  return set;
}
