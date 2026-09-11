import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { employeesController, clearEmployeeReadCaches, clearEmployeeTimeGridCache } from "./employees.controller";
import { employeesService } from "./employees.service";

/**
 * Etapa 14I.6 — a diferencia de `employees.controller.test.ts` (que sólo
 * ejercita los 5 mutadores de HourConceptBreakdown y mockea las cachés de
 * otros módulos para probar invalidación cruzada), este archivo usa las 6
 * cachés de lectura REALES declaradas en `employees.controller.ts`
 * (`employeeDetailCache`/`employeeListCache`/`employeeSummaryCache`/
 * `employeeOrgChartCache`/`employeeOptionsCache`/`employeeTimeGridCache`).
 * Esas 6 son locales al módulo (no se exportan individualmente, sólo
 * `clearEmployeeReadCaches`/`clearEmployeeTimeGridCache`) — 14I.1 las
 * confirmó correctas por lectura de código pero sin ningún test de
 * hit/miss/aislamiento real. Igual que `timeEntries.homeSummary.test.ts`, no
 * tiene sentido mockear la pieza que se está probando: sólo se mockea
 * `employeesService`.
 */
vi.mock("./employees.service", () => ({
  employeesService: {
    list: vi.fn(),
    listOrgChart: vi.fn(),
    listOptions: vi.fn(),
    summary: vi.fn(),
    getById: vi.fn(),
    getOverviewById: vi.fn(),
    getOverviewDetailsById: vi.fn(),
    getTimeGrid: vi.fn(),
  },
}));

const mockedService = employeesService as unknown as {
  list: Mock;
  listOrgChart: Mock;
  listOptions: Mock;
  summary: Mock;
  getById: Mock;
  getOverviewById: Mock;
  getOverviewDetailsById: Mock;
  getTimeGrid: Mock;
};

const userA: Express.AuthUser = { id: "user-a", email: "a@example.com", name: "Usuario A", role: "NIVEL_1_RRHH" };
const userB: Express.AuthUser = { id: "user-b", email: "b@example.com", name: "Usuario B", role: "NIVEL_2_SUPERVISION" };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: { id: "emp-1" },
    query: {},
    originalUrl: "/api/employees",
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
  clearEmployeeReadCaches();
  clearEmployeeTimeGridCache();
});

