import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { employeesController } from "./employees.controller";
import { employeesService } from "./employees.service";
import { automaticHourConceptBreakdownsService } from "./automaticHourConceptBreakdowns.service";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";

vi.mock("./employees.service", () => ({
  employeesService: {
    upsertManualHourConceptBreakdown: vi.fn(),
    approveManualHourConceptBreakdown: vi.fn(),
    rejectManualHourConceptBreakdown: vi.fn(),
    returnManualHourConceptBreakdown: vi.fn(),
  },
}));

vi.mock("./automaticHourConceptBreakdowns.service", () => ({
  automaticHourConceptBreakdownsService: { recalculate: vi.fn() },
}));

vi.mock("../time-entries/timeEntries.cache", () => ({
  clearTimeEntriesReadCaches: vi.fn(),
}));

vi.mock("../documents/documents.cache", () => ({
  clearDocumentsReadCaches: vi.fn(),
}));

const mockedService = employeesService as unknown as {
  upsertManualHourConceptBreakdown: Mock;
  approveManualHourConceptBreakdown: Mock;
  rejectManualHourConceptBreakdown: Mock;
  returnManualHourConceptBreakdown: Mock;
};
const mockedRecalculate = automaticHourConceptBreakdownsService.recalculate as unknown as Mock;
const mockedClearTimeEntriesReadCaches = clearTimeEntriesReadCaches as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: { period: "2026-08" },
    params: { id: "emp-1", breakdownId: "brk-1" },
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
  mockedService.upsertManualHourConceptBreakdown.mockResolvedValue({ id: "brk-1", status: "EN_REVISION" });
  mockedService.approveManualHourConceptBreakdown.mockResolvedValue({ id: "brk-1", status: "APROBADO" });
  mockedService.rejectManualHourConceptBreakdown.mockResolvedValue({ id: "brk-1", status: "RECHAZADO" });
  mockedService.returnManualHourConceptBreakdown.mockResolvedValue({ id: "brk-1", status: "DEVUELTO" });
  mockedRecalculate.mockResolvedValue({ period: "2026-08", items: [] });
});

// Etapa 7A: espejo del test de la Etapa 6L.4 en timeEntries.controller.test.ts.
// Los mutadores de HourConceptBreakdown escriben lo que findPeriodEmployees()
// lee para la columna "especial" del listado por período — que se sirve desde
// timeEntriesPeriodEmployeesCache (20s de TTL). Sin limpiar esa caché acá, el
// desglose se guardaba en base pero Carga de horas seguía mostrando el valor
// anterior hasta que expirara el TTL.
describe("employeesController — invalidación de timeEntriesPeriodEmployeesCache (Etapa 7A)", () => {
  it("upsertManualHourConceptBreakdown limpia las cachés de lectura de time-entries", async () => {
    await employeesController.upsertManualHourConceptBreakdown(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("approveManualHourConceptBreakdown limpia las cachés de lectura de time-entries", async () => {
    await employeesController.approveManualHourConceptBreakdown(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("rejectManualHourConceptBreakdown limpia las cachés de lectura de time-entries", async () => {
    await employeesController.rejectManualHourConceptBreakdown(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("returnManualHourConceptBreakdown limpia las cachés de lectura de time-entries", async () => {
    await employeesController.returnManualHourConceptBreakdown(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("recalculateAutomaticHourConceptBreakdowns limpia las cachés de lectura de time-entries", async () => {
    await employeesController.recalculateAutomaticHourConceptBreakdowns(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });

  it("sigue devolviendo el desglose resuelto en el body (la UI lo usa para refrescar)", async () => {
    const res = fakeRes();
    await employeesController.approveManualHourConceptBreakdown(fakeReq(), res);
    expect(res.json).toHaveBeenCalledWith({ data: { id: "brk-1", status: "APROBADO" } });
  });
});
