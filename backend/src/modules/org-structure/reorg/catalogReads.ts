/**
 * Lecturas de la reorganización (docs/decisions/A8_M2_PREPARATION.md §12):
 * inventario con clases y ampliación, dependencias del catálogo de Postgres,
 * historia, reglas, manifiesto por fila, motor y guardas. Reciben siempre el
 * cliente de la transacción (`tx`): ninguna usa el cliente global de la app,
 * así que importarlas no fija ni abre ninguna conexión. Las compuertas de
 * destino (host esperado, identidad Neon D-0) viven en los scripts
 * (`scripts/org-reorg/lib.ts`), no acá.
 */
import type { PrismaClient } from "@prisma/client";
import { engineOutcomeLabel, type EngineEvaluation } from "../../time-entries/specialHourEvidence";
import { borrableIds, DELETE_ORDER, inventoryDimensions, partitionHistoryReference, type CompanyMode, type FrozenInventory, type HistoryReference, type InventoryClass, type InventoryRecord, type ReferenceCount, type RuleReference, type TargetTable } from "./cleanupPlan";
import { stableColumns, WATCHED_COLUMNS, type RowManifest, type TableManifest } from "./manifest";
import type { ShapeRows } from "./shapes";
import type { DateKey } from "../../labor-history/laborHistory.periods";
import { rulePopulationAt, type PopulationReader } from "./rulePopulation";
import { HISTORY_TABLES, normalizeSnapshotRow, type ArchivedLink, type HistorySnapshot, type IndexInfo } from "./guards";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------
// Inventario del modelo anterior
// ---------------------------------------------------------------------------

/** Fila de catálogo con lo necesario para clasificar su membresía en la transición. */
export type CatalogRow = {
  id: string; code: string; name: string; status: string;
  companyId?: string | null; businessUnitId?: string | null; establishmentId?: string | null; areaId?: string | null;
  sectorId?: string | null; zoneId?: string | null;
  /** BusinessUnit: tiene sectores del modelo nuevo. Position: tiene alcances (PositionOrgScope). */
  inNewModelUse?: boolean;
};

/**
 * Criterio de membresía de la transición (A8 §12.2, ADR §12.2), ÚNICA fuente
 * para el congelado inicial y para la ampliación: `borrable` = registro del
 * modelo anterior candidato a borrado; `conservada` = en alcance y activo por
 * el modo (empresas en C1); `nueva` = catálogo del modelo nuevo, que sólo
 * entra al congelado si la historia lo referencia (ampliación) y nunca se
 * borra ni se archiva.
 */
export function transitionClass(table: TargetTable, row: CatalogRow, companyMode: CompanyMode): InventoryClass {
  switch (table) {
    case "Company": return companyMode === "C2" ? "borrable" : "conservada";
    // Una UN que ya tenga sectores del modelo nuevo es un registro nuevo en uso.
    case "BusinessUnit": return row.inNewModelUse ? "nueva" : "borrable";
    case "Establishment": return row.zoneId ? "nueva" : "borrable";
    case "Area": return row.sectorId ? "nueva" : "borrable";
    case "Sector": return row.businessUnitId ? "nueva" : "borrable";
    // Puestos: todos los actuales se recargan, salvo los que ya tengan alcance del modelo nuevo.
    case "Position": return row.inNewModelUse ? "nueva" : "borrable";
  }
}

/** Padres del modelo anterior de una fila (para el cierre de retención). */
function legacyParents(table: TargetTable, row: CatalogRow): InventoryRecord["parents"] {
  switch (table) {
    case "Company": return {};
    case "BusinessUnit": return { Company: row.companyId ?? null };
    case "Establishment": return { Company: row.companyId ?? null, BusinessUnit: row.businessUnitId ?? null };
    case "Area": return { Establishment: row.establishmentId ?? null };
    case "Sector": return { Area: row.areaId ?? null };
    case "Position": return { Sector: row.sectorId ?? null };
  }
}

const toRecord = (table: TargetTable, row: CatalogRow, companyMode: CompanyMode): InventoryRecord => {
  const cls = transitionClass(table, row, companyMode);
  return { id: row.id, code: row.code, name: row.name, status: row.status, parents: legacyParents(table, row), ...(cls === "borrable" ? {} : { class: cls }) };
};

