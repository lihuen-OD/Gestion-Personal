import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { employeeApiService, employeeListRequest, mapEmployeeFromApi, orgChartReachedLimit } from "./employeeApiService";
import * as cache from "../cache";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));

describe("mapEmployeeFromApi transport", () => {
  it("keeps transport locality separate from the home address city", () => {
    const employee = mapEmployeeFromApi({
      id: "employee-1",
      legajo: "100",
      cuil: "20-12345678-9",
      dni: "12345678",
      firstName: "Ana",
      lastName: "Prueba",
      status: "ACTIVO",
      address: { city: "Luján" },
      transport: {
        usesCompanyTransport: true,
        locality: "Open Door",
        observation: "Sube en la plaza",
      },
    });

    expect(employee.city).toBe("Luján");
    expect(employee.transportLocality).toBe("Open Door");
    expect(employee.transportNotes).toBe("Sube en la plaza");
  });
});

describe("mapEmployeeFromApi — conceptos horarios adicionales 6F", () => {
  it("incluye datos de conceptos habilitados e ignora cualquier Normal legacy", () => {
    const base = { deletedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const employee = mapEmployeeFromApi({
      id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Prueba", status: "ACTIVO",
      hourConcepts: [
        { hourConceptId: "normal", hourConcept: { ...base, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" } },
        { hourConceptId: "colectivo", hourConcept: { ...base, id: "colectivo", code: "HOR-002", name: "Colectivo", kind: "TRANSPORTE", status: "ACTIVO", loadMode: "MANUAL", systemRole: null } },
      ],
    });
    expect(employee.enabledHours).toEqual(["Colectivo"]);
    expect(employee.enabledHourConcepts).toEqual([
      expect.objectContaining({ id: "colectivo", name: "Colectivo", kind: "TRANSPORTE", loadMode: "MANUAL", status: "ACTIVO", systemRole: null, enabled: true }),
    ]);
  });
});

describe("employeeApiService.getTimeGrid — grilla aditiva 6G", () => {
  it("preserva filas por id, modo y total trabajado explícito del backend", async () => {
    const base = { deletedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "ACTIVO" };
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Prueba", status: "ACTIVO" },
        entries: [], novelties: [], noveltyTypes: [], hourConcepts: [], attendanceIssues: 0,
        rows: [
          { concept: { ...base, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", loadMode: null, systemRole: "NORMAL_BASE" }, role: "NORMAL_BASE", minutesByDay: { "1": 600 }, totalMinutes: 600 },
          { concept: { ...base, id: "sereno", code: "HC-SERENO", name: "Sereno", kind: "SERENO", loadMode: "AUTOMATIC", systemRole: null }, role: "ADDITIONAL", minutesByDay: { "1": 360 }, totalMinutes: 360 },
        ],
        totalWorkedMinutes: 600,
      },
    } as never);

    const result = await employeeApiService.getTimeGrid("employee-1", "2026-08", { includeDetails: false });
    expect(result.totalWorkedMinutes).toBe(600);
    expect(result.rows.map((row) => [row.concept.id, row.concept.loadMode])).toEqual([["normal", null], ["sereno", "AUTOMATIC"]]);
  });
});

describe("employeeApiService manual breakdowns — 6H", () => {
  it("guarda por employeeId, hourConceptId y fecha sin usar el nombre", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "breakdown-1" } });
    await employeeApiService.saveManualHourConceptBreakdown("employee-1", {
      date: "2026-08-12", hourConceptId: "colectivo-id", minutes: 120, observation: "Traslado",
    });
    expect(apiRequest).toHaveBeenCalledWith("/employees/employee-1/hour-concept-breakdowns/manual", {
      method: "PUT",
      body: { date: "2026-08-12", hourConceptId: "colectivo-id", minutes: 120, observation: "Traslado" },
    });
  });

  it("borra mediante el mismo PUT enviando minutes cero", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: null });
    await employeeApiService.saveManualHourConceptBreakdown("employee-1", { date: "2026-08-12", hourConceptId: "colectivo-id", minutes: 0 });
    expect(apiRequest).toHaveBeenCalledWith("/employees/employee-1/hour-concept-breakdowns/manual", {
      method: "PUT", body: { date: "2026-08-12", hourConceptId: "colectivo-id", minutes: 0 },
    });
  });
});

describe("employeeApiService recalculateAutomaticHourConceptBreakdowns — 6J", () => {
  it("llama al endpoint explícito de 6I por employeeId y período, sin transformar el body", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: { employeeId: "employee-1", period: "2026-08", processedShifts: 3, eligibleConcepts: 2, generated: 3, removed: 1 },
    });
    const result = await employeeApiService.recalculateAutomaticHourConceptBreakdowns("employee-1", "2026-08");
    expect(apiRequest).toHaveBeenCalledWith("/employees/employee-1/hour-concept-breakdowns/recalculate-automatic", {
      method: "POST",
      body: { period: "2026-08" },
    });
    expect(result).toEqual({ employeeId: "employee-1", period: "2026-08", processedShifts: 3, eligibleConcepts: 2, generated: 3, removed: 1 });
  });
});

