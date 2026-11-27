import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { employeesController } from "./employees.controller";
import { employeesService } from "./employees.service";
import { automaticHourConceptBreakdownsService } from "./automaticHourConceptBreakdowns.service";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { invalidateEmployeeScopeCaches } from "./employeeScopeCaches";

vi.mock("./employees.service", () => ({
  employeesService: {
    upsertManualHourConceptBreakdown: vi.fn(),
    returnManualHourConceptBreakdown: vi.fn(),
    replaceAssignments: vi.fn(),
  },
}));

vi.mock("./employeeScopeCaches", () => ({
  invalidateEmployeeScopeCaches: vi.fn(),
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

  it("recalculateAutomaticHourConceptBreakdowns limpia las cachés de lectura de time-entries", async () => {
    await employeesController.recalculateAutomaticHourConceptBreakdowns(fakeReq(), fakeRes());
    expect(mockedClearTimeEntriesReadCaches).toHaveBeenCalledTimes(1);
  });
});

describe("employeesController.replaceAssignments — alcance visible sin esperar TTL", () => {
  it("después de guardar responsables/asignaciones invalida todas las cachés que dependen del alcance", async () => {
    const replaceAssignments = (employeesService as unknown as { replaceAssignments: Mock }).replaceAssignments;
    replaceAssignments.mockResolvedValue({ id: "emp-1", legajo: "100" });
    const res = fakeRes();

    await employeesController.replaceAssignments(fakeReq({ body: { assignments: [] } }), res);

    expect(invalidateEmployeeScopeCaches).toHaveBeenCalledTimes(1);
    expect(replaceAssignments.mock.invocationCallOrder[0]).toBeLessThan((invalidateEmployeeScopeCaches as unknown as Mock).mock.invocationCallOrder[0]!);
    expect(res.json).toHaveBeenCalledWith({ data: { id: "emp-1", legajo: "100" } });
  });

  it("si el guardado falla no invalida (nada cambió)", async () => {
    (employeesService as unknown as { replaceAssignments: Mock }).replaceAssignments.mockRejectedValue(new Error("fallo"));

    await expect(employeesController.replaceAssignments(fakeReq({ body: { assignments: [] } }), fakeRes())).rejects.toThrow("fallo");
    expect(invalidateEmployeeScopeCaches).not.toHaveBeenCalled();
  });
});
