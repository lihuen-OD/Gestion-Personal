import { describe, expect, it } from "vitest";
import { evaluateF0, evaluateF1Shapes, g1Violations, shapeOf, type ShapeRows } from "./shapes";

const empty = (): ShapeRows => ({ Company: [], BusinessUnit: [], Establishment: [], Area: [], Sector: [], Position: [] });
const ARCHIVED = "2026-10-09T10:00:00.000Z";

// Una fila por celda de la tabla de A8 §12.3, sin archivedAt (estado de F0).
const oldRows = (): ShapeRows => ({
  Company: [{ id: "comp-1", archivedAt: null }],
  BusinessUnit: [{ id: "bu-1", companyId: "comp-1", archivedAt: null }],
  Establishment: [{ id: "est-old", zoneId: null, companyId: "comp-1", businessUnitId: "bu-1", archivedAt: null }],
  Area: [{ id: "area-old", sectorId: null, establishmentId: "est-old", archivedAt: null }],
  Sector: [{ id: "sec-old", isLegacy: true, businessUnitId: null, areaId: "area-old", archivedAt: null }],
  Position: [{ id: "pos-old", sectorId: "sec-old", activeScopes: 0, archivedAt: null }],
});
const newRows = (): ShapeRows => ({
  Company: [{ id: "comp-2", archivedAt: null }],
  BusinessUnit: [{ id: "bu-2", companyId: "comp-2", archivedAt: null }],
  Establishment: [{ id: "est-new", zoneId: "zone-1", companyId: null, businessUnitId: null, archivedAt: null }],
  Area: [{ id: "area-new", sectorId: "sec-new", establishmentId: null, archivedAt: null }],
  Sector: [{ id: "sec-new", isLegacy: false, businessUnitId: "bu-2", areaId: null, archivedAt: null }],
  Position: [{ id: "pos-new", sectorId: null, activeScopes: 2, archivedAt: null }],
});

describe("AT-2 — F0: formas transicionales SIN exigir archivedAt (§12.3)", () => {
  it("cada celda en forma vieja y en forma nueva pasa F0 con archivedAt vacío", () => {
    for (const rows of [oldRows(), newRows()]) {
      const result = evaluateF0(rows);
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    }
    expect(evaluateF0(oldRows()).counts).toMatchObject({ Establishment: { OLD: 1 }, Area: { OLD: 1 }, Sector: { OLD: 1 }, Position: { OLD: 1 } });
    expect(evaluateF0(newRows()).counts).toMatchObject({ Establishment: { NEW: 1 }, Area: { NEW: 1 }, Sector: { NEW: 1 }, Position: { NEW: 1 } });
  });

  it("F0 ignora archivedAt: una fila vieja ya archivada sigue siendo forma vieja válida", () => {
    const rows = oldRows();
    rows.Sector[0]!.archivedAt = ARCHIVED;
    expect(evaluateF0(rows).ok).toBe(true);
  });

  it.each([
    ["Establishment", { id: "est-x", zoneId: null, companyId: null, businessUnitId: null, archivedAt: null }, "huérfano"],
    ["Establishment", { id: "est-x", zoneId: "zone-1", companyId: "comp-1", businessUnitId: null, archivedAt: null }, "doble padre"],
    ["Establishment", { id: "est-x", zoneId: "zone-1", companyId: null, businessUnitId: "bu-1", archivedAt: null }, "unidad de negocio"],
    ["Area", { id: "area-x", sectorId: null, establishmentId: null, archivedAt: null }, "huérfana"],
    ["Area", { id: "area-x", sectorId: "sec-new", establishmentId: "est-old", archivedAt: null }, "doble padre"],
    ["Sector", { id: "sec-x", isLegacy: true, businessUnitId: "bu-2", areaId: null, archivedAt: null }, "G1"],
    ["Sector", { id: "sec-x", isLegacy: false, businessUnitId: null, areaId: null, archivedAt: null }, "G1"],
    ["Sector", { id: "sec-x", isLegacy: false, businessUnitId: "bu-2", areaId: "area-old", archivedAt: null }, "área del modelo anterior"],
    ["Position", { id: "pos-x", sectorId: "sec-old", activeScopes: 1, archivedAt: null }, "alcances activos"],
    ["BusinessUnit", { id: "bu-x", companyId: null, archivedAt: null }, "sin empresa"],
  ] as const)("estado mixto en %s aborta F0 con tabla + ID (%s)", (table, row, reason) => {
    const rows = empty();
    (rows[table] as unknown[]).push(row);
    const result = evaluateF0(rows);
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ table, id: row.id, code: "F0_MIXED_SHAPE", message: expect.stringContaining(reason) }));
  });

  it("G1 (F0.2): isLegacy contradice businessUnitId → violación propia además del estado mixto", () => {
    expect(g1Violations([{ id: "sec-x", isLegacy: true, businessUnitId: "bu-2", areaId: null, archivedAt: null }])).toEqual([expect.objectContaining({ table: "Sector", id: "sec-x", code: "G1_CLASSIFICATION" })]);
    expect(g1Violations(oldRows().Sector)).toEqual([]);
    expect(evaluateF0({ ...empty(), Sector: [{ id: "sec-x", isLegacy: false, businessUnitId: null, areaId: null, archivedAt: null }] }).violations.map((violation) => violation.code))
      .toEqual(["F0_MIXED_SHAPE", "G1_CLASSIFICATION"]);
  });
});

