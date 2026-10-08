import { describe, expect, it } from "vitest";
import { compareEnginePairResults, engineOutcomeLabel, groupEnginePairs, normalizeMatchedRules, reportCoverage, shapeEngineEvaluation, type EnginePairResult } from "./specialHourEvidence";

const pair = (id: string, day: string) => `${id}|${day}`;

function result(overrides: Partial<EnginePairResult> = {}): EnginePairResult {
  return {
    label: "1.5:rule-1",
    multiplier: 1.5,
    winners: ["rule-1"],
    matchedRules: [{ id: "rule-1", name: "Doble por feriado" }],
    conflicting: false,
    missingHistory: null,
    ...overrides,
  };
}

describe("groupEnginePairs", () => {
  it("agrupa fechas por legajo sin duplicar el par", () => {
    const groups = groupEnginePairs([pair("emp-1", "2026-05-01"), pair("emp-1", "2026-05-02"), pair("emp-2", "2026-05-01")]);
    expect(groups.get("emp-1")).toEqual(new Set(["2026-05-01", "2026-05-02"]));
    expect(groups.get("emp-2")).toEqual(new Set(["2026-05-01"]));
  });

  it("rechaza pares employeeId|fecha duplicados antes de agrupar", () => {
    expect(() => groupEnginePairs([pair("emp-1", "2026-05-01"), pair("emp-1", "2026-05-01")])).toThrow(/duplicados/i);
  });

  it("rechaza un par con formato inválido y una fecha que no es YYYY-MM-DD", () => {
    expect(() => groupEnginePairs(["emp-1"])).toThrow(/inválido/i);
    expect(() => groupEnginePairs([pair("emp-1", "01/05/2026")])).toThrow(/fecha inválida/i);
  });
});

describe("reportCoverage", () => {
  it("ok cuando los pares únicos y las claves de resultado coinciden", () => {
    const coverage = reportCoverage(
      [pair("emp-1", "2026-05-01"), pair("emp-2", "2026-05-01")],
      [pair("emp-1", "2026-05-01"), pair("emp-2", "2026-05-01")],
    );
    expect(coverage).toMatchObject({ uniquePairs: 2, resultKeys: 2, missingPairs: [], unexpectedKeys: [], ok: true });
  });

  it("reporta el par sin resultado", () => {
    const coverage = reportCoverage([pair("emp-1", "2026-05-01"), pair("emp-2", "2026-05-01")], [pair("emp-1", "2026-05-01")]);
    expect(coverage.ok).toBe(false);
    expect(coverage.missingPairs).toEqual([pair("emp-2", "2026-05-01")]);
  });

  it("reporta la clave de resultado que no corresponde a ningún par", () => {
    const coverage = reportCoverage([pair("emp-1", "2026-05-01")], [pair("emp-1", "2026-05-01"), pair("emp-9", "2026-05-01")]);
    expect(coverage.ok).toBe(false);
    expect(coverage.unexpectedKeys).toEqual([pair("emp-9", "2026-05-01")]);
  });

  it("detecta el desajuste de cantidad aunque no sobre ni falte una clave", () => {
    const coverage = reportCoverage([pair("emp-1", "2026-05-01")], [pair("emp-1", "2026-05-01"), pair("emp-1", "2026-05-01")]);
    expect(coverage.uniquePairs).toBe(1);
    expect(coverage.resultKeys).toBe(2);
    expect(coverage.ok).toBe(false);
  });
});

describe("compareEnginePairResults", () => {
  it("considera igual lo idéntico y con el orden distinto de matchedRules", () => {
    const before = result({ matchedRules: [{ id: "rule-1", name: "A" }, { id: "rule-2", name: "B" }] });
    const after = result({ matchedRules: [{ id: "rule-2", name: "B" }, { id: "rule-1", name: "A" }] });
    expect(compareEnginePairResults(before, after)).toEqual({ equal: true, detail: [] });
  });

  it("trata un cambio de nombre de la misma regla como diferencia visible", () => {
    const outcome = compareEnginePairResults(result(), result({ matchedRules: [{ id: "rule-1", name: "Doble por feriado (editado)" }] }));
    expect(outcome.equal).toBe(false);
    expect(outcome.detail.join(" ")).toContain("matchedRules");
    expect(outcome.detail.join(" ")).toContain("Doble por feriado (editado)");
  });

  it("trata un id distinto en matchedRules como diferencia", () => {
    const outcome = compareEnginePairResults(result(), result({ matchedRules: [{ id: "rule-2", name: "Doble por feriado" }] }));
    expect(outcome.equal).toBe(false);
    expect(outcome.detail.join(" ")).toContain("matchedRules");
    expect(outcome.detail.join(" ")).toContain("rule-2");
  });

  it("reporta cambios de etiqueta, multiplicador, ganadoras y conflicto", () => {
    const outcome = compareEnginePairResults(result(), result({ label: "2:rule-1", multiplier: 2, winners: ["rule-2"], conflicting: true }));
    expect(outcome.equal).toBe(false);
    expect(outcome.detail.join(" ")).toContain("label");
    expect(outcome.detail.join(" ")).toContain("multiplier");
    expect(outcome.detail.join(" ")).toContain("winners");
    expect(outcome.detail.join(" ")).toContain("conflicting");
  });

  it("MISSING igual antes y después sigue siendo igual", () => {
    const missing = result({ label: "MISSING:HOLIDAY+NORMAL:rule-1", multiplier: null, winners: [], matchedRules: [], missingHistory: { dimensions: ["HOLIDAY", "NORMAL"], ruleId: "rule-1", ruleName: "Base" } });
    expect(compareEnginePairResults(missing, missing)).toEqual({ equal: true, detail: [] });
  });
});

describe("engineOutcomeLabel / shapeEngineEvaluation / normalizeMatchedRules", () => {
  it("etiqueta el formato D5 y ordena dimensiones y ganadoras", () => {
    const shaped = shapeEngineEvaluation({
      resolution: { multiplier: 1.5, winners: [{ id: "b" }, { id: "a" }], matchedRules: [{ id: "z", name: "Z" }, { id: "a", name: "A" }] },
    });
    expect(shaped.label).toBe("1.5:a,b");
    expect(engineOutcomeLabel({ missingHistory: { dimensions: ["NORMAL", "HOLIDAY"], ruleId: "rule-1" } })).toBe("MISSING:HOLIDAY+NORMAL:rule-1");
    expect(shaped.matchedRules.map((rule) => rule.id)).toEqual(["a", "z"]);
    expect(normalizeMatchedRules([])).toEqual([]);
  });
});
