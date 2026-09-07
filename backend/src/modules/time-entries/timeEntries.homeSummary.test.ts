import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { timeEntriesController } from "./timeEntries.controller";
import { timeEntriesService } from "./timeEntries.service";
import { clearTimeEntriesReadCaches, homeSummaryCache } from "./timeEntries.cache";

/**
 * Etapa 14G.2 — a diferencia de `timeEntries.controller.test.ts` (que mockea
 * `./timeEntries.cache` por completo para probar sólo invalidación en
 * escrituras), este archivo usa el módulo de cache REAL: lo que hace falta
 * validar acá es exactamente el comportamiento nuevo (hit/miss, que la key
 * está scopeada por usuario, que la invalidación compartida la alcanza) — no
 * tiene sentido mockear la pieza que se está probando.
 */
vi.mock("./timeEntries.service", () => ({
  timeEntriesService: { homeSummary: vi.fn() },
  timeEntriesExportToCsv: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
  clearEmployeeTimeGridCache: vi.fn(),
}));

const mockedHomeSummary = timeEntriesService.homeSummary as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/time-entries/home-summary",
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

beforeEach(() => {
  vi.clearAllMocks();
  homeSummaryCache.clear();
});

describe("timeEntriesController.homeSummary — cache backend (Etapa 14G.2)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado en cache", async () => {
    mockedHomeSummary.mockResolvedValue({ role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 2, fichadasObservadas: 3 });
    const res = fakeRes();

    await timeEntriesController.homeSummary(fakeReq(), res);

    expect(mockedHomeSummary).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: { role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 2, fichadasObservadas: 3 } });
  });

  it("segundo pedido del mismo usuario dentro del TTL: cache hit, NO vuelve a llamar al service", async () => {
    mockedHomeSummary.mockResolvedValue({ role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 2, fichadasObservadas: 3 });

    await timeEntriesController.homeSummary(fakeReq(), fakeRes());
    const res2 = fakeRes();
    await timeEntriesController.homeSummary(fakeReq(), res2);

    expect(mockedHomeSummary).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: { role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 2, fichadasObservadas: 3 } });
  });

  it("key scopeada por usuario: dos usuarios distintos nunca comparten el resultado cacheado del otro", async () => {
    mockedHomeSummary
      .mockResolvedValueOnce({ role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 0, fichadasObservadas: 0 })
      .mockResolvedValueOnce({ role: "carga", period: "2026-09", paraCargar: 5, devueltosParaCorregir: 0, enviadoEsperandoRevision: 0 });

    const resA = fakeRes();
    await timeEntriesController.homeSummary(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA);
    const resB = fakeRes();
    await timeEntriesController.homeSummary(fakeReq({ user: { id: "user-b", role: "NIVEL_3_CARGA_HORARIA" } } as Partial<Request>), resB);

    expect(mockedHomeSummary).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.objectContaining({ role: "revision", paraRevisarHoy: 1 }) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.objectContaining({ role: "carga", paraCargar: 5 }) });

    // Repetir el pedido de user-a: debe seguir siendo SU propio resultado
    // cacheado (revision/paraRevisarHoy:1), nunca el de user-b.
    const resA2 = fakeRes();
    await timeEntriesController.homeSummary(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA2);
    expect(mockedHomeSummary).toHaveBeenCalledTimes(2); // sigue en 2: hit de cache para user-a
    expect(resA2.json).toHaveBeenCalledWith({ data: expect.objectContaining({ role: "revision", paraRevisarHoy: 1 }) });
  });

  it("clearTimeEntriesReadCaches() invalida homeSummaryCache — el próximo pedido vuelve a pegarle al service", async () => {
    mockedHomeSummary.mockResolvedValue({ role: "revision", period: "2026-09", paraRevisarHoy: 1, novedadesPendientes: 0, fichadasObservadas: 0 });

    await timeEntriesController.homeSummary(fakeReq(), fakeRes());
    expect(mockedHomeSummary).toHaveBeenCalledTimes(1);

    clearTimeEntriesReadCaches();

    await timeEntriesController.homeSummary(fakeReq(), fakeRes());
    expect(mockedHomeSummary).toHaveBeenCalledTimes(2);
  });
});
