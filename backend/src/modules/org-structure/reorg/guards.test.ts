import { describe, expect, it } from "vitest";
import { buildCleanupPlan, type FrozenInventory, type HistoryReference, type TargetTable } from "./cleanupPlan";
import { compareHistorySnapshots, normalizeSnapshotRow, evaluateG3, evaluateG4, evaluateG5, evaluateG6, evaluateG7, evaluateG8, evaluateG9, HISTORY_TABLES, SHAPE_CHECK_CONSTRAINTS, type ArchivedLink, type HistorySnapshot } from "./guards";

const none = (): Record<TargetTable, string[]> => ({ Company: [], BusinessUnit: [], Establishment: [], Area: [], Sector: [], Position: [] });
const rec = (id: string, parents: Record<string, string | null> = {}) => ({ id, code: id.toUpperCase(), name: id, status: "ACTIVO", parents });

const inventory: FrozenInventory = {
  companyMode: "C1",
  records: {
    Company: [],
    BusinessUnit: [rec("bu-1", { Company: "comp-1" })],
    Establishment: [rec("est-1", { Company: "comp-1", BusinessUnit: "bu-1" })],
    Area: [rec("area-1", { Establishment: "est-1" })],
    Sector: [rec("sec-1", { Area: "area-1" }), rec("sec-2", { Area: "area-1" })],
    Position: [rec("pos-1", { Sector: "sec-1" }), rec("pos-2", { Sector: "sec-2" })],
  },
};
const history: HistoryReference[] = [{ source: "EmployeePositionPeriod.positionId", targetTable: "Position", referencedIds: ["pos-1"], insideInventory: ["pos-1"], outsideInventory: [] }];

describe("AT-5 — el plan produce retained = raíces + cierre; G3/G4 sobre el resultado aplicado", () => {
  const plan = buildCleanupPlan({ inventory, references: [], rules: [], decisions: [], history });

  it("retained = raíz histórica + ancestros; deletable = el resto", () => {
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toEqual([
      { table: "Position", id: "pos-1" }, { table: "Sector", id: "sec-1" }, { table: "Area", id: "area-1" },
      { table: "Establishment", id: "est-1" }, { table: "BusinessUnit", id: "bu-1" },
    ]);
    expect(plan.deletable).toMatchObject({ Position: ["pos-2"], Sector: ["sec-2"], Area: [], Establishment: [], BusinessUnit: [] });
  });

  it("aplicado el marcado exacto: G4 diferencia simétrica 0 y G3 sin eliminables presentes (F1.1-F1.2 verdes)", () => {
    const archived = { ...none(), Position: ["pos-1"], Sector: ["sec-1"], Area: ["area-1"], Establishment: ["est-1"], BusinessUnit: ["bu-1"] };
    const present = { ...archived };
    expect(evaluateG4(plan.retained, archived)).toMatchObject({ ok: true, detail: { missing: {}, unexpected: {} } });
    expect(evaluateG3(plan.deletable, present)).toMatchObject({ ok: true });
  });

  it("archivo distinto de retained → G4 falla con faltantes y sobrantes por tabla (F1.1)", () => {
    const archived = { ...none(), Position: ["pos-1", "pos-2"], Sector: ["sec-1"], Area: ["area-1"], Establishment: ["est-1"] };
    expect(evaluateG4(plan.retained, archived)).toMatchObject({ ok: false, detail: { missing: { BusinessUnit: ["bu-1"] }, unexpected: { Position: ["pos-2"] } } });
  });

  it("un ID eliminable todavía presente → G3 falla (F1.2)", () => {
    expect(evaluateG3(plan.deletable, { ...none(), Sector: ["sec-1", "sec-2"] })).toMatchObject({ ok: false, detail: { stillPresent: { Sector: ["sec-2"] } } });
  });
});

