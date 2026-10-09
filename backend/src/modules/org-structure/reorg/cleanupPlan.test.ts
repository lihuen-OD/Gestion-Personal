import { describe, expect, it } from "vitest";
import { borrableIds, buildCleanupPlan, classFourOutsidePlan, classifyReference, partitionHistoryReference, retainedClosure, type FrozenInventory, type HistoryReference, type ReferenceCount, type RuleReference } from "./cleanupPlan";

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

const ref = (table: string, column: string, target: ReferenceCount["target"], rowsToInventory = 1, rowsOutsideInventory = 0, targetIds?: string[]): ReferenceCount =>
  ({ constraint: `${table}_${column}_fkey`, table, column, target, onDelete: "n", rowsToInventory, rowsOutsideInventory, ...(targetIds ? { targetIds } : {}) });

const historyRef = (source: string, target: HistoryReference["targetTable"], ids: string[], inside: string[], outside: string[] = []): HistoryReference =>
  ({ source, targetTable: target, referencedIds: ids, insideInventory: inside, outsideInventory: outside });

const rule = (overrides: Partial<RuleReference>): RuleReference =>
  ({ ruleId: "rule-1", name: "x2 Cocina", status: "ACTIVO", companyId: null, sectorId: null, positionId: null, currentPopulation: ["emp-1"], ...overrides });

describe("classifyReference", () => {
  it("vínculos de legajos y filas de vínculo tienen tratamiento autorizado", () => {
    expect(classifyReference(ref("Employee", "sectorId", "Sector", 12)).issue).toBeUndefined();
    expect(classifyReference(ref("CostCenterSector", "sectorId", "Sector", 3)).treatment).toBe("DELETE_LINKS");
  });

  it("una FK no clasificada o de un registro nuevo bloquea si tiene filas (fail closed)", () => {
    expect(classifyReference(ref("PositionOrgScope", "sectorId", "Sector", 1)).issue).toMatchObject({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", blocking: true });
  });

  it("D-5: la historia temporal nunca se trata (ni NULL ni DELETE); con §12.2 implementado queda informativa salvo el aborto C2 (§12.7)", () => {
    for (const [table, column, target] of [
      ["EmployeePositionPeriod", "positionId", "Position"],
      ["EmployeeLegacySectorPeriod", "sectorId", "Sector"],
      ["EmployeeEmployerPeriodCompany", "companyId", "Company"],
      ["PositionOrgScopePeriod", "positionId", "Position"],
      ["PositionOrgScopePeriodNode", "areaSectorId", "Sector"],
    ] as const) {
      const informative = classifyReference(ref(table, column, target, 2));
      expect(informative.issue).toMatchObject({ code: "HISTORY_REFERENCES_INVENTORY", blocking: false });
      expect(classifyReference(ref(table, column, target, 2), { historyBlocking: true }).issue).toMatchObject({ code: "HISTORY_REFERENCES_INVENTORY", blocking: true });
      expect(classifyReference(ref(table, column, target, 0)).issue).toBeUndefined();
    }
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

  it("R3 aprobada retiene el destino y sus ancestros: no se borran ni se vacían, y la referencia queda admitida para G5", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ positionId: "pos-1" })], decisions: [{ ruleId: "rule-1", treatment: "R3", approvedBy: "RRHH — acta 12" }] });
    expect(plan.blocking).toBe(false);
    expect(plan.r3References).toEqual([{ ruleId: "rule-1", column: "positionId", targetTable: "Position", targetId: "pos-1" }]);
    expect(plan.roots.r3).toEqual([{ table: "Position", id: "pos-1" }]);
    expect(plan.deletable.Position).toEqual([]);
    expect(plan.deletable.Sector).toEqual(["sec-2"]);
    expect(plan.deletable.Area).toEqual([]);
    expect(plan.deletable.Establishment).toEqual([]);
    expect(plan.deletable.BusinessUnit).toEqual([]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R3_RETAINED", blocking: false }));
  });

  it("R3 sin aprobación (approvedBy) bloquea: sólo una R3 aprobada conserva referencias hacia archivados (§12.4)", () => {
    for (const approvedBy of [undefined, "  "]) {
      const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ positionId: "pos-1" })], decisions: [{ ruleId: "rule-1", treatment: "R3", approvedBy }] });
      expect(plan.blocking).toBe(true);
      expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R3_NOT_APPROVED", blocking: true }));
      expect(plan.r3References).toEqual([]);
      expect(plan.deletable.Position).toEqual(["pos-1"]);
    }
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

