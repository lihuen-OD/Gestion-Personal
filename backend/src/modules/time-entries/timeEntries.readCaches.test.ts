import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { timeEntriesController } from "./timeEntries.controller";
import { timeEntriesService } from "./timeEntries.service";
import { clearTimeEntriesReadCaches } from "./timeEntries.cache";

/**
 * Etapa 14I.6 — a diferencia de `timeEntries.controller.test.ts` (que
 * mockea `./timeEntries.cache` por completo con `{get: vi.fn(), set:
 * vi.fn()}` para probar sólo invalidación en los mutadores, nunca hit/miss
 * real) y siguiendo el mismo patrón que `timeEntries.homeSummary.test.ts`/
 * `timeEntries.attendanceObservations.test.ts`, este archivo usa las 4
 * cachés de lectura reales que 14I.1 marcó como "mockeadas en su test de
 * controller — sólo confirma que se llama, no el comportamiento real de
 * hit/miss/TTL": `timeEntriesListCache`, `timeEntriesSummaryCache`,
 * `timeEntriesPeriodEmployeesCache`, `attendanceSummaryCache`. No se tocan
 * `homeSummaryCache`/`attendanceObservationsCache` (ya tienen test real
 * propio, usado acá sólo como referencia de patrón).
 */
vi.mock("./timeEntries.service", () => ({
  timeEntriesService: {
    list: vi.fn(),
    summary: vi.fn(),
    periodEmployees: vi.fn(),
    attendanceSummary: vi.fn(),
  },
  timeEntriesExportToCsv: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
  clearEmployeeTimeGridCache: vi.fn(),
}));

const mockedService = timeEntriesService as unknown as {
  list: Mock; summary: Mock; periodEmployees: Mock; attendanceSummary: Mock;
};

const userA: Express.AuthUser = { id: "user-a", email: "a@example.com", name: "Usuario A", role: "NIVEL_1_RRHH" };
const userB: Express.AuthUser = { id: "user-b", email: "b@example.com", name: "Usuario B", role: "NIVEL_3_CARGA_HORARIA" };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/time-entries",
    user: userA,
    ip: "127.0.0.1",
    get: () => null,
    ...overrides,
  } as unknown as Request;
}

function fakeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTimeEntriesReadCaches();
});

