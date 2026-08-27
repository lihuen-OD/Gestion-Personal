import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { workforceController } from "./workforce.controller";
import { workforceService } from "./workforce.service";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearEmployeeReadCaches } from "../employees/employees.controller";

vi.mock("./workforce.service", () => ({
  workforceService: {
    approveCorrection: vi.fn(),
  },
}));

vi.mock("../time-entries/timeEntries.cache", () => ({
  clearTimeEntriesReadCaches: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
}));

const mockedService = workforceService as unknown as { approveCorrection: Mock };
const mockedClearTimeEntriesReadCaches = clearTimeEntriesReadCaches as unknown as Mock;
const mockedClearEmployeeReadCaches = clearEmployeeReadCaches as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: { id: "correction-1" },
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
  mockedService.approveCorrection.mockResolvedValue({ id: "correction-1", status: "APROBADA" });
});

describe("workforceController.approveCorrection — invalidación de cache (Etapa 9B)", () => {
  it("limpia el cache de lectura de time-entries tras aprobar la corrección", async () => {
    await workforceController.approveCorrection(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("limpia el cache de lectura de legajos (grilla) tras aprobar la corrección", async () => {
    await workforceController.approveCorrection(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("invalida ambos caches sólo después de que el service haya terminado (no antes de confirmar la corrección)", async () => {
    const callOrder: string[] = [];
    mockedService.approveCorrection.mockImplementationOnce(async () => {
      callOrder.push("service");
      return { id: "correction-1", status: "APROBADA" };
    });
    mockedClearTimeEntriesReadCaches.mockImplementationOnce(() => callOrder.push("clearTimeEntries"));
    mockedClearEmployeeReadCaches.mockImplementationOnce(() => callOrder.push("clearEmployees"));

    await workforceController.approveCorrection(fakeReq(), fakeRes());

    expect(callOrder).toEqual(["service", "clearTimeEntries", "clearEmployees"]);
  });

  it("sigue devolviendo el registro de la corrección aprobada (sin cambiar el contrato de la respuesta)", async () => {
    const res = fakeRes();
    await workforceController.approveCorrection(fakeReq(), res);
    expect(res.json).toHaveBeenCalledWith({ data: { id: "correction-1", status: "APROBADA" } });
  });
});
