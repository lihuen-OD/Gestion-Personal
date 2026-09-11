import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { documentsController } from "./documents.controller";
import { documentsService } from "./documents.service";
import { clearDocumentsReadCaches, documentsListCache } from "./documents.cache";

/**
 * Etapa 14I.6 — este módulo no tenía ningún test de controller (sólo
 * `documents.service.test.ts`, que mockea el repositorio, y
 * `documents.repository.test.ts`). `documentsListCache` (20s, scopeada por
 * `userScopedCacheKey`) estaba confirmada correcta por lectura de código en
 * 14I.1 pero sin ningún test de hit/miss/aislamiento real. Mismo criterio
 * que el resto de la serie: se mockea `documentsService`, NUNCA la cache que
 * se está probando.
 */
vi.mock("./documents.service", () => ({
  documentsService: {
    list: vi.fn(),
    download: vi.fn(),
  },
}));

const mockedService = documentsService as unknown as { list: Mock; download: Mock };

const userA: Express.AuthUser = { id: "user-a", email: "a@example.com", name: "Usuario A", role: "NIVEL_1_RRHH" };
const userB: Express.AuthUser = { id: "user-b", email: "b@example.com", name: "Usuario B", role: "NIVEL_2_SUPERVISION" };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/documents",
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
  res.redirect = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.sendFile = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  documentsListCache.clear();
});

describe("documentsController.list — documentsListCache (Etapa 14I.6)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado en cache", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "doc-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await documentsController.list(fakeReq(), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "doc-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido del mismo usuario y misma URL dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "doc-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq();

    await documentsController.list(req, fakeRes());
    await documentsController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros/paginación distintos) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "doc-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "doc-2" }], meta: { total: 1, page: 2, pageSize: 25, hasMore: false } });

    await documentsController.list(fakeReq({ originalUrl: "/api/documents?page=1" }), fakeRes());
    await documentsController.list(fakeReq({ originalUrl: "/api/documents?page=2" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    // Repetir la primera URL: sigue siendo cache hit de esa entrada.
    const res3 = fakeRes();
    await documentsController.list(fakeReq({ originalUrl: "/api/documents?page=1" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "doc-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("aislamiento por usuario/rol: dos usuarios con la misma URL nunca comparten el resultado cacheado del otro (employeeAccessWhere distinto por usuario)", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "doc-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "doc-supervision-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const url = "/api/documents";

    const resA = fakeRes();
    await documentsController.list(fakeReq({ originalUrl: url, user: userA }), resA);
    const resB = fakeRes();
    await documentsController.list(fakeReq({ originalUrl: url, user: userB }), resB);

    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: [{ id: "doc-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    expect(resB.json).toHaveBeenCalledWith({ data: [{ id: "doc-supervision-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    // Repetir el pedido de userA: sigue siendo SU propio resultado cacheado.
    const resA2 = fakeRes();
    await documentsController.list(fakeReq({ originalUrl: url, user: userA }), resA2);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(resA2.json).toHaveBeenCalledWith({ data: [{ id: "doc-rrhh-scope" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("clearDocumentsReadCaches() invalida documentsListCache — el próximo pedido vuelve a pegarle al service (mismo mecanismo que createDocument en employees.controller.ts)", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq();

    await documentsController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    clearDocumentsReadCaches();

    await documentsController.list(req, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});
