import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { roles } from "../../shared/security/roles";
import { clearDashboardMetricsCache } from "./dashboard.cache";
import { dashboardRepository } from "./dashboard.repository";
import { dashboardService } from "./dashboard.service";

// Etapa 14E.1: `dashboard.service.ts` no tenia ningun test — se agrega esta
// suite junto con el cambio (countTotal+countActive -> groupBy, 15 queries
// en 1 Promise.all -> 14 en 3 lotes de <=5) para no introducir una regresion
// silenciosa en el calculo de metricas ni en el scoping del cache por
// usuario/rol. Ver docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md.

vi.mock("./dashboard.repository", () => ({
  dashboardRepository: {
    countTotalAndActive: vi.fn(),
    countExitsThisYear: vi.fn(),
    countTransported: vi.fn(),
    sumLoadedHours: vi.fn(),
    countEmployeesWithEntries: vi.fn(),
    countEmployeesWithoutEntries: vi.fn(),
    countEmployeesInReview: vi.fn(),
    findPeriodAbsenceDateRanges: vi.fn(),
    countPendingNovelties: vi.fn(),
    countExpiredDocuments: vi.fn(),
    countExpiringDocuments: vi.fn(),
    countMissingTimeResponsible: vi.fn(),
    findActiveDashboardEmployees: vi.fn(),
    findTransportedEmployees: vi.fn(),
  },
}));

const repo = dashboardRepository as unknown as {
  countTotalAndActive: Mock;
  countExitsThisYear: Mock;
  countTransported: Mock;
  sumLoadedHours: Mock;
  countEmployeesWithEntries: Mock;
  countEmployeesWithoutEntries: Mock;
  countEmployeesInReview: Mock;
  findPeriodAbsenceDateRanges: Mock;
  countPendingNovelties: Mock;
  countExpiredDocuments: Mock;
  countExpiringDocuments: Mock;
  countMissingTimeResponsible: Mock;
  findActiveDashboardEmployees: Mock;
  findTransportedEmployees: Mock;
};

function user(role: string, overrides: Partial<Express.AuthUser> = {}): Express.AuthUser {
  return { id: "user-1", email: "u@test.com", name: "Test", role, ...overrides } as unknown as Express.AuthUser;
}

function mockAllDefaults() {
  repo.countTotalAndActive.mockResolvedValue([
    { status: "ACTIVO", _count: { _all: 8 } },
    { status: "INACTIVO", _count: { _all: 2 } },
  ]);
  repo.countExitsThisYear.mockResolvedValue(1);
  repo.countTransported.mockResolvedValue(3);
  repo.sumLoadedHours.mockResolvedValue({ _sum: { hours: { toString: () => "40" } } });
  repo.countEmployeesWithEntries.mockResolvedValue(5);
  repo.countEmployeesWithoutEntries.mockResolvedValue(2);
  repo.countEmployeesInReview.mockResolvedValue(1);
  repo.findPeriodAbsenceDateRanges.mockResolvedValue([]);
  repo.countPendingNovelties.mockResolvedValue(4);
  repo.countExpiredDocuments.mockResolvedValue(1);
  repo.countExpiringDocuments.mockResolvedValue(2);
  repo.countMissingTimeResponsible.mockResolvedValue(0);
  repo.findActiveDashboardEmployees.mockResolvedValue([]);
  repo.findTransportedEmployees.mockResolvedValue([]);
}

const repoFnNames = [
  "countTotalAndActive",
  "countExitsThisYear",
  "countTransported",
  "sumLoadedHours",
  "countEmployeesWithEntries",
  "countEmployeesWithoutEntries",
  "countEmployeesInReview",
  "findPeriodAbsenceDateRanges",
  "countPendingNovelties",
  "countExpiredDocuments",
  "countExpiringDocuments",
  "countMissingTimeResponsible",
  "findActiveDashboardEmployees",
  "findTransportedEmployees",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  clearDashboardMetricsCache();
  mockAllDefaults();
});