/** Filas de catálogo de una tabla (todas o por IDs), con los datos de membresía. Sólo lectura. */
export async function loadCatalogRows(tx: Tx, table: TargetTable, ids?: string[]): Promise<CatalogRow[]> {
  const where = ids ? { id: { in: ids } } : {};
  const base = { id: true, code: true, name: true, status: true } as const;
  switch (table) {
    case "Company": return tx.company.findMany({ where, select: base, orderBy: { code: "asc" } });
    case "BusinessUnit": {
      const rows = await tx.businessUnit.findMany({ where, select: { ...base, companyId: true, _count: { select: { sectors: true } } }, orderBy: { code: "asc" } });
      // `sectors` = sectores del modelo nuevo (Sector.businessUnitId).
      return rows.map(({ _count, ...row }) => ({ ...row, inNewModelUse: _count.sectors > 0 }));
    }
    case "Establishment": return tx.establishment.findMany({ where, select: { ...base, companyId: true, businessUnitId: true, zoneId: true }, orderBy: { code: "asc" } });
    case "Area": return tx.area.findMany({ where, select: { ...base, establishmentId: true, sectorId: true }, orderBy: { code: "asc" } });
    case "Sector": return tx.sector.findMany({ where, select: { ...base, areaId: true, businessUnitId: true }, orderBy: { code: "asc" } });
    case "Position": {
      const rows = await tx.position.findMany({ where, select: { ...base, sectorId: true, _count: { select: { orgScopes: true } } }, orderBy: { code: "asc" } });
      return rows.map(({ _count, ...row }) => ({ ...row, inNewModelUse: _count.orgScopes > 0 }));
    }
  }
}

/**
 * Inventario congelado inicial: registros `borrable` del modelo anterior y,
 * en C1, las empresas como `conservada` (para que la historia que las
 * referencia quede dentro del inventario sin tratarlas).
 */
export async function loadInventory(tx: Tx, companyMode: CompanyMode): Promise<FrozenInventory> {
  const records = {} as FrozenInventory["records"];
  for (const table of DELETE_ORDER) {
    records[table] = (await loadCatalogRows(tx, table))
      .map((row) => toRecord(table, row, companyMode))
      .filter((record) => (record.class ?? "borrable") === "borrable" || (table === "Company" && record.class === "conservada"));
  }
  return { companyMode, records };
}

export interface AmplificationRound { round: number; added: Array<{ table: TargetTable; id: string; class: InventoryClass; reason: string }> }

/**
 * Ciclo de ampliación (A8 §12.2): mientras alguna fuente de historia tenga
 * `outsideInventory`, incorpora esos destinos (y, si son `borrable`, sus
 * ancestros) clasificados con el MISMO criterio de membresía, re-congela y
 * vuelve a particionar la historia. No hay reconocimiento ni flag: un destino
 * que no existe en la base aborta. Devuelve el inventario con `history` y el
 * registro de cada ronda (IDs exactos) para el reporte.
 */
export async function amplifyInventory(tx: Tx, initial: FrozenInventory, maxRounds = 10): Promise<{ inventory: FrozenInventory; rounds: AmplificationRound[] }> {
  const records = Object.fromEntries(DELETE_ORDER.map((table) => [table, [...initial.records[table]]])) as FrozenInventory["records"];
  const rounds: AmplificationRound[] = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    const history = await loadHistoryReferences(tx, { records });
    const pending = new Map<string, { table: TargetTable; id: string; reason: string }>();
    for (const entry of history) for (const id of entry.outsideInventory) pending.set(`${entry.targetTable}:${id}`, { table: entry.targetTable, id, reason: `referenciado por ${entry.source}` });
    if (!pending.size) return { inventory: { companyMode: initial.companyMode, records, history }, rounds };
    const added: AmplificationRound["added"] = [];
    while (pending.size) {
      const [key, item] = pending.entries().next().value as [string, { table: TargetTable; id: string; reason: string }];
      pending.delete(key);
      if (records[item.table].some((record) => record.id === item.id)) continue;
      const [row] = await loadCatalogRows(tx, item.table, [item.id]);
      if (!row) throw new Error(`Ampliación: ${item.table} ${item.id} (${item.reason}) no existe en la base. No se reconoce: revisar la historia.`);
      const record = toRecord(item.table, row, initial.companyMode);
      records[item.table].push(record);
      added.push({ table: item.table, id: item.id, class: record.class ?? "borrable", reason: item.reason });
      // Dependencias: un borrable necesita sus ancestros en el congelado para el cierre de retención.
      if ((record.class ?? "borrable") === "borrable") {
        for (const [parentTable, parentId] of Object.entries(record.parents) as Array<[TargetTable, string | null]>) {
          if (parentId && !records[parentTable].some((existing) => existing.id === parentId)) pending.set(`${parentTable}:${parentId}`, { table: parentTable, id: parentId, reason: `ancestro de ${item.table} ${item.id}` });
        }
      }
    }
    rounds.push({ round, added });
  }
  throw new Error(`La ampliación del inventario no convergió en ${maxRounds} rondas.`);
}

