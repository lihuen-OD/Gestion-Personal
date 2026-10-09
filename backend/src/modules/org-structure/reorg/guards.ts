// Guardas del ensayo G3-G9 (docs/decisions/A8_M2_PREPARATION.md §12.5-§12.6).
// Funciones puras: los scripts (`org-reorg-cleanup`, `org-reorg-guards`)
// leen la base en sólo lectura y estas funciones deciden. G1 y G2 (formas)
// viven en `shapes.ts`.

import { DELETE_ORDER, type HistoryReference, type R3Reference, type TargetTable } from "./cleanupPlan";

export interface GuardResult { guard: string; ok: boolean; detail: unknown }

const sortedIds = (ids: Iterable<string>) => [...new Set(ids)].sort();

// ---------------------------------------------------------------------------
// G3 — eliminables ausentes
// ---------------------------------------------------------------------------

/** G3: ningún ID `deletable` del plan sigue presente en su tabla. */
export function evaluateG3(deletable: Record<TargetTable, string[]>, present: Record<TargetTable, string[]>): GuardResult {
  const stillPresent = Object.fromEntries(
    DELETE_ORDER.map((table) => {
      const live = new Set(present[table] ?? []);
      return [table, sortedIds((deletable[table] ?? []).filter((id) => live.has(id)))];
    }).filter(([, ids]) => (ids as string[]).length),
  );
  return { guard: "G3", ok: Object.keys(stillPresent).length === 0, detail: { stillPresent } };
}

// ---------------------------------------------------------------------------
// G4 — conjunto archivado == retained
// ---------------------------------------------------------------------------

/** G4: IDs archivados en la base == `retained` del manifiesto (diferencia simétrica 0), por tabla. */
export function evaluateG4(retained: Array<{ table: TargetTable; id: string }>, archived: Record<TargetTable, string[]>): GuardResult {
  const missing: Record<string, string[]> = {};
  const unexpected: Record<string, string[]> = {};
  for (const table of DELETE_ORDER) {
    const expected = new Set(retained.filter((entry) => entry.table === table).map((entry) => entry.id));
    const actual = new Set(archived[table] ?? []);
    const notArchived = sortedIds([...expected].filter((id) => !actual.has(id)));
    const extra = sortedIds([...actual].filter((id) => !expected.has(id)));
    if (notArchived.length) missing[table] = notArchived;
    if (extra.length) unexpected[table] = extra;
  }
  return { guard: "G4", ok: !Object.keys(missing).length && !Object.keys(unexpected).length, detail: { missing, unexpected } };
}

// ---------------------------------------------------------------------------
// G5 — vínculos activos hacia archivados
// ---------------------------------------------------------------------------

/** Fila no histórica que apunta a un registro archivado (la lee el script por FK del catálogo). */
export interface ArchivedLink {
  table: string;
  column: string;
  target: TargetTable;
  /** Clave primaria de la fila que referencia (concat de columnas de la PK). */
  key: string;
  targetId: string;
  /** La fila que referencia es ella misma una fila archivada de las 6 tablas (forma `tal cual`). */
  sourceArchived: boolean;
}

/**
 * G5: 0 filas no históricas que referencien un archivado, salvo (a) la propia
 * fila archivada de las 6 tablas (conserva su FK vieja tal cual) y (b)
 * `DoubleHourRule` con R3 APROBADA hacia ese mismo destino y columna. Las
 * fuentes históricas no deben llegar acá (el script las excluye por la lista
 * de §12.2); si llegan, se rechazan igual (fail closed).
 */
export function evaluateG5(links: ArchivedLink[], r3References: R3Reference[]): GuardResult {
  const admitted = new Set(r3References.map((ref) => `${ref.ruleId}|${ref.column}|${ref.targetId}`));
  const violations = links.filter((link) => {
    if (link.sourceArchived && (DELETE_ORDER as readonly string[]).includes(link.table)) return false;
    if (link.table === "DoubleHourRule" && admitted.has(`${link.key}|${link.column}|${link.targetId}`)) return false;
    return true;
  });
  const admittedRules = links.filter((link) => link.table === "DoubleHourRule" && admitted.has(`${link.key}|${link.column}|${link.targetId}`));
  return { guard: "G5", ok: violations.length === 0, detail: { violations, admittedR3: admittedRules } };
}