describe("G5 — vínculos activos hacia archivados", () => {
  const link = (overrides: Partial<ArchivedLink>): ArchivedLink => ({ table: "Employee", column: "positionId", target: "Position", key: "emp-1", targetId: "pos-1", sourceArchived: false, ...overrides });

  it("la propia fila archivada (FK vieja tal cual) se admite; una fila activa hacia un archivado no", () => {
    const result = evaluateG5([
      link({ table: "Sector", column: "areaId", target: "Area", key: "sec-1", targetId: "area-1", sourceArchived: true }),
      link({}),
      link({ table: "BusinessUnit", column: "companyId", target: "Company", key: "bu-new", targetId: "comp-arch", sourceArchived: false }),
    ], []);
    expect(result.ok).toBe(false);
    expect((result.detail as { violations: ArchivedLink[] }).violations.map((violation) => violation.key)).toEqual(["emp-1", "bu-new"]);
  });

  it("DoubleHourRule sólo se admite con R3 aprobada hacia ESE destino y ESA columna (AT-4)", () => {
    const r3 = [{ ruleId: "rule-1", column: "positionId" as const, targetTable: "Position" as const, targetId: "pos-1" }];
    expect(evaluateG5([link({ table: "DoubleHourRule", key: "rule-1" })], r3).ok).toBe(true);
    expect(evaluateG5([link({ table: "DoubleHourRule", key: "rule-2" })], r3).ok).toBe(false);
    expect(evaluateG5([link({ table: "DoubleHourRule", key: "rule-1", column: "sectorId", target: "Sector", targetId: "sec-1" })], r3).ok).toBe(false);
  });

  it("una fila no archivada de las seis tablas no se ampara en `sourceArchived=false`, ni una tabla ajena en `sourceArchived=true`", () => {
    expect(evaluateG5([link({ table: "ClockDevice", column: "establishmentId", target: "Establishment", sourceArchived: true })], []).ok).toBe(false);
  });
});