describe("AT-2 — F1.3: formas finales con archivedAt (§12.3)", () => {
  const archivedOld = (): ShapeRows => {
    const rows = oldRows();
    for (const table of ["Company", "BusinessUnit", "Establishment", "Area", "Sector", "Position"] as const) for (const row of rows[table]) row.archivedAt = ARCHIVED;
    return rows;
  };

  it("archivado con forma vieja + activo con forma nueva pasa F1", () => {
    const rows = archivedOld();
    const fresh = newRows();
    for (const table of ["Company", "BusinessUnit", "Establishment", "Area", "Sector", "Position"] as const) (rows[table] as unknown[]).push(...fresh[table]);
    expect(evaluateF1Shapes(rows)).toMatchObject({ ok: true, violations: [] });
  });

  it("fila con forma vieja y archivedAt NULL → falla (debía archivarse o borrarse)", () => {
    const result = evaluateF1Shapes(oldRows());
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => `${violation.table}:${violation.code}`)).toEqual(expect.arrayContaining([
      "Establishment:F1_ACTIVE_OLD_SHAPE", "Area:F1_ACTIVE_OLD_SHAPE", "Sector:F1_ACTIVE_OLD_SHAPE", "Position:F1_ACTIVE_OLD_SHAPE",
    ]));
  });

  it("fila con forma nueva y archivedAt NOT NULL → falla (al revés)", () => {
    const rows = newRows();
    rows.Area[0]!.archivedAt = ARCHIVED;
    rows.Establishment[0]!.archivedAt = ARCHIVED;
    expect(evaluateF1Shapes(rows).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "Area", id: "area-new", code: "F1_ARCHIVED_NEW_SHAPE" }),
      expect.objectContaining({ table: "Establishment", id: "est-new", code: "F1_ARCHIVED_NEW_SHAPE" }),
    ]));
  });

  it("Position archivada conserva el resto tal cual (también sectorId NULL heredado) pero nunca con alcances activos", () => {
    const rows = empty();
    rows.Position.push({ id: "pos-null", sectorId: null, activeScopes: 0, archivedAt: ARCHIVED });
    expect(evaluateF1Shapes(rows).ok).toBe(true);
    rows.Position.push({ id: "pos-scoped", sectorId: null, activeScopes: 1, archivedAt: ARCHIVED });
    expect(evaluateF1Shapes(rows).violations).toEqual([expect.objectContaining({ id: "pos-scoped", code: "F1_ARCHIVED_WITH_SCOPES" })]);
  });

  it("Company/BusinessUnit tienen una sola forma: archivar o no no cambia su validez de forma", () => {
    expect(shapeOf("Company", { id: "c", archivedAt: ARCHIVED }).shape).toBe("SINGLE");
    expect(evaluateF1Shapes({ ...empty(), Company: [{ id: "c", archivedAt: ARCHIVED }, { id: "d", archivedAt: null }] }).ok).toBe(true);
  });
});