// ---------------------------------------------------------------------------
// G6 — CHECKs de forma de M2
// ---------------------------------------------------------------------------

/**
 * Nombres que deben tener los CHECKs bicondicionales de forma que agrega M2
 * (§12.3): `archivedAt IS NOT NULL ⇒ padre nuevo IS NULL` y
 * `archivedAt IS NULL ⇒ padre nuevo IS NOT NULL`. La migración M2 debe usar
 * exactamente estos nombres para que G6 los encuentre.
 */
export const SHAPE_CHECK_CONSTRAINTS: ReadonlyArray<{ table: TargetTable; name: string }> = [
  { table: "Sector", name: "Sector_archive_shape_check" },
  { table: "Area", name: "Area_archive_shape_check" },
  { table: "Establishment", name: "Establishment_archive_shape_check" },
];

/** G6 (paso 8, post-M2): cada CHECK de forma existe y está validado. El `migrate diff` vacío lo corre el script aparte. */
export function evaluateG6(constraints: Array<{ table: string; name: string; validated: boolean }>, migrateDiffEmpty: boolean | null): GuardResult {
  const missing = SHAPE_CHECK_CONSTRAINTS.filter((expected) => !constraints.some((found) => found.table === expected.table && found.name === expected.name)).map((expected) => expected.name);
  const notValidated = constraints.filter((found) => SHAPE_CHECK_CONSTRAINTS.some((expected) => expected.name === found.name) && !found.validated).map((found) => found.name);
  return { guard: "G6", ok: !missing.length && !notValidated.length && migrateDiffEmpty === true, detail: { missing, notValidated, migrateDiffEmpty } };
}

// ---------------------------------------------------------------------------
// G7 — historia intacta, comparación profunda (§12.6)
// ---------------------------------------------------------------------------

/** Las siete tablas de historia de D-5 (§3.1). */
export const HISTORY_TABLES: readonly string[] = [
  "EmployeePositionPeriod",
  "EmployeeCostCenterPeriod",
  "EmployeeLegacySectorPeriod",
  "EmployeeEmployerPeriod",
  "EmployeeEmployerPeriodCompany",
  "PositionOrgScopePeriod",
  "PositionOrgScopePeriodNode",
];

/** Snapshot completo: todas las columnas de cada fila, ordenadas por clave primaria. */
export type HistorySnapshot = Record<string, { key: string[]; rows: Array<Record<string, unknown>> }>;

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * `row_to_json` escribe los TIMESTAMPTZ con la zona de la SESIÓN: dos
 * capturas del mismo dato en sesiones con distinta zona diferirían. Se
 * normalizan a ISO UTC; las fechas de calendario (`@db.Date`, sin hora) y el
 * resto de los valores quedan tal cual.
 */
export function normalizeSnapshotRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [column, typeof value === "string" && OFFSET_TIMESTAMP.test(value) ? new Date(value).toISOString() : value]));
}

export interface HistoryDiff { table: string; key?: string; column?: string; kind: "TABLE_MISSING" | "TABLE_ADDED" | "ROW_MISSING" | "ROW_ADDED" | "CELL_CHANGED"; before?: unknown; after?: unknown }

const rowKey = (key: string[], row: Record<string, unknown>) => key.map((column) => String(row[column])).join("|");

/**
 * G7: JSON idéntico — diff 0 filas y 0 columnas. Una celda cambiada (incluido
 * `updatedAt`), una fila perdida o agregada → guarda fallida con
 * tabla/fila/columna.
 */
