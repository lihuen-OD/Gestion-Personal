import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { Request, Response } from "express";
import { workforceController } from "./workforce.controller";
import { workforceService } from "./workforce.service";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearEmployeeReadCaches } from "../employees/employees.controller";
import { doubleRulesCache, shiftTemplatesCache } from "./workforce.cache";

vi.mock("./workforce.service", () => ({
  workforceService: {
    approveCorrection: vi.fn(),
    shiftTemplates: vi.fn(),
    createShiftTemplate: vi.fn(),
    updateShiftTemplate: vi.fn(),
    removeShiftTemplate: vi.fn(),
    doubleRules: vi.fn(),
    createDoubleRule: vi.fn(),
    updateDoubleRule: vi.fn(),
    removeDoubleRule: vi.fn(),
  },
}));

vi.mock("../time-entries/timeEntries.cache", () => ({
  clearTimeEntriesReadCaches: vi.fn(),
}));

vi.mock("../employees/employees.controller", () => ({
  clearEmployeeReadCaches: vi.fn(),
}));

// Etapa 9C: workforce.cache.ts NO se mockea acá a propósito — estos tests
// verifican el comportamiento real del cache (hit/miss/invalidación), no
// sólo que se llamen ciertas funciones.
const mockedService = workforceService as unknown as {
  approveCorrection: Mock;
  shiftTemplates: Mock; createShiftTemplate: Mock; updateShiftTemplate: Mock; removeShiftTemplate: Mock;
  doubleRules: Mock; createDoubleRule: Mock; updateDoubleRule: Mock; removeDoubleRule: Mock;
};
const mockedClearTimeEntriesReadCaches = clearTimeEntriesReadCaches as unknown as Mock;
const mockedClearEmployeeReadCaches = clearEmployeeReadCaches as unknown as Mock;

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: { id: "correction-1" },
    originalUrl: "/workforce/closures",
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
  shiftTemplatesCache.clear();
  doubleRulesCache.clear();
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

describe("workforceController.shiftTemplates — cache de lectura TTL (Etapa 9C)", () => {
  const templates = [{ id: "template-1", code: "T-1", name: "Turno mañana" }];

  it("la primera llamada lee de Prisma (vía el service)", async () => {
    mockedService.shiftTemplates.mockResolvedValue(templates);
    const res = fakeRes();

    await workforceController.shiftTemplates(fakeReq({ originalUrl: "/workforce/shift-templates" }), res);

    expect(mockedService.shiftTemplates).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: templates });
  });

  it("la segunda llamada (mismo usuario) usa el cache, sin volver a golpear el service", async () => {
    mockedService.shiftTemplates.mockResolvedValue(templates);
    const req = fakeReq({ originalUrl: "/workforce/shift-templates" });

    await workforceController.shiftTemplates(req, fakeRes());
    const res2 = fakeRes();
    await workforceController.shiftTemplates(req, res2);

    expect(mockedService.shiftTemplates).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: templates });
  });

  it("no cambia el shape de la respuesta respecto de leer directo del service", async () => {
    mockedService.shiftTemplates.mockResolvedValue(templates);
    const res = fakeRes();
    await workforceController.shiftTemplates(fakeReq({ originalUrl: "/workforce/shift-templates" }), res);
    expect(res.json).toHaveBeenCalledWith({ data: templates });
  });

  it.each([
    ["createShiftTemplate", () => workforceController.createShiftTemplate(fakeReq({ originalUrl: "/workforce/shift-templates", body: { code: "T-2", name: "Turno tarde" } }), fakeRes())],
    ["updateShiftTemplate", () => workforceController.updateShiftTemplate(fakeReq({ originalUrl: "/workforce/shift-templates/template-1", params: { id: "template-1" }, body: { name: "Turno mañana (editado)" } }), fakeRes())],
    ["removeShiftTemplate", () => workforceController.removeShiftTemplate(fakeReq({ originalUrl: "/workforce/shift-templates/template-1", params: { id: "template-1" } }), fakeRes())],
  ])("%s invalida el cache — la siguiente lectura vuelve a golpear el service", async (_name, mutate) => {
    mockedService.shiftTemplates.mockResolvedValue(templates);
    const req = fakeReq({ originalUrl: "/workforce/shift-templates" });
    await workforceController.shiftTemplates(req, fakeRes()); // primera lectura, cachea
    await workforceController.shiftTemplates(req, fakeRes()); // cache hit
    expect(mockedService.shiftTemplates).toHaveBeenCalledTimes(1);

    mockedService.createShiftTemplate.mockResolvedValue({ id: "template-2" });
    mockedService.updateShiftTemplate.mockResolvedValue({ id: "template-1" });
    mockedService.removeShiftTemplate.mockResolvedValue({ mode: "DELETED", id: "template-1" });
    await mutate();

    const updatedTemplates = [...templates, { id: "template-2", code: "T-2", name: "Turno tarde" }];
    mockedService.shiftTemplates.mockResolvedValue(updatedTemplates);
    const res = fakeRes();
    await workforceController.shiftTemplates(req, res);

    expect(mockedService.shiftTemplates).toHaveBeenCalledTimes(2); // volvió a leer de Prisma, no del cache viejo
    expect(res.json).toHaveBeenCalledWith({ data: updatedTemplates });
  });
});