describe("timeEntriesController.list — timeEntriesListCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "te-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/time-entries?period=2026-09" });

    await timeEntriesController.list(req, fakeRes());
    await timeEntriesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto período en `originalUrl` no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "te-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "te-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await timeEntriesController.list(fakeReq({ originalUrl: "/api/time-entries?period=2026-09" }), fakeRes());
    await timeEntriesController.list(fakeReq({ originalUrl: "/api/time-entries?period=2026-10" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("aislamiento por usuario/rol: dos usuarios con la misma URL no comparten el resultado cacheado", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "te-rrhh" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "te-carga" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const url = "/api/time-entries?period=2026-09";

    const resA = fakeRes();
    await timeEntriesController.list(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await timeEntriesController.list(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: [{ id: "te-rrhh" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    expect(resB.json).toHaveBeenCalledWith({ data: [{ id: "te-carga" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("clearTimeEntriesReadCaches() invalida timeEntriesListCache", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq();

    await timeEntriesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    clearTimeEntriesReadCaches();

    await timeEntriesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("timeEntriesController.summary — timeEntriesSummaryCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.summary.mockResolvedValue({ period: "2026-09", totalHours: 160 });
    const req = fakeReq({ originalUrl: "/api/time-entries/summary?period=2026-09" });

    await timeEntriesController.summary(req, fakeRes());
    await timeEntriesController.summary(req, fakeRes());

    expect(mockedService.summary).toHaveBeenCalledTimes(1);
  });

  it("aislamiento por usuario: misma URL, dos usuarios, resultados propios", async () => {
    mockedService.summary
      .mockResolvedValueOnce({ period: "2026-09", totalHours: 160, viewer: "rrhh" })
      .mockResolvedValueOnce({ period: "2026-09", totalHours: 40, viewer: "carga" });
    const url = "/api/time-entries/summary?period=2026-09";

    const resA = fakeRes();
    await timeEntriesController.summary(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await timeEntriesController.summary(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.summary).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "rrhh" }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "carga" }) });
  });

  it("clearTimeEntriesReadCaches() invalida timeEntriesSummaryCache", async () => {
    mockedService.summary.mockResolvedValue({ period: "2026-09", totalHours: 0 });
    const req = fakeReq({ originalUrl: "/api/time-entries/summary?period=2026-09" });

    await timeEntriesController.summary(req, fakeRes());
    clearTimeEntriesReadCaches();
    await timeEntriesController.summary(req, fakeRes());

    expect(mockedService.summary).toHaveBeenCalledTimes(2);
  });
});

describe("timeEntriesController.periodEmployees — timeEntriesPeriodEmployeesCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.periodEmployees.mockResolvedValue({ items: [{ employeeId: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/time-entries/period-employees?period=2026-09" });

    await timeEntriesController.periodEmployees(req, fakeRes());
    await timeEntriesController.periodEmployees(req, fakeRes());

    expect(mockedService.periodEmployees).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto período no comparte cache", async () => {
    mockedService.periodEmployees
      .mockResolvedValueOnce({ items: [{ employeeId: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ employeeId: "emp-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await timeEntriesController.periodEmployees(fakeReq({ originalUrl: "/api/time-entries/period-employees?period=2026-09" }), fakeRes());
    await timeEntriesController.periodEmployees(fakeReq({ originalUrl: "/api/time-entries/period-employees?period=2026-10" }), fakeRes());

    expect(mockedService.periodEmployees).toHaveBeenCalledTimes(2);
  });

  it("clearTimeEntriesReadCaches() invalida timeEntriesPeriodEmployeesCache", async () => {
    mockedService.periodEmployees.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/time-entries/period-employees?period=2026-09" });

    await timeEntriesController.periodEmployees(req, fakeRes());
    clearTimeEntriesReadCaches();
    await timeEntriesController.periodEmployees(req, fakeRes());

    expect(mockedService.periodEmployees).toHaveBeenCalledTimes(2);
  });
});

describe("timeEntriesController.attendanceSummary — attendanceSummaryCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.attendanceSummary.mockResolvedValue({ date: "2026-09-11", totals: { open: 1, closed: 2, observed: 0, workedHours: 8 } });
    const req = fakeReq({ originalUrl: "/api/time-entries/attendance?date=2026-09-11" });

    await timeEntriesController.attendanceSummary(req, fakeRes());
    await timeEntriesController.attendanceSummary(req, fakeRes());

    expect(mockedService.attendanceSummary).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinta fecha no comparte cache", async () => {
    mockedService.attendanceSummary
      .mockResolvedValueOnce({ date: "2026-09-11", totals: { open: 1, closed: 2, observed: 0, workedHours: 8 } })
      .mockResolvedValueOnce({ date: "2026-09-12", totals: { open: 0, closed: 3, observed: 1, workedHours: 6 } });

    await timeEntriesController.attendanceSummary(fakeReq({ originalUrl: "/api/time-entries/attendance?date=2026-09-11" }), fakeRes());
    await timeEntriesController.attendanceSummary(fakeReq({ originalUrl: "/api/time-entries/attendance?date=2026-09-12" }), fakeRes());

    expect(mockedService.attendanceSummary).toHaveBeenCalledTimes(2);
  });

  it("aislamiento por usuario/rol: misma URL, dos usuarios, resultados propios (RBAC-scoped por employeeAccessWhere)", async () => {
    mockedService.attendanceSummary
      .mockResolvedValueOnce({ date: "2026-09-11", viewer: "rrhh" })
      .mockResolvedValueOnce({ date: "2026-09-11", viewer: "carga" });
    const url = "/api/time-entries/attendance?date=2026-09-11";

    const resA = fakeRes();
    await timeEntriesController.attendanceSummary(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await timeEntriesController.attendanceSummary(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.attendanceSummary).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "rrhh" }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "carga" }) });
  });

  it("clearTimeEntriesReadCaches() invalida attendanceSummaryCache", async () => {
    mockedService.attendanceSummary.mockResolvedValue({ date: "2026-09-11", totals: { open: 0, closed: 0, observed: 0, workedHours: 0 } });
    const req = fakeReq({ originalUrl: "/api/time-entries/attendance?date=2026-09-11" });

    await timeEntriesController.attendanceSummary(req, fakeRes());
    clearTimeEntriesReadCaches();
    await timeEntriesController.attendanceSummary(req, fakeRes());

    expect(mockedService.attendanceSummary).toHaveBeenCalledTimes(2);
  });
});
