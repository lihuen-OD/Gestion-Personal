import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { auditParametersController } from "./auditParameters.controller";
import { auditParametersService } from "./auditParameters.service";

/**
 * Etapa 14H.6 -- mismo criterio que shiftAssignment.controller.test.ts
 * (14H.3)/shiftAlert.controller.test.ts (14G.5): se prueba la cache REAL (no
 * mockeada), porque lo que hace falta validar es exactamente el
 * comportamiento nuevo (hit/miss, invalidación tras create/update). A
 * diferencia de esos dos, esta cache no está scopeada por usuario -- el
 * router entero ya requiere adminRoles (auditParameters.routes.ts) y
 * auditParametersService.list() no recibe `user`, así que no hay variación
 * de datos entre usuarios que pudiera filtrarse por compartir la key.
 */
vi.mock("./auditParameters.service", () => ({
  auditParametersService: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const mockedList = auditParametersService.list as unknown as Mock;
const mockedCreate = auditParametersService.create as unknown as Mock;
const mockedUpdate = auditParametersService.update as unknown as Mock;

// auditParametersReadCache vive dentro del controller (mismo patrón que
// hourConceptsReadCache/documentCategoriesReadCache -- no exportado, sin
// forma de limpiarlo desde el test) y persiste entre los tests de este
// archivo (mismo módulo, mismo proceso) -- por eso cada test que necesita un
// cache MISS real usa su propia originalUrl única, nunca reutilizada.
function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/audit-parameters?take=300",
    user: { id: "user-1", role: "NIVEL_1_RRHH" },
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

const sampleResult = { items: [{ id: "param-1", code: "AUD-001", name: "Alta de legajo" }], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auditParametersController.list — cache backend (Etapa 14H.6)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedList.mockResolvedValue(sampleResult);
    const res = fakeRes();

    await auditParametersController.list(fakeReq({ originalUrl: "/api/audit-parameters?t=miss1" }), res);

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("segundo pedido idéntico (misma URL) dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedList.mockResolvedValue(sampleResult);
    const url = "/api/audit-parameters?t=hit1";

    await auditParametersController.list(fakeReq({ originalUrl: url }), fakeRes());
    const res2 = fakeRes();
    await auditParametersController.list(fakeReq({ originalUrl: url }), res2);

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("cambiar cualquier filtro (originalUrl distinto) es un cache miss nuevo", async () => {
    mockedList
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 2 } });

    await auditParametersController.list(fakeReq({ originalUrl: "/api/audit-parameters?t=miss2a" }), fakeRes());
    await auditParametersController.list(fakeReq({ originalUrl: "/api/audit-parameters?t=miss2b&scope=LEGAJO" }), fakeRes());

    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["create", "/api/audit-parameters?t=mut-create", () => auditParametersController.create(fakeReq({ body: { code: "AUD-002", name: "Nuevo" } } as Partial<Request>), fakeRes())],
    ["update", "/api/audit-parameters?t=mut-update", () => auditParametersController.update(fakeReq({ params: { id: "param-1" }, body: { name: "Editado" } } as Partial<Request>), fakeRes())],
  ])("%s (escritura real) invalida la cache — el próximo pedido de list vuelve a pegarle al service", async (_name, url, mutate) => {
    mockedList.mockResolvedValue(sampleResult);
    mockedCreate.mockResolvedValue({ id: "param-2" });
    mockedUpdate.mockResolvedValue({ id: "param-1" });

    // Popula la cache con el resultado "viejo" (URL propia de este caso, nunca
    // usada por otro test del archivo, para que este primer pedido sea un
    // cache miss real sin importar el orden de ejecución).
    await auditParametersController.list(fakeReq({ originalUrl: url }), fakeRes());
    expect(mockedList).toHaveBeenCalledTimes(1);

    await mutate();

    // El próximo pedido de list (misma URL) ya no debe servir el resultado
    // cacheado viejo — create/update llaman a .clear() (invalida TODA la
    // cache, no sólo esta key).
    mockedList.mockResolvedValue({ ...sampleResult, meta: { ...sampleResult.meta, total: 5 } });
    const resAfter = fakeRes();
    await auditParametersController.list(fakeReq({ originalUrl: url }), resAfter);

    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(resAfter.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 5 }) });
  });
});