describe("AT-6 — G7: comparación profunda de las siete tablas de historia (§12.6)", () => {
  const snapshot = (): HistorySnapshot => Object.fromEntries(HISTORY_TABLES.map((table) => [table, { key: ["id"], rows: [] as Array<Record<string, unknown>> }]));
  const withRow = () => {
    const snap = snapshot();
    snap.EmployeeLegacySectorPeriod!.rows.push({ id: "h1", employeeId: "emp-1", sectorId: "sec-1", effectiveFrom: "2026-01-01", effectiveTo: null, reason: "Alta", createdByUserId: "u1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
    return snap;
  };

  it("sin alteraciones → diff 0", () => {
    expect(evaluateG7(withRow(), withRow())).toMatchObject({ ok: true, detail: { diffs: [] } });
  });

  it("alterar una celda (también updatedAt) → falla indicando tabla/fila/columna", () => {
    const after = withRow();
    after.EmployeeLegacySectorPeriod!.rows[0]!.updatedAt = "2026-10-09T00:00:00Z";
    expect(compareHistorySnapshots(withRow(), after)).toEqual([{ table: "EmployeeLegacySectorPeriod", key: "h1", column: "updatedAt", kind: "CELL_CHANGED", before: "2026-01-01T00:00:00Z", after: "2026-10-09T00:00:00Z" }]);
  });

  it("una fila perdida o agregada, o una tabla faltante, falla", () => {
    const lost = withRow();
    lost.EmployeeLegacySectorPeriod!.rows = [];
    expect(compareHistorySnapshots(withRow(), lost)).toEqual([{ table: "EmployeeLegacySectorPeriod", key: "h1", kind: "ROW_MISSING" }]);
    expect(compareHistorySnapshots(snapshot(), withRow())).toEqual([{ table: "EmployeeLegacySectorPeriod", key: "h1", kind: "ROW_ADDED" }]);
    const missingTable = withRow();
    delete missingTable.PositionOrgScopePeriodNode;
    expect(compareHistorySnapshots(withRow(), missingTable)).toEqual([{ table: "PositionOrgScopePeriodNode", kind: "TABLE_MISSING" }]);
  });

  it("los TIMESTAMPTZ se normalizan a UTC (la zona de la sesión no genera diferencias); las fechas de calendario no se tocan", () => {
    expect(normalizeSnapshotRow({ updatedAt: "2025-12-31T21:00:00-03:00", effectiveFrom: "2026-01-01", reason: "Alta 10:00" }))
      .toEqual({ updatedAt: "2026-01-01T00:00:00.000Z", effectiveFrom: "2026-01-01", reason: "Alta 10:00" });
    expect(normalizeSnapshotRow({ createdAt: "2026-10-09T07:38:57.492+00:00" })).toEqual({ createdAt: "2026-10-09T07:38:57.492Z" });
  });

  it("claves compuestas se comparan por todas las columnas de la PK", () => {
    const before = snapshot();
    before.EmployeeEmployerPeriodCompany = { key: ["periodId", "companyId"], rows: [{ periodId: "p1", companyId: "c1" }, { periodId: "p1", companyId: "c2" }] };
    const after = snapshot();
    after.EmployeeEmployerPeriodCompany = { key: ["periodId", "companyId"], rows: [{ periodId: "p1", companyId: "c1" }, { periodId: "p1", companyId: "c3" }] };
    expect(compareHistorySnapshots(before, after)).toEqual([
      { table: "EmployeeEmployerPeriodCompany", key: "p1|c2", kind: "ROW_MISSING" },
      { table: "EmployeeEmployerPeriodCompany", key: "p1|c3", kind: "ROW_ADDED" },
    ]);
  });
});

describe("G8 — raíces históricas sin bypass", () => {
  it("outsideInventory ≠ ∅ falla con los IDs exactos por fuente", () => {
    const result = evaluateG8([{ ...history[0]!, referencedIds: ["pos-1", "pos-9"], outsideInventory: ["pos-9"] }], none());
    expect(result).toMatchObject({ ok: false, detail: { outsideInventory: { "EmployeePositionPeriod.positionId": ["pos-9"] } } });
  });

  it("un ID referenciado por historia (congelado o vivo) dentro de deletable falla", () => {
    expect(evaluateG8(history, { ...none(), Position: ["pos-1"] })).toMatchObject({ ok: false, detail: { referencedDeletable: ["EmployeePositionPeriod.positionId:pos-1"] } });
    expect(evaluateG8([], { ...none(), Sector: ["sec-2"] }, { Sector: ["sec-2"] })).toMatchObject({ ok: false, detail: { referencedDeletable: ["Sector:sec-2"] } });
    expect(evaluateG8(history, { ...none(), Position: ["pos-2"] }, { Position: ["pos-1"] }).ok).toBe(true);
  });
});

describe("G6 / G9", () => {
  it("G6 exige los tres CHECKs de forma con su nombre, validados, y migrate diff vacío", () => {
    const all = SHAPE_CHECK_CONSTRAINTS.map((check) => ({ table: check.table, name: check.name, validated: true }));
    expect(evaluateG6(all, true).ok).toBe(true);
    expect(evaluateG6(all.slice(1), true)).toMatchObject({ ok: false, detail: { missing: ["Sector_archive_shape_check"] } });
    expect(evaluateG6(all.map((check, index) => ({ ...check, validated: index !== 0 })), true)).toMatchObject({ ok: false, detail: { notValidated: ["Sector_archive_shape_check"] } });
    expect(evaluateG6(all, false).ok).toBe(false);
    expect(evaluateG6(all, null).ok).toBe(false);
  });

  it("G9 exige un índice de Employee encabezado por status y adjunta los planes", () => {
    const plans = { employeesByStatus: [{ Plan: { "Node Type": "Index Scan" } }] };
    expect(evaluateG9([{ table: "Employee", name: "Employee_status_idx", columns: ["status"] }], plans)).toMatchObject({ ok: true, detail: { plans } });
    expect(evaluateG9([{ table: "Employee", name: "Employee_lastName_idx", columns: ["lastName", "status"] }], plans).ok).toBe(false);
  });
});
