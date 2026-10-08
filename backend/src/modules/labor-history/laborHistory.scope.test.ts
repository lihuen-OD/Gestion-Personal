import { describe, expect, it } from "vitest";
import type { Period } from "./laborHistory.periods";
import { evaluateRuleScope, type EngineScopeHistory, type RuleScope, type ScopeNodeSnapshot } from "./laborHistory.scope";

const open = <V>(effectiveFrom: string, value: V, effectiveTo: string | null = null): Period<V> => ({ id: `${effectiveFrom}`, effectiveFrom, effectiveTo, value });
const rule = (overrides: Partial<RuleScope>): RuleScope => ({ companyId: null, sectorId: null, sectorIsLegacy: false, costCenterId: null, positionId: null, ...overrides });
const history = (overrides: Partial<EngineScopeHistory> = {}): EngineScopeHistory => ({ position: [], costCenter: [], legacySector: [], employer: [], scopes: new Map(), ...overrides });

describe("evaluateRuleScope — alcance de una regla con la historia de ESE día (D-4/D-5)", () => {
  it("una regla sin dimensiones no necesita historia", () => {
    expect(evaluateRuleScope(rule({}), history(), "2026-10-04")).toEqual({ kind: "MATCH" });
  });

  it("empresa = empresa EMPLEADORA vigente ese día; antes y después de un cambio", () => {
    const h = history({ employer: [open("2026-01-01", ["losod"], "2026-09-30"), open("2026-10-01", ["tropa"])] });
    expect(evaluateRuleScope(rule({ companyId: "losod" }), h, "2026-09-27")).toEqual({ kind: "MATCH" });
    expect(evaluateRuleScope(rule({ companyId: "losod" }), h, "2026-10-04")).toEqual({ kind: "NO_MATCH" });
  });

  it("varias empresas empleadoras: alcanza si alguna coincide (semántica de EmployeeCompany)", () => {
    expect(evaluateRuleScope(rule({ companyId: "tropa" }), history({ employer: [open("2026-01-01", ["losod", "tropa"])] }), "2026-03-01")).toEqual({ kind: "MATCH" });
  });

  it("sin vigencia ese día falta evidencia: MISSING, nunca el valor actual", () => {
    const h = history({ employer: [open("2026-10-01", ["losod"])] });
    expect(evaluateRuleScope(rule({ companyId: "losod" }), h, "2026-09-27")).toEqual({ kind: "MISSING", dimensions: ["EMPLOYER"] });
  });

  it("una dimensión conocida que ya excluye decide aunque otra no tenga historia", () => {
    const h = history({ costCenter: [open("2026-01-01", "cc-otro")] });
    expect(evaluateRuleScope(rule({ companyId: "losod", costCenterId: "cc-1" }), h, "2026-05-01")).toEqual({ kind: "NO_MATCH" });
  });

  it("centro de costo y puesto vigentes ese día", () => {
    const h = history({ costCenter: [open("2026-01-01", "cc-1")], position: [open("2026-01-01", "pos-a", "2026-06-30"), open("2026-07-01", "pos-b")] });
    expect(evaluateRuleScope(rule({ costCenterId: "cc-1", positionId: "pos-a" }), h, "2026-06-30")).toEqual({ kind: "MATCH" });
    expect(evaluateRuleScope(rule({ costCenterId: "cc-1", positionId: "pos-a" }), h, "2026-07-01")).toEqual({ kind: "NO_MATCH" });
  });

  it("sector ANTERIOR: compara el sector anterior vigente ese día", () => {
    expect(evaluateRuleScope(rule({ sectorId: "sec-old", sectorIsLegacy: true }), history({ legacySector: [open("2026-01-01", "sec-old")] }), "2026-02-01")).toEqual({ kind: "MATCH" });
    expect(evaluateRuleScope(rule({ sectorId: "sec-old", sectorIsLegacy: true }), history({ legacySector: [open("2026-01-01", null)] }), "2026-02-01")).toEqual({ kind: "NO_MATCH" });
    expect(evaluateRuleScope(rule({ sectorId: "sec-old", sectorIsLegacy: true }), history(), "2026-02-01")).toEqual({ kind: "MISSING", dimensions: ["LEGACY_SECTOR"] });
  });

  describe("sector NUEVO — “Ubicado dentro de” con el alcance del puesto vigente ese día", () => {
    const nodes = (...items: ScopeNodeSnapshot[]) => items;
    const shared = history({
      position: [open("2026-01-01", "pos-shared")],
      scopes: new Map([["pos-shared", [
        open("2026-01-01", nodes({ level: "SECTOR", nodeId: "agro", areaSectorId: null }), "2026-09-30"),
        open("2026-10-01", nodes({ level: "AREA", nodeId: "riego", areaSectorId: "ganaderia" })),
      ]]]),
    });

    it("cambio del alcance de un puesto compartido: antes alcanza Agricultura, después Ganadería (por el sector padre REGISTRADO del área)", () => {
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), shared, "2026-09-30")).toEqual({ kind: "MATCH" });
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), shared, "2026-10-01")).toEqual({ kind: "NO_MATCH" });
      expect(evaluateRuleScope(rule({ sectorId: "ganaderia" }), shared, "2026-10-01")).toEqual({ kind: "MATCH" });
    });

    it("un alcance de empresa o UN no hereda reglas sectoriales", () => {
      const h = history({ position: [open("2026-01-01", "pos-dir")], scopes: new Map([["pos-dir", [open("2026-01-01", nodes({ level: "COMPANY", nodeId: "losod", areaSectorId: null }))]]]) });
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), h, "2026-05-01")).toEqual({ kind: "NO_MATCH" });
    });

    it("sin puesto ese día (dato conocido) no alcanza; sin vigencia de puesto o de alcance, falta evidencia", () => {
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), history({ position: [open("2026-01-01", null)] }), "2026-05-01")).toEqual({ kind: "NO_MATCH" });
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), history(), "2026-05-01")).toEqual({ kind: "MISSING", dimensions: ["POSITION"] });
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), shared, "2025-12-31")).toEqual({ kind: "MISSING", dimensions: ["POSITION"] });
      const noScope = history({ position: [open("2026-01-01", "pos-x")] });
      expect(evaluateRuleScope(rule({ sectorId: "agro" }), noScope, "2026-05-01")).toEqual({ kind: "MISSING", dimensions: ["POSITION_SCOPE"] });
    });
  });
});
