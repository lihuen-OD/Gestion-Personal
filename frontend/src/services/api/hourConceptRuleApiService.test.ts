import { describe, expect, it } from "vitest";
import { buildRulesByConceptPath, mapHourConceptRuleFromApi } from "./hourConceptRuleApiService";

describe("mapHourConceptRuleFromApi", () => {
  it("mapea una regla que no cruza medianoche, incluyendo el concepto anidado (id/code/name, nunca el nombre hardcodeado)", () => {
    const rule = mapHourConceptRuleFromApi({
      id: "rule-1",
      hourConceptId: "concept-1",
      hourConcept: { id: "concept-1", code: "HOR-001", name: "Hora normal" },
      startTime: "07:00",
      endTime: "21:00",
      crossesMidnight: false,
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
      status: "INACTIVO",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(rule.status).toBe("INACTIVO");
  });

  // Etapa 8M: response.data vacío ([]) es un concepto real sin reglas
  // todavía — .map nunca lanza sobre un array vacío, así que esto nunca
  // puede confundirse con un error real (eso lo decide el service según si
  // la promesa de apiRequest resuelve o rechaza, no el largo del array).
  it("un array vacío se mapea a un array vacío, nunca lanza ni se confunde con un error", () => {
    const rules = ([] as Parameters<typeof mapHourConceptRuleFromApi>[0][]).map(mapHourConceptRuleFromApi);
    expect(rules).toEqual([]);
  });
});

describe("buildRulesByConceptPath — endpoint real que llama listByConcept (Etapa 8M)", () => {
  it("arma exactamente /hour-concepts/:hourConceptId/rules, igual que la ruta montada en el backend", () => {
    expect(buildRulesByConceptPath("concept-abc")).toBe("/hour-concepts/concept-abc/rules");
  });

  it("usa el id real del concepto que se está editando, no uno fijo", () => {
    expect(buildRulesByConceptPath("otro-concepto-id")).toBe("/hour-concepts/otro-concepto-id/rules");
  });
});
