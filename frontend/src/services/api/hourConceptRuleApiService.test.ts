import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { buildRulesByConceptPath, hourConceptRuleApiService, mapHourConceptRuleFromApi } from "./hourConceptRuleApiService";

// Etapa 14H.5: sólo el describe de más abajo (listByConcept/create/update/
// updateStatus) usa `apiRequest` de verdad — el resto de este archivo
// (mapeo puro) nunca lo invoca.
vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

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

// Etapa 14H.5: listByConcept() no tenía dedupe/cache frontend — se dispara al
// abrir "Editar" en un concepto AUTOMATIC/BOTH existente (HourConceptRulesPanel),
// un montaje fresco cada vez que StrictMode duplica en dev.
describe("hourConceptRuleApiService.listByConcept — dedupe/cache frontend (Etapa 14H.5)", () => {
  const rulesResponse = {
    data: [{ id: "rule-1", hourConceptId: "concept-1", hourConcept: { id: "concept-1", code: "HOR-001", name: "Guardia" }, startTime: "21:00", endTime: "06:00", crossesMidnight: true, status: "ACTIVO" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
  };

  beforeEach(async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("dos llamadas concurrentes con el mismo concepto generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(rulesResponse);

    const [a, b] = await Promise.all([
      hourConceptRuleApiService.listByConcept("concept-1"),
      hourConceptRuleApiService.listByConcept("concept-1"),
    ]);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(rulesResponse);

    await hourConceptRuleApiService.listByConcept("concept-1");
    await hourConceptRuleApiService.listByConcept("concept-1");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar de concepto es un cache miss nuevo", async () => {
    vi.mocked(apiRequest).mockResolvedValue(rulesResponse);

    await hourConceptRuleApiService.listByConcept("concept-1");
    await hourConceptRuleApiService.listByConcept("concept-2");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("un array vacío no lanza ni queda como cache-miss permanente — sigue siendo un empty state real", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    const result = await hourConceptRuleApiService.listByConcept("concept-1");

    expect(result).toEqual([]);
  });

  it.each([
    ["create", () => hourConceptRuleApiService.create({ hourConceptId: "concept-1", startTime: "21:00", endTime: "06:00", crossesMidnight: true, status: "ACTIVO" })],
    ["update", () => hourConceptRuleApiService.update("rule-1", { startTime: "22:00" })],
    ["updateStatus", () => hourConceptRuleApiService.updateStatus("rule-1", "INACTIVO")],
  ])("%s invalida la familia 'hour-concepts'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: rulesResponse.data[0] });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("hour-concepts", expect.any(String));
  });

  it("después de invalidar 'hour-concepts' (p. ej. tras crear una regla), listByConcept vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue(rulesResponse);
    await hourConceptRuleApiService.listByConcept("concept-1");
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("hour-concepts", "unit test");

    await hourConceptRuleApiService.listByConcept("concept-1");
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
