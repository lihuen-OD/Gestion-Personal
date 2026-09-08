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

    expect(invalidateCacheFamily).not.toHaveBeenCalledWith("dashboard", expect.any(String));
  });

  // Etapa 14G.8: ambas ramas invalidan "monthly-closures" -- rechazar también
  // afecta la lista de correcciones (TimeCorrectionRequest.status cambia),
  // aunque no toque TimeEntry/dashboard.
  it("aprobar y rechazar invalidan la familia 'monthly-closures' (lista de correcciones/cierres)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "correction-1", status: "APROBADA" } });
    await workforceApiService.reviewCorrection("correction-1", "approve");
    expect(invalidateCacheFamily).toHaveBeenCalledWith("monthly-closures", expect.any(String));

    vi.mocked(invalidateCacheFamily).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "correction-1", status: "RECHAZADA" } });
    await workforceApiService.reviewCorrection("correction-1", "reject");
    expect(invalidateCacheFamily).toHaveBeenCalledWith("monthly-closures", expect.any(String));
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

// Etapa 14G.8: antes de esta etapa, closures()/corrections() llamaban
// apiRequest directo sin ningún dedupe/cache frontend — en StrictMode
// (MonthlyClosuresPage monta el effect dos veces) esto generaba 2 requests
// idénticos por mount, confirmado en el journey de 14G.6/14G.7 ("Entrar a
// Cierres mensuales": GET /workforce/closures x2, GET /workforce/corrections
// x2). Mismo patrón exacto que unreadNotificationCount/notifications.
describe("workforceApiService.closures/corrections — dedupe/cache frontend (Etapa 14G.8)", () => {
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

  it("closures: dos llamadas concurrentes con el mismo período generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "closure-1" }] });

    const [a, b] = await Promise.all([workforceApiService.closures("2026-08"), workforceApiService.closures("2026-08")]);

    expect(a).toEqual([{ id: "closure-1" }]);
    expect(b).toEqual([{ id: "closure-1" }]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("closures: una segunda llamada idéntica dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "closure-1" }] });

    await workforceApiService.closures("2026-08");
    await workforceApiService.closures("2026-08");

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("closures: cambiar de período es un cache miss nuevo (no sirve el período anterior)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await workforceApiService.closures("2026-08");
    await workforceApiService.closures("2026-07");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("corrections: dos llamadas concurrentes generan un solo request real (dedupe in-flight)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "correction-1" }] });

    const [a, b] = await Promise.all([workforceApiService.corrections(), workforceApiService.corrections()]);

    expect(a).toEqual([{ id: "correction-1" }]);
    expect(b).toEqual([{ id: "correction-1" }]);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("corrections: una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "correction-1" }] });

    await workforceApiService.corrections();
    await workforceApiService.corrections();

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  // Confirma el objetivo real de compartir familia "monthly-closures":
  // corrections() no depende del período, así que un segundo llamado (p. ej.
  // disparado por un cambio de período que sí re-pide closures) sigue
  // sirviendo el valor cacheado sin un request nuevo.
  it("corrections: no se vuelve a pedir aunque closures() cambie de período en el medio", async () => {
    vi.mocked(apiRequest).mockImplementation((url: string) => {
      if (url.startsWith("/workforce/corrections")) return Promise.resolve({ data: [{ id: "correction-1" }] });
      return Promise.resolve({ data: [{ id: "closure-1" }] });
    });

    await Promise.all([workforceApiService.closures("2026-08"), workforceApiService.corrections()]);
    const callsBefore = vi.mocked(apiRequest).mock.calls.filter((call) => String(call[0]).startsWith("/workforce/corrections")).length;

    await Promise.all([workforceApiService.closures("2026-07"), workforceApiService.corrections()]);
    const callsAfter = vi.mocked(apiRequest).mock.calls.filter((call) => String(call[0]).startsWith("/workforce/corrections")).length;

    expect(callsBefore).toBe(1);
    expect(callsAfter).toBe(1); // sin cambios: corrections() sigue siendo un cache hit
  });

  it.each([
    ["submitClosures", () => workforceApiService.submitClosures("2026-08", ["emp-1"])],
    ["approveClosures", () => workforceApiService.approveClosures(["closure-1"])],
    ["returnClosure", () => workforceApiService.returnClosure("closure-1", "falta revisar")],
    ["createCorrection", () => workforceApiService.createCorrection({ timeEntryId: "entry-1", proposedHours: 9, reason: "olvido" })],
  ])("%s invalida la familia 'monthly-closures'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("monthly-closures", expect.any(String));
  });

  it("después de invalidar 'monthly-closures' (p. ej. tras aprobar un cierre), closures/corrections vuelven a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "closure-1", status: "ENVIADO" }] });
    await workforceApiService.closures("2026-08");
    await workforceApiService.corrections();
    expect(apiRequest).toHaveBeenCalledTimes(2);

    await invalidateCacheFamily("monthly-closures", "unit test");

    vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "closure-1", status: "APROBADO" }] });
    await workforceApiService.closures("2026-08");
    await workforceApiService.corrections();

    expect(apiRequest).toHaveBeenCalledTimes(4);
  });
});

