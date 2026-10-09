import { describe, expect, it } from "vitest";
import type { CleanupPlan, TargetTable } from "./cleanupPlan";
import { addRetiredRows, normalizeBackupRetired, restoreTableOrder, retiredCount, retiredKeys, retirementPredicates, verifyRetiredRows, type RetiredRows } from "./retirement";

const none = (): Record<TargetTable, string[]> => ({ Company: [], BusinessUnit: [], Establishment: [], Area: [], Sector: [], Position: [] });
const scope = (id: string, overrides: Record<string, unknown>) => ({ id, positionId: "pos-new", level: "BUSINESS_UNIT", companyId: null, businessUnitId: null, sectorId: null, areaId: null, createdByUserId: null, createdAt: "2026-10-01T00:00:00+00:00", ...overrides });

describe("captura consolidada por tabla + PK (hallazgo 1)", () => {
  it("dos resoluciones de la misma tabla/columna con destinos distintos: se conservan las filas de ambas", () => {
    const set: RetiredRows = {};
    expect(addRetiredRows(set, "PositionOrgScope", ["id"], [scope("ps-1", { businessUnitId: "bu-1" })])).toEqual([]);
    expect(addRetiredRows(set, "PositionOrgScope", ["id"], [scope("ps-2", { businessUnitId: "bu-2" })])).toEqual([]);
    expect(retiredKeys(set)).toEqual({ PositionOrgScope: ["ps-1", "ps-2"] });
    // Una familia sin filas no deja una tabla vacía en el respaldo.
    addRetiredRows(set, "CostCenterEstablishment", ["costCenterId", "establishmentId"], []);
    expect(Object.keys(set)).toEqual(["PositionOrgScope"]);
  });

  it("una fila alcanzada por varias resoluciones entra UNA vez; nunca se sobrescribe", () => {
    const set: RetiredRows = {};
    const row = scope("ps-1", { businessUnitId: "bu-1" });
    addRetiredRows(set, "PositionOrgScope", ["id"], [row]);
    expect(addRetiredRows(set, "PositionOrgScope", ["id"], [{ ...row }])).toEqual([]);
    expect(retiredCount(set)).toBe(1);
    // Misma PK con contenido distinto: conflicto explícito, lo capturado no cambia.
    expect(addRetiredRows(set, "PositionOrgScope", ["id"], [{ ...row, level: "SECTOR" }])).toEqual(["PositionOrgScope ps-1"]);
    expect(set.PositionOrgScope!.rows["ps-1"]).toEqual(row);
  });

  it("claves primarias compuestas", () => {
    const set: RetiredRows = {};
    addRetiredRows(set, "CostCenterSector", ["costCenterId", "sectorId"], [{ costCenterId: "cc-1", sectorId: "sec-1" }, { costCenterId: "cc-2", sectorId: "sec-1" }]);
    expect(retiredKeys(set)).toEqual({ CostCenterSector: ["cc-1|sec-1", "cc-2|sec-1"] });
    expect(addRetiredRows(set, "CostCenterSector", ["sectorId"], [{ sectorId: "sec-2" }])).toEqual([expect.stringContaining("clave primaria inconsistente")]);
  });
});

