import { describe, expect, it } from "vitest";
import { crossesMidnightLabel, hourConceptRuleStatusLabel, hourConceptRuleStatusTone, sortHourConceptRules } from "./hourConceptRuleLabels";
import type { HourConceptRule } from "../../types/hourConceptRule.types";

function rule(overrides: Partial<HourConceptRule> = {}): HourConceptRule {
  return {
    id: "rule-1",
    hourConceptId: "concept-1",
    hourConcept: { id: "concept-1", code: "HOR-001", name: "Hora normal" },
    startTime: "07:00",
    endTime: "21:00",
    crossesMidnight: false,
    priority: 0,
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("hourConceptRuleStatusLabel / hourConceptRuleStatusTone", () => {
  it("ACTIVO -> 'Activo' / success", () => {
    expect(hourConceptRuleStatusLabel("ACTIVO")).toBe("Activo");
    expect(hourConceptRuleStatusTone("ACTIVO")).toBe("success");
  });

  it("INACTIVO -> 'Inactivo' / neutral (nunca se oculta, solo se marca)", () => {
    expect(hourConceptRuleStatusLabel("INACTIVO")).toBe("Inactivo");
    expect(hourConceptRuleStatusTone("INACTIVO")).toBe("neutral");
  });
});

describe("crossesMidnightLabel", () => {
  it("true -> 'Sí', false -> 'No'", () => {
    expect(crossesMidnightLabel(true)).toBe("Sí");
    expect(crossesMidnightLabel(false)).toBe("No");
  });
});

describe("sortHourConceptRules — mismo orden que devuelve el backend (priority desc, startTime asc)", () => {
  it("ordena por priority descendente", () => {
    const rules = [rule({ id: "a", priority: 1 }), rule({ id: "b", priority: 5 }), rule({ id: "c", priority: 0 })];
    expect(sortHourConceptRules(rules).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("con la misma priority, ordena por startTime ascendente", () => {
    const rules = [rule({ id: "a", priority: 1, startTime: "21:00" }), rule({ id: "b", priority: 1, startTime: "07:00" })];
    expect(sortHourConceptRules(rules).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("no muta el array original", () => {
    const rules = [rule({ id: "a", priority: 1 }), rule({ id: "b", priority: 5 })];
    const sorted = sortHourConceptRules(rules);
    expect(sorted).not.toBe(rules);
    expect(rules.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
