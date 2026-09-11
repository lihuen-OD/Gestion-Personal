import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { salaryCategoriesController } from "./salaryCategories.controller";
import { salaryCategoriesService } from "./salaryCategories.service";

/**
 * Etapa 14I.7 — `salary-categories` era, junto con `users`, uno de los 2
 * módulos backend sin ningún test de controller (14I.3 sólo agregó
 * `salaryCategories.repository.test.ts`, que cubre la Forma B de cache a
 * nivel repositorio — una capa distinta). `salaryCategoriesReadCache`
 * (`createTtlCache`, 60s, key = `req.originalUrl`, SIN scope de usuario)
 * estaba confirmada correcta por lectura de código en 14I.1
 * ("`list(query)` no recibe `user`") pero sin ningún test real de
 * hit/miss/invalidación a nivel controller. Se mockea sólo
 * `salaryCategoriesService`, nunca la cache bajo prueba.
 *
 * El `$transaction` P2 de la rama filtrada de `salaryCategories.repository.
 * ts` (sin caller real) queda documentado y SIN TOCAR — no forma parte de
 * esta etapa (ver docs/decisions/BACKEND_CACHE_REMAINING_TESTS_14I7.md §6).
 *
 * Igual que en `users.controller.test.ts`: `salaryCategoriesReadCache` es un
 * singleton de módulo sin exportar (no hay `.clear()` accesible desde
 * afuera, y no se permite modificar `controller.ts` para exportarlo) — cada
 * test usa un `originalUrl` exclusivo en vez de depender de un reset entre
 * tests. La invalidación se prueba vía los mutadores reales (`create`/
 * `update`).
 */
vi.mock("./salaryCategories.service", () => ({
  salaryCategoriesService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const mockedService = salaryCategoriesService as unknown as { list: Mock; create: Mock; update: Mock };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/salary-categories",
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

describe("salaryCategoriesController.list — salaryCategoriesReadCache (Etapa 14I.7)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado — contrato {data, meta} preservado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "cat-1", name: "Administrativo" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await salaryCategoriesController.list(fakeReq({ originalUrl: "/api/salary-categories?case=first-request" }), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "cat-1", name: "Administrativo" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido con el mismo `originalUrl`: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/salary-categories?case=hit-same-url" });

    await salaryCategoriesController.list(req, fakeRes());
    await salaryCategoriesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros `family`/`status`/`search`) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "cat-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await salaryCategoriesController.list(fakeReq({ originalUrl: "/api/salary-categories?family=CONVENIO" }), fakeRes());
    await salaryCategoriesController.list(fakeReq({ originalUrl: "/api/salary-categories?family=FUERA_CONVENIO" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    // Repetir la primera URL: sigue siendo cache hit de esa entrada.
    const res3 = fakeRes();
    await salaryCategoriesController.list(fakeReq({ originalUrl: "/api/salary-categories?family=CONVENIO" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "cat-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("no cachea un rechazo del service: un error no deja una entrada cacheada, el próximo pedido reintenta", async () => {
    mockedService.list.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/salary-categories?case=error-not-cached" });

    await expect(salaryCategoriesController.list(req, fakeRes())).rejects.toThrow("db down");
    await salaryCategoriesController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("salaryCategoriesController — invalidación de salaryCategoriesReadCache (Etapa 14I.7)", () => {
  it("create() invalida la cache — el próximo listado vuelve a pegarle al service", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.create.mockResolvedValue({ id: "cat-new", name: "Nueva categoría" });
    const listReq = fakeReq({ originalUrl: "/api/salary-categories?case=invalidate-create" });

    await salaryCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await salaryCategoriesController.create(fakeReq({ body: { name: "Nueva categoría", family: "CONVENIO" } }), fakeRes());

    await salaryCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("update() invalida la cache — el próximo listado vuelve a pegarle al service", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.update.mockResolvedValue({ id: "cat-1", name: "Categoría actualizada" });
    const listReq = fakeReq({ originalUrl: "/api/salary-categories?case=invalidate-update" });

    await salaryCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await salaryCategoriesController.update(fakeReq({ params: { id: "cat-1" }, body: { name: "Categoría actualizada" } }), fakeRes());

    await salaryCategoriesController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});
