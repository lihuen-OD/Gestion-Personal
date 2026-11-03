import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";
import { manualHoursConflictApiService } from "./manualHoursConflictApiService";

vi.mock("./apiClient", async (importOriginal) => ({ ...(await importOriginal<typeof import("./apiClient")>()), apiRequest: vi.fn() }));
vi.mock("../cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cache")>()), invalidateCacheFamily: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("manualHoursConflictApiService (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md)", () => {
  it("lista las revisiones del período sin caché (tiene que mostrar la decisión recién tomada)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await manualHoursConflictApiService.list("2026-10", "employee-1");

    expect(apiRequest).toHaveBeenCalledWith("/time-entries/manual-hours-conflicts?period=2026-10&employeeId=employee-1", { apiCache: false });
  });

  it("resolver envía la decisión (y el motivo sólo si hay) e invalida horas, alertas y notificaciones", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "alert-1", status: "RESUELTA" } });

    await manualHoursConflictApiService.resolve("alert-1", "USE_CLOCK", "  Verificado  ");
    await manualHoursConflictApiService.resolve("alert-1", "KEEP_MANUAL", "   ");

    expect(apiRequest).toHaveBeenNthCalledWith(1, "/time-entries/manual-hours-conflicts/alert-1/resolve", { method: "POST", body: { decision: "USE_CLOCK", correctionReason: "Verificado" } });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/time-entries/manual-hours-conflicts/alert-1/resolve", { method: "POST", body: { decision: "KEEP_MANUAL" } });
    const families = [...new Set(vi.mocked(invalidateCacheFamily).mock.calls.map(([family]) => family))].sort();
    expect(families).toEqual(["dashboard", "employees", "monthly-closures", "notifications", "pending", "shift-alerts", "time-entries"]);
  });

  it("si la decisión falla no invalida nada", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("409"));
    await expect(manualHoursConflictApiService.resolve("alert-1", "KEEP_MANUAL")).rejects.toThrow();
    expect(invalidateCacheFamily).not.toHaveBeenCalled();
  });
});
