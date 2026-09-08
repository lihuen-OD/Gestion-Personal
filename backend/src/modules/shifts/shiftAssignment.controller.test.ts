import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { shiftAssignmentController } from "./shiftAssignment.controller";
import { shiftAssignmentService } from "./shiftAssignment.service";
import { shiftAssignmentSummaryCache, clearShiftAssignmentSummaryCache } from "./shiftAssignment.cache";

/**
 * Etapa 14H.3 -- mismo criterio que shiftAlert.controller.test.ts (14G.5): se
 * prueba la cache REAL (no mockeada), porque lo que hace falta validar es
 * exactamente el comportamiento nuevo (hit/miss, key por usuario+rol,
 * invalidación tras assign/update/remove).
 */
vi.mock("./shiftAssignment.service", () => ({
  shiftAssignmentService: { summary: vi.fn(), list: vi.fn(), assign: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

vi.mock("../audit/audit.service", () => ({
  auditService: { register: vi.fn().mockResolvedValue(null) },
}));

const mockedSummary = shiftAssignmentService.summary as unknown as Mock;
const mockedAssign = shiftAssignmentService.assign as unknown as Mock;
const mockedUpdate = shiftAssignmentService.update as unknown as Mock;
const mockedRemove = shiftAssignmentService.remove as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    originalUrl: "/api/shifts/assignments/summary",
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

const sampleResult = [{ shiftTemplateId: "shift-1", total: 5, enabled: 4, disabled: 1, other: 0 }];

beforeEach(() => {
  vi.clearAllMocks();
  shiftAssignmentSummaryCache.clear();
});

describe("shiftAssignmentController.summary — cache backend (Etapa 14H.3)", () => {
  it("primer pedido: cache miss, llama al service y guarda el resultado", async () => {
    mockedSummary.mockResolvedValue(sampleResult);
    const res = fakeRes();

    await shiftAssignmentController.summary(fakeReq(), res);

    expect(mockedSummary).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: sampleResult });
  });

  it("segundo pedido idéntico (mismo usuario) dentro del TTL: cache hit, no vuelve a llamar al service", async () => {
    mockedSummary.mockResolvedValue(sampleResult);

    await shiftAssignmentController.summary(fakeReq(), fakeRes());
    const res2 = fakeRes();
    await shiftAssignmentController.summary(fakeReq(), res2);

    expect(mockedSummary).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: sampleResult });
  });

  it("key scopeada por usuario+rol: dos usuarios nunca comparten el resultado cacheado del otro", async () => {
    mockedSummary
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce([{ shiftTemplateId: "shift-1", total: 99, enabled: 99, disabled: 0, other: 0 }]);

    const resA = fakeRes();
    await shiftAssignmentController.summary(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA);
    const resB = fakeRes();
    await shiftAssignmentController.summary(fakeReq({ user: { id: "user-b", role: "NIVEL_2_SUPERVISION" } } as Partial<Request>), resB);

    expect(mockedSummary).toHaveBeenCalledTimes(2);
    expect(resA.json).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ total: 5 })]) });
    expect(resB.json).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ total: 99 })]) });

    // Repetir el pedido de user-a: debe seguir siendo SU propio resultado (total:5), nunca el de user-b (total:99).
    const resA2 = fakeRes();
    await shiftAssignmentController.summary(fakeReq({ user: { id: "user-a", role: "NIVEL_1_RRHH" } } as Partial<Request>), resA2);
    expect(mockedSummary).toHaveBeenCalledTimes(2); // sigue en 2: hit de cache para user-a
    expect(resA2.json).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ total: 5 })]) });
  });

  it("clearShiftAssignmentSummaryCache() invalida la cache — el próximo pedido vuelve a pegarle al service", async () => {
    mockedSummary.mockResolvedValue(sampleResult);

    await shiftAssignmentController.summary(fakeReq(), fakeRes());
    expect(mockedSummary).toHaveBeenCalledTimes(1);

    clearShiftAssignmentSummaryCache();

    await shiftAssignmentController.summary(fakeReq(), fakeRes());
    expect(mockedSummary).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["assign", () => shiftAssignmentController.assign(fakeReq({ body: { employeeIds: ["employee-1"], shiftTemplateId: "shift-1", effectiveFrom: "2026-09-08" } } as Partial<Request>), fakeRes())],
    ["update", () => shiftAssignmentController.update(fakeReq({ params: { id: "assignment-1" }, body: { observation: "x" } } as Partial<Request>), fakeRes())],
    ["remove", () => shiftAssignmentController.remove(fakeReq({ params: { id: "assignment-1" } } as Partial<Request>), fakeRes())],
  ])("%s (escritura real) invalida la cache — el próximo pedido de summary vuelve a pegarle al service", async (_name, mutate) => {
    mockedSummary.mockResolvedValue(sampleResult);
    mockedAssign.mockResolvedValue([]);
    mockedUpdate.mockResolvedValue({});
    mockedRemove.mockResolvedValue({ id: "assignment-1" });

    // Popula la cache con el resultado "viejo".
    await shiftAssignmentController.summary(fakeReq(), fakeRes());
    expect(mockedSummary).toHaveBeenCalledTimes(1);

    await mutate();

    // El próximo pedido de summary ya no debe servir el resultado cacheado viejo.
    mockedSummary.mockResolvedValue([{ shiftTemplateId: "shift-1", total: 6, enabled: 5, disabled: 1, other: 0 }]);
    const resAfter = fakeRes();
    await shiftAssignmentController.summary(fakeReq(), resAfter);

    expect(mockedSummary).toHaveBeenCalledTimes(2);
    expect(resAfter.json).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ total: 6 })]) });
  });
});
