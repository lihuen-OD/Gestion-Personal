/**
 * E/S compartida de los scripts de reorganización
 * (docs/decisions/ORG_LOCATION_REORGANIZATION.md §5).
 *
 * Conexión SIEMPRE explícita: la URL sale de `--env-file=<archivo>` (nunca del
 * `.env` habitual) y su host debe coincidir con `--expected-host`. Antes de
 * importar cualquier módulo de la app se fija process.env.DATABASE_URL a esa
 * URL, así ningún cliente puede caer en otra base.
 */
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertExpectedHost, verifyNeonIdentity, type NeonIdentity } from "../../src/modules/org-structure/reorg/targetIdentity";
import { DELETE_ORDER, type CompanyMode, type FrozenInventory, type InventoryRecord, type ReferenceCount, type RuleReference, type TargetTable } from "../../src/modules/org-structure/reorg/cleanupPlan";
import { stableColumns, WATCHED_COLUMNS, type RowManifest, type TableManifest } from "../../src/modules/org-structure/reorg/manifest";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export function arg(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export interface Target { prisma: PrismaClient; host: string; databaseUrl: string; identity: NeonIdentity }

/** Conecta al destino declarado y comprueba (si hay credencial) su identidad Neon. */
export async function connectTarget(): Promise<Target> {
  const envFile = arg("env-file");
  if (!envFile) throw new Error("Falta --env-file=<archivo>: el destino nunca se toma del .env habitual.");
  const databaseUrl = parse(readFileSync(envFile)).DATABASE_URL;
  if (!databaseUrl) throw new Error(`${envFile} no define DATABASE_URL.`);
  const host = assertExpectedHost(databaseUrl, arg("expected-host"));
  process.env.DATABASE_URL = databaseUrl;
  const identity = await verifyNeonIdentity({
    databaseUrl,
    apiKey: process.env.NEON_API_KEY,
    projectId: arg("neon-project-id"),
    expectedBranchId: arg("expected-branch-id"),
    expectedBranchName: arg("expected-branch-name"),
  });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  return { prisma, host, databaseUrl, identity };
}

/** Transacción de SÓLO LECTURA: Postgres rechaza cualquier escritura. */
export function readOnly<T>(prisma: PrismaClient, operation: (tx: Tx) => Promise<T>, timeout = 300_000): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return operation(tx as Tx);
  }, { timeout, maxWait: 30_000 });
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------
// Inventario del modelo anterior
// ---------------------------------------------------------------------------

type Row = { id: string; code: string; name: string; status: string };

/** Registros del modelo anterior. C1 conserva empresas (no entran al inventario). */
export async function loadInventory(tx: Tx, companyMode: CompanyMode): Promise<FrozenInventory> {
  const [companies, businessUnits, establishments, areas, sectors, positions] = await Promise.all([
    companyMode === "C2" ? tx.company.findMany({ select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } }) : Promise.resolve([] as Row[]),
    tx.businessUnit.findMany({ select: { id: true, code: true, name: true, status: true, companyId: true }, orderBy: { code: "asc" } }),
    // Modelo anterior: establecimientos sin zona. Los nuevos (con zona) no se tocan.
    tx.establishment.findMany({ where: { zoneId: null }, select: { id: true, code: true, name: true, status: true, companyId: true, businessUnitId: true }, orderBy: { code: "asc" } }),
    tx.area.findMany({ where: { sectorId: null }, select: { id: true, code: true, name: true, status: true, establishmentId: true }, orderBy: { code: "asc" } }),
    tx.sector.findMany({ where: { businessUnitId: null }, select: { id: true, code: true, name: true, status: true, areaId: true }, orderBy: { code: "asc" } }),
    tx.position.findMany({ select: { id: true, code: true, name: true, status: true, sectorId: true, _count: { select: { orgScopes: true } } }, orderBy: { code: "asc" } }),
  ]);
  const record = (row: Row, parents: InventoryRecord["parents"]): InventoryRecord => ({ id: row.id, code: row.code, name: row.name, status: row.status, parents });
  // Unidades de negocio: el concepto se mantiene, pero las actuales se recargan.
  // Una UN que ya tenga sectores del modelo nuevo no entra (registro nuevo en uso).
  const businessUnitsWithNewSectors = new Set((await tx.sector.findMany({ where: { businessUnitId: { not: null } }, select: { businessUnitId: true } })).map((row) => row.businessUnitId!));
  return {
    companyMode,
    records: {
      Company: companies.map((row) => record(row, {})),
      BusinessUnit: businessUnits.filter((row) => !businessUnitsWithNewSectors.has(row.id)).map((row) => record(row, { Company: row.companyId })),
      Establishment: establishments.map((row) => record(row, { Company: row.companyId, BusinessUnit: row.businessUnitId })),
      Area: areas.map((row) => record(row, { Establishment: row.establishmentId })),
      Sector: sectors.map((row) => record(row, { Area: row.areaId })),
      // Puestos: todos los actuales se recargan, salvo los que ya tengan alcance del modelo nuevo.
      Position: positions.filter((row) => row._count.orgScopes === 0).map((row) => record(row, { Sector: row.sectorId })),
    },
  };
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
    const [row] = await tx.$queryRawUnsafe<Array<{ total: number; outside: number }>>(
      `SELECT count(*)::int AS total, ${ownIds ? `count(*) FILTER (WHERE NOT (t."id" = ANY($2::text[])))::int` : "count(*)::int"} AS outside
       FROM ${quoteIdent(fk.table)} t WHERE t.${quoteIdent(fk.column)} = ANY($1::text[])`,
      targetIds, ...(ownIds ? [ownIds] : []),
    );
    result.push({ ...fk, rowsToInventory: row!.total, rowsOutsideInventory: row!.outside });
  }
  return result;
}