describe("A8 §12.2 — contrato de raíces históricas (AT-1)", () => {
  it("partitionHistoryReference produce referencedIds exactos por fuente, ordenados y sin duplicados", () => {
    const partitioned = partitionHistoryReference("EmployeeLegacySectorPeriod.sectorId", "Sector", ["sec-2", "sec-1", "sec-2"], inventory());
    expect(partitioned.referencedIds).toEqual(["sec-1", "sec-2"]);
    expect(partitioned.insideInventory).toEqual(["sec-1", "sec-2"]);
    expect(partitioned.outsideInventory).toEqual([]);
  });

  it("partitionHistoryReference lista uno a uno los IDs fuera del inventario", () => {
    const partitioned = partitionHistoryReference("EmployeeLegacySectorPeriod.sectorId", "Sector", ["sec-9", "sec-1"], inventory());
    expect(partitioned.insideInventory).toEqual(["sec-1"]);
    expect(partitioned.outsideInventory).toEqual(["sec-9"]);
  });

  it("una fila de historia que apunta a un ID deletable lo promueve a raíz: sale de deletable y entra a retained con sus ancestros", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("EmployeeLegacySectorPeriod", "sectorId", "Sector", 1)],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeeLegacySectorPeriod.sectorId", "Sector", ["sec-1"], ["sec-1"])],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toContainEqual({ table: "Sector", id: "sec-1" });
    expect(plan.retained).toContainEqual({ table: "Area", id: "area-1" });
    expect(plan.deletable.Sector).toEqual(["sec-2"]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCES_INVENTORY", blocking: false }));
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_STILL_DELETABLE" }));
  });

  it("aserción fail-closed: si un ID referenciado por historia sigue deletable, el plan aborta con los IDs exactos", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeePositionPeriod.positionId", "Position", ["pos-1"], [])],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_STILL_DELETABLE", blocking: true, message: expect.stringContaining("pos-1") }));
  });

  it("outsideInventory bloquea SIN reconocimiento ni flag: el plan aborta con los IDs exactos", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("PositionOrgScopePeriodNode.companyId", "Company", ["comp-9"], [], ["comp-9"])],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_OUTSIDE_INVENTORY", blocking: true, ref: "PositionOrgScopePeriodNode.companyId", message: expect.stringContaining("comp-9") }));
  });

  it("un ID referenciado que el congelado ya no contiene también bloquea (defensa, sin fiarse sólo del reporte)", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeePositionPeriod.positionId", "Position", ["pos-9"], [])],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_OUTSIDE_INVENTORY", message: expect.stringContaining("pos-9") }));
  });

  it("ciclo de ampliación: el destino incorporado como borrable queda archivado y outsideInventory queda vacío", () => {
    const amplified = inventory();
    amplified.records.Sector.push({ id: "sec-9", code: "SEC-9", name: "Sector ampliado", status: "ACTIVO", parents: { Area: "area-1" } });
    const plan = buildCleanupPlan({
      inventory: amplified,
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeeLegacySectorPeriod.sectorId", "Sector", ["sec-9"], ["sec-9"])],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toContainEqual({ table: "Sector", id: "sec-9" });
    expect(plan.deletable.Sector).toEqual(["sec-1", "sec-2"]);
  });

  it("ciclo de ampliación: el destino que no cumple el criterio entra como conservada y NO se archiva ni se borra", () => {
    const amplified = inventory();
    amplified.records.Sector.push({ id: "sec-9", code: "SEC-9", name: "Sector conservado", status: "ACTIVO", parents: { Area: "area-1" }, class: "conservada" });
    const plan = buildCleanupPlan({
      inventory: amplified,
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeeLegacySectorPeriod.sectorId", "Sector", ["sec-9"], ["sec-9"])],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).not.toContainEqual({ table: "Sector", id: "sec-9" });
    expect(plan.deletable.Sector).toEqual(["sec-1", "sec-2"]);
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_OUTSIDE_INVENTORY" }));
  });
});

describe("A8 §12.7 / AT-7 — C2 condicionada por el gate archiveHistoryCompanies", () => {
  const c2WithCompanyHistory = () => ({
    inventory: inventory("C2"),
    references: [ref("EmployeeEmployerPeriodCompany", "companyId", "Company", 1)],
    rules: [],
    decisions: [],
    history: [historyRef("EmployeeEmployerPeriodCompany.companyId", "Company", ["comp-1"], ["comp-1"])],
  });

  it("comportamiento actual (gate apagado): C2 aborta con HISTORY_REFERENCES_INVENTORY y la empresa sigue deletable", () => {
    const plan = buildCleanupPlan(c2WithCompanyHistory());
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCES_INVENTORY", blocking: true }));
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_STILL_DELETABLE" }));
    expect(plan.deletable.Company).toEqual(["comp-1"]);
  });

  it("con las condiciones de §12.7 activadas: la empresa entra a retained/archivo, sale de deletable y el plan no bloquea", () => {
    const plan = buildCleanupPlan({ ...c2WithCompanyHistory(), archiveHistoryCompanies: true });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toContainEqual({ table: "Company", id: "comp-1" });
    expect(plan.deletable.Company).toEqual([]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCES_INVENTORY", blocking: false }));
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "HISTORY_REFERENCE_STILL_DELETABLE" }));
  });
});