// ---------------------------------------------------------------------------
// Dependencias: descubrimiento genérico en el catálogo de Postgres
// ---------------------------------------------------------------------------

export interface ForeignKey { constraint: string; table: string; column: string; target: TargetTable; onDelete: string }

/** Todas las FKs de una columna hacia las tablas de la estructura, leídas del catálogo (no de una lista a mano). */
export async function discoverForeignKeys(tx: Tx): Promise<ForeignKey[]> {
  const rows = await tx.$queryRawUnsafe<Array<{ constraint: string; table: string; column: string; target: string; on_delete: string; columns: number }>>(`
    SELECT con.conname AS constraint, src.relname AS table, att.attname AS column, tgt.relname AS target,
           con.confdeltype::text AS on_delete, array_length(con.conkey, 1) AS columns
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = src.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND ns.nspname = 'public'
      AND tgt.relname IN ('Company', 'BusinessUnit', 'Establishment', 'Area', 'Sector', 'Position')
    ORDER BY tgt.relname, src.relname, att.attname`);
  for (const row of rows) {
    if (row.columns !== 1) throw new Error(`FK compuesta inesperada ${row.constraint}: clasificarla antes de continuar.`);
  }
  return rows.map((row) => ({ constraint: row.constraint, table: row.table, column: row.column, target: row.target as TargetTable, onDelete: row.on_delete }));
}

/** Cuenta, por FK, filas que apuntan a IDs del conjunto y cuántas son registros fuera de ese conjunto. */
export async function countReferences(tx: Tx, foreignKeys: ForeignKey[], ids: Record<TargetTable, string[]>): Promise<ReferenceCount[]> {
  const result: ReferenceCount[] = [];
  for (const fk of foreignKeys) {
    const targetIds = ids[fk.target];
    if (!targetIds.length) { result.push({ ...fk, rowsToInventory: 0, rowsOutsideInventory: 0 }); continue; }
    const ownIds = (DELETE_ORDER as readonly string[]).includes(fk.table) ? ids[fk.table as TargetTable] : null;
    const [row] = await tx.$queryRawUnsafe<Array<{ total: number; outside: number; ids: string[] | null }>>(
      `SELECT count(*)::int AS total, ${ownIds ? `count(*) FILTER (WHERE NOT (t."id" = ANY($2::text[])))::int` : "count(*)::int"} AS outside,
              array_agg(DISTINCT t.${quoteIdent(fk.column)}::text) AS ids
       FROM ${quoteIdent(fk.table)} t WHERE t.${quoteIdent(fk.column)} = ANY($1::text[])`,
      targetIds, ...(ownIds ? [ownIds] : []),
    );
    // IDs exactos (A8 §12.2/§12.4): los reportes listan destinos, no sólo conteos.
    result.push({ ...fk, rowsToInventory: row!.total, rowsOutsideInventory: row!.outside, targetIds: [...(row!.ids ?? [])].sort() });
  }
  return result;
}

/**
 * IDs contra los que se cuentan las dependencias: sólo `borrable` (los únicos
 * que se borran o archivan). Una FK hacia un `conservada`/`nueva` no requiere
 * tratamiento.
 */
