import { describe, expect, it } from "vitest";
import { buildCleanupPlan, classifyReference, retainedClosure, type FrozenInventory, type ReferenceCount, type RuleReference } from "./cleanupPlan";

const rec = (id: string, parents: Record<string, string | null> = {}) => ({ id, code: id.toUpperCase(), name: id, status: "ACTIVO", parents });

function inventory(companyMode: "C1" | "C2" = "C1"): FrozenInventory {
  return {
    companyMode,
    records: {
      Company: companyMode === "C2" ? [rec("comp-1")] : [],
      BusinessUnit: [rec("bu-1", { Company: "comp-1" })],
      Establishment: [rec("est-1", { Company: "comp-1", BusinessUnit: "bu-1" })],
      Area: [rec("area-1", { Establishment: "est-1" })],
      Sector: [rec("sec-1", { Area: "area-1" }), rec("sec-2", { Area: "area-1" })],
      Position: [rec("pos-1", { Sector: "sec-1" })],
    },
  };
}

const ref = (table: string, column: string, target: ReferenceCount["target"], rowsToInventory = 1, rowsOutsideInventory = 0): ReferenceCount =>
  ({ constraint: `${table}_${column}_fkey`, table, column, target, onDelete: "n", rowsToInventory, rowsOutsideInventory });

const rule = (overrides: Partial<RuleReference>): RuleReference =>
  ({ ruleId: "rule-1", name: "x2 Cocina", status: "ACTIVO", companyId: null, sectorId: null, positionId: null, currentPopulation: ["emp-1"], ...overrides });

