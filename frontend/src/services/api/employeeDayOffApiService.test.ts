import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";
import { employeeDayOffApiService } from "./employeeDayOffApiService";

vi.mock("./apiClient", async (importOriginal) => ({ ...(await importOriginal<typeof import("./apiClient")>()), apiRequest: vi.fn() }));
vi.mock("../cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cache")>()), invalidateCacheFamily: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("employeeDayOffApiService (docs/decisions/EMPLOYEE_DAY_OFF.md)", () => {
  it("consulta por fecha sin caché (el modal decide con el estado vigente) y con búsqueda/paginación", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { date: "2026-11-05", items: [] }, meta: { total: 0, page: 2, pageSize: 50, hasMore: false } });

    const result = await employeeDayOffApiService.getByDate({ date: "2026-11-05", search: " ana ", page: 2 });

    expect(apiRequest).toHaveBeenCalledWith("/employee-day-offs/by-date?date=2026-11-05&page=2&take=50&search=ana", { apiCache: false });
    expect(result).toEqual({ items: [], meta: { total: 0, page: 2, pageSize: 50, hasMore: false } });
  });

  it("guardar en lote invalida todo lo que muestra horas, alertas y notificaciones (mismo alcance que el backend)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { date: "2026-11-05", summary: { changed: 2 } } });
    const input = { date: "2026-11-05", employees: [{ employeeId: "e1", status: "ACTIVO" as const }, { employeeId: "e2", status: "ACTIVO" as const }] };

    await employeeDayOffApiService.save(input);

    expect(apiRequest).toHaveBeenCalledWith("/employee-day-offs", { method: "PUT", body: input });
    const families = vi.mocked(invalidateCacheFamily).mock.calls.map(([family]) => family).sort();
    expect(families).toEqual(["dashboard", "employees", "monthly-closures", "notifications", "pending", "shift-alerts", "time-entries"]);
  });

  it("si el guardado falla no invalida nada", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("409"));
    await expect(employeeDayOffApiService.save({ date: "2026-11-05", employees: [] })).rejects.toThrow();
    expect(invalidateCacheFamily).not.toHaveBeenCalled();
  });
});