export function inventoryIds(inventory: FrozenInventory): Record<TargetTable, string[]> {
  return borrableIds(inventory);
}

// ---------------------------------------------------------------------------
// Historia temporal (A8 §12.2): IDs exactos por fuente
// ---------------------------------------------------------------------------

/** Las 9 FKs de las 7 tablas de D-5 cuyo destino es una tabla de DELETE_ORDER (A8 §12.2). */
export const HISTORY_SOURCES: ReadonlyArray<{ table: string; column: string; source: string; targetTable: TargetTable }> = [
  { table: "EmployeePositionPeriod", column: "positionId", source: "EmployeePositionPeriod.positionId", targetTable: "Position" },
  { table: "EmployeeLegacySectorPeriod", column: "sectorId", source: "EmployeeLegacySectorPeriod.sectorId", targetTable: "Sector" },
  { table: "EmployeeEmployerPeriodCompany", column: "companyId", source: "EmployeeEmployerPeriodCompany.companyId", targetTable: "Company" },
  { table: "PositionOrgScopePeriod", column: "positionId", source: "PositionOrgScopePeriod.positionId", targetTable: "Position" },
  { table: "PositionOrgScopePeriodNode", column: "companyId", source: "PositionOrgScopePeriodNode.companyId", targetTable: "Company" },
  { table: "PositionOrgScopePeriodNode", column: "businessUnitId", source: "PositionOrgScopePeriodNode.businessUnitId", targetTable: "BusinessUnit" },
  { table: "PositionOrgScopePeriodNode", column: "sectorId", source: "PositionOrgScopePeriodNode.sectorId", targetTable: "Sector" },
  { table: "PositionOrgScopePeriodNode", column: "areaId", source: "PositionOrgScopePeriodNode.areaId", targetTable: "Area" },
  { table: "PositionOrgScopePeriodNode", column: "areaSectorId", source: "PositionOrgScopePeriodNode.areaSectorId", targetTable: "Sector" },
];

