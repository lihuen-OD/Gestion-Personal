import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { shiftAssignmentApiService } from "./shiftAssignmentApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

describe("shiftAssignmentApiService.getSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta el resumen agregado sin descargar asignaciones", async () => {
    const data = [{ shiftTemplateId: "template-1", total: 5, enabled: 3, disabled: 2, other: 0 }];
    vi.mocked(apiRequest).mockResolvedValue({ data });

    await expect(shiftAssignmentApiService.getSummary()).resolves.toEqual(data);
    expect(apiRequest).toHaveBeenCalledWith("/shifts/assignments/summary", { apiCache: false });
  });
});

// Etapa 14H.3: getSummary() no tenía dedupe/cache frontend -- el journey
// 14H.1/14H.2 confirmó 2 requests duplicadas (StrictMode) al entrar a
// Turnos. Mismo patrón ya usado 8 veces en las series 14G/14H.2.
describe("shiftAssignmentApiService.getSummary — dedupe/cache frontend (Etapa 14H.3)", () => {
  const summaryData = [{ shiftTemplateId: "template-1", total: 5, enabled: 3, disabled: 2, other: 0 }];

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

  it("dos llamadas concurrentes generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: summaryData });

    const [a, b] = await Promise.all([shiftAssignmentApiService.getSummary(), shiftAssignmentApiService.getSummary()]);

    expect(a).toEqual(summaryData);
    expect(b).toEqual(summaryData);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: summaryData });

    await shiftAssignmentApiService.getSummary();
    await shiftAssignmentApiService.getSummary();

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["assign", () => shiftAssignmentApiService.assign({ employeeIds: ["employee-1"], shiftTemplateId: "shift-1", effectiveFrom: "2026-09-08" })],
    ["update", () => shiftAssignmentApiService.update("assignment-1", { observation: "x" })],
    ["remove", () => shiftAssignmentApiService.remove("assignment-1")],
  ])("%s invalida la familia 'workforce-config'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("workforce-config", expect.any(String));
  });

  it("después de invalidar 'workforce-config' (p. ej. tras asignar), getSummary vuelve a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: summaryData });
    await shiftAssignmentApiService.getSummary();
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await invalidateCacheFamily("workforce-config", "unit test");

    await shiftAssignmentApiService.getSummary();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});

describe("shiftAssignmentApiService — cobertura de novedades (etapa 5, NOVELTY_COVERAGE_ENGINE.md §13.7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["asignar", () => shiftAssignmentApiService.assign({ employeeIds: ["e-1"], shiftTemplateId: "t-1", effectiveFrom: "2027-03-01", weekdays: [] } as never)],
    ["editar", () => shiftAssignmentApiService.update("a-1", { weekdays: [0, 1] } as never)],
    ["quitar", () => shiftAssignmentApiService.remove("a-1")],
  ])("%s un turno invalida configuración, pantallas de horas y novedades", async (_label, run) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });
    await run();
    const families = vi.mocked(invalidateCacheFamily).mock.calls.map(([family]) => family).sort();
    expect(families).toEqual(["dashboard", "employees", "monthly-closures", "novelties", "pending", "time-entries", "workforce-config"]);
  });
});