describe("employeesController.list — employeeListCache (Etapa 14I.6)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await employeesController.list(fakeReq(), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido del mismo usuario y misma URL dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await employeesController.list(fakeReq(), fakeRes());
    await employeesController.list(fakeReq(), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros distintos) no comparte cache — se llama al service de nuevo", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "emp-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await employeesController.list(fakeReq({ originalUrl: "/api/employees?sectorId=sector-1" }), fakeRes());
    await employeesController.list(fakeReq({ originalUrl: "/api/employees?sectorId=sector-2" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    // Repetir la primera URL: debe seguir siendo cache hit de ESA entrada.
    const res3 = fakeRes();
    await employeesController.list(fakeReq({ originalUrl: "/api/employees?sectorId=sector-1" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("clearEmployeeReadCaches() invalida employeeListCache — el próximo pedido vuelve a pegarle al service", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });

    await employeesController.list(fakeReq(), fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    clearEmployeeReadCaches();

    await employeesController.list(fakeReq(), fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("employeesController.listOrgChart — employeeOrgChartCache (Etapa 14I.6)", () => {
  it("primer pedido: cache miss, llama al service", async () => {
    mockedService.listOrgChart.mockResolvedValue({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 500, hasMore: false } });

    await employeesController.listOrgChart(fakeReq({ originalUrl: "/api/employees/org-chart?take=1000" }), fakeRes());

    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(1);
  });

  it("segundo pedido del mismo usuario y misma URL: cache hit", async () => {
    mockedService.listOrgChart.mockResolvedValue({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 500, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/employees/org-chart?take=1000" });

    await employeesController.listOrgChart(req, fakeRes());
    await employeesController.listOrgChart(req, fakeRes());

    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(1);
  });

  it("query variance: `take`/filtros distintos en `originalUrl` no comparten cache", async () => {
    mockedService.listOrgChart
      .mockResolvedValueOnce({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "emp-2" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } });

    await employeesController.listOrgChart(fakeReq({ originalUrl: "/api/employees/org-chart?take=1000" }), fakeRes());
    await employeesController.listOrgChart(fakeReq({ originalUrl: "/api/employees/org-chart?take=1000&sectorId=sector-1" }), fakeRes());

    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(2);
  });

  it("aislamiento por usuario/rol: dos usuarios distintos nunca comparten el resultado cacheado del otro", async () => {
    mockedService.listOrgChart
      .mockResolvedValueOnce({ items: [{ id: "emp-rrhh-view" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "emp-supervision-view" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } });
    const url = "/api/employees/org-chart?take=1000";

    const resA = fakeRes();
    await employeesController.listOrgChart(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await employeesController.listOrgChart(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: [{ id: "emp-rrhh-view" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } });
    expect(resB.json).toHaveBeenCalledWith({ data: [{ id: "emp-supervision-view" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } });

    // Repetir el pedido de userA con la misma URL: sigue siendo SU propio
    // resultado cacheado, nunca el de userB (RBAC-scoped por rol/id, no sólo
    // por URL — mismo criterio ya verificado en 14G.2 para home-summary).
    const resA2 = fakeRes();
    await employeesController.listOrgChart(fakeReq({ originalUrl: url, user: userA }), resA2);
    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(2);
    expect(resA2.json).toHaveBeenCalledWith({ data: [{ id: "emp-rrhh-view" }], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } });
  });

  it("clearEmployeeReadCaches() invalida employeeOrgChartCache", async () => {
    mockedService.listOrgChart.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 1000, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/employees/org-chart?take=1000" });

    await employeesController.listOrgChart(req, fakeRes());
    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(1);

    clearEmployeeReadCaches();

    await employeesController.listOrgChart(req, fakeRes());
    expect(mockedService.listOrgChart).toHaveBeenCalledTimes(2);
  });
});

describe("employeesController.listOptions — employeeOptionsCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.listOptions.mockResolvedValue({ items: [{ id: "emp-1" }], meta: { total: 1, page: 1, pageSize: 250, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/employees/options" });

    await employeesController.listOptions(req, fakeRes());
    await employeesController.listOptions(req, fakeRes());

    expect(mockedService.listOptions).toHaveBeenCalledTimes(1);
  });

  it("clearEmployeeReadCaches() invalida employeeOptionsCache", async () => {
    mockedService.listOptions.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 250, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/employees/options" });

    await employeesController.listOptions(req, fakeRes());
    clearEmployeeReadCaches();
    await employeesController.listOptions(req, fakeRes());

    expect(mockedService.listOptions).toHaveBeenCalledTimes(2);
  });
});

describe("employeesController.summary — employeeSummaryCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido del mismo usuario no vuelve a llamar al service", async () => {
    mockedService.summary.mockResolvedValue({ total: 10, active: 8, inactive: 2, missingTimeResponsible: 0, pendingTimeLoads: 0 });
    const req = fakeReq({ originalUrl: "/api/employees/summary" });

    await employeesController.summary(req, fakeRes());
    await employeesController.summary(req, fakeRes());

    expect(mockedService.summary).toHaveBeenCalledTimes(1);
  });

  it("aislamiento por usuario: dos usuarios con la misma URL no comparten el resumen cacheado", async () => {
    mockedService.summary
      .mockResolvedValueOnce({ total: 10, active: 8, inactive: 2, missingTimeResponsible: 0, pendingTimeLoads: 0 })
      .mockResolvedValueOnce({ total: 3, active: 3, inactive: 0, missingTimeResponsible: 1, pendingTimeLoads: 0 });
    const url = "/api/employees/summary";

    const resA = fakeRes();
    await employeesController.summary(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await employeesController.summary(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.summary).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ total: 10 }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ total: 3 }) });
  });

  it("clearEmployeeReadCaches() invalida employeeSummaryCache", async () => {
    mockedService.summary.mockResolvedValue({ total: 0, active: 0, inactive: 0, missingTimeResponsible: 0, pendingTimeLoads: 0 });
    const req = fakeReq({ originalUrl: "/api/employees/summary" });

    await employeesController.summary(req, fakeRes());
    clearEmployeeReadCaches();
    await employeesController.summary(req, fakeRes());

    expect(mockedService.summary).toHaveBeenCalledTimes(2);
  });
});