/** IDs EXACTOS (ordenados, sin duplicados) que la historia referencia hacia el inventario. Sólo lectura. */
export async function loadHistoryReferences(tx: Tx, inventory: Pick<FrozenInventory, "records">): Promise<HistoryReference[]> {
  const result: HistoryReference[] = [];
  for (const { table, column, source, targetTable } of HISTORY_SOURCES) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT DISTINCT t.${quoteIdent(column)}::text AS id FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} IS NOT NULL ORDER BY 1`,
    );
    result.push(partitionHistoryReference(source, targetTable, rows.map((row) => row.id), inventory));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reglas de horas especiales
// ---------------------------------------------------------------------------

export interface RuleRow {
  id: string; name: string; kind: string; status: string; recurrenceType: string; fromDate: Date; toDate: Date | null;
  priority: number; multiplier: unknown; companyId: string | null; sectorId: string | null; costCenterId: string | null; positionId: string | null;
  /** Clasificación PERSISTIDA del sector (A8-3); `null` si la regla no tiene sector. */
  sector: { isLegacy: boolean } | null;
  employees: Array<{ employeeId: string }>;
  dates: Array<{ date: Date; isActive: boolean }>;
}

export function loadRules(tx: Tx): Promise<RuleRow[]> {
  return tx.doubleHourRule.findMany({
    select: {
      id: true, name: true, kind: true, status: true, recurrenceType: true, fromDate: true, toDate: true, priority: true, multiplier: true,
      companyId: true, sectorId: true, costCenterId: true, positionId: true,
      sector: { select: { isLegacy: true } },
      employees: { select: { employeeId: true } },
      dates: { select: { date: true, isActive: true } },
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Referencias de reglas para el plan. La población (R2) se calcula con la
 * semántica del MOTOR a la fecha `populationDate` (reorg/rulePopulation.ts) y
 * sólo para las reglas que referencian registros `borrable` del inventario —
 * las únicas que pueden necesitar R2. Las demás quedan con población vacía y
 * `populationDate` sin definir: no se usan.
 */
export async function ruleReferences(tx: Tx, rules: RuleRow[], options: { populationDate: DateKey; inventory: FrozenInventory }): Promise<RuleReference[]> {
  const result: RuleReference[] = [];
  for (const rule of rules) {
    const base: RuleReference = { ruleId: rule.id, name: rule.name, status: rule.status, companyId: rule.companyId, sectorId: rule.sectorId, positionId: rule.positionId, currentPopulation: [] };
    if (!inventoryDimensions(base, options.inventory).length) { result.push(base); continue; }
    const population = await rulePopulationAt(tx as unknown as PopulationReader, rule, options.populationDate);
    result.push({ ...base, currentPopulation: population.employeeIds, population: { date: population.date, sectorSemantics: population.sectorSemantics, candidates: population.candidates, missing: population.missing, holidayConvocations: population.holidayConvocations } });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Manifiesto por fila
// ---------------------------------------------------------------------------

/** Manifiesto id → hash por fila de todas las tablas, con columnas vigiladas en claro. Sólo lectura. */
export async function captureRowManifest(tx: Tx, host: string): Promise<RowManifest> {
  // `ROW(...)::text` escribe los TIMESTAMPTZ con la zona de la SESIÓN: dos
  // capturas del mismo dato con distinto TimeZone darían hashes distintos. Se
  // fija UTC sólo durante la captura (SET LOCAL, dentro de la transacción del
  // llamador) y se repone la zona previa al terminar, para no alterar nada que
  // la misma transacción haga después.
  const [current] = await tx.$queryRawUnsafe<Array<{ timezone: string }>>("SELECT current_setting('TimeZone') AS timezone");
  const timezone = current!.timezone;
  await tx.$queryRawUnsafe("SELECT set_config('TimeZone', 'UTC', true)");
  try {
    return await captureRowManifestUtc(tx, host);
  } finally {
    await tx.$queryRawUnsafe("SELECT set_config('TimeZone', $1, true)", timezone);
  }
}

async function captureRowManifestUtc(tx: Tx, host: string): Promise<RowManifest> {
  const tables = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const manifest: RowManifest = { takenAt: new Date().toISOString(), host, tables: {} };
  for (const { table_name: table } of tables) {
    const columns = (await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", table,
    )).map((row) => row.column_name);
    const key = (await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT a.attname AS column_name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`, quoteIdent(table),
    )).map((row) => row.column_name);
    if (!key.length) throw new Error(`La tabla ${table} no tiene clave primaria: no se puede verificar por fila.`);
    const stable = stableColumns(table, columns);
    const watched = (WATCHED_COLUMNS[table] ?? []).filter((column) => columns.includes(column));
    const rows = await tx.$queryRawUnsafe<Array<Record<string, string | null>>>(
      `SELECT concat_ws('|', ${key.map((column) => `t.${quoteIdent(column)}::text`).join(", ")}) AS "__key",
              md5(ROW(${stable.map((column) => `t.${quoteIdent(column)}`).join(", ")})::text) AS "__stable"
              ${watched.map((column) => `, t.${quoteIdent(column)}::text AS ${quoteIdent(column)}`).join("")}
       FROM ${quoteIdent(table)} t`,
    );
    const tableManifest: TableManifest = { key, columns, rows: {} };
    for (const row of rows) {
      tableManifest.rows[row.__key!] = { stable: row.__stable!, ...(watched.length ? { watched: Object.fromEntries(watched.map((column) => [column, row[column] ?? null])) } : {}) };
    }
    manifest.tables[table] = tableManifest;
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Motor de horas especiales (D-5): resultado por legajo + fecha
// ---------------------------------------------------------------------------

export type EngineEvaluator = (employeeId: string, dates: Date[], db: unknown) => Promise<Map<string, EngineEvaluation>>;

/** Fechas con horas, desgloses o tramos, por legajo. */
export async function employeeDatesWithHours(tx: Tx) {
  const rows = await tx.$queryRawUnsafe<Array<{ employeeId: string; date: Date }>>(
    `SELECT "employeeId", date FROM "TimeEntry" UNION SELECT "employeeId", date FROM "HourConceptBreakdown" UNION SELECT "employeeId", date FROM "TimeSegment"`,
  );
  const byEmployee = new Map<string, Date[]>();
  for (const row of rows) byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row.date]);
  return { rows: rows.length, byEmployee };
}

