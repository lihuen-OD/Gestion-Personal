import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { timeEntriesController } from "./timeEntries.controller";
import { timeEntriesService } from "./timeEntries.service";
import { clearTimeEntriesReadCaches } from "./timeEntries.cache";
import { clearEmployeeReadCaches, clearEmployeeTimeGridCache } from "../employees/employees.controller";

vi.mock("./timeEntries.service", () => ({
  timeEntriesService: {
    create: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    returnForCorrection: vi.fn(),
  },
  timeEntriesExportToCsv: vi.fn(),
}));

vi.mock("./timeEntries.cache", () => ({
  clearTimeEntriesReadCaches: vi.fn(),
  timeEntriesListCache: { get: vi.fn(), set: vi.fn() },
  timeEntriesSummaryCache: { get: vi.fn(), set: vi.fn() },
  timeEntriesPeriodEmployeesCache: { get: vi.fn(), set: vi.fn() },
  attendanceSummaryCache: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
  clearEmployeeTimeGridCache: vi.fn(),
}));

const mockedService = timeEntriesService as unknown as {
  create: Mock; update: Mock; submit: Mock; approve: Mock; reject: Mock; returnForCorrection: Mock;
};
const mockedClearTimeEntriesReadCaches = clearTimeEntriesReadCaches as unknown as Mock;
const mockedClearEmployeeReadCaches = clearEmployeeReadCaches as unknown as Mock;
const mockedClearEmployeeTimeGridCache = clearEmployeeTimeGridCache as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: { id: "entry-1" },
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
  mockedService.create.mockResolvedValue({ id: "entry-1", status: "APROBADO" });
  mockedService.update.mockResolvedValue({ id: "entry-1", status: "APROBADO" });
  mockedService.submit.mockResolvedValue({ id: "entry-1", status: "EN_REVISION" });
  mockedService.approve.mockResolvedValue({ id: "entry-1", status: "APROBADO" });
  mockedService.reject.mockResolvedValue({ id: "entry-1", status: "RECHAZADO" });
  mockedService.returnForCorrection.mockResolvedValue({ id: "entry-1", status: "DEVUELTO" });
});

describe("timeEntriesController — invalidación de employeeTimeGridCache (Etapa 6L.4 / 14C.2 ampliada)", () => {
  // Etapa 14C.2 (ampliada): create/update (guardado manual real) pasaron de
  // `clearEmployeeReadCaches` (6 caches de employees) a
  // `clearEmployeeTimeGridCache` (sólo la grilla horaria, la única
  // realmente afectada por guardar una hora) — ver
  // docs/decisions/TIME_ENTRIES_AND_EMPLOYEES_PERFORMANCE_14C2.md.
  it("create limpia las cachés de time-entries y sólo la grilla horaria del empleado (no todo employees)", async () => {
    await timeEntriesController.create(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeReadCaches).not.toHaveBeenCalled();
  });

  it("update limpia sólo la caché de la grilla del empleado (no todo employees)", async () => {
    await timeEntriesController.update(fakeReq(), fakeRes());
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeReadCaches).not.toHaveBeenCalled();
  });

  it("submit limpia la caché de la grilla del empleado", async () => {
    await timeEntriesController.submit(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("approve limpia la caché de la grilla del empleado", async () => {
    await timeEntriesController.approve(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("reject limpia la caché de la grilla del empleado", async () => {
    await timeEntriesController.reject(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("returnForCorrection limpia la caché de la grilla del empleado", async () => {
    await timeEntriesController.returnForCorrection(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).toHaveBeenCalledTimes(1);
  });

  it("create sigue devolviendo el registro completo guardado (para poder actualizar la UI localmente)", async () => {
    const res = fakeRes();
    await timeEntriesController.create(fakeReq(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: { id: "entry-1", status: "APROBADO" } });
  });
});