describe("employeesController.getById — employeeDetailCache (Etapa 14I.6)", () => {
  it("hit/miss: segundo pedido del mismo legajo por el mismo usuario no vuelve a llamar al service", async () => {
    mockedService.getById.mockResolvedValue({ id: "emp-1", firstName: "Ana" });
    const req = fakeReq({ params: { id: "emp-1" } });

    await employeesController.getById(req, fakeRes());
    await employeesController.getById(req, fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(1);
  });

  it("aislamiento por usuario/rol: dos usuarios pidiendo el MISMO legajo no comparten entrada de cache", async () => {
    mockedService.getById
      .mockResolvedValueOnce({ id: "emp-1", firstName: "Ana", viewer: "rrhh" })
      .mockResolvedValueOnce({ id: "emp-1", firstName: "Ana", viewer: "supervision" });

    const resA = fakeRes();
    await employeesController.getById(fakeReq({ params: { id: "emp-1" }, user: userA }), resA);
    const resB = fakeRes();
    await employeesController.getById(fakeReq({ params: { id: "emp-1" }, user: userB }), resB);

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "rrhh" }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "supervision" }) });
  });

  it("legajos distintos no comparten entrada de cache", async () => {
    mockedService.getById
      .mockResolvedValueOnce({ id: "emp-1" })
      .mockResolvedValueOnce({ id: "emp-2" });

    await employeesController.getById(fakeReq({ params: { id: "emp-1" } }), fakeRes());
    await employeesController.getById(fakeReq({ params: { id: "emp-2" } }), fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });

  it("getOverviewById/getOverviewDetailsById usan una key distinta a getById para el mismo legajo (sufijo :overview/:overview-details)", async () => {
    mockedService.getById.mockResolvedValue({ id: "emp-1", view: "detail" });
    mockedService.getOverviewById.mockResolvedValue({ id: "emp-1", view: "overview" });
    mockedService.getOverviewDetailsById.mockResolvedValue({ id: "emp-1", view: "overview-details" });
    const req = fakeReq({ params: { id: "emp-1" } });

    await employeesController.getById(req, fakeRes());
    await employeesController.getOverviewById(req, fakeRes());
    await employeesController.getOverviewDetailsById(req, fakeRes());

    // Las 3 comparten el mismo `emp-1`/usuario pero son vistas distintas del
    // legajo — deben pedir al service las 3 veces (keys distintas), nunca
    // servir la vista de una desde la cache de otra.
    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getOverviewById).toHaveBeenCalledTimes(1);
    expect(mockedService.getOverviewDetailsById).toHaveBeenCalledTimes(1);

    // Repetir las 3: las 3 deben ser cache hit ahora (sin llamadas nuevas).
    await employeesController.getById(req, fakeRes());
    await employeesController.getOverviewById(req, fakeRes());
    await employeesController.getOverviewDetailsById(req, fakeRes());
    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getOverviewById).toHaveBeenCalledTimes(1);
    expect(mockedService.getOverviewDetailsById).toHaveBeenCalledTimes(1);
  });

  it("clearEmployeeReadCaches() invalida employeeDetailCache", async () => {
    mockedService.getById.mockResolvedValue({ id: "emp-1" });
    const req = fakeReq({ params: { id: "emp-1" } });

    await employeesController.getById(req, fakeRes());
    clearEmployeeReadCaches();
    await employeesController.getById(req, fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });
});

describe("employeesController.getTimeGrid — employeeTimeGridCache (Etapa 14I.6)", () => {
  function timeGridReq(overrides: Partial<Request> = {}) {
    return fakeReq({ params: { id: "emp-1" }, originalUrl: "/api/employees/emp-1/time-grid?period=2026-09", ...overrides });
  }

  it("hit/miss: segundo pedido idéntico no vuelve a llamar al service", async () => {
    mockedService.getTimeGrid.mockResolvedValue({ period: "2026-09", days: [] });
    const req = timeGridReq();

    await employeesController.getTimeGrid(req, fakeRes());
    await employeesController.getTimeGrid(req, fakeRes());

    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto período en `originalUrl` no comparte cache", async () => {
    mockedService.getTimeGrid
      .mockResolvedValueOnce({ period: "2026-09", days: [] })
      .mockResolvedValueOnce({ period: "2026-10", days: [] });

    await employeesController.getTimeGrid(timeGridReq({ originalUrl: "/api/employees/emp-1/time-grid?period=2026-09" }), fakeRes());
    await employeesController.getTimeGrid(timeGridReq({ originalUrl: "/api/employees/emp-1/time-grid?period=2026-10" }), fakeRes());

    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(2);
  });

  it("aislamiento por usuario: dos usuarios pidiendo la grilla del mismo legajo/período no comparten cache", async () => {
    mockedService.getTimeGrid
      .mockResolvedValueOnce({ period: "2026-09", viewer: "rrhh" })
      .mockResolvedValueOnce({ period: "2026-09", viewer: "supervision" });
    const url = "/api/employees/emp-1/time-grid?period=2026-09";

    const resA = fakeRes();
    await employeesController.getTimeGrid(timeGridReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await employeesController.getTimeGrid(timeGridReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "rrhh" }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ viewer: "supervision" }) });
  });

  it("clearEmployeeTimeGridCache() invalida SÓLO la grilla horaria — employeeDetailCache sigue siendo cache hit (Etapa 14C.2)", async () => {
    mockedService.getById.mockResolvedValue({ id: "emp-1" });
    mockedService.getTimeGrid.mockResolvedValue({ period: "2026-09", days: [] });
    const detailReq = fakeReq({ params: { id: "emp-1" } });
    const gridReq = timeGridReq();

    await employeesController.getById(detailReq, fakeRes());
    await employeesController.getTimeGrid(gridReq, fakeRes());
    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(1);

    clearEmployeeTimeGridCache();

    await employeesController.getById(detailReq, fakeRes());
    await employeesController.getTimeGrid(gridReq, fakeRes());
    // Detail sigue siendo cache hit (no se limpió); time-grid vuelve a pegarle al service.
    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(2);
  });

  it("clearEmployeeReadCaches() (invalidación amplia) también limpia employeeTimeGridCache", async () => {
    mockedService.getTimeGrid.mockResolvedValue({ period: "2026-09", days: [] });
    const req = timeGridReq();

    await employeesController.getTimeGrid(req, fakeRes());
    clearEmployeeReadCaches();
    await employeesController.getTimeGrid(req, fakeRes());

    expect(mockedService.getTimeGrid).toHaveBeenCalledTimes(2);
  });
});