describe("dashboardService.metrics — 14 queries en lotes, no 15 en un unico Promise.all (Etapa 14E.1)", () => {
  it("llama exactamente a las 14 funciones del repositorio (countTotal/countActive quedaron colapsadas en countTotalAndActive)", async () => {
    await dashboardService.metrics({}, user(roles.rrhh));

    for (const name of repoFnNames) {
      expect(repo[name]).toHaveBeenCalledTimes(1);
    }
    expect(Object.keys(repo)).toHaveLength(repoFnNames.length);
  });

  it("nunca dispara más de 5 queries del repositorio en simultáneo (tamaño de lote acordado)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const defaultValueByName: Record<string, unknown> = {
      countTotalAndActive: [{ status: "ACTIVO", _count: { _all: 1 } }],
      countExitsThisYear: 0,
      countTransported: 0,
      sumLoadedHours: { _sum: { hours: { toString: () => "0" } } },
      countEmployeesWithEntries: 0,
      countEmployeesWithoutEntries: 0,
      countEmployeesInReview: 0,
      findPeriodAbsenceDateRanges: [],
      countPendingNovelties: 0,
      countExpiredDocuments: 0,
      countExpiringDocuments: 0,
      countMissingTimeResponsible: 0,
      findActiveDashboardEmployees: [],
      findTransportedEmployees: [],
    };
    for (const name of repoFnNames) {
      repo[name].mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return defaultValueByName[name];
      });
    }

    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-batch" }));

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});

describe("dashboardService.metrics — cálculo de métricas (Etapa 14E.1: total/active vía groupBy)", () => {
  it("total = suma de todos los grupos, active = grupo ACTIVO", async () => {
    const result = await dashboardService.metrics({}, user(roles.rrhh));

    expect(result.total).toBe(10);
    expect(result.active).toBe(8);
    expect(result.inactive).toBe(2);
  });

  it("si el groupBy no devuelve ningún grupo ACTIVO (accessWhere sin activos), active = 0, no undefined/NaN", async () => {
    repo.countTotalAndActive.mockResolvedValue([{ status: "INACTIVO", _count: { _all: 3 } }]);

    const result = await dashboardService.metrics({}, user(roles.rrhh));

    expect(result.active).toBe(0);
    expect(result.total).toBe(3);
    expect(result.inactive).toBe(3);
    expect(result.averageAge).toBe("0.0");
    expect(result.averageTenure).toBe("0.0");
    expect(result.loadCoverage).toBe(0);
  });

  it("si el groupBy no devuelve absolutamente ningún grupo (0 empleados en el scope), total = 0, active = 0", async () => {
    repo.countTotalAndActive.mockResolvedValue([]);

    const result = await dashboardService.metrics({}, user(roles.rrhh));

    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
    expect(result.inactive).toBe(0);
  });

  it("cada métrica independiente llega al campo correcto de la respuesta (sin mezclarse entre sí)", async () => {
    repo.countExitsThisYear.mockResolvedValue(7);
    repo.countTransported.mockResolvedValue(11);
    repo.countEmployeesWithEntries.mockResolvedValue(6);
    repo.countEmployeesWithoutEntries.mockResolvedValue(9);
    repo.countEmployeesInReview.mockResolvedValue(13);
    repo.countPendingNovelties.mockResolvedValue(17);
    repo.countExpiredDocuments.mockResolvedValue(19);
    repo.countExpiringDocuments.mockResolvedValue(23);
    repo.countMissingTimeResponsible.mockResolvedValue(29);

    const result = await dashboardService.metrics({}, user(roles.rrhh));

    expect(result.exits).toBe(7);
    expect(result.transported).toBe(11);
    expect(result.pendingLoads).toBe(9);
    expect(result.reviewLoads).toBe(13);
    expect(result.pendingNovelties).toBe(17);
    expect(result.expiredDocuments).toBe(19);
    expect(result.expiringDocuments).toBe(23);
    expect(result.missingResponsible).toBe(29);
    expect(result.loadCoverage).toBe(Math.round((6 / 8) * 100));
  });
});