describe("classifyReference", () => {
  it("vínculos de legajos y filas de vínculo tienen tratamiento autorizado", () => {
    expect(classifyReference(ref("Employee", "sectorId", "Sector", 12)).issue).toBeUndefined();
    expect(classifyReference(ref("CostCenterSector", "sectorId", "Sector", 3)).treatment).toBe("DELETE_LINKS");
  });

  it("una FK no clasificada o de un registro nuevo bloquea si tiene filas (fail closed)", () => {
    expect(classifyReference(ref("PositionOrgScope", "sectorId", "Sector", 1)).issue).toMatchObject({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", blocking: true });
    expect(classifyReference(ref("TablaFutura", "sectorId", "Sector", 1)).issue?.blocking).toBe(true);
    expect(classifyReference(ref("TablaFutura", "sectorId", "Sector", 0)).issue).toBeUndefined();
  });

  it("la cadena interna bloquea si un registro fuera del inventario cuelga de uno a borrar", () => {
    expect(classifyReference(ref("Sector", "areaId", "Area", 2, 1)).issue).toMatchObject({ code: "OUTSIDE_RECORD_DEPENDS_ON_INVENTORY" });
  });
});

describe("buildCleanupPlan — reglas de horas especiales", () => {
  it("una regla que referencia un sector del inventario sin decisión bloquea; nunca se planifica NULL", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ sectorId: "sec-1" })], decisions: [] });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "RULE_WITHOUT_DECISION" }));
    expect(plan.ruleOperations).toEqual([]);
  });

  it("una regla sin dimensiones del inventario (p. ej. sólo centro de costo) no requiere decisión", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({})], decisions: [] });
    expect(plan.blocking).toBe(false);
  });

  it("con empresas conservadas (C1) la dimensión empresa no está en juego", () => {
    const plan = buildCleanupPlan({ inventory: inventory("C1"), references: [], rules: [rule({ companyId: "comp-1" })], decisions: [] });
    expect(plan.blocking).toBe(false);
  });

  it("con empresas eliminadas (C2) la dimensión empresa requiere decisión", () => {
    const plan = buildCleanupPlan({ inventory: inventory("C2"), references: [], rules: [rule({ companyId: "comp-1" })], decisions: [] });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "RULE_WITHOUT_DECISION" }));
  });

  it("R2 convierte la población actual en lista explícita y recién entonces quita la dimensión", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ positionId: "pos-1", currentPopulation: ["emp-2", "emp-1"] })], decisions: [{ ruleId: "rule-1", treatment: "R2" }] });
    expect(plan.blocking).toBe(false);
    expect(plan.ruleOperations).toEqual([{ ruleId: "rule-1", kind: "R2", employeeIds: ["emp-1", "emp-2"], clear: ["positionId"] }]);
  });

  it("R2 con población vacía está prohibida: quitar la dimensión ampliaría la regla a todos", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ sectorId: "sec-1", currentPopulation: [] })], decisions: [{ ruleId: "rule-1", treatment: "R2" }] });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R2_EMPTY_POPULATION", blocking: true }));
    expect(plan.ruleOperations).toEqual([]);
  });

  it("R3 retiene el destino y sus ancestros: no se borran ni se vacían", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ positionId: "pos-1" })], decisions: [{ ruleId: "rule-1", treatment: "R3" }] });
    expect(plan.blocking).toBe(false);
    expect(plan.deletable.Position).toEqual([]);
    expect(plan.deletable.Sector).toEqual(["sec-2"]);
    expect(plan.deletable.Area).toEqual([]);
    expect(plan.deletable.Establishment).toEqual([]);
    expect(plan.deletable.BusinessUnit).toEqual([]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R3_RETAINED", blocking: false }));
  });

  it("R1 sobre sector bloquea hasta que la semántica S esté implementada; exige destino nuevo existente y no legado", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [rule({ sectorId: "sec-1", positionId: "pos-1" })],
      decisions: [{ ruleId: "rule-1", treatment: "R1", targets: { sectorId: "new-sec", positionId: "old-pos" } }],
      r1Targets: { "new-sec": { exists: true, legacyOrInventory: false }, "old-pos": { exists: true, legacyOrInventory: true } },
    });
    expect(plan.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["R1_SECTOR_REQUIRES_SEMANTICS", "R1_TARGET_LEGACY", "R1_POSITION_GAP"]));
    expect(plan.blocking).toBe(true);
  });

  it("R1 sobre puesto con destino nuevo válido se planifica, con aviso de brecha hasta reasignar legajos", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [rule({ positionId: "pos-1" })],
      decisions: [{ ruleId: "rule-1", treatment: "R1", targets: { positionId: "new-pos" }, inactivate: true }],
      r1Targets: { "new-pos": { exists: true, legacyOrInventory: false } },
    });
    expect(plan.blocking).toBe(false);
    expect(plan.ruleOperations).toEqual([{ ruleId: "rule-1", kind: "R1", set: { positionId: "new-pos" } }, { ruleId: "rule-1", kind: "INACTIVATE" }]);
  });
});

describe("buildCleanupPlan — operaciones sobre referencias", () => {
  it("agrupa vaciados y borrados de vínculos por tratamiento y respeta el orden de borrado", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("Employee", "positionId", "Position"), ref("PositionSalaryCategory", "positionId", "Position"), ref("Sector", "areaId", "Area")],
      rules: [],
      decisions: [],
    });
    expect(plan.nullify).toEqual([{ table: "Employee", column: "positionId", target: "Position" }]);
    expect(plan.deleteLinks).toEqual([{ table: "PositionSalaryCategory", column: "positionId", target: "Position" }]);
    expect(plan.deleteOrder).toEqual(["Position", "Sector", "Area", "Establishment", "BusinessUnit", "Company"]);
  });

  it("retainedClosure incluye todos los ancestros legados", () => {
    const keys = [...retainedClosure(inventory("C2"), [{ table: "Position", id: "pos-1" }]).keys()];
    expect(keys).toEqual(["Position:pos-1", "Sector:sec-1", "Area:area-1", "Establishment:est-1", "BusinessUnit:bu-1", "Company:comp-1"]);
  });
});