// Etapa 14H.3: shiftTemplates()/doubleHourRules()/doubleHourRulesCalendar()
// no tenían dedupe/cache frontend -- el journey 14H.1/14H.2 confirmó
// requests duplicadas (StrictMode) al entrar a Turnos/Horas especiales,
// incluso con cache backend ya activo (shiftTemplates/doubleRules, Etapa
// 9C) porque sin dedupe del lado del cliente dos llamadas casi simultáneas
// llegan al backend antes de que la primera termine de escribir su propia
// cache.
describe("workforceApiService.shiftTemplates/doubleHourRules/doubleHourRulesCalendar — dedupe/cache frontend (Etapa 14H.3)", () => {
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

  it("shiftTemplates: dos llamadas concurrentes generan un solo request real (dedupe in-flight)", async () => {
    const templates = [{ id: "shift-1", code: "M", name: "Mañana" }];
    vi.mocked(apiRequest).mockResolvedValue({ data: templates });

    const [a, b] = await Promise.all([workforceApiService.shiftTemplates(), workforceApiService.shiftTemplates()]);

    expect(a).toEqual(templates);
    expect(b).toEqual(templates);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("shiftTemplates: una segunda llamada dentro del TTL usa cache, no repite el request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await workforceApiService.shiftTemplates();
    await workforceApiService.shiftTemplates();

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("doubleHourRules: dos llamadas concurrentes generan un solo request real (dedupe in-flight)", async () => {
    const rules = [{ id: "rule-1", name: "Domingo" }];
    vi.mocked(apiRequest).mockResolvedValue({ data: rules });

    const [a, b] = await Promise.all([workforceApiService.doubleHourRules(), workforceApiService.doubleHourRules()]);

    expect(a).toEqual(rules);
    expect(b).toEqual(rules);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("doubleHourRulesCalendar: dos llamadas concurrentes con el mismo rango generan un solo request real (dedupe in-flight)", async () => {
    const days = [{ date: "2026-09-08", rules: [], hasOverlap: false, hasConflict: false }];
    vi.mocked(apiRequest).mockResolvedValue({ data: days });

    const [a, b] = await Promise.all([
      workforceApiService.doubleHourRulesCalendar("2026-09-01", "2026-09-30"),
      workforceApiService.doubleHourRulesCalendar("2026-09-01", "2026-09-30"),
    ]);

    expect(a).toEqual(days);
    expect(b).toEqual(days);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("doubleHourRulesCalendar: cambiar el filtro kind es un cache miss nuevo (forma parte de la key)", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    await workforceApiService.doubleHourRulesCalendar("2026-09-01", "2026-09-30");
    await workforceApiService.doubleHourRulesCalendar("2026-09-01", "2026-09-30", "FERIADO");

    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["createShiftTemplate", () => workforceApiService.createShiftTemplate({ code: "M", name: "Mañana", startTime: "08:00", endTime: "16:00" } as never)],
    ["updateShiftTemplate", () => workforceApiService.updateShiftTemplate("shift-1", { name: "Mañana" })],
    ["removeShiftTemplate", () => workforceApiService.removeShiftTemplate("shift-1")],
    ["createDoubleHourRule", () => workforceApiService.createDoubleHourRule({ name: "Domingo", recurrenceType: "SEMANAL", fromDate: "2026-01-01", toDate: null, weekdays: [0], multiplier: 2, priority: 0, employeeIds: [], reason: "x" })],
    ["updateDoubleHourRule", () => workforceApiService.updateDoubleHourRule("rule-1", { name: "Domingo" })],
    ["removeDoubleHourRule", () => workforceApiService.removeDoubleHourRule("rule-1")],
  ])("%s invalida la familia 'workforce-config'", async (_name, mutate) => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });

    await mutate();

    expect(invalidateCacheFamily).toHaveBeenCalledWith("workforce-config", expect.any(String));
  });

  it("después de invalidar 'workforce-config' (p. ej. tras crear un turno), shiftTemplates/doubleHourRules vuelven a pedirse", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
    await workforceApiService.shiftTemplates();
    await workforceApiService.doubleHourRules();
    expect(apiRequest).toHaveBeenCalledTimes(2);

    await invalidateCacheFamily("workforce-config", "unit test");

    await workforceApiService.shiftTemplates();
    await workforceApiService.doubleHourRules();

    expect(apiRequest).toHaveBeenCalledTimes(4);
  });
});