describe("dashboardService.metrics — cache TTL por usuario/rol/scope (Etapa 14E.1)", () => {
  it("primera llamada calcula (cache miss) y la segunda con el mismo usuario+rol+período usa cache", async () => {
    const u = user(roles.rrhh, { id: "user-cache-1" });

    await dashboardService.metrics({ period: "2026-08" }, u);
    await dashboardService.metrics({ period: "2026-08" }, u);

    expect(repo.countTotalAndActive).toHaveBeenCalledTimes(1);
  });

  it("un usuario distinto no comparte cache (key incluye userId)", async () => {
    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-a" }));
    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-b" }));

    expect(repo.countTotalAndActive).toHaveBeenCalledTimes(2);
  });

  it("un rol distinto no comparte cache aunque el userId sea el mismo (key incluye role)", async () => {
    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-x" }));
    await dashboardService.metrics({ period: "2026-08" }, user(roles.supervision, { id: "user-x" }));

    expect(repo.countTotalAndActive).toHaveBeenCalledTimes(2);
  });

  it("un período distinto no comparte cache (key incluye period)", async () => {
    const u = user(roles.rrhh, { id: "user-period" });

    await dashboardService.metrics({ period: "2026-07" }, u);
    await dashboardService.metrics({ period: "2026-08" }, u);

    expect(repo.countTotalAndActive).toHaveBeenCalledTimes(2);
  });

  it("un companyId/sectorId distinto no comparte cache (key incluye scope)", async () => {
    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-scope", sectorId: "sec-1" }));
    await dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "user-scope", sectorId: "sec-2" }));

    expect(repo.countTotalAndActive).toHaveBeenCalledTimes(2);
  });
});

describe("dashboardService.metrics — RBAC/scope real pasado a las queries (Etapa 14E.1)", () => {
  it("RRHH: accessWhere vacío llega sin cambios a las queries", async () => {
    await dashboardService.metrics({}, user(roles.rrhh, { id: "rrhh-1" }));

    expect(repo.countExitsThisYear).toHaveBeenCalledWith({}, expect.any(Number));
    expect(repo.countTransported).toHaveBeenCalledWith({});
  });

  it("Supervisión: accessWhere scopeado (TIME_RESPONSIBLE + userId propio) llega igual a las queries", async () => {
    await dashboardService.metrics({}, user(roles.supervision, { id: "sup-42" }));

    const expectedWhere = expect.objectContaining({
      assignments: { some: expect.objectContaining({ type: "TIME_RESPONSIBLE", userId: "sup-42" }) },
    });
    expect(repo.countTransported).toHaveBeenCalledWith(expectedWhere);
    expect(repo.countMissingTimeResponsible).toHaveBeenCalledWith(expectedWhere);
  });
});

describe("dashboardService.metrics — un error real se propaga, nunca se esconde ni se cachea (Etapa 14E.1)", () => {
  it("si una query falla, metrics() rechaza (no devuelve ceros falsos)", async () => {
    repo.countExitsThisYear.mockRejectedValue(new Error("P1017: Server has closed the connection"));

    await expect(dashboardService.metrics({}, user(roles.rrhh))).rejects.toThrow("P1017");
  });

  it("un fallo no queda cacheado — la siguiente llamada vuelve a intentar contra el repositorio", async () => {
    repo.countExitsThisYear.mockRejectedValueOnce(new Error("P1017: Server has closed the connection"));
    const u = user(roles.rrhh, { id: "user-error-retry" });

    await expect(dashboardService.metrics({ period: "2026-08" }, u)).rejects.toThrow();
    repo.countExitsThisYear.mockResolvedValue(1);
    const result = await dashboardService.metrics({ period: "2026-08" }, u);

    expect(result.exits).toBe(1);
    expect(repo.countExitsThisYear).toHaveBeenCalledTimes(2);
  });

  it("el error se loguea con contexto (query/period/role) sin PII (sin email/nombre/userId)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    repo.countExitsThisYear.mockRejectedValue(new Error("boom"));

    await expect(dashboardService.metrics({ period: "2026-08" }, user(roles.rrhh, { id: "secret-user-id" }))).rejects.toThrow();

    const logged = warnSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes("dashboard_metrics_query_error"));
    expect(logged).toBeDefined();
    const parsed = JSON.parse(logged!);
    expect(parsed.query).toBe("Employee.count(exitsThisYear)");
    expect(parsed.period).toBe("2026-08");
    expect(parsed.role).toBe(roles.rrhh);
    expect(logged).not.toContain("secret-user-id");
    expect(logged).not.toContain("email");
    warnSpy.mockRestore();
  });
});
