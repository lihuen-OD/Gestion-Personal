import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./apiClient";
import { clearAllAppCaches, invalidateCacheFamily } from "../cache";
import { workforceApiService, type DoubleHourRuleInput } from "./workforceApiService";

vi.mock("./apiClient", () => ({ apiRequest: vi.fn() }));
// Etapa 14F.2: `cachedData`/`cachePolicies`/`clearAllAppCaches` quedan
// reales (mismo módulo probado en services/cache/cachedData.test.ts) para
// poder verificar dedupe/TTL de verdad en unreadNotificationCount — sólo
// `invalidateCacheFamily` sigue espiado, como ya lo estaba antes de esta
// etapa para reviewCorrection.
vi.mock("../cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache")>();
  // Envuelve (no reemplaza) la implementación real: sigue siendo espiable
  // con toHaveBeenCalledWith (igual que antes de esta etapa) pero además
  // invalida la cache real de verdad — necesario para los tests de
  // unreadNotificationCount que verifican que, tras invalidar, se vuelve a
  // pedir el dato en vez de servir el valor cacheado.
  return { ...actual, invalidateCacheFamily: vi.fn(actual.invalidateCacheFamily) };
});

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

// Etapa 14F.2: antes de esta etapa, unreadNotificationCount() llamaba
// apiRequest directo sin ningún dedupe/cache frontend — en StrictMode
// (AppShell monta el effect dos veces) esto generaba 2 requests idénticos
// por mount, confirmado en el journey de 14F.1. Ver docs/decisions/
// INITIAL_APP_LANDING_OPTIMIZATION_14F2.md.
describe("workforceApiService.unreadNotificationCount — dedupe/cache frontend (Etapa 14F.2)", () => {
  beforeEach(async () => {
    // mockReset (no clearAllMocks): clearAllMocks no vacía la cola de
    // mockResolvedValueOnce/mockRejectedValueOnce de un test anterior — un
    // valor "once" no consumido (p. ej. porque la cache evitó una segunda
    // llamada real) quedaría filtrándose al test siguiente.
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("dos llamadas concurrentes generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { count: 3 } });

    const [a, b] = await Promise.all([workforceApiService.unreadNotificationCount(), workforceApiService.unreadNotificationCount()]);

    expect(a).toBe(3);
    expect(b).toBe(3);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { count: 5 } });

    await workforceApiService.unreadNotificationCount();
    await expect(workforceApiService.unreadNotificationCount()).resolves.toBe(5);

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("después de invalidar la familia 'notifications', vuelve a pedir", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { count: 1 } }).mockResolvedValueOnce({ data: { count: 2 } });

    await expect(workforceApiService.unreadNotificationCount()).resolves.toBe(1);
    await invalidateCacheFamily("notifications", "unit test");
    await expect(workforceApiService.unreadNotificationCount()).resolves.toBe(2);

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("un error no queda cacheado permanentemente — la siguiente llamada reintenta", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce({ data: { count: 4 } });

    await expect(workforceApiService.unreadNotificationCount()).rejects.toThrow("network error");
    await expect(workforceApiService.unreadNotificationCount()).resolves.toBe(4);

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});

// Etapa 14G.6: antes de esta etapa, notifications() llamaba apiRequest
// directo sin ningún dedupe/cache frontend — en StrictMode (NotificationsPage
// monta el effect dos veces) esto generaba 2 requests idénticos por mount,
// confirmado en el journey de 14G.1/14G.5. Mismo patrón exacto que
// unreadNotificationCount (14F.2), misma familia "notifications".
describe("workforceApiService.notifications — dedupe/cache frontend (Etapa 14G.6)", () => {
  const sampleResult = { data: [{ id: "n-1", title: "Cierre mensual" }], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } };

  beforeEach(async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00.000Z"));
    await clearAllAppCaches("test setup");
  });

  afterEach(async () => {
    await clearAllAppCaches("test teardown");
    vi.useRealTimers();
  });

  it("dos llamadas concurrentes con los mismos filtros generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(sampleResult);

    const [a, b] = await Promise.all([workforceApiService.notifications({ page: 1, take: 20 }), workforceApiService.notifications({ page: 1, take: 20 })]);

    expect(a.meta.total).toBe(1);
    expect(b.meta.total).toBe(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(sampleResult);

    await workforceApiService.notifications({ page: 1, take: 20 });
    await workforceApiService.notifications({ page: 1, take: 20 });

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("cambiar page/take/status es un cache miss nuevo (no sirve resultados de otra página/filtro)", async () => {
    vi.mocked(apiRequest).mockResolvedValue(sampleResult);

    await workforceApiService.notifications({ page: 1, take: 20 });
    await workforceApiService.notifications({ page: 2, take: 20 });
    await workforceApiService.notifications({ page: 1, take: 20, status: "NO_LEIDA" });

    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it("después de invalidar la familia 'notifications' (readNotification), vuelve a pedir", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(sampleResult)
      .mockResolvedValueOnce({ ...sampleResult, meta: { ...sampleResult.meta, total: 0 } });

    await expect(workforceApiService.notifications({ page: 1, take: 20 })).resolves.toMatchObject({ meta: { total: 1 } });
    await invalidateCacheFamily("notifications", "unit test");
    await expect(workforceApiService.notifications({ page: 1, take: 20 })).resolves.toMatchObject({ meta: { total: 0 } });

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("no cambia el contrato: sigue devolviendo {items, meta} igual que antes", async () => {
    vi.mocked(apiRequest).mockResolvedValue(sampleResult);

    const result = await workforceApiService.notifications({ page: 1, take: 20 });

    expect(result).toEqual({ items: sampleResult.data, meta: sampleResult.meta });
  });
});

describe("workforceApiService.readNotification — invalidación del badge (Etapa 14F.2)", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(invalidateCacheFamily).mockClear();
  });

  it("al marcar una notificación como leída, invalida la familia 'notifications'", async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);

    await workforceApiService.readNotification("notif-1");

    expect(invalidateCacheFamily).toHaveBeenCalledWith("notifications", expect.any(String));
  });

  it("sigue devolviendo el resultado del POST (sin cambiar el contrato)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true });

    await expect(workforceApiService.readNotification("notif-1")).resolves.toEqual({ ok: true });
  });
});