describe("A8 §12.4 — filas clase 4: retención de destino o retiro de la fila", () => {
  it("una fila clase 4 SIN resolución bloquea con UNCLASSIFIED_OR_NEW_DEPENDENCY y los IDs exactos", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("PositionOrgScope", "businessUnitId", "BusinessUnit", 1, 0, ["bu-1"])],
      rules: [],
      decisions: [],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", blocking: true, message: expect.stringContaining("bu-1") }));
  });

  it("retirar la fila nueva (borrado autorizado) resuelve la referencia y se planifica", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("PositionOrgScope", "businessUnitId", "BusinessUnit", 1, 0, ["bu-1"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: [], retire: ["bu-1"] }],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retireRows).toEqual([{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-1"] }]);
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY" }));
  });

  it("retener el destino SIN retirar la fila no resuelve: la fila quedaría apuntando a un archivado (G5)", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("PositionOrgScope", "businessUnitId", "BusinessUnit", 1, 0, ["bu-1"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: ["bu-1"], retire: [] }],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY", message: expect.stringContaining("bu-1") }));
  });

  it("retener el destino Y retirar la fila: el destino queda archivado (raíz clase 4) y la fila se retira", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("PositionOrgScope", "businessUnitId", "BusinessUnit", 1, 0, ["bu-1"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: ["bu-1"], retire: ["bu-1"] }],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.roots.classFour).toEqual([{ table: "BusinessUnit", id: "bu-1" }]);
    expect(plan.retained).toContainEqual({ table: "BusinessUnit", id: "bu-1" });
    expect(plan.deletable.BusinessUnit).toEqual([]);
    expect(plan.retireRows).toEqual([{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-1"] }]);
  });

  it("retirar filas fuera de la familia autorizada (p. ej. dispositivos o ubicaciones) bloquea: no es borrado autorizado", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [ref("ClockDevice", "establishmentId", "Establishment", 1, 0, ["est-1"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "ClockDevice", column: "establishmentId", target: "Establishment", retain: [], retire: ["est-1"] }],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "CLASS_FOUR_RETIRE_NOT_AUTHORIZED", blocking: true }));
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "UNCLASSIFIED_OR_NEW_DEPENDENCY" }));
    expect(plan.retireRows).toEqual([]);
  });

  it("un destino fuera del inventario en una resolución clase 4 bloquea (fail closed)", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "companyId", target: "Company", retain: [], retire: ["comp-9"] }],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "CLASS_FOUR_INVALID", blocking: true, message: expect.stringContaining("comp-9 no está en el inventario congelado") }));
    expect(plan.retireRows).toEqual([]);
  });
});

