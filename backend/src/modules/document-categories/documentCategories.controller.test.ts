import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { documentCategoriesController } from "./documentCategories.controller";
import { documentCategoriesService } from "./documentCategories.service";

/**
 * Etapa 14I.10 — diagnóstico de la doble capa de cache controller+repository.
 * `document-categories` no tenía ningún test de controller (sólo
 * `documentCategories.repository.test.ts`, capa distinta — Forma B de
 * repositorio). `documentCategoriesReadCache` (controller-layer,
 * `createTtlCache`, 60s, key = `req.originalUrl`) nunca tuvo test real.
 * Mismo criterio que 14I.6/14I.7/14I.10 (hour-concepts/novelty-types): se
 * mockea `documentCategoriesService`, nunca la cache bajo prueba.
 *
 * La cache no está exportada desde `documentCategories.controller.ts` —
 * cada test usa un `originalUrl` exclusivo, nunca reusado. La invalidación
 * se prueba vía los mutadores reales (`create`/`update`).
 */
vi.mock("./documentCategories.service", () => ({
  documentCategoriesService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const mockedService = documentCategoriesService as unknown as { list: Mock; create: Mock; update: Mock };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/document-categories",
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

describe("documentCategoriesController.list — documentCategoriesReadCache (Etapa 14I.10)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado — contrato {data, meta} preservado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "cat-1", name: "DNI" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await documentCategoriesController.list(fakeReq({ originalUrl: "/api/document-categories?case=first-request" }), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "cat-1", name: "DNI" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido con el mismo `originalUrl`: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/document-categories?case=hit-same-url" });

    await documentCategoriesController.list(req, fakeRes());
    await documentCategoriesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros `kind`/`status`/`scope`) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "cat-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await documentCategoriesController.list(fakeReq({ originalUrl: "/api/document-categories?scope=EMPLEADO" }), fakeRes());
    await documentCategoriesController.list(fakeReq({ originalUrl: "/api/document-categories?scope=NOVEDAD" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    const res3 = fakeRes();
    await documentCategoriesController.list(fakeReq({ originalUrl: "/api/document-categories?scope=EMPLEADO" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("no cachea un rechazo del service: un error no deja una entrada cacheada", async () => {
    mockedService.list.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/document-categories?case=error-not-cached" });

    await expect(documentCategoriesController.list(req, fakeRes())).rejects.toThrow("db down");
    await documentCategoriesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("documentCategoriesController — invalidación de documentCategoriesReadCache (Etapa 14I.10)", () => {
  it("create() invalida la cache — el próximo listado vuelve a pegarle al service", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.create.mockResolvedValue({ id: "cat-new", name: "Nueva categoría" });
    const listReq = fakeReq({ originalUrl: "/api/document-categories?case=invalidate-create" });

    await documentCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await documentCategoriesController.create(fakeReq({ body: { name: "Nueva categoría", kind: "OBLIGATORIO" } }), fakeRes());

    await documentCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("update() invalida la cache", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.update.mockResolvedValue({ id: "cat-1", name: "Categoría actualizada" });
    const listReq = fakeReq({ originalUrl: "/api/document-categories?case=invalidate-update" });

    await documentCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await documentCategoriesController.update(fakeReq({ params: { id: "cat-1" }, body: { name: "Categoría actualizada" } }), fakeRes());

    await documentCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});