describe("workforceController.doubleRules — cache de lectura TTL (Etapa 9C)", () => {
  const rules = [{ id: "rule-1", name: "Domingo", priority: 0, status: "ACTIVO", dates: [] }];

  it("la primera llamada lee de Prisma (vía el service)", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const res = fakeRes();

    await workforceController.doubleRules(fakeReq({ originalUrl: "/workforce/double-hour-rules" }), res);

    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ data: rules });
  });

  it("la segunda llamada (mismo usuario) usa el cache, sin volver a golpear el service", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const req = fakeReq({ originalUrl: "/workforce/double-hour-rules" });

    await workforceController.doubleRules(req, fakeRes());
    const res2 = fakeRes();
    await workforceController.doubleRules(req, res2);

    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);
    expect(res2.json).toHaveBeenCalledWith({ data: rules });
  });

  it("no cambia el shape de la respuesta respecto de leer directo del service", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const res = fakeRes();
    await workforceController.doubleRules(fakeReq({ originalUrl: "/workforce/double-hour-rules" }), res);
    expect(res.json).toHaveBeenCalledWith({ data: rules });
  });

  it("createDoubleRule invalida el cache — la siguiente lectura vuelve a golpear el service", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const req = fakeReq({ originalUrl: "/workforce/double-hour-rules" });
    await workforceController.doubleRules(req, fakeRes());
    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);

    mockedService.createDoubleRule.mockResolvedValue({ id: "rule-2" });
    await workforceController.createDoubleRule(fakeReq({ originalUrl: "/workforce/double-hour-rules", body: { name: "Feriado" } }), fakeRes());

    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(2);
  });

  it("actualizar las fechas de una regla de feriado invalida el cache", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const req = fakeReq({ originalUrl: "/workforce/double-hour-rules" });
    await workforceController.doubleRules(req, fakeRes());
    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);

    mockedService.updateDoubleRule.mockResolvedValue({ id: "rule-1", recurrenceType: "FECHA", dates: [{ date: "2026-12-25", isActive: true }] });
    await workforceController.updateDoubleRule(fakeReq({
      originalUrl: "/workforce/double-hour-rules/rule-1",
      params: { id: "rule-1" },
      body: { recurrenceType: "FECHA", dates: [{ date: "2026-12-25", isActive: true }, { date: "2027-01-01", isActive: false }] },
    }), fakeRes());

    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(2);
  });

  it("cambiar la prioridad de una regla invalida el cache", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const req = fakeReq({ originalUrl: "/workforce/double-hour-rules" });
    await workforceController.doubleRules(req, fakeRes());
    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);

    mockedService.updateDoubleRule.mockResolvedValue({ id: "rule-1", priority: 5 });
    await workforceController.updateDoubleRule(fakeReq({
      originalUrl: "/workforce/double-hour-rules/rule-1",
      params: { id: "rule-1" },
      body: { priority: 5 },
    }), fakeRes());

    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(2);
  });

  it("activar/desactivar una regla (updateDoubleRule con status, y removeDoubleRule) invalida el cache en ambos casos", async () => {
    mockedService.doubleRules.mockResolvedValue(rules);
    const req = fakeReq({ originalUrl: "/workforce/double-hour-rules" });
    await workforceController.doubleRules(req, fakeRes());
    await workforceController.doubleRules(req, fakeRes());
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(1);

    mockedService.updateDoubleRule.mockResolvedValue({ id: "rule-1", status: "INACTIVO" });
    await workforceController.updateDoubleRule(fakeReq({
      originalUrl: "/workforce/double-hour-rules/rule-1",
      params: { id: "rule-1" },
      body: { status: "INACTIVO" },
    }), fakeRes());
    await workforceController.doubleRules(req, fakeRes()); // miss tras updateDoubleRule -> vuelve a cachear
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(2);

    mockedService.removeDoubleRule.mockResolvedValue({ mode: "INACTIVATED", item: { id: "rule-1", status: "INACTIVO" } });
    await workforceController.removeDoubleRule(fakeReq({
      originalUrl: "/workforce/double-hour-rules/rule-1",
      params: { id: "rule-1" },
    }), fakeRes());
    await workforceController.doubleRules(req, fakeRes()); // miss tras removeDoubleRule
    expect(mockedService.doubleRules).toHaveBeenCalledTimes(3);
  });
});
