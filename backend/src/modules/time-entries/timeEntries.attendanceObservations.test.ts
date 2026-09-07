import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { timeEntriesController } from "./timeEntries.controller";
import { timeEntriesService } from "./timeEntries.service";
import { attendanceObservationsCache, clearTimeEntriesReadCaches } from "./timeEntries.cache";

/**
 * Etapa 14G.3 — mismo criterio que `timeEntries.homeSummary.test.ts` (14G.2):
 * acá se prueba el cache REAL (no mockeado), porque lo que hace falta
 * validar es exactamente el comportamiento nuevo (hit/miss, que la key
 * incluye fecha/tipo/búsqueda además de usuario, que la invalidación
 * compartida la alcanza) — mockear `./timeEntries.cache` dejaría de
 * validar la lógica real.
 */
vi.mock("./timeEntries.service", () => ({
  timeEntriesService: { attendanceObservations: vi.fn(), resolveAttendanceObservation: vi.fn() },
  timeEntriesExportToCsv: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
  clearEmployeeTimeGridCache: vi.fn(),
}));

const mockedAttendanceObservations = timeEntriesService.attendanceObservations as unknown as Mock;
const mockedResolveAttendanceObservation = timeEntriesService.resolveAttendanceObservation as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: { type: "ALL", reviewStatus: "PENDIENTE", take: 10 },
    originalUrl: "/api/time-entries/attendance/observations?type=ALL&reviewStatus=PENDIENTE&take=10",
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

const sampleResult = { items: [{ kind: "SHIFT", occurredAt: new Date(), shift: { id: "s1" } }], meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null } };

beforeEach(() => {
  vi.clearAllMocks();
  attendanceObservationsCache.clear();
});

describe("timeEntriesController.attendanceObservations — cache backend (Etapa 14G.3)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedAttendanceObservations.mockResolvedValue(sampleResult);
    const res = fakeRes();

    await timeEntriesController.attendanceObservations(fakeReq(), res);

    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("segundo pedido idéntico (mismos filtros, mismo usuario) dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedAttendanceObservations.mockResolvedValue(sampleResult);

    await timeEntriesController.attendanceObservations(fakeReq(), fakeRes());
    const res2 = fakeRes();
    await timeEntriesController.attendanceObservations(fakeReq(), res2);

    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: sampleResult.meta });
  });

  it("key incluye fecha/tipo/búsqueda: cambiar cualquier filtro es un cache miss nuevo, aunque sea el mismo usuario", async () => {
    mockedAttendanceObservations
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 2 } });

    await timeEntriesController.attendanceObservations(fakeReq(), fakeRes());
    await timeEntriesController.attendanceObservations(
      fakeReq({ originalUrl: "/api/time-entries/attendance/observations?type=SHIFT&reviewStatus=PENDIENTE&take=10" }),
      fakeRes(),
    );

    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(2);
  });

  it("key scopeada por usuario: dos usuarios con los mismos filtros nunca comparten el resultado cacheado del otro", async () => {
    mockedAttendanceObservations
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 99 } });

    const resA = fakeRes();
    await timeEntriesController.attendanceObservations(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA);
    const resB = fakeRes();
    await timeEntriesController.attendanceObservations(fakeReq({ user: { id: "user-b", role: "NIVEL_1_RRHH" } } as Partial<Request>), resB);

    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 1 }) });
    expect(resB.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 99 }) });

    // Repetir el pedido de user-a: debe seguir siendo SU propio resultado (total:1), nunca el de user-b (total:99).
    const resA2 = fakeRes();
    await timeEntriesController.attendanceObservations(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA2);
    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(2); // sigue en 2: hit de cache para user-a
    expect(resA2.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 1 }) });
  });

  it("clearTimeEntriesReadCaches() invalida attendanceObservationsCache — el próximo pedido vuelve a pegarle al service", async () => {
    mockedAttendanceObservations.mockResolvedValue(sampleResult);

    await timeEntriesController.attendanceObservations(fakeReq(), fakeRes());
    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(1);

    clearTimeEntriesReadCaches();

    await timeEntriesController.attendanceObservations(fakeReq(), fakeRes());
    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(2);
  });

  it("resolveAttendanceObservation (escritura real) invalida la cache — una observación resuelta deja de verse en el próximo pedido", async () => {
    mockedAttendanceObservations.mockResolvedValue(sampleResult);
    mockedResolveAttendanceObservation.mockResolvedValue({ id: "shift-1", reviewStatus: "RESUELTA" });

    // Popula la cache con el resultado "viejo" (observación todavía pendiente).
    await timeEntriesController.attendanceObservations(fakeReq(), fakeRes());
    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(1);

    // Resolver la observación es una escritura real — nunca lee ni escribe
    // attendanceObservationsCache directamente, sólo la invalida vía
    // clearTimeEntriesReadCaches() (mismo mecanismo que 14G.2).
    await timeEntriesController.resolveAttendanceObservation(
      fakeReq({ params: { kind: "SHIFT", id: "shift-1" }, body: { resolution: "RESUELTA", reason: "Corregido" } } as Partial<Request>),
      fakeRes(),
    );
    expect(mockedResolveAttendanceObservation).toHaveBeenCalledTimes(1);

    // El próximo pedido de observations ya no debe servir el resultado cacheado viejo.
    mockedAttendanceObservations.mockResolvedValue({ ...sampleResult, meta: { ...sampleResult.meta, total: 0 } });
    const resAfter = fakeRes();
    await timeEntriesController.attendanceObservations(fakeReq(), resAfter);

    expect(mockedAttendanceObservations).toHaveBeenCalledTimes(2);
    expect(resAfter.json).toHaveBeenCalledWith({ data: sampleResult.items, meta: expect.objectContaining({ total: 0 }) });
  });
});