/** Resultado del motor real para cada legajo + fecha con horas, sin escribir nada. */
export async function engineOutcomes(tx: Tx, evaluate: EngineEvaluator, db: unknown = tx): Promise<Map<string, string>> {
  const { byEmployee } = await employeeDatesWithHours(tx);
  const result = new Map<string, string>();
  for (const [employeeId, dates] of byEmployee) {
    for (const [day, evaluation] of await evaluate(employeeId, dates, db)) result.set(`${employeeId}|${day}`, engineOutcomeLabel(evaluation));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Formas y guardas (A8 §12.3-§12.6). Todo de sólo lectura.
// ---------------------------------------------------------------------------

/** Filas de los seis catálogos con las columnas que deciden su forma (F0/F1, G1). */
export async function loadShapeRows(tx: Tx): Promise<ShapeRows> {
  const q = <T>(sql: string) => tx.$queryRawUnsafe<T[]>(sql);
  return {
    Company: await q(`SELECT id, "archivedAt"::text AS "archivedAt" FROM "Company" ORDER BY id`),
    BusinessUnit: await q(`SELECT id, "companyId", "archivedAt"::text AS "archivedAt" FROM "BusinessUnit" ORDER BY id`),
    Establishment: await q(`SELECT id, "zoneId", "companyId", "businessUnitId", "archivedAt"::text AS "archivedAt" FROM "Establishment" ORDER BY id`),
    Area: await q(`SELECT id, "sectorId", "establishmentId", "archivedAt"::text AS "archivedAt" FROM "Area" ORDER BY id`),
    Sector: await q(`SELECT id, "isLegacy", "businessUnitId", "areaId", "archivedAt"::text AS "archivedAt" FROM "Sector" ORDER BY id`),
    Position: await q(`SELECT p.id, p."sectorId", p."archivedAt"::text AS "archivedAt", (SELECT count(*)::int FROM "PositionOrgScope" s WHERE s."positionId" = p.id) AS "activeScopes" FROM "Position" p ORDER BY p.id`),
  };
}

export async function primaryKey(tx: Tx, table: string): Promise<string[]> {
  const key = (await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT a.attname AS column_name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`, quoteIdent(table),
  )).map((row) => row.column_name);
  if (!key.length) throw new Error(`La tabla ${table} no tiene clave primaria.`);
  return key;
}

/** G7 (§12.6): snapshot COMPLETO de las siete tablas de historia — todas las columnas, ordenado por PK. */
export async function captureHistorySnapshot(tx: Tx): Promise<HistorySnapshot> {
  const snapshot: HistorySnapshot = {};
  for (const table of HISTORY_TABLES) {
    const key = await primaryKey(tx, table);
    const rows = await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(
      `SELECT row_to_json(t) AS row FROM ${quoteIdent(table)} t ORDER BY ${key.map((column) => `t.${quoteIdent(column)}`).join(", ")}`,
    );
    snapshot[table] = { key, rows: rows.map((item) => normalizeSnapshotRow(item.row)) };
  }
  return snapshot;
}

/** IDs con `archivedAt NOT NULL`, por tabla (G4). */
export async function loadArchivedIds(tx: Tx): Promise<Record<TargetTable, string[]>> {
  const result = {} as Record<TargetTable, string[]>;
  for (const table of DELETE_ORDER) {
    result[table] = (await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM ${quoteIdent(table)} WHERE "archivedAt" IS NOT NULL ORDER BY id`)).map((row) => row.id);
  }
  return result;
}

