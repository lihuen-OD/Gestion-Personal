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
    clockOut: vi.fn(),
    clockOutByEmployee: vi.fn(),
    clockPhotoPunchIdempotent: vi.fn(),
    createWorkShift: vi.fn(),
    closeWorkShiftManually: vi.fn(),
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
  clockOut: Mock; clockOutByEmployee: Mock; clockPhotoPunchIdempotent: Mock; createWorkShift: Mock; closeWorkShiftManually: Mock;
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
  mockedService.clockOut.mockResolvedValue({ workShift: { id: "shift-1" } });
  mockedService.clockOutByEmployee.mockResolvedValue({ workShift: { id: "shift-1" } });
  mockedService.clockPhotoPunchIdempotent.mockResolvedValue({ workShift: { id: "shift-1" } });
  mockedService.createWorkShift.mockResolvedValue({ workShift: { id: "shift-1" } });
  mockedService.closeWorkShiftManually.mockResolvedValue({ workShift: { id: "shift-1" } });
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

// Etapa 15M.2 (docs/decisions/ATTENDANCE_AUTO_BREAKDOWN_SYNC_15M2.md): 15M.1
// confirmó que clockOut/clockOutByEmployee/clockPhotoPunch y
// createWorkShift/closeWorkShiftManually sólo limpiaban
// `clearTimeEntriesReadCaches()` — la grilla por-legajo
// (`employeeTimeGridCache`) podía quedar hasta 60s desactualizada tras una
// salida real, aunque el TimeEntry normal ya se hubiera guardado (y, desde
// esta etapa, el breakdown automático también). Estos 5 handlers ahora
// invalidan ambas, con el mismo criterio acotado de 14C.2 (sólo la grilla
// del empleado, no `clearEmployeeReadCaches()` completo).
describe("timeEntriesController — invalidación de employeeTimeGridCache en fichador/cierres (Etapa 15M.2)", () => {
  it("clockOut limpia time-entries y la grilla horaria del empleado", async () => {
    await timeEntriesController.clockOut(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
  });

  it("clockOutByEmployee limpia time-entries y la grilla horaria del empleado", async () => {
    await timeEntriesController.clockOutByEmployee(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
  });

  it("clockPhotoPunch limpia time-entries y la grilla horaria del empleado", async () => {
    await timeEntriesController.clockPhotoPunch(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
  });

  it("createWorkShift limpia time-entries y la grilla horaria del empleado", async () => {
    await timeEntriesController.createWorkShift(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
  });

  it("closeWorkShiftManually limpia time-entries y la grilla horaria del empleado", async () => {
    await timeEntriesController.closeWorkShiftManually(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
    expect(mockedClearEmployeeTimeGridCache).toHaveBeenCalledTimes(1);
  });

  it("ninguno de los 5 amplía a clearEmployeeReadCaches() completo (sólo la grilla, mismo criterio de 14C.2)", async () => {
    await timeEntriesController.clockOut(fakeReq(), fakeRes());
    await timeEntriesController.clockOutByEmployee(fakeReq(), fakeRes());
    await timeEntriesController.clockPhotoPunch(fakeReq(), fakeRes());
    await timeEntriesController.createWorkShift(fakeReq(), fakeRes());
    await timeEntriesController.closeWorkShiftManually(fakeReq(), fakeRes());
    expect(mockedClearEmployeeReadCaches).not.toHaveBeenCalled();
  });
});