describe("employeeListRequest filtros sectorId/costCenterId (Etapa 8F)", () => {
  it("envía sectorId como query param cuando se filtra por sector", () => {
    const { path } = employeeListRequest({ sectorId: "sector-1" });
    expect(path).toContain("sectorId=sector-1");
  });

  it("envía costCenterId como query param cuando se filtra por centro de costo", () => {
    const { path } = employeeListRequest({ costCenterId: "cc-1" });
    expect(path).toContain("costCenterId=cc-1");
  });

  it("puede combinar sectorId y costCenterId sin pisarse entre sí", () => {
    const { path } = employeeListRequest({ sectorId: "sector-1", costCenterId: "cc-1" });
    expect(path).toContain("sectorId=sector-1");
    expect(path).toContain("costCenterId=cc-1");
  });

  it("sin sectorId/costCenterId (filtros no aplicados), no agrega esos query params", () => {
    const { path } = employeeListRequest({});
    expect(path).not.toContain("sectorId=");
    expect(path).not.toContain("costCenterId=");
  });

  it("limpiar el filtro (string vacío, como al elegir 'Todos') elimina el query param, igual que companyId", () => {
    const { path } = employeeListRequest({ sectorId: "", costCenterId: "" });
    expect(path).not.toContain("sectorId=");
    expect(path).not.toContain("costCenterId=");
  });
});

describe("employeeApiService — invalidación de cache 'time-entries'/'pending' tras mutar HourConceptBreakdown (Etapa 11A)", () => {
  // Bug encontrado durante la auditoría 11A: estos 5 métodos no invalidaban
  // ningún cache de frontend — la columna "Especiales" de la grilla de
  // período (family "time-entries") y la Bandeja de revisión (family
  // "pending") podían quedar hasta 30s desactualizadas tras guardar/aprobar/
  // rechazar/devolver un desglose manual, o recalcular los automáticos.
  it("saveManualHourConceptBreakdown invalida 'time-entries' y 'pending'", async () => {
    const spy = vi.spyOn(cache, "invalidateCacheFamily").mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "breakdown-1" } });

    await employeeApiService.saveManualHourConceptBreakdown("employee-1", { date: "2026-08-12", hourConceptId: "colectivo-id", minutes: 120 });

    expect(spy).toHaveBeenCalledWith("time-entries", expect.any(String));
    expect(spy).toHaveBeenCalledWith("pending", expect.any(String));
    spy.mockRestore();
  });

  it("approve/reject/returnManualHourConceptBreakdown invalidan 'time-entries' y 'pending'", async () => {
    const spy = vi.spyOn(cache, "invalidateCacheFamily").mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "breakdown-1" } });

    await employeeApiService.approveManualHourConceptBreakdown("employee-1", "breakdown-1");
    await employeeApiService.rejectManualHourConceptBreakdown("employee-1", "breakdown-1", "motivo");
    await employeeApiService.returnManualHourConceptBreakdown("employee-1", "breakdown-1", "motivo");

    expect(spy).toHaveBeenCalledWith("time-entries", expect.any(String));
    expect(spy).toHaveBeenCalledWith("pending", expect.any(String));
    expect(spy.mock.calls.filter(([family]) => family === "time-entries")).toHaveLength(3);
    spy.mockRestore();
  });

  it("recalculateAutomaticHourConceptBreakdowns invalida 'time-entries' (no cambia estado de revisión, no hace falta 'pending')", async () => {
    const spy = vi.spyOn(cache, "invalidateCacheFamily").mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue({ data: { employeeId: "employee-1", period: "2026-08", processedShifts: 0, eligibleConcepts: 0, generated: 0, removed: 0 } });

    await employeeApiService.recalculateAutomaticHourConceptBreakdowns("employee-1", "2026-08");

    expect(spy).toHaveBeenCalledWith("time-entries", expect.any(String));
    spy.mockRestore();
  });
});

describe("orgChartReachedLimit", () => {
  const employee = mapEmployeeFromApi({ id: "employee-1", legajo: "1", firstName: "Ana", lastName: "Test", status: "ACTIVO" });

  it("advierte cuando backend informa que existen más páginas", () => {
    expect(orgChartReachedLimit({ items: [employee], meta: { total: 1001, page: 1, pageSize: 1000, hasMore: true } })).toBe(true);
  });

  it("no advierte para una respuesta completa por debajo del límite", () => {
    expect(orgChartReachedLimit({ items: [employee], meta: { total: 1, page: 1, pageSize: 1000, hasMore: false } })).toBe(false);
  });
});
