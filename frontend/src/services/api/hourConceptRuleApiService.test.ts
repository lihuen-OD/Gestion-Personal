import { describe, expect, it } from "vitest";
import { mapHourConceptRuleFromApi } from "./hourConceptRuleApiService";

describe("mapHourConceptRuleFromApi", () => {
  it("mapea una regla que no cruza medianoche, incluyendo el concepto anidado (id/code/name, nunca el nombre hardcodeado)", () => {
    const rule = mapHourConceptRuleFromApi({
      id: "rule-1",
      hourConceptId: "concept-1",
      hourConcept: { id: "concept-1", code: "HOR-001", name: "Hora normal" },
      startTime: "07:00",
      endTime: "21:00",
      crossesMidnight: false,
      priority: 1,
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rule).toEqual({
      id: "rule-1",
      hourConceptId: "concept-1",
      hourConcept: { id: "concept-1", code: "HOR-001", name: "Hora normal" },
      startTime: "07:00",
      endTime: "21:00",
      crossesMidnight: false,
      priority: 1,
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("mapea una regla que cruza medianoche (21:00 a 04:00) preservando crossesMidnight", () => {
    const rule = mapHourConceptRuleFromApi({
      id: "rule-2",
      hourConceptId: "concept-2",
      hourConcept: { id: "concept-2", code: "HOR-002", name: "Guardia" },
      startTime: "21:00",
      endTime: "04:00",
      crossesMidnight: true,
      priority: 1,
      status: "ACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rule.crossesMidnight).toBe(true);
    expect(rule.startTime).toBe("21:00");
    expect(rule.endTime).toBe("04:00");
  });

  it("mapea una regla inactiva conservando su status, sin ocultarla", () => {
    const rule = mapHourConceptRuleFromApi({
      id: "rule-3",
      hourConceptId: "concept-1",
      hourConcept: { id: "concept-1", code: "HOR-001", name: "Hora normal" },
      startTime: "07:00",
      endTime: "15:00",
      crossesMidnight: false,
      priority: 0,
      status: "INACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rule.status).toBe("INACTIVO");
  });
});
