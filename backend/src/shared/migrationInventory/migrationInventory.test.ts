import { describe, expect, it } from "vitest";
import {
  compareInventories,
  INVENTORY_VERSION,
  migrationChecksumDrift,
  preservedColumns,
  quoteIdent,
  R49_PENDING_MIGRATIONS_CONFIG,
  tableInventorySql,
  type InventoryConfig,
  type InventorySnapshot,
} from "./migrationInventory";

const config: InventoryConfig = {
  preservedTables: ["Employee", "WorkShift"],
  newColumns: { WorkShift: ["templateRulesSnapshot"] },
  droppedTables: ["ShiftRotationSlot"],
  createdTables: ["ShiftRotationDay"],
};

function snapshot(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    version: INVENTORY_VERSION,
    meta: { database: "db", serverVersion: "18", readOnly: true, takenAt: "2026-11-25T00:00:00.000Z" },
    migrations: [{ name: "20260101000000_a", finished: true, rolledBack: false, checksum: "aaa" }],
    tables: {
      Employee: { rows: 2, idsHash: "e-ids", rowsHash: "e-rows", columns: 5 },
      WorkShift: { rows: 3, idsHash: "w-ids", rowsHash: "w-rows", columns: 9 },
    },
    structuralTables: { ShiftRotationSlot: 0, ShiftRotationDay: "ABSENT" },
    newColumnValues: { "WorkShift.templateRulesSnapshot": "ABSENT" },
    integrity: { notValidatedConstraints: 0 },
    ...overrides,
  };
}

const migrated = (overrides: Partial<InventorySnapshot> = {}) =>
  snapshot({
    migrations: [...snapshot().migrations, { name: "20260202000000_b", finished: true, rolledBack: false, checksum: "bbb" }],
    structuralTables: { ShiftRotationSlot: "ABSENT", ShiftRotationDay: 0 },
    newColumnValues: { "WorkShift.templateRulesSnapshot": 0 },
    ...overrides,
  });

describe("quoteIdent / preservedColumns / tableInventorySql", () => {
  it("sólo acepta identificadores simples", () => {
    expect(quoteIdent("WorkShift")).toBe('"WorkShift"');
    for (const bad of ['a"b', "a;b", "1a", "a b", ""]) expect(() => quoteIdent(bad)).toThrow(/Identificador inválido/);
  });

  it("excluye las columnas que agrega la migración y ordena el resto", () => {
    expect(preservedColumns("WorkShift", ["status", "templateRulesSnapshot", "id"], config)).toEqual(["id", "status"]);
    expect(preservedColumns("Employee", ["b", "a"], config)).toEqual(["a", "b"]);
  });

  it("el SQL sólo devuelve agregados (conteo y md5), ordenados por id", () => {
    const sql = tableInventorySql("WorkShift", ["id", "status"]);
    expect(sql).toContain('count(*)::int AS "rows"');
    expect(sql).toContain('ORDER BY "id"');
    expect(sql).toContain('md5(coalesce(string_agg(md5(json_build_array("id", "status")::text)');
    expect(sql).toMatch(/^SELECT count\(\*\)::int AS "rows", md5\(.*\) AS "idsHash", md5\(.*\) AS "rowsHash" FROM "WorkShift"$/);
    expect(() => tableInventorySql("WorkShift", [])).toThrow();
  });

  it("la configuración de R4.9 excluye exactamente las dos columnas nuevas y declara la tabla eliminada", () => {
    expect(R49_PENDING_MIGRATIONS_CONFIG.newColumns).toEqual({ AttendanceInactivityIncident: ["scheduledStartAt"], WorkShift: ["templateRulesSnapshot"] });
    expect(R49_PENDING_MIGRATIONS_CONFIG.droppedTables).toEqual(["ShiftRotationSlot"]);
    expect(R49_PENDING_MIGRATIONS_CONFIG.preservedTables).toEqual(expect.arrayContaining(["AttendancePunch", "WorkShift", "TimeEntry", "AttendanceInactivityIncident", "AuditLog"]));
  });
});