describe("A8 §12.2 — clases del congelado: conservada/nueva nunca se borran, archivan ni exigen tratamiento (AT-1)", () => {
  const conserved = (id: string) => ({ ...rec(id), class: "conservada" as const });
  function c1WithConservedCompany(): FrozenInventory {
    const base = inventory("C1");
    return { ...base, records: { ...base.records, Company: [conserved("comp-1")] } };
  }

  it("C1: las empresas entran como conservada; la historia que las referencia queda DENTRO del inventario y no bloquea", () => {
    const plan = buildCleanupPlan({
      inventory: c1WithConservedCompany(),
      references: [ref("EmployeeEmployerPeriodCompany", "companyId", "Company", 0)],
      rules: [],
      decisions: [],
      history: [historyRef("EmployeeEmployerPeriodCompany.companyId", "Company", ["comp-1"], ["comp-1"])],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "COMPANIES_IN_C1" }));
    expect(plan.retained).not.toContainEqual({ table: "Company", id: "comp-1" });
    expect(plan.deletable.Company).toEqual([]);
  });

  it("C1: el cierre de ancestros de una UN retenida NO archiva la empresa conservada", () => {
    const plan = buildCleanupPlan({
      inventory: c1WithConservedCompany(),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("PositionOrgScopePeriodNode.businessUnitId", "BusinessUnit", ["bu-1"], ["bu-1"])],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toEqual([{ table: "BusinessUnit", id: "bu-1" }]);
  });

  it("C1: una regla sobre la empresa conservada no requiere decisión; una empresa BORRABLE en C1 sigue siendo un inventario inválido", () => {
    const ok = buildCleanupPlan({ inventory: c1WithConservedCompany(), references: [], rules: [rule({ companyId: "comp-1" })], decisions: [] });
    expect(ok.blocking).toBe(false);
    const bad = buildCleanupPlan({ inventory: { ...inventory("C1"), records: { ...inventory("C1").records, Company: [rec("comp-1")] } }, references: [], rules: [], decisions: [] });
    expect(bad.issues).toContainEqual(expect.objectContaining({ code: "COMPANIES_IN_C1", blocking: true }));
  });

  it("borrableIds excluye conservada/nueva (los únicos candidatos a borrar o archivar)", () => {
    const inv = c1WithConservedCompany();
    inv.records.Position.push({ ...rec("pos-new"), class: "nueva" });
    expect(borrableIds(inv)).toMatchObject({ Company: [], Position: ["pos-1"], Sector: ["sec-1", "sec-2"] });
  });
});

describe("A8 §12.7 / AT-7 — C2 con gate apagado: tampoco archiva empresas por el cierre de una raíz histórica", () => {
  it("una UN retenida por historia arrastraría su empresa → C2 aborta con HISTORY_RETAINS_COMPANY_C2", () => {
    const plan = buildCleanupPlan({
      inventory: inventory("C2"),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("PositionOrgScopePeriodNode.businessUnitId", "BusinessUnit", ["bu-1"], ["bu-1"])],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "HISTORY_RETAINS_COMPANY_C2", blocking: true, message: expect.stringContaining("comp-1") }));
  });

  it("con el gate de §12.7 activado el mismo caso archiva la empresa y no bloquea", () => {
    const plan = buildCleanupPlan({
      inventory: inventory("C2"),
      references: [],
      rules: [],
      decisions: [],
      history: [historyRef("PositionOrgScopePeriodNode.businessUnitId", "BusinessUnit", ["bu-1"], ["bu-1"])],
      archiveHistoryCompanies: true,
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toContainEqual({ table: "Company", id: "comp-1" });
  });

  it("R3 aprobada sobre una empresa en C2 (referencia de catálogo, no historia) sí la retiene y archiva sin el gate", () => {
    const plan = buildCleanupPlan({ inventory: inventory("C2"), references: [], rules: [rule({ companyId: "comp-1" })], decisions: [{ ruleId: "rule-1", treatment: "R3", approvedBy: "RRHH" }] });
    expect(plan.blocking).toBe(false);
    expect(plan.retained).toContainEqual({ table: "Company", id: "comp-1" });
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ code: "HISTORY_RETAINS_COMPANY_C2" }));
  });
});

