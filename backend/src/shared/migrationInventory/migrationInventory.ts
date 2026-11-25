/**
 * Inventario de conservación de datos antes/después de aplicar migraciones
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.20, docs/DATABASE_STANDARDS.md
 * "Migrations"). Núcleo PURO: configuración, SQL de agregados y comparación.
 *
 * Garantías:
 * - Las consultas sólo devuelven AGREGADOS (conteos y md5): nunca valores de
 *   filas, así que el inventario no contiene datos personales.
 * - Las columnas que la migración AGREGA se excluyen del hash, para que antes y
 *   después sean comparables; todas las demás deben quedar idénticas.
 * - Una tabla que la migración elimina debe estar vacía antes.
 */

export const INVENTORY_VERSION = 1;

export interface InventoryConfig {
  /** Tablas cuyas filas (columnas preexistentes) deben conservarse idénticas. */
  preservedTables: readonly string[];
  /** Columnas que la migración agrega, por tabla: fuera del hash y NULL después (sin backfill). */
  newColumns: Readonly<Record<string, readonly string[]>>;
  /** Tablas que la migración elimina: deben estar vacías antes y ausentes después. */
  droppedTables: readonly string[];
  /** Tablas que la migración crea: ausentes antes y presentes (vacías) después. */
  createdTables: readonly string[];
}

/**
 * Migraciones pendientes en Neon development tras R4.9C (R4.1A, R4.3a, R4.5 y
 * R4.6): `20261120180000`, `20261121090000`, `20261124120000`, `20261125120000`.
 */
export const R49_PENDING_MIGRATIONS_CONFIG: InventoryConfig = {
  preservedTables: [
    "Employee", "User", "LaborMovement", "AttendancePunch", "ClockPunchAttempt", "WorkShift", "TimeSegment", "TimeEntry",
    "AttendanceInactivityIncident", "ShiftAlert", "SystemNotification", "ShiftTemplate", "ShiftGroup", "ShiftAssignment",
    "EmployeeWorkRegime", "WorkRegime", "EmployeeDayOff", "HolidayWorkAssignment", "DoubleHourRule", "SpecialHourRuleDate",
    "Novelty", "NoveltyType", "NoveltyDayCoverage", "MonthlyTimeClosure", "StorageFile", "AuditLog", "JobCheckpoint",
    "EmployeeAssignment", "ClockDevice", "ShiftRotation", "ShiftRotationVersion", "ShiftRotationCrew", "ShiftRotationCrewMember",
  ],
  newColumns: { AttendanceInactivityIncident: ["scheduledStartAt"], WorkShift: ["templateRulesSnapshot"] },
  droppedTables: ["ShiftRotationSlot"],
  createdTables: ["ShiftRotationDay", "ShiftRotationBlock"],
};

export type TableInventory = { rows: number; idsHash: string; rowsHash: string; columns: number } | "ABSENT";

export interface MigrationRow {
  name: string;
  finished: boolean;
  rolledBack: boolean;
  checksum: string;
}