describe("compareInventories", () => {
  it("migración que conserva todo: ok, con la migración agregada", () => {
    const result = compareInventories(snapshot(), migrated(), config);
    expect(result).toMatchObject({ ok: true, migrationsAdded: ["20260202000000_b"], changedTables: [], previousMigrationsAltered: [] });
  });

  it("dos inventarios previos iguales (control de determinismo): datos idénticos, pero no cuenta como migración aplicada", () => {
    expect(compareInventories(snapshot(), snapshot(), config)).toMatchObject({
      ok: false,
      changedTables: [],
      migrationsAdded: [],
      previousMigrationsAltered: [],
      droppedTablesStillPresent: ["ShiftRotationSlot"],
      createdTablesMissing: ["ShiftRotationDay"],
    });
  });

  it("cualquier cambio en filas, IDs o conteo de una tabla preservada falla", () => {
    for (const change of [{ rows: 1 }, { idsHash: "x" }, { rowsHash: "x" }]) {
      const after = migrated({ tables: { ...snapshot().tables, Employee: { ...(snapshot().tables.Employee as object), ...change } as never } });
      const result = compareInventories(snapshot(), after, config);
      expect(result.ok).toBe(false);
      expect(result.changedTables.map((item) => item.table)).toEqual(["Employee"]);
    }
  });

  it("una tabla preservada que desaparece falla", () => {
    const result = compareInventories(snapshot(), migrated({ tables: { ...snapshot().tables, WorkShift: "ABSENT" } }), config);
    expect(result.ok).toBe(false);
  });

  it("una migración anterior alterada o desaparecida falla; una fallida también", () => {
    expect(compareInventories(snapshot(), migrated({ migrations: [{ name: "20260101000000_a", finished: true, rolledBack: false, checksum: "zzz" }] }), config).previousMigrationsAltered).toEqual(["20260101000000_a"]);
    expect(compareInventories(snapshot(), migrated({ migrations: [] }), config).ok).toBe(false);
    const failed = compareInventories(snapshot(), migrated({ migrations: [...migrated().migrations, { name: "20260303000000_c", finished: false, rolledBack: false, checksum: "c" }] }), config);
    expect(failed).toMatchObject({ ok: false, failedMigrationsAfter: ["20260303000000_c"] });
  });

  it("tabla eliminada con filas antes, o que sigue presente: falla", () => {
    expect(compareInventories(snapshot({ structuralTables: { ShiftRotationSlot: 3, ShiftRotationDay: "ABSENT" } }), migrated(), config).droppedTablesNotEmptyBefore).toEqual(["ShiftRotationSlot"]);
    expect(compareInventories(snapshot(), migrated({ structuralTables: { ShiftRotationSlot: 0, ShiftRotationDay: 0 } }), config).droppedTablesStillPresent).toEqual(["ShiftRotationSlot"]);
  });

  it("tabla creada ausente, columna nueva con valores (backfill no previsto) o integridad rota: falla", () => {
    expect(compareInventories(snapshot(), migrated({ structuralTables: { ShiftRotationSlot: "ABSENT", ShiftRotationDay: "ABSENT" } }), config).createdTablesMissing).toEqual(["ShiftRotationDay"]);
    expect(compareInventories(snapshot(), migrated({ newColumnValues: { "WorkShift.templateRulesSnapshot": 2 } }), config).newColumnsWithValues).toEqual(["WorkShift.templateRulesSnapshot"]);
    expect(compareInventories(snapshot(), migrated({ integrity: { notValidatedConstraints: 1 } }), config).integrityIssuesAfter).toEqual(["notValidatedConstraints"]);
  });
});

describe("migrationChecksumDrift (B1)", () => {
  it("separa checksums distintos, pendientes y aplicadas sin archivo; ignora las revertidas", () => {
    const rows = [
      { name: "a", finished: true, rolledBack: false, checksum: "1" },
      { name: "b", finished: true, rolledBack: false, checksum: "old" },
      { name: "x", finished: true, rolledBack: false, checksum: "9" },
      { name: "c", finished: true, rolledBack: true, checksum: "3" },
    ];
    expect(migrationChecksumDrift(rows, { a: "1", b: "new", c: "3", d: "4" })).toEqual({ mismatched: ["b"], pending: ["c", "d"], appliedWithoutFile: ["x"] });
  });
});
