import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { noveltiesController } from "./novelties.controller";
import { noveltiesService } from "./novelties.service";
import { noveltiesListCache } from "./novelties.cache";

/**
 * Etapa 14I.6 — este módulo no tenía ningún test de controller (sólo
 * `novelties.service.test.ts`/`novelties.repository.test.ts`, que mockean la
 * capa de abajo). `noveltiesListCache` (15s, `userScopedCacheKey`) estaba
 * confirmada correcta por lectura de código en 14I.1 pero sin ningún test de
 * hit/miss/aislamiento real. `clearTimeEntriesReadCaches` se mockea sólo
 * para aislar esta prueba de esa cache (ya cubierta en su propio módulo) —
 * `noveltiesListCache`, la pieza bajo prueba, nunca se mockea.
 */
vi.mock("./novelties.service", () => ({
  noveltiesService: {
    list: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    approveMany: vi.fn(),
    reject: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../time-entries/timeEntries.cache", () => ({
  clearTimeEntriesReadCaches: vi.fn(),
}));

const mockedService = noveltiesService as unknown as {
  list: Mock; create: Mock; approve: Mock; approveMany: Mock; reject: Mock; remove: Mock;
};

const userA: Express.AuthUser = { id: "user-a", email: "a@example.com", name: "Usuario A", role: "NIVEL_1_RRHH" };
const userB: Express.AuthUser = { id: "user-b", email: "b@example.com", name: "Usuario B", role: "NIVEL_2_SUPERVISION" };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/novelties",
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
  noveltiesListCache.clear();
});

describe("noveltiesController.list — noveltiesListCache (Etapa 14I.6)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado en cache", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "nov-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await noveltiesController.list(fakeReq(), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "nov-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido del mismo usuario y misma URL dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "nov-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq();

    await noveltiesController.list(req, fakeRes());
    await noveltiesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (p. ej. `employeeId` de EmployeeHoursPage) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "nov-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "nov-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await noveltiesController.list(fakeReq({ originalUrl: "/api/novelties" }), fakeRes());
    await noveltiesController.list(fakeReq({ originalUrl: "/api/novelties?employeeId=emp-1" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    const res3 = fakeRes();
    await noveltiesController.list(fakeReq({ originalUrl: "/api/novelties" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "nov-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("aislamiento por usuario/rol: dos usuarios con la misma URL nunca comparten el resultado cacheado del otro", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "nov-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "nov-supervision-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const url = "/api/novelties";

    const resA = fakeRes();
    await noveltiesController.list(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await noveltiesController.list(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: [{ id: "nov-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    expect(resB.json).toHaveBeenCalledWith({ data: [{ id: "nov-supervision-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    const resA2 = fakeRes();
    await noveltiesController.list(fakeReq({ originalUrl: url, user: userA }), resA2);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(resA2.json).toHaveBeenCalledWith({ data: [{ id: "nov-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("create() invalida noveltiesListCache — el próximo listado vuelve a pegarle al service (call site real, no sólo clearNoveltiesReadCaches directo)", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.create.mockResolvedValue([{ id: "nov-new" }]);
    const req = fakeReq();

    await noveltiesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await noveltiesController.create(fakeReq({ body: { employeeIds: ["emp-1"], noveltyTypeId: "type-1" } }), fakeRes());

    await noveltiesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("approve()/reject()/remove() también invalidan noveltiesListCache", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.approve.mockResolvedValue({ id: "nov-1", status: "APROBADO" });
    mockedService.reject.mockResolvedValue({ id: "nov-1", status: "RECHAZADO" });
    mockedService.remove.mockResolvedValue({ ok: true });
    const req = fakeReq();

    await noveltiesController.list(req, fakeRes());
    await noveltiesController.approve(fakeReq({ params: { id: "nov-1" } }), fakeRes());
    await noveltiesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);

    await noveltiesController.reject(fakeReq({ params: { id: "nov-1" }, body: { reason: "no aplica" } }), fakeRes());
    await noveltiesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(3);

    await noveltiesController.remove(fakeReq({ params: { id: "nov-1" } }), fakeRes());
    await noveltiesController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(4);
  });
});
