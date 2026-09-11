import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { hourConceptsController } from "./hourConcepts.controller";
import { hourConceptsService } from "./hourConcepts.service";

/**
 * Etapa 14I.10 — diagnóstico de la doble capa de cache controller+repository.
 * `hourConceptsReadCache` (controller-layer, `createTtlCache`, 60s, key =
 * `req.originalUrl`) nunca había tenido un test propio: el único archivo de
 * test de este controller (`hourConcepts.controller.test.ts`) cubre otra
 * cosa (invalidación cruzada de `employeeDetailCache` en `enableEmployees`/
 * `disableEmployee`, vía un router HTTP real), sin ejercitar `list`/la cache
 * de catálogo en absoluto — mismo criterio que 14I.6/14I.7 para
 * `documentsListCache`/`noveltyTypesListCache`/`usersListCache`/
 * `salaryCategoriesReadCache`. Se agrega este archivo nuevo y separado (no
 * se toca `hourConcepts.controller.test.ts`, que usa un estilo de test
 * distinto — router HTTP real, no mock de servicio) para no mezclar
 * estilos ni reescribir nada existente.
 *
 * `hourConceptsReadCache` es un singleton de módulo sin exportar (no hay
 * `.clear()` accesible desde afuera) — cada test usa un `originalUrl`
 * exclusivo, nunca reusado, en vez de depender de un reset entre tests
 * (mismo mecanismo ya usado en `users.controller.test.ts`/
 * `salaryCategories.controller.test.ts`, 14I.7). La invalidación se prueba
 * vía los mutadores reales (`create`/`update`/`remove`).
 */
vi.mock("./hourConcepts.service", () => ({
  hourConceptsService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockedService = hourConceptsService as unknown as { list: Mock; create: Mock; update: Mock; remove: Mock };

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/hour-concepts",
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

describe("hourConceptsController.list — hourConceptsReadCache (Etapa 14I.10)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado — contrato {data, meta} preservado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "concept-1", name: "Hora normal" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await hourConceptsController.list(fakeReq({ originalUrl: "/api/hour-concepts?case=first-request" }), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "concept-1", name: "Hora normal" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido con el mismo `originalUrl`: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "concept-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/hour-concepts?case=hit-same-url" });

    await hourConceptsController.list(req, fakeRes());
    await hourConceptsController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros `kind`/`status`/`search`) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "concept-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "concept-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await hourConceptsController.list(fakeReq({ originalUrl: "/api/hour-concepts?kind=NORMAL" }), fakeRes());
    await hourConceptsController.list(fakeReq({ originalUrl: "/api/hour-concepts?kind=ADICIONAL" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    const res3 = fakeRes();
    await hourConceptsController.list(fakeReq({ originalUrl: "/api/hour-concepts?kind=NORMAL" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "concept-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("no cachea un rechazo del service: un error no deja una entrada cacheada, el próximo pedido reintenta", async () => {
    mockedService.list.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/hour-concepts?case=error-not-cached" });

    await expect(hourConceptsController.list(req, fakeRes())).rejects.toThrow("db down");
    await hourConceptsController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("hourConceptsController — invalidación de hourConceptsReadCache (Etapa 14I.10)", () => {
  it("create() invalida la cache — el próximo listado vuelve a pegarle al service", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.create.mockResolvedValue({ id: "concept-new", name: "Nuevo concepto" });
    const listReq = fakeReq({ originalUrl: "/api/hour-concepts?case=invalidate-create" });

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await hourConceptsController.create(fakeReq({ body: { name: "Nuevo concepto", kind: "ADICIONAL" } }), fakeRes());

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("update() invalida la cache", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.update.mockResolvedValue({ id: "concept-1", name: "Concepto actualizado" });
    const listReq = fakeReq({ originalUrl: "/api/hour-concepts?case=invalidate-update" });

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await hourConceptsController.update(fakeReq({ params: { id: "concept-1" }, body: { name: "Concepto actualizado" } }), fakeRes());

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });

  it("remove() invalida la cache", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.remove.mockResolvedValue({ id: "concept-1", code: "HC1", name: "Concepto", mode: "DELETED" });
    const listReq = fakeReq({ originalUrl: "/api/hour-concepts?case=invalidate-remove" });

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);

    await hourConceptsController.remove(fakeReq({ params: { id: "concept-1" }, query: { force: "false" } }), fakeRes());

    await hourConceptsController.list(listReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});