describe("predicados autorizados y verificación exacta", () => {
  const plan: Pick<CleanupPlan, "deletable" | "retained" | "deleteLinks" | "retireRows"> = {
    deletable: { ...none(), Sector: ["sec-2"], Position: ["pos-2"] },
    retained: [{ table: "Area", id: "area-1" }, { table: "BusinessUnit", id: "bu-1" }],
    deleteLinks: [{ table: "CostCenterArea", column: "areaId", target: "Area" }, { table: "CostCenterSector", column: "sectorId", target: "Sector" }],
    retireRows: [
      { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-1"] },
      { table: "ClockDevice", column: "establishmentId", target: "Establishment", ids: ["est-1"] }, // fuera de la lista cerrada: se ignora
    ],
  };
  const predicates = retirementPredicates(plan);

  it("deriva catálogo deletable, familias hacia deletable ∪ retained y sólo clase 4 autorizada", () => {
    expect(predicates).toEqual([
      { table: "Position", column: "id", ids: ["pos-2"], family: "CATALOG" },
      { table: "Sector", column: "id", ids: ["sec-2"], family: "CATALOG" },
      { table: "CostCenterArea", column: "areaId", ids: ["area-1"], family: "DELETE_LINKS" },
      { table: "CostCenterSector", column: "sectorId", ids: ["sec-2"], family: "DELETE_LINKS" },
      { table: "PositionOrgScope", column: "businessUnitId", ids: ["bu-1"], family: "CLASS_FOUR" },
    ]);
  });

  it("acepta exactamente lo que se va a retirar; detecta faltantes, sobrantes y filas fuera de los predicados", () => {
    const set: RetiredRows = {};
    addRetiredRows(set, "PositionOrgScope", ["id"], [scope("ps-1", { businessUnitId: "bu-1" })]);
    expect(verifyRetiredRows(set, predicates, { PositionOrgScope: ["ps-1"] })).toEqual([]);
    expect(verifyRetiredRows(set, predicates, { PositionOrgScope: ["ps-1", "ps-9"] })).toEqual([expect.objectContaining({ key: "ps-9", code: "RETIRE_NOT_BACKED_UP" })]);
    expect(verifyRetiredRows(set, predicates, { PositionOrgScope: [] })).toEqual([expect.objectContaining({ key: "ps-1", code: "RETIRE_BACKUP_EXTRA" })]);
    addRetiredRows(set, "PositionOrgScope", ["id"], [scope("ps-3", { level: "COMPANY", companyId: "comp-1" })]);
    expect(verifyRetiredRows(set, predicates)).toEqual([expect.objectContaining({ key: "ps-3", code: "RETIRE_ROW_NOT_AUTHORIZED" })]);
    addRetiredRows(set, "ClockDevice", ["id"], [{ id: "dev-1", establishmentId: "est-1" }]);
    expect(verifyRetiredRows(set, predicates)).toContainEqual(expect.objectContaining({ table: "ClockDevice", code: "RETIRE_TABLE_NOT_AUTHORIZED" }));
  });
});

describe("restauración: cada fila una sola vez, en orden, con compatibilidad de formato", () => {
  const preManifest = { tables: { PositionOrgScope: { key: ["id"], columns: [], rows: {} }, Sector: { key: ["id"], columns: [], rows: {} }, CostCenterSector: { key: ["costCenterId", "sectorId"], columns: [], rows: {} } } };

  it("formato 2 se usa tal cual", () => {
    const retired: RetiredRows = {};
    addRetiredRows(retired, "Sector", ["id"], [{ id: "sec-2" }]);
    expect(normalizeBackupRetired({ format: 2, retired, preManifest })).toBe(retired);
    expect(() => normalizeBackupRetired({ format: 7, preManifest })).toThrow("no soportado");
  });

  it("formato 1 (claves Tabla.columna): una fila repetida en dos columnas se consolida en una; IDs y contenido completos", () => {
    const row = scope("ps-1", { businessUnitId: "bu-1" });
    const normalized = normalizeBackupRetired({
      preManifest,
      deleted: {
        Sector: [{ id: "sec-2", name: "Limpieza" }],
        "PositionOrgScope.businessUnitId": [row],
        "PositionOrgScope.companyId": [{ ...row }, scope("ps-2", { level: "COMPANY", companyId: "comp-1" })],
        "CostCenterSector.sectorId": [{ costCenterId: "cc-1", sectorId: "sec-2" }],
      },
    });
    expect(retiredKeys(normalized)).toEqual({ Sector: ["sec-2"], PositionOrgScope: ["ps-1", "ps-2"], CostCenterSector: ["cc-1|sec-2"] });
    expect(normalized.PositionOrgScope!.rows["ps-1"]).toEqual(row);
    expect(retiredCount(normalized)).toBe(4);
  });

  it("formato 1 con la misma PK y contenido distinto aborta", () => {
    expect(() => normalizeBackupRetired({ preManifest, deleted: { "PositionOrgScope.businessUnitId": [scope("ps-1", {})], "PositionOrgScope.companyId": [scope("ps-1", { level: "COMPANY" })] } })).toThrow("inconsistente");
  });

  it("orden: catálogo de padres a hijos y después vínculos", () => {
    expect(restoreTableOrder(["PositionOrgScope", "Position", "CostCenterSector", "Sector", "BusinessUnit"])).toEqual(["BusinessUnit", "Sector", "Position", "CostCenterSector", "PositionOrgScope"]);
  });
});
