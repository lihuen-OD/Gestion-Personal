import { describe, expect, it } from "vitest";
import type { Period } from "../../labor-history/laborHistory.periods";
import type { EngineScopeHistory, ScopeNodeSnapshot } from "../../labor-history/laborHistory.scope";
import { SpecialHourRuleSectorIntegrityError } from "../../time-entries/specialHourRuleScope";
import { rulePopulationAt, type PopulationReader, type PopulationRule } from "./rulePopulation";

const DATE = "2026-10-09";
const open = <T>(value: T): Period<T>[] => [{ id: "period-1", effectiveFrom: "2026-01-01", effectiveTo: null, value }];
const empty = (): EngineScopeHistory => ({ position: [], costCenter: [], legacySector: [], employer: [], scopes: new Map() });
const withPosition = (positionId: string, nodes: ScopeNodeSnapshot[] | null): EngineScopeHistory => ({
  ...empty(),
  position: open(positionId),
  scopes: nodes ? new Map([[positionId, open(nodes)]]) : new Map(),
});
const sectorNode = (nodeId: string): ScopeNodeSnapshot => ({ level: "SECTOR", nodeId, areaSectorId: null });
const areaNode = (nodeId: string, areaSectorId: string): ScopeNodeSnapshot => ({ level: "AREA", nodeId, areaSectorId });

const rule = (overrides: Partial<PopulationRule>): PopulationRule => ({ id: "rule-1", name: "x2 Cocina", kind: "ESPECIAL", companyId: null, sectorId: null, costCenterId: null, positionId: null, sector: null, employees: [], ...overrides });

function reader(employeeIds: string[]): PopulationReader {
  return { employee: { findMany: async () => employeeIds.map((id) => ({ id })) } } as unknown as PopulationReader;
}
const histories = (byEmployee: Record<string, EngineScopeHistory>) => async (_db: unknown, employeeId: string, range: { fromKey: string; toKey: string }) => {
  expect(range).toEqual({ fromKey: DATE, toKey: DATE }); // historia de la fecha de congelado, no valores actuales
  return byEmployee[employeeId] ?? empty();
};

describe("población de R2 con la semántica del motor (A7)", () => {
  it("sector ANTERIOR (isLegacy persistido): LEGACY_SECTOR contra el sector anterior vigente; sin vigencia → missing", async () => {
    const population = await rulePopulationAt(reader(["e1", "e2", "e3"]), rule({ sectorId: "sec-old", sector: { isLegacy: true } }), DATE, histories({
      e1: { ...empty(), legacySector: open("sec-old") },
      e2: { ...empty(), legacySector: open("sec-other") },
    }));
    expect(population).toMatchObject({ date: DATE, sectorSemantics: "LEGACY_SECTOR", candidates: "ALL_EMPLOYEES", employeeIds: ["e1"], missing: [{ employeeId: "e3", dimensions: ["LEGACY_SECTOR"] }] });
  });

  it("sector NUEVO: WITHIN sobre los alcances del puesto — alcance de sector o de área del sector; NO alcances de empresa ni de UN", async () => {
    const population = await rulePopulationAt(reader(["e-sector", "e-area", "e-bu", "e-company", "e-other"]), rule({ sectorId: "sec-new", sector: { isLegacy: false } }), DATE, histories({
      "e-sector": withPosition("p1", [sectorNode("sec-new")]),
      "e-area": withPosition("p2", [areaNode("area-1", "sec-new")]),
      "e-bu": withPosition("p3", [{ level: "BUSINESS_UNIT", nodeId: "bu-new", areaSectorId: null }]),
      "e-company": withPosition("p4", [{ level: "COMPANY", nodeId: "comp-1", areaSectorId: null }]),
      "e-other": withPosition("p5", [sectorNode("sec-otro"), areaNode("area-2", "sec-otro")]),
    }));
    expect(population).toMatchObject({ sectorSemantics: "WITHIN", employeeIds: ["e-area", "e-sector"].sort(), missing: [] });
  });

  it("varios alcances que cumplen a la vez no duplican al legajo; un legajo sin puesto vigente no la cumple", async () => {
    const population = await rulePopulationAt(reader(["e1", "e2"]), rule({ sectorId: "sec-new", sector: { isLegacy: false } }), DATE, histories({
      e1: withPosition("p1", [sectorNode("sec-new"), areaNode("area-1", "sec-new"), areaNode("area-2", "sec-new")]),
      e2: { ...empty(), position: open(null as unknown as string) },
    }));
    expect(population.employeeIds).toEqual(["e1"]);
    expect(population.missing).toEqual([]);
  });

  it("historia faltante (puesto o alcance del puesto) se informa y no se asume pertenencia", async () => {
    const population = await rulePopulationAt(reader(["no-position", "no-scope"]), rule({ sectorId: "sec-new", sector: { isLegacy: false } }), DATE, histories({
      "no-scope": withPosition("p1", null),
    }));
    expect(population.employeeIds).toEqual([]);
    expect(population.missing).toEqual([{ employeeId: "no-position", dimensions: ["POSITION"] }, { employeeId: "no-scope", dimensions: ["POSITION_SCOPE"] }]);
  });

  it("las demás dimensiones se mantienen (AND) y una dimensión conocida que excluye gana sobre la faltante", async () => {
    const population = await rulePopulationAt(reader(["e1", "e2"]), rule({ companyId: "comp-1", positionId: "pos-1" }), DATE, histories({
      e1: { ...empty(), employer: open(["comp-1", "comp-2"]), position: open("pos-1") },
      e2: { ...empty(), position: open("pos-otro") }, // sin empleadora, pero el puesto ya excluye
    }));
    expect(population).toMatchObject({ sectorSemantics: "NONE", employeeIds: ["e1"], missing: [] });
  });

  it("la lista explícita de la regla acota los candidatos (sin duplicados) y no consulta todos los legajos", async () => {
    const all = reader(["e1", "e2", "e3"]);
    const population = await rulePopulationAt(all, rule({ positionId: "pos-1", employees: [{ employeeId: "e2" }, { employeeId: "e2" }, { employeeId: "e3" }] }), DATE, histories({
      e1: { ...empty(), position: open("pos-1") },
      e2: { ...empty(), position: open("pos-1") },
      e3: { ...empty(), position: open("pos-otro") },
    }));
    expect(population).toMatchObject({ candidates: "EXPLICIT_LIST", employeeIds: ["e2"] });
  });

  it("sector sin clasificación legible → error de integridad (nunca se deriva del padre ni se acepta la lectura incompleta)", async () => {
    await expect(rulePopulationAt(reader(["e1"]), rule({ sectorId: "sec-x", sector: null }), DATE, histories({}))).rejects.toBeInstanceOf(SpecialHourRuleSectorIntegrityError);
  });

  it("FERIADO: la población es sólo por alcance; las convocatorias quedan explícitamente aparte", async () => {
    const population = await rulePopulationAt(reader(["e1"]), rule({ kind: "FERIADO", positionId: "pos-1" }), DATE, histories({ e1: { ...empty(), position: open("pos-1") } }));
    expect(population).toMatchObject({ employeeIds: ["e1"], holidayConvocations: "RESOLVED_SEPARATELY" });
    expect((await rulePopulationAt(reader([]), rule({}), DATE, histories({}))).holidayConvocations).toBe("NOT_APPLICABLE");
  });
});
