import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { noveltyTypesController } from "./noveltyTypes.controller";
import { noveltyTypesService } from "./noveltyTypes.service";

/**
 * Etapa 14I.10 — diagnóstico de la doble capa de cache controller+repository.
 * `novelty-types` no tenía ningún test de controller (sólo
 * `noveltyTypes.repository.test.ts`, que cubre la Forma B de repositorio —
 * capa distinta). `noveltyTypesListCache`/`noveltyTypesDetailCache`
 * (controller-layer, `createTtlCache`, 60s cada una, key = `req.originalUrl`
 * / `id`) nunca tuvieron test real de hit/miss/invalidación. Mismo criterio
 * que 14I.6/14I.7: se mockea `noveltyTypesService`, nunca la cache bajo
 * prueba.
 *
 * Ninguna de las 2 caches está exportada desde `noveltyTypes.controller.ts`
 * — cada test usa una key (`originalUrl`/`id`) exclusiva, nunca reusada, en
 * vez de depender de un reset entre tests. La invalidación se prueba vía
 * los mutadores reales (`create`/`update`, que limpian ambas cachés juntas).
 */
vi.mock("./noveltyTypes.service", () => ({
  noveltyTypesService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const mockedService = noveltyTypesService as unknown as { list: Mock; getById: Mock; create: Mock; update: Mock };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/novelty-types",
    user: { id: "admin-1", email: "admin@example.com", name: "Admin", role: "NIVEL_1_RRHH" },
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
});

describe("noveltyTypesController.list — noveltyTypesListCache (Etapa 14I.10)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado — contrato {data, meta} preservado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "type-1", name: "Vacaciones" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await noveltyTypesController.list(fakeReq({ originalUrl: "/api/novelty-types?case=first-request" }), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "type-1", name: "Vacaciones" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido con el mismo `originalUrl`: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "type-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/novelty-types?case=hit-same-url" });

    await noveltyTypesController.list(req, fakeRes());
    await noveltyTypesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros `kind`/`origin`/`status`) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "type-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "type-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await noveltyTypesController.list(fakeReq({ originalUrl: "/api/novelty-types?status=ACTIVO" }), fakeRes());
    await noveltyTypesController.list(fakeReq({ originalUrl: "/api/novelty-types?status=INACTIVO" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    const res3 = fakeRes();
    await noveltyTypesController.list(fakeReq({ originalUrl: "/api/novelty-types?status=ACTIVO" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "type-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("no cachea un rechazo del service: un error no deja una entrada cacheada", async () => {
    mockedService.list.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/novelty-types?case=error-not-cached" });

    await expect(noveltyTypesController.list(req, fakeRes())).rejects.toThrow("db down");
    await noveltyTypesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("noveltyTypesController.getById — noveltyTypesDetailCache (Etapa 14I.10)", () => {
  it("primer pedido: cache miss, llama al service", async () => {
    mockedService.getById.mockResolvedValue({ id: "type-detail-first", name: "Vacaciones" });

    await noveltyTypesController.getById(fakeReq({ params: { id: "type-detail-first" } }), fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getById).toHaveBeenCalledWith("type-detail-first");
  });

  it("mismo id: segundo pedido es cache hit", async () => {
    mockedService.getById.mockResolvedValue({ id: "type-detail-hit" });
    const req = fakeReq({ params: { id: "type-detail-hit" } });

    await noveltyTypesController.getById(req, fakeRes());
    await noveltyTypesController.getById(req, fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(1);
  });

  it("id variance: distinto id no comparte cache", async () => {
    mockedService.getById
      .mockResolvedValueOnce({ id: "type-detail-variance-a" })
      .mockResolvedValueOnce({ id: "type-detail-variance-b" });

    await noveltyTypesController.getById(fakeReq({ params: { id: "type-detail-variance-a" } }), fakeRes());
    await noveltyTypesController.getById(fakeReq({ params: { id: "type-detail-variance-b" } }), fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });
});

describe("noveltyTypesController — invalidación de noveltyTypesListCache/noveltyTypesDetailCache (Etapa 14I.10)", () => {
  it("create() invalida list y detail", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.getById.mockResolvedValue({ id: "type-invalidate-create" });
    mockedService.create.mockResolvedValue({ id: "type-new", name: "Nuevo tipo" });
    const listReq = fakeReq({ originalUrl: "/api/novelty-types?case=invalidate-create" });
    const detailReq = fakeReq({ params: { id: "type-invalidate-create" } });

    await noveltyTypesController.list(listReq, fakeRes());
    await noveltyTypesController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(mockedService.getById).toHaveBeenCalledTimes(1);

    await noveltyTypesController.create(fakeReq({ body: { name: "Nuevo tipo", kind: "PROGRAMADA" } }), fakeRes());

    await noveltyTypesController.list(listReq, fakeRes());
    await noveltyTypesController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });

  it("update() invalida list y detail", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.getById.mockResolvedValue({ id: "type-invalidate-update" });
    mockedService.update.mockResolvedValue({ id: "type-invalidate-update", name: "Tipo actualizado" });
    const listReq = fakeReq({ originalUrl: "/api/novelty-types?case=invalidate-update" });
    const detailReq = fakeReq({ params: { id: "type-invalidate-update" } });

    await noveltyTypesController.list(listReq, fakeRes());
    await noveltyTypesController.getById(detailReq, fakeRes());

    await noveltyTypesController.update(fakeReq({ params: { id: "type-invalidate-update" }, body: { name: "Tipo actualizado" } }), fakeRes());

    await noveltyTypesController.list(listReq, fakeRes());
    await noveltyTypesController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });
});