describe("A8 §12.4 — clase 4 limitada al alcance autorizado (hallazgo de revisión)", () => {
  const scopeRef = (column: string, target: ReferenceCount["target"], targetIds: string[]) => ref("PositionOrgScope", column, target, targetIds.length, 0, targetIds);
  function c1WithConservedAndNew(): FrozenInventory {
    const base = inventory("C1");
    return {
      ...base,
      records: {
        ...base.records,
        Company: [{ ...rec("comp-1"), class: "conservada" }],
        BusinessUnit: [...base.records.BusinessUnit, { ...rec("bu-new", { Company: "comp-1" }), class: "nueva" }],
      },
    };
  }

  it("rechaza retirar alcances hacia una empresa CONSERVADA de C1 (reproducción): bloquea y no planifica ningún retiro", () => {
    const plan = buildCleanupPlan({
      inventory: c1WithConservedAndNew(),
      references: [scopeRef("companyId", "Company", ["comp-1"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "companyId", target: "Company", retain: [], retire: ["comp-1"] }],
    });
    expect(plan.blocking).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "CLASS_FOUR_INVALID", message: expect.stringContaining("comp-1 es un registro conservada") }));
    expect(plan.retireRows).toEqual([]);
  });

  it("rechaza retirar alcances hacia un registro NUEVO incorporado por ampliación", () => {
    const plan = buildCleanupPlan({
      inventory: c1WithConservedAndNew(),
      references: [scopeRef("businessUnitId", "BusinessUnit", ["bu-new"])],
      rules: [],
      decisions: [],
      classFour: [{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: [], retire: ["bu-new"] }],
    });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "CLASS_FOUR_INVALID", message: expect.stringContaining("bu-new es un registro nueva") }));
    expect(plan.retireRows).toEqual([]);
  });

  it.each([
    [{ table: "PositionOrgScope", column: "companyId", target: "Sector" as const }, "CLASS_FOUR_RETIRE_NOT_AUTHORIZED"],
    [{ table: "PositionOrgScope", column: "positionId", target: "Position" as const }, "CLASS_FOUR_RETIRE_NOT_AUTHORIZED"],
    [{ table: "EmployeeWorkLocationEstablishment", column: "establishmentId", target: "Establishment" as const }, "CLASS_FOUR_RETIRE_NOT_AUTHORIZED"],
  ])("rechaza combinaciones fuera de la lista cerrada: %o", (combination, code) => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [], decisions: [], classFour: [{ ...combination, retain: [], retire: ["sec-1"] }] });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code, blocking: true }));
    expect(plan.retireRows).toEqual([]);
  });

  it("rechaza entradas contradictorias o vacías: retener sin retirar, sin retiros, retiro sin filas", () => {
    const plan = buildCleanupPlan({
      inventory: inventory(),
      references: [scopeRef("businessUnitId", "BusinessUnit", ["bu-1"])],
      rules: [],
      decisions: [],
      classFour: [
        { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: ["bu-1"], retire: [] },
        { table: "PositionOrgScope", column: "sectorId", target: "Sector", retain: ["sec-2"], retire: ["sec-1"] },
        { table: "PositionOrgScope", column: "areaId", target: "Area", retain: [], retire: ["area-1"] },
      ],
    });
    const codes = plan.issues.filter((issue) => issue.code.startsWith("CLASS_FOUR")).map((issue) => `${issue.code}:${issue.message}`);
    expect(codes).toEqual(expect.arrayContaining([
      expect.stringContaining("CLASS_FOUR_EMPTY"),
      expect.stringMatching(/CLASS_FOUR_INVALID:.*retiene sin retirar sec-2/),
      expect.stringMatching(/CLASS_FOUR_INVALID:.*PositionOrgScope.areaId → Area: .*no hay filas/),
    ]));
    expect(plan.retireRows).toEqual([]);
    expect(plan.roots.classFour).toEqual([]);
  });

  it("dos resoluciones de la misma tabla/columna con destinos distintos se consolidan en un único retiro legítimo", () => {
    const inv = inventory();
    inv.records.BusinessUnit.push(rec("bu-2", { Company: "comp-1" }));
    const plan = buildCleanupPlan({
      inventory: inv,
      references: [scopeRef("businessUnitId", "BusinessUnit", ["bu-1", "bu-2"])],
      rules: [],
      decisions: [],
      classFour: [
        { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: [], retire: ["bu-2"] },
        { table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", retain: ["bu-1"], retire: ["bu-1"] },
      ],
    });
    expect(plan.blocking).toBe(false);
    expect(plan.retireRows).toEqual([{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-1", "bu-2"] }]);
    expect(plan.retained).toContainEqual({ table: "BusinessUnit", id: "bu-1" });
    expect(plan.deletable.BusinessUnit).toEqual(["bu-2"]);
  });

  it("validación final: un retiro hacia un ID fuera de deletable ∪ retained, o una combinación no autorizada, bloquea", () => {
    const deletable = { Company: [], BusinessUnit: ["bu-2"], Establishment: [], Area: [], Sector: [], Position: [] };
    const retained = [{ table: "BusinessUnit" as const, id: "bu-1" }];
    expect(classFourOutsidePlan([{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-1", "bu-2"] }], deletable, retained)).toEqual([]);
    expect(classFourOutsidePlan([{ table: "PositionOrgScope", column: "businessUnitId", target: "BusinessUnit", ids: ["bu-9"] }], deletable, retained))
      .toEqual([expect.objectContaining({ code: "CLASS_FOUR_RETIRE_OUTSIDE_PLAN", message: expect.stringContaining("bu-9") })]);
    expect(classFourOutsidePlan([{ table: "ClockDevice", column: "establishmentId", target: "Establishment", ids: ["x"] }], deletable, retained))
      .toEqual([expect.objectContaining({ code: "CLASS_FOUR_RETIRE_NOT_AUTHORIZED" })]);
  });
});

describe("R2 con la población del motor (hallazgo de revisión, A7)", () => {
  const population = (overrides: Partial<NonNullable<RuleReference["population"]>> = {}) => ({ date: "2026-10-09", sectorSemantics: "WITHIN" as const, candidates: "ALL_EMPLOYEES" as const, missing: [], holidayConvocations: "NOT_APPLICABLE" as const, ...overrides });

  it("historia faltante para decidir la población bloquea R2 con legajos y dimensiones; no se congela una lista parcial", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ sectorId: "sec-1", currentPopulation: ["emp-1"], population: population({ missing: [{ employeeId: "emp-9", dimensions: ["POSITION_SCOPE"] }] }) })], decisions: [{ ruleId: "rule-1", treatment: "R2" }] });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R2_POPULATION_HISTORY_MISSING", blocking: true, message: expect.stringContaining("emp-9: POSITION_SCOPE") }));
    expect(plan.ruleOperations).toEqual([]);
  });

  it("FERIADO: R2 informa que las convocatorias siguen aparte (no bloqueante) y congela la población por alcance", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ positionId: "pos-1", currentPopulation: ["emp-2", "emp-1"], population: population({ holidayConvocations: "RESOLVED_SEPARATELY" }) })], decisions: [{ ruleId: "rule-1", treatment: "R2" }] });
    expect(plan.blocking).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R2_HOLIDAY_CONVOCATIONS_SEPARATE", blocking: false }));
    expect(plan.ruleOperations).toEqual([{ ruleId: "rule-1", kind: "R2", employeeIds: ["emp-1", "emp-2"], clear: ["positionId"] }]);
  });

  it("R1 sobre sector sigue bloqueado: explica el cambio LEGACY_SECTOR → WITHIN (no la falta de D-4)", () => {
    const plan = buildCleanupPlan({ inventory: inventory(), references: [], rules: [rule({ sectorId: "sec-1" })], decisions: [{ ruleId: "rule-1", treatment: "R1", targets: { sectorId: "new-sec" } }], r1Targets: { "new-sec": { exists: true, legacyOrInventory: false } } });
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: "R1_SECTOR_REQUIRES_SEMANTICS", blocking: true, message: expect.stringContaining("WITHIN") }));
  });
});