export interface InventorySnapshot {
  version: number;
  meta: { database: string; serverVersion: string; readOnly: boolean; takenAt: string };
  migrations: MigrationRow[];
  tables: Record<string, TableInventory>;
  /** Filas por tabla eliminada/creada ("ABSENT" si no existe). */
  structuralTables: Record<string, number | "ABSENT">;
  /** Filas con valor en cada columna nueva (debe ser 0: sin backfill). "ABSENT" si la columna no existe. */
  newColumnValues: Record<string, number | "ABSENT">;
  /** Controles de integridad: todos deben ser 0. */
  integrity: Record<string, number>;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Identificador entre comillas dobles; rechaza cualquier nombre que no sea un identificador simple. */
export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Identificador inválido para el inventario: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

/** Columnas que entran en el hash de conservación: todas menos las que agrega la migración. */
export function preservedColumns(table: string, allColumns: readonly string[], config: InventoryConfig): string[] {
  const excluded = new Set(config.newColumns[table] ?? []);
  return [...allColumns].filter((column) => !excluded.has(column)).sort();
}

/**
 * SQL que devuelve SÓLO agregados de una tabla: cantidad, md5 de los IDs en
 * orden y md5 de los md5 de cada fila (columnas dadas, en orden de id). Con
 * TimeZone UTC el texto de cada fila es estable.
 */
export function tableInventorySql(table: string, columns: readonly string[]): string {
  if (!columns.length) throw new Error(`La tabla ${table} no tiene columnas para el inventario.`);
  const rowText = `json_build_array(${columns.map(quoteIdent).join(", ")})::text`;
  const hasId = columns.includes("id");
  const order = hasId ? quoteIdent("id") : rowText;
  const idText = hasId ? `${quoteIdent("id")}::text` : rowText;
  return `SELECT count(*)::int AS "rows", md5(coalesce(string_agg(${idText}, ',' ORDER BY ${order}), '')) AS "idsHash", md5(coalesce(string_agg(md5(${rowText}), '' ORDER BY ${order}), '')) AS "rowsHash" FROM ${quoteIdent(table)}`;
}

export interface InventoryComparison {
  ok: boolean;
  /** Tablas preservadas que cambiaron (conteo, IDs o filas) o que aparecieron/desaparecieron. */
  changedTables: Array<{ table: string; before: TableInventory | undefined; after: TableInventory | undefined }>;
  migrationsAdded: string[];
  /** Migraciones aplicadas antes cuyo checksum cambió, o que dejaron de figurar como aplicadas. */
  previousMigrationsAltered: string[];
  failedMigrationsAfter: string[];
  droppedTablesNotEmptyBefore: string[];
  droppedTablesStillPresent: string[];
  createdTablesMissing: string[];
  newColumnsWithValues: string[];
  integrityIssuesAfter: string[];
}

const applied = (snapshot: InventorySnapshot) => snapshot.migrations.filter((row) => row.finished && !row.rolledBack);

/** Compara dos inventarios; `ok` sólo si nada preexistente cambió y la estructura nueva es la esperada. */
export function compareInventories(before: InventorySnapshot, after: InventorySnapshot, config: InventoryConfig): InventoryComparison {
  const changedTables = config.preservedTables
    .filter((table) => JSON.stringify(before.tables[table]) !== JSON.stringify(after.tables[table]))
    .map((table) => ({ table, before: before.tables[table], after: after.tables[table] }));
  const beforeApplied = new Map(applied(before).map((row) => [row.name, row.checksum]));
  const afterApplied = new Map(applied(after).map((row) => [row.name, row.checksum]));
  const migrationsAdded = [...afterApplied.keys()].filter((name) => !beforeApplied.has(name)).sort();
  const previousMigrationsAltered = [...beforeApplied.entries()].filter(([name, checksum]) => afterApplied.get(name) !== checksum).map(([name]) => name).sort();
  const failedMigrationsAfter = after.migrations.filter((row) => !row.finished && !row.rolledBack).map((row) => row.name);
  const droppedTablesNotEmptyBefore = config.droppedTables.filter((table) => before.structuralTables[table] !== "ABSENT" && before.structuralTables[table] !== 0);
  const droppedTablesStillPresent = config.droppedTables.filter((table) => after.structuralTables[table] !== "ABSENT");
  const createdTablesMissing = config.createdTables.filter((table) => after.structuralTables[table] === "ABSENT" || after.structuralTables[table] === undefined);
  const newColumnsWithValues = Object.entries(after.newColumnValues).filter(([, value]) => value !== 0).map(([column]) => column);
  const integrityIssuesAfter = Object.entries(after.integrity).filter(([, value]) => value !== 0).map(([check]) => check);
  const ok = !changedTables.length && !previousMigrationsAltered.length && !failedMigrationsAfter.length && !droppedTablesNotEmptyBefore.length
    && !droppedTablesStillPresent.length && !createdTablesMissing.length && !newColumnsWithValues.length && !integrityIssuesAfter.length;
  return { ok, changedTables, migrationsAdded, previousMigrationsAltered, failedMigrationsAfter, droppedTablesNotEmptyBefore, droppedTablesStillPresent, createdTablesMissing, newColumnsWithValues, integrityIssuesAfter };
}

export interface ChecksumDrift {
  /** Aplicadas en la base con un checksum distinto del sha256 del archivo del repositorio. */
  mismatched: string[];
  /** En el repositorio y todavía no aplicadas. */
  pending: string[];
  /** Aplicadas en la base sin carpeta en el repositorio. */
  appliedWithoutFile: string[];
}

/**
 * Deriva entre `_prisma_migrations.checksum` y el sha256 de cada
 * `migration.sql` del repositorio. `migrate deploy` no la detecta; antes de
 * producción debe revisarse explícitamente (§25.20, hallazgo B1).
 */
export function migrationChecksumDrift(rows: readonly MigrationRow[], repoChecksums: Readonly<Record<string, string>>): ChecksumDrift {
  const appliedRows = rows.filter((row) => row.finished && !row.rolledBack);
  const appliedNames = new Set(appliedRows.map((row) => row.name));
  return {
    mismatched: appliedRows.filter((row) => repoChecksums[row.name] !== undefined && repoChecksums[row.name] !== row.checksum).map((row) => row.name).sort(),
    pending: Object.keys(repoChecksums).filter((name) => !appliedNames.has(name)).sort(),
    appliedWithoutFile: appliedRows.filter((row) => repoChecksums[row.name] === undefined).map((row) => row.name).sort(),
  };
}
