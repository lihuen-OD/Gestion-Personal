/**
 * Lectura del inventario de conservación (ver migrationInventory.ts). Corre en
 * UNA transacción `READ ONLY` (PostgreSQL rechaza cualquier escritura) con
 * TimeZone UTC, y sólo pide agregados: nunca lee valores de filas.
 */
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_VERSION, preservedColumns, quoteIdent, tableInventorySql, type InventoryConfig, type InventorySnapshot, type TableInventory } from "./migrationInventory";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const toNumber = (value: unknown) => (typeof value === "bigint" ? Number(value) : (value as number));

async function columnsOf(tx: Tx, table: string): Promise<string[] | null> {
  const rows = await tx.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    table,
  );
  return rows.length ? rows.map((row) => row.column_name) : null;
}

async function countRows(tx: Tx, table: string, where = "TRUE"): Promise<number> {
  const [row] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${quoteIdent(table)} WHERE ${where}`);
  return toNumber(row!.n);
}

export async function takeInventory(prisma: PrismaClient, config: InventoryConfig, timeoutMs = 180_000): Promise<InventorySnapshot> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL TimeZone = 'UTC'");
    const [meta] = await tx.$queryRawUnsafe<Array<{ database: string; serverVersion: string; readOnly: string; takenAt: Date }>>(
      `SELECT current_database() AS "database", current_setting('server_version') AS "serverVersion", current_setting('transaction_read_only') AS "readOnly", now() AS "takenAt"`,
    );
    const migrations = (await columnsOf(tx, "_prisma_migrations"))
      ? await tx.$queryRawUnsafe<Array<{ name: string; finished: boolean; rolledBack: boolean; checksum: string }>>(
        `SELECT migration_name AS "name", (finished_at IS NOT NULL) AS "finished", (rolled_back_at IS NOT NULL) AS "rolledBack", checksum FROM "_prisma_migrations" ORDER BY migration_name, started_at`,
      )
      : [];

    const tables: Record<string, TableInventory> = {};
    for (const table of config.preservedTables) {
      const columns = await columnsOf(tx, table);
      if (!columns) { tables[table] = "ABSENT"; continue; }
      const kept = preservedColumns(table, columns, config);
      const [row] = await tx.$queryRawUnsafe<Array<{ rows: number; idsHash: string; rowsHash: string }>>(tableInventorySql(table, kept));
      tables[table] = { rows: toNumber(row!.rows), idsHash: row!.idsHash, rowsHash: row!.rowsHash, columns: kept.length };
    }

    const structuralTables: InventorySnapshot["structuralTables"] = {};
    for (const table of [...config.droppedTables, ...config.createdTables]) {
      structuralTables[table] = (await columnsOf(tx, table)) ? await countRows(tx, table) : "ABSENT";
    }

    const newColumnValues: InventorySnapshot["newColumnValues"] = {};
    for (const [table, columns] of Object.entries(config.newColumns)) {
      const present = (await columnsOf(tx, table)) ?? [];
      for (const column of columns) {
        newColumnValues[`${table}.${column}`] = present.includes(column) ? await countRows(tx, table, `${quoteIdent(column)} IS NOT NULL`) : "ABSENT";
      }
    }

    const integrity: Record<string, number> = {};
    const [constraints] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND NOT c.convalidated`,
    );
    integrity.notValidatedConstraints = toNumber(constraints!.n);
    const incidentColumns = await columnsOf(tx, "AttendanceInactivityIncident");
    if (incidentColumns) {
      const key = incidentColumns.includes("scheduledStartAt") ? `"employeeId", "operationalDate", COALESCE("scheduledStartAt", '-infinity'::timestamptz)` : `"employeeId", "operationalDate"`;
      const [duplicates] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM (SELECT 1 FROM "AttendanceInactivityIncident" GROUP BY ${key} HAVING count(*) > 1) d`);
      integrity.duplicateIncidentKeys = toNumber(duplicates!.n);
      integrity.incidentWithoutEmployee = await countRows(tx, "AttendanceInactivityIncident", `NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id = "AttendanceInactivityIncident"."employeeId")`);
    }
    if (await columnsOf(tx, "WorkShift")) {
      integrity.shiftWithoutStartPunch = await countRows(tx, "WorkShift", `"startPunchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttendancePunch" p WHERE p.id = "WorkShift"."startPunchId")`);
      integrity.shiftWithoutEndPunch = await countRows(tx, "WorkShift", `"endPunchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttendancePunch" p WHERE p.id = "WorkShift"."endPunchId")`);
      integrity.timeEntryWithoutShift = await countRows(tx, "TimeEntry", `"workShiftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "WorkShift" w WHERE w.id = "TimeEntry"."workShiftId")`);
      integrity.alertWithoutShift = await countRows(tx, "ShiftAlert", `NOT EXISTS (SELECT 1 FROM "WorkShift" w WHERE w.id = "ShiftAlert"."workShiftId")`);
    }

    return {
      version: INVENTORY_VERSION,
      meta: { database: meta!.database, serverVersion: meta!.serverVersion, readOnly: meta!.readOnly === "on", takenAt: new Date(meta!.takenAt).toISOString() },
      migrations,
      tables,
      structuralTables,
      newColumnValues,
      integrity,
    };
  }, { timeout: timeoutMs, maxWait: 30_000 });
}