/** De los IDs dados, cuáles siguen existiendo (G3). */
export async function loadPresentIds(tx: Tx, ids: Record<TargetTable, string[]>): Promise<Record<TargetTable, string[]>> {
  const result = {} as Record<TargetTable, string[]>;
  for (const table of DELETE_ORDER) {
    result[table] = ids[table]?.length
      ? (await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM ${quoteIdent(table)} WHERE id = ANY($1::text[]) ORDER BY id`, ids[table])).map((row) => row.id)
      : [];
  }
  return result;
}

/** IDs que la historia referencia HOY, por tabla destino (G8 después de escribir). */
export async function loadLiveHistoryIds(tx: Tx): Promise<Record<TargetTable, string[]>> {
  const result = Object.fromEntries(DELETE_ORDER.map((table) => [table, [] as string[]])) as Record<TargetTable, string[]>;
  for (const { table, column, targetTable } of HISTORY_SOURCES) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT DISTINCT t.${quoteIdent(column)}::text AS id FROM ${quoteIdent(table)} t WHERE t.${quoteIdent(column)} IS NOT NULL`);
    result[targetTable] = [...new Set([...result[targetTable], ...rows.map((row) => row.id)])].sort();
  }
  return result;
}

/**
 * G5: filas que referencian un archivado, por cada FK del catálogo de Postgres
 * hacia las seis tablas, EXCEPTO las nueve fuentes de historia (§12.2). Marca
 * si la fila de origen es ella misma un archivado de las seis tablas.
 */
export async function loadArchivedLinks(tx: Tx, foreignKeys: ForeignKey[], archived: Record<TargetTable, string[]>): Promise<ArchivedLink[]> {
  const historySources = new Set(HISTORY_SOURCES.map((source) => source.source));
  const links: ArchivedLink[] = [];
  for (const fk of foreignKeys) {
    if (historySources.has(`${fk.table}.${fk.column}`) || !archived[fk.target].length) continue;
    const key = await primaryKey(tx, fk.table);
    const ownArchive = (DELETE_ORDER as readonly string[]).includes(fk.table);
    const rows = await tx.$queryRawUnsafe<Array<{ key: string; targetId: string; sourceArchived: boolean }>>(
      `SELECT concat_ws('|', ${key.map((column) => `t.${quoteIdent(column)}::text`).join(", ")}) AS key, t.${quoteIdent(fk.column)}::text AS "targetId",
              ${ownArchive ? `t."archivedAt" IS NOT NULL` : "false"} AS "sourceArchived"
       FROM ${quoteIdent(fk.table)} t WHERE t.${quoteIdent(fk.column)} = ANY($1::text[]) ORDER BY 1`,
      archived[fk.target],
    );
    for (const row of rows) links.push({ table: fk.table, column: fk.column, target: fk.target, key: row.key, targetId: row.targetId, sourceArchived: row.sourceArchived });
  }
  return links;
}

/** G6: CHECKs de las seis tablas con su estado de validación. */
export async function loadCheckConstraints(tx: Tx): Promise<Array<{ table: string; name: string; validated: boolean }>> {
  return tx.$queryRawUnsafe(
    `SELECT rel.relname AS table, con.conname AS name, con.convalidated AS validated
     FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE con.contype = 'c' AND ns.nspname = 'public' AND rel.relname IN ('Company', 'BusinessUnit', 'Establishment', 'Area', 'Sector', 'Position')
     ORDER BY 1, 2`,
  );
}

/** G9: índices de Employee (columnas en orden) y planes EXPLAIN (sin ANALYZE: no ejecuta la consulta) de los listados. */
export async function loadListingPerformance(tx: Tx): Promise<{ indexes: IndexInfo[]; plans: Record<string, unknown> }> {
  const indexes = await tx.$queryRawUnsafe<IndexInfo[]>(
    `SELECT t.relname AS table, i.relname AS name, array_agg(a.attname ORDER BY k.ord)::text[] AS columns
     FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid
     JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE t.relname = 'Employee' GROUP BY t.relname, i.relname ORDER BY 2`,
  );
  const explain = async (sql: string) => (await tx.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(`EXPLAIN (FORMAT JSON) ${sql}`))[0]?.["QUERY PLAN"];
  return {
    indexes,
    plans: {
      employeesActiveByName: await explain(`SELECT id FROM "Employee" WHERE status = 'ACTIVO' ORDER BY "lastName", "firstName" LIMIT 25`),
      employeesCountByStatus: await explain(`SELECT status, count(*) FROM "Employee" GROUP BY status`),
      positionsActiveList: await explain(`SELECT id FROM "Position" WHERE "archivedAt" IS NULL ORDER BY status, name LIMIT 25`),
    },
  };
}