export function inventoryIds(inventory: FrozenInventory): Record<TargetTable, string[]> {
  return Object.fromEntries(DELETE_ORDER.map((table) => [table, inventory.records[table].map((record) => record.id)])) as Record<TargetTable, string[]>;
}

// ---------------------------------------------------------------------------
// Reglas de horas especiales
// ---------------------------------------------------------------------------

export interface RuleRow {
  id: string; name: string; kind: string; status: string; recurrenceType: string; fromDate: Date; toDate: Date | null;
  priority: number; multiplier: unknown; companyId: string | null; sectorId: string | null; costCenterId: string | null; positionId: string | null;
  employees: Array<{ employeeId: string }>;
  dates: Array<{ date: Date; isActive: boolean }>;
}

export function loadRules(tx: Tx): Promise<RuleRow[]> {
  return tx.doubleHourRule.findMany({
    select: {
      id: true, name: true, kind: true, status: true, recurrenceType: true, fromDate: true, toDate: true, priority: true, multiplier: true,
      companyId: true, sectorId: true, costCenterId: true, positionId: true,
      employees: { select: { employeeId: true } },
      dates: { select: { date: true, isActive: true } },
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Legajos que HOY cumplen el alcance de la regla, con la misma semántica que
 * doubleHourRuleScopeWhere (timeEntries.repository.ts): todas las dimensiones
 * configuradas con AND, NULL = sin restricción, lista vacía = sin restricción
 * por persona. No incluye la excepción FERIADO + convocatoria (se informa
 * aparte), porque depende de la fecha.
 */
export async function currentPopulation(tx: Tx, rule: Pick<RuleRow, "companyId" | "sectorId" | "costCenterId" | "positionId" | "employees">): Promise<string[]> {
  const rows = await tx.employee.findMany({
    where: {
      ...(rule.employees.length ? { id: { in: rule.employees.map((item) => item.employeeId) } } : {}),
      ...(rule.companyId ? { companies: { some: { companyId: rule.companyId } } } : {}),
      ...(rule.sectorId ? { sectorId: rule.sectorId } : {}),
      ...(rule.costCenterId ? { costCenterId: rule.costCenterId } : {}),
      ...(rule.positionId ? { positionId: rule.positionId } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

export async function ruleReferences(tx: Tx, rules: RuleRow[]): Promise<RuleReference[]> {
  const result: RuleReference[] = [];
  for (const rule of rules) {
    result.push({ ruleId: rule.id, name: rule.name, status: rule.status, companyId: rule.companyId, sectorId: rule.sectorId, positionId: rule.positionId, currentPopulation: await currentPopulation(tx, rule) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Manifiesto por fila
// ---------------------------------------------------------------------------

/** Manifiesto id → hash por fila de todas las tablas, con columnas vigiladas en claro. Sólo lectura. */
export async function captureRowManifest(tx: Tx, host: string): Promise<RowManifest> {
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
