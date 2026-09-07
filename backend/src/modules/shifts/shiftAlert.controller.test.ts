import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { shiftAlertController } from "./shiftAlert.controller";
import { shiftAlertService } from "./shiftAlert.service";
import { shiftAlertListCache, clearShiftAlertReadCaches } from "./shiftAlert.cache";

/**
 * Etapa 14G.5 -- mismo criterio que timeEntries.attendanceObservations.test.ts
 * (14G.3) y timeEntries.homeSummary.test.ts (14G.2): se prueba la cache REAL
 * (no mockeada), porque lo que hace falta validar es exactamente el
 * comportamiento nuevo (hit/miss, que la key incluye los filtros además de
 * usuario/rol, que resolver una alerta invalida el resultado cacheado).
 */
vi.mock("./shiftAlert.service", () => ({
  shiftAlertService: { list: vi.fn(), resolve: vi.fn() },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const mockedList = shiftAlertService.list as unknown as Mock;
const mockedResolve = shiftAlertService.resolve as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: { status: "PENDIENTE", take: 20 },
    originalUrl: "/api/shifts/alerts?status=PENDIENTE&take=20",
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

const sampleResult = {
  items: [{ id: "alert-1", type: "SALIDA_TARDIA", employee: { legajo: "100" } }],
  meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  shiftAlertListCache.clear();
});

describe("shiftAlertController.list — cache backend (Etapa 14G.5)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedList.mockResolvedValue(sampleResult);
    const res = fakeRes();

    await shiftAlertController.list(fakeReq(), res);

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("segundo pedido idéntico (mismos filtros, mismo usuario) dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedList.mockResolvedValue(sampleResult);

    await shiftAlertController.list(fakeReq(), fakeRes());
    const res2 = fakeRes();
    await shiftAlertController.list(fakeReq(), res2);

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("key incluye type/severity/status/search/before/take: cambiar cualquier filtro es un cache miss nuevo, aunque sea el mismo usuario", async () => {
    mockedList
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 2 } });

    await shiftAlertController.list(fakeReq(), fakeRes());
    await shiftAlertController.list(
      fakeReq({ originalUrl: "/api/shifts/alerts?status=RESUELTA&take=20" }),
      fakeRes(),
    );

    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("key scopeada por usuario+rol: dos usuarios con los mismos filtros nunca comparten el resultado cacheado del otro", async () => {
    mockedList
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 99 } });

    const resA = fakeRes();
    await shiftAlertController.list(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA);
    const resB = fakeRes();
    await shiftAlertController.list(fakeReq({ user: { id: "user-b", role: "NIVEL_2_SUPERVISION" } } as Partial<Request>), resB);

    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 1 }) });
    expect(resB.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 99 }) });

    // Repetir el pedido de user-a: debe seguir siendo SU propio resultado (total:1), nunca el de user-b (total:99).
    const resA2 = fakeRes();
    await shiftAlertController.list(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA2);
    expect(mockedList).toHaveBeenCalledTimes(2); // sigue en 2: hit de cache para user-a
    expect(resA2.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 1 }) });
  });

  it("clearShiftAlertReadCaches() invalida shiftAlertListCache — el próximo pedido vuelve a pegarle al service", async () => {
    mockedList.mockResolvedValue(sampleResult);

    await shiftAlertController.list(fakeReq(), fakeRes());
    expect(mockedList).toHaveBeenCalledTimes(1);

    clearShiftAlertReadCaches();

    await shiftAlertController.list(fakeReq(), fakeRes());
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("resolve (escritura real) invalida la cache — una alerta resuelta deja de verse en el próximo pedido", async () => {
    mockedList.mockResolvedValue(sampleResult);
    mockedResolve.mockResolvedValue({ id: "alert-1", status: "RESUELTA" });

    // Popula la cache con el resultado "viejo" (alerta todavía pendiente).
    await shiftAlertController.list(fakeReq(), fakeRes());
    expect(mockedList).toHaveBeenCalledTimes(1);

    // Resolver la alerta es una escritura real -- nunca lee ni escribe
    // shiftAlertListCache directamente, sólo la invalida vía
    // clearShiftAlertReadCaches() (mismo mecanismo que 14G.2/14G.3).
    await shiftAlertController.resolve(
      fakeReq({ params: { id: "alert-1" }, body: { resolution: "RESUELTA", reason: "Corregido" } } as Partial<Request>),
      fakeRes(),
    );
    expect(mockedResolve).toHaveBeenCalledTimes(1);

    // El próximo pedido de alertas ya no debe servir el resultado cacheado viejo.
    mockedList.mockResolvedValue({ ...sampleResult, meta: { ...sampleResult.meta, total: 0 } });
    const resAfter = fakeRes();
    await shiftAlertController.list(fakeReq(), resAfter);

    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(resAfter.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 0 }) });
  });
});
