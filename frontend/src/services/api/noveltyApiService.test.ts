import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { mapNoveltyFromApi, noveltyApiService, NOVELTY_DEPENDENT_CACHE_FAMILIES } from "./noveltyApiService";
import { invalidateCacheFamily, NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES, WORKED_TIME_DERIVED_CACHE_FAMILIES } from "../cache";

vi.mock("./apiClient", async (importOriginal) => ({ ...(await importOriginal<typeof import("./apiClient")>()), apiRequest: vi.fn() }));
vi.mock("../cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cache")>()), invalidateCacheFamily: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

// Etapa 4 de cobertura: las mutaciones de novedades invalidan todas las
// familias con contabilidad de horas, además de las novedades.
describe("noveltyApiService — invalidación de cachés", () => {
  it("incluye todas las familias derivadas de horas y la de novedades", () => {
    expect(NOVELTY_DEPENDENT_CACHE_FAMILIES).toEqual(expect.arrayContaining([...WORKED_TIME_DERIVED_CACHE_FAMILIES, "novelties"]));
    expect(NOVELTY_DEPENDENT_CACHE_FAMILIES).toEqual(expect.arrayContaining(["pending", "monthly-closures", "employees", "dashboard", "time-entries"]));
  });
});

describe("noveltyApiService — resolución diaria de cobertura", () => {
  const resolvedDay = {
    date: "2026-11-16", outcome: "COVERED" as const, scheduleReviewReason: null, reviewStatus: "RESOLVED" as const,
    label: "Cobertura resuelta", expectedMinutes: 480, baseMinutes: 240, resolution: "SET_BASE_MINUTES" as const,
    resolvedBaseMinutes: 180, effectiveBaseMinutes: 180, multiplier: 2, computedMinutes: 360, countsTowardTotal: true,
  };

  it("envía endpoint y payload exactos e invalida todas las familias derivadas", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: resolvedDay });
    const input = { resolution: "SET_BASE_MINUTES" as const, baseMinutes: 180, note: "Confirmado por supervisión", correctionReason: "Confirmado por supervisión" };

    await expect(noveltyApiService.resolveCoverageDay("novelty-1", "2026-11-16", input)).resolves.toEqual(resolvedDay);

    expect(apiRequest).toHaveBeenCalledWith("/novelties/novelty-1/coverage-days/2026-11-16/resolution", { method: "POST", body: input });
    expect(vi.mocked(invalidateCacheFamily).mock.calls.map(([family]) => family).sort()).toEqual([...NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES].sort());
  });

  it("propaga el error del backend y no invalida cachés si la escritura falla", async () => {
    const backendError = new Error("conflict");
    vi.mocked(apiRequest).mockRejectedValue(backendError);
    await expect(noveltyApiService.resolveCoverageDay("novelty-1", "2026-11-16", { resolution: "CONFIRMED_ZERO", baseMinutes: null, note: "Ya no corresponde" })).rejects.toBe(backendError);
    expect(invalidateCacheFamily).not.toHaveBeenCalled();
  });
});

describe("mapNoveltyFromApi — rango canónico", () => {
  it("toDate=null se representa como un único día, sin inventar un rango abierto", () => {
    const novelty = mapNoveltyFromApi({
      id: "novelty-1", employeeId: "employee-1", noveltyTypeId: "type-1", status: "APROBADO", fromDate: "2026-11-16", toDate: null,
      noveltyType: { id: "type-1", code: "VAC", name: "Vacaciones", exportsToFinnegans: false, allowsHours: false, timeEntryBehavior: "BLOQUEA_NUEVA_CARGA" },
    });
    expect(novelty.from).toBe("2026-11-16");
    expect(novelty.to).toBe("2026-11-16");
  });
});
