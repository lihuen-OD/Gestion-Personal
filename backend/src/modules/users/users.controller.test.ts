import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { usersController } from "./users.controller";
import { usersService } from "./users.service";

/**
 * Etapa 14I.7 — `users` era, junto con `salary-categories`, uno de los 2
 * módulos backend sin ningún test de controller (14I.1/14I.2 sólo agregaron
 * `users.repository.test.ts`). `usersListCache`/`usersDetailCache`
 * (`createTtlCache`, 30s cada una, key = `req.originalUrl`/`id` SIN scope de
 * usuario) estaban confirmadas correctas por lectura de código en 14I.1
 * ("`list(query)` no recibe `user`, ruta ya es `adminRoles`-only") pero sin
 * ningún test real. Mismo criterio que el resto de la serie (14I.6): se
 * mockea `usersService`, nunca la cache que se está probando.
 *
 * `clearUsersReadCache()` no está exportada desde `users.controller.ts`
 * (a diferencia de `clearEmployeeReadCaches`/`clearDocumentsReadCaches`) y
 * esta etapa tiene prohibido modificar `controller.ts` para exportarla — las
 * 2 caches son singletons de módulo sin forma de resetearlas entre tests.
 * Por eso cada test usa una key (`originalUrl`/`id`) exclusiva, nunca
 * reusada por otro test del archivo, en vez de depender de un `clear()`
 * entre tests. La invalidación real (`create`/`update`/`resetPassword`) se
 * prueba igual, vía los mutadores reales del controller.
 */
vi.mock("./users.service", () => ({
  usersService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const mockedService = usersService as unknown as {
  list: Mock; getById: Mock; create: Mock; update: Mock; resetPassword: Mock;
};

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/users",
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

describe("usersController.list — usersListCache (Etapa 14I.7)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "user-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const res = fakeRes();

    await usersController.list(fakeReq({ originalUrl: "/api/users?case=first-request" }), res);

    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: "user-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("segundo pedido con el mismo `originalUrl`: cache hit, no vuelve a llamar al service", async () => {
    mockedService.list.mockResolvedValue({ items: [{ id: "user-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/users?case=hit-same-url" });

    await usersController.list(req, fakeRes());
    await usersController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(1);
  });

  it("query variance: distinto `originalUrl` (filtros/paginación) no comparte cache", async () => {
    mockedService.list
      .mockResolvedValueOnce({ items: [{ id: "user-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } })
      .mockResolvedValueOnce({ items: [{ id: "user-2" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });

    await usersController.list(fakeReq({ originalUrl: "/api/users?case=variance-a" }), fakeRes());
    await usersController.list(fakeReq({ originalUrl: "/api/users?case=variance-b" }), fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);

    // Repetir la primera URL: sigue siendo cache hit de esa entrada.
    const res3 = fakeRes();
    await usersController.list(fakeReq({ originalUrl: "/api/users?case=variance-a" }), res3);
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(res3.json).toHaveBeenCalledWith({ data: [{ id: "user-1" }], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
  });

  it("no cachea un rechazo del service: un error no deja una entrada cacheada, el próximo pedido reintenta contra el service", async () => {
    mockedService.list.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const req = fakeReq({ originalUrl: "/api/users?case=error-not-cached" });

    await expect(usersController.list(req, fakeRes())).rejects.toThrow("db down");
    await usersController.list(req, fakeRes());

    expect(mockedService.list).toHaveBeenCalledTimes(2);
  });
});

describe("usersController.getById — usersDetailCache (Etapa 14I.7)", () => {
  it("primer pedido: cache miss, llama al service", async () => {
    mockedService.getById.mockResolvedValue({ id: "user-detail-first", email: "a@example.com" });

    await usersController.getById(fakeReq({ params: { id: "user-detail-first" } }), fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(1);
    expect(mockedService.getById).toHaveBeenCalledWith("user-detail-first");
  });

  it("mismo id: segundo pedido es cache hit, no vuelve a llamar al service", async () => {
    mockedService.getById.mockResolvedValue({ id: "user-detail-hit", email: "a@example.com" });
    const req = fakeReq({ params: { id: "user-detail-hit" } });

    await usersController.getById(req, fakeRes());
    await usersController.getById(req, fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(1);
  });

  it("id variance: distinto id no comparte cache", async () => {
    mockedService.getById
      .mockResolvedValueOnce({ id: "user-detail-variance-a" })
      .mockResolvedValueOnce({ id: "user-detail-variance-b" });

    await usersController.getById(fakeReq({ params: { id: "user-detail-variance-a" } }), fakeRes());
    await usersController.getById(fakeReq({ params: { id: "user-detail-variance-b" } }), fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });

  it("no cachea un rechazo del service (p. ej. USER_NOT_FOUND): el próximo pedido reintenta", async () => {
    mockedService.getById.mockRejectedValueOnce(new Error("User not found")).mockResolvedValueOnce({ id: "user-detail-error" });
    const req = fakeReq({ params: { id: "user-detail-error" } });

    await expect(usersController.getById(req, fakeRes())).rejects.toThrow("User not found");
    await usersController.getById(req, fakeRes());

    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });
});

describe("usersController — invalidación de usersListCache/usersDetailCache (Etapa 14I.7)", () => {
  it("create() invalida list y detail — ambos vuelven a pegarle al service después", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.getById.mockResolvedValue({ id: "user-invalidate-create" });
    mockedService.create.mockResolvedValue({ id: "user-new", email: "new@example.com" });
    const listReq = fakeReq({ originalUrl: "/api/users?case=invalidate-create" });
    const detailReq = fakeReq({ params: { id: "user-invalidate-create" } });

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(1);
    expect(mockedService.getById).toHaveBeenCalledTimes(1);

    await usersController.create(fakeReq({ body: { email: "new@example.com", password: "Secret123!", role: "NIVEL_1_RRHH" } }), fakeRes());

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });

  it("update() invalida list y detail", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.getById.mockResolvedValue({ id: "user-invalidate-update" });
    mockedService.update.mockResolvedValue({ id: "user-invalidate-update", status: "INACTIVO" });
    const listReq = fakeReq({ originalUrl: "/api/users?case=invalidate-update" });
    const detailReq = fakeReq({ params: { id: "user-invalidate-update" } });

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());

    await usersController.update(fakeReq({ params: { id: "user-invalidate-update" }, body: { status: "INACTIVO" } }), fakeRes());

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });

  it("resetPassword() invalida list y detail", async () => {
    mockedService.list.mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    mockedService.getById.mockResolvedValue({ id: "user-invalidate-resetpw" });
    mockedService.resetPassword.mockResolvedValue({ id: "user-invalidate-resetpw" });
    const listReq = fakeReq({ originalUrl: "/api/users?case=invalidate-resetpw" });
    const detailReq = fakeReq({ params: { id: "user-invalidate-resetpw" } });

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());

    await usersController.resetPassword(fakeReq({ params: { id: "user-invalidate-resetpw" }, body: { password: "NuevoSecret123!" } }), fakeRes());

    await usersController.list(listReq, fakeRes());
    await usersController.getById(detailReq, fakeRes());
    expect(mockedService.list).toHaveBeenCalledTimes(2);
    expect(mockedService.getById).toHaveBeenCalledTimes(2);
  });
});
