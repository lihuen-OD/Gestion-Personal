import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";
import { workforceApiService, type DoubleHourRuleInput } from "./workforceApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));
vi.mock("../cache", () => ({ invalidateCacheFamily: vi.fn() }));

describe("workforceApiService.createDoubleHourRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("envía el multiplicador elegido sin reemplazarlo por el default", async () => {
    const input: DoubleHourRuleInput = {
      name: "Hora especial",
      recurrenceType: "FECHA",
      fromDate: "2026-08-25",
      toDate: null,
      weekdays: [],
      multiplier: 1.5,
      priority: 0,
      employeeIds: ["employee-1"],
      reason: "Evento especial",
    };
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "rule-1" } });

    await workforceApiService.createDoubleHourRule(input);

    expect(apiRequest).toHaveBeenCalledWith("/workforce/double-hour-rules", { method: "POST", body: input });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body).toMatchObject({ multiplier: 1.5 });
  });
});

// Etapa 9G: aprobar una corrección post-cierre reescribe TimeEntry.hours en
// el backend (workforce.service.ts:approveCorrection), que afecta la
// métrica "Horas cargadas" del dashboard. El backend ya invalida su propio
// cache (auditService.register limpia dashboardMetricsCache siempre), pero
// el cache del lado del frontend (dashboardMetricsApiService, TTL propio de
// 30s) es una capa aparte — nada la invalidaba antes de este fix.
describe("workforceApiService.reviewCorrection — invalidación de dashboard (Etapa 9G)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("al aprobar, invalida el cache de dashboard del lado del frontend", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "correction-1", status: "APROBADA" } });

    await workforceApiService.reviewCorrection("correction-1", "approve");

    expect(invalidateCacheFamily).toHaveBeenCalledWith("dashboard", expect.any(String));
  });

  it("al rechazar, NO invalida el cache de dashboard — rejectCorrection no toca TimeEntry", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "correction-1", status: "RECHAZADA" } });

    await workforceApiService.reviewCorrection("correction-1", "reject");

    expect(invalidateCacheFamily).not.toHaveBeenCalled();
  });

  it("sigue devolviendo el registro de la corrección (sin cambiar el contrato)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "correction-1", status: "APROBADA" } });

    const result = await workforceApiService.reviewCorrection("correction-1", "approve");

    expect(result).toEqual({ id: "correction-1", status: "APROBADA" });
  });
});