export function compareHistorySnapshots(before: HistorySnapshot, after: HistorySnapshot): HistoryDiff[] {
  const diffs: HistoryDiff[] = [];
  for (const table of HISTORY_TABLES) {
    const pre = before[table];
    const post = after[table];
    if (!pre || !post) { if (pre || post) diffs.push({ table, kind: pre ? "TABLE_MISSING" : "TABLE_ADDED" }); continue; }
    const postRows = new Map(post.rows.map((row) => [rowKey(post.key, row), row]));
    const preKeys = new Set<string>();
    for (const row of pre.rows) {
      const key = rowKey(pre.key, row);
      preKeys.add(key);
      const now = postRows.get(key);
      if (!now) { diffs.push({ table, key, kind: "ROW_MISSING" }); continue; }
      for (const column of new Set([...Object.keys(row), ...Object.keys(now)])) {
        if (JSON.stringify(row[column] ?? null) !== JSON.stringify(now[column] ?? null)) diffs.push({ table, key, column, kind: "CELL_CHANGED", before: row[column] ?? null, after: now[column] ?? null });
      }
    }
    for (const key of postRows.keys()) if (!preKeys.has(key)) diffs.push({ table, key, kind: "ROW_ADDED" });
  }
  for (const table of Object.keys(after)) if (!HISTORY_TABLES.includes(table) && !(table in before)) diffs.push({ table, kind: "TABLE_ADDED" });
  return diffs;
}

export function evaluateG7(before: HistorySnapshot, after: HistorySnapshot): GuardResult {
  const diffs = compareHistorySnapshots(before, after);
  const rows = Object.fromEntries(HISTORY_TABLES.map((table) => [table, { before: before[table]?.rows.length ?? null, after: after[table]?.rows.length ?? null }]));
  return { guard: "G7", ok: diffs.length === 0, detail: { rows, diffs } };
}

// ---------------------------------------------------------------------------
// G8 — raíces históricas
// ---------------------------------------------------------------------------

/**
 * G8: `referencedIds ∩ deletable = ∅` y `outsideInventory = ∅` (sin lista
 * reconocida ni flag, §12.2). `liveReferenced` (opcional) son los IDs que la
 * historia referencia HOY: después de la limpieza tampoco pueden estar entre
 * los eliminados.
 */
export function evaluateG8(history: HistoryReference[], deletable: Record<TargetTable, string[]>, liveReferenced?: Partial<Record<TargetTable, string[]>>): GuardResult {
  const outside = Object.fromEntries(history.filter((entry) => entry.outsideInventory.length).map((entry) => [entry.source, sortedIds(entry.outsideInventory)]));
  const deletableByTable = Object.fromEntries(DELETE_ORDER.map((table) => [table, new Set(deletable[table] ?? [])])) as Record<TargetTable, Set<string>>;
  const frozenHits = history.flatMap((entry) => entry.referencedIds.filter((id) => deletableByTable[entry.targetTable].has(id)).map((id) => `${entry.source}:${id}`));
  const liveHits = DELETE_ORDER.flatMap((table) => (liveReferenced?.[table] ?? []).filter((id) => deletableByTable[table].has(id)).map((id) => `${table}:${id}`));
  const referencedDeletable = sortedIds([...frozenHits, ...liveHits]);
  return { guard: "G8", ok: !Object.keys(outside).length && !referencedDeletable.length, detail: { outsideInventory: outside, referencedDeletable } };
}

// ---------------------------------------------------------------------------
// G9 — rendimiento (A8-4)
// ---------------------------------------------------------------------------

export interface IndexInfo { table: string; name: string; columns: string[] }

/**
 * G9: cobertura de `@@index([status])` en `Employee` (A8-4, tras el DROP de
 * `[status, sectorId]`/`[sectorId]`). Los planes `EXPLAIN` de los listados se
 * adjuntan al reporte para revisión (no son compuerta automática: dependen del
 * volumen de la base).
 */
export function evaluateG9(indexes: IndexInfo[], plans: Record<string, unknown>): GuardResult {
  const statusLeading = indexes.filter((index) => index.table === "Employee" && index.columns[0] === "status").map((index) => index.name);
  return { guard: "G9", ok: statusLeading.length > 0, detail: { employeeStatusIndexes: statusLeading, plans } };
}
