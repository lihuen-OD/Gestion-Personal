import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { attendanceApiService } from "./attendanceApiService";

vi.mock("./apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiClient")>();
  return { ...actual, apiRequest: vi.fn(), apiDownload: actual.apiDownload };
});

// `invalidateCacheFamily` queda envuelta (no reemplazada) para poder
// espiarla y, a la vez, ejercer la invalidación real -- mismo criterio ya
// usado en workforceApiService.test.ts (14G.6/14G.8).
vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

// Etapa 14G.9: `getSummary`/`getObservations` no tenían dedupe/cache
// frontend -- el doble-montaje de StrictMode disparaba 2 llamadas de red
// reales a cada uno (confirmado en el journey de 14G.8, "Entrar a
// Asistencia": GET /time-entries/attendance x2, GET /time-entries/
// attendance/observations x2). Mismo patrón ya usado 7 veces en esta serie
// (shift alerts/notifications/time-entries list-listByEmployee/closures/
// corrections/home-summary).
describe("attendanceApiService.getSummary/getObservations — dedupe/cache frontend (Etapa 14G.9)", () => {
  const summaryResponse = { data: { date: "2026-08-27", totals: { open: 1, closed: 0, observed: 0, workedHours: 2 }, openShifts: [], closedShifts: [], observedShifts: [], observedPunches: [] } };
  const observationsResponse = { data: [{ kind: "SHIFT", occurredAt: "2026-08-27T10:00:00.000Z" }], meta: { total: 1, pageSize: 10, hasMore: false, nextBefore: null } };

  beforeEach(async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("getSummary: dos llamadas concurrentes con la misma fecha generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(summaryResponse);

    const [a, b] = await Promise.all([attendanceApiService.getSummary("2026-08-27"), attendanceApiService.getSummary("2026-08-27")]);

    expect(a).toEqual(summaryResponse.data);
    expect(b).toEqual(summaryResponse.data);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("getSummary: una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(summaryResponse);

    await attendanceApiService.getSummary("2026-08-27");
    await attendanceApiService.getSummary("2026-08-27");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("getSummary: cambiar de fecha es un cache miss nuevo", async () => {
    vi.mocked(apiRequest).mockResolvedValue(summaryResponse);

    await attendanceApiService.getSummary("2026-08-27");
    await attendanceApiService.getSummary("2026-08-26");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("getObservations: dos llamadas concurrentes con los mismos filtros generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(observationsResponse);

    const [a, b] = await Promise.all([attendanceApiService.getObservations({ date: "2026-08-27" }), attendanceApiService.getObservations({ date: "2026-08-27" })]);

    expect(a).toEqual(observationsResponse);
    expect(b).toEqual(observationsResponse);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("getObservations: una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(observationsResponse);

    await attendanceApiService.getObservations({ date: "2026-08-27" });
    await attendanceApiService.getObservations({ date: "2026-08-27" });

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("getObservations: cambiar el filtro de tipo es un cache miss nuevo", async () => {
    vi.mocked(apiRequest).mockResolvedValue(observationsResponse);

    await attendanceApiService.getObservations({ date: "2026-08-27", type: "ALL" });
    await attendanceApiService.getObservations({ date: "2026-08-27", type: "SHIFT" });

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["resolveObservation", () => attendanceApiService.resolveObservation("SHIFT", "shift-1", "RESUELTA", "motivo")],
    ["closeWorkShiftManually", () => attendanceApiService.closeWorkShiftManually("shift-1", { endAt: "2026-08-27T20:00:00.000Z", reason: "motivo" })],
    ["markMissingOut", () => attendanceApiService.markMissingOut("shift-1", "motivo")],
    ["observeWorkShift", () => attendanceApiService.observeWorkShift("shift-1", "motivo")],
  ])("%s invalida la familia 'time-entries'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("time-entries", expect.any(String));
  });

  it("después de invalidar 'time-entries' (p. ej. tras resolver una observación), getSummary/getObservations vuelven a pedirse", async () => {
    vi.mocked(apiRequest).mockImplementation((url: string) => (url.includes("/observations") ? Promise.resolve(observationsResponse) : Promise.resolve(summaryResponse)));
    await attendanceApiService.getSummary("2026-08-27");
    await attendanceApiService.getObservations({ date: "2026-08-27" });
    expect(apiRequest).toHaveBeenCalledTimes(2);

    await invalidateCacheFamily("time-entries", "unit test");

    await attendanceApiService.getSummary("2026-08-27");
    await attendanceApiService.getObservations({ date: "2026-08-27" });

    expect(apiRequest).toHaveBeenCalledTimes(4);
  });
});
