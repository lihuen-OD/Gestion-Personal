import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { env } from "../../config/env";
import { jobCheckpointRepository } from "../../shared/jobs/jobCheckpoint.repository";
import { detectAttendanceInactivity } from "./attendanceInactivity.service";
import { buildPendingDateKeys, runAttendanceInactivityCatchUp } from "./attendanceInactivityScheduler";

vi.mock("../../shared/jobs/jobCheckpoint.repository", () => ({
  jobCheckpointRepository: { findLastProcessedDateKey: vi.fn(), advance: vi.fn() },
}));

// isInactivityCheckDue/previousOperationalDateKey se mantienen reales (son
// funciones puras, ya probadas por su cuenta) — sólo se mockea la parte que
// toca la base de datos.
vi.mock("./attendanceInactivity.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./attendanceInactivity.service")>();
  return { ...actual, detectAttendanceInactivity: vi.fn() };
});

const mockedCheckpoint = jobCheckpointRepository as unknown as { findLastProcessedDateKey: Mock; advance: Mock };
const mockedDetect = detectAttendanceInactivity as unknown as Mock;

// 2026-09-14 08:00 UTC = 2026-09-14 05:00 ART (después de la ventana diaria
// por defecto, 01:00 ART) — "ayer" en Argentina es 2026-09-13. Corresponde
// al escenario del §42 de la decisión: viernes 11/09 procesado, backend no
// corrió sábado 12 ni domingo 13, vuelve el lunes 14.
const MONDAY_AFTER_WINDOW = new Date("2026-09-14T08:00:00.000Z");
// 2026-09-14 03:30 UTC = 2026-09-14 00:30 ART — antes de la ventana de 01:00.
const BEFORE_DAILY_WINDOW = new Date("2026-09-14T03:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockedCheckpoint.advance.mockResolvedValue(undefined);
  mockedDetect.mockResolvedValue({ date: "unused", detected: 0, notified: 0 });
});

afterEach(() => {
  env.ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES = 14;
  env.ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE = undefined;
});

describe("buildPendingDateKeys — Etapa 15M.19A (aritmética pura de catch-up, sin mocks)", () => {
  it("Caso A — un día pendiente", () => {
    expect(buildPendingDateKeys("2026-09-10", "2026-09-11", 14)).toEqual(["2026-09-11"]);
  });

  it("Caso B — tres días perdidos, en orden ascendente", () => {
    expect(buildPendingDateKeys("2026-09-10", "2026-09-13", 14)).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
  });

  it("Caso F — nada pendiente cuando el checkpoint ya es la fecha objetivo", () => {
    expect(buildPendingDateKeys("2026-09-13", "2026-09-13", 14)).toEqual([]);
  });

  it("checkpoint por delante del objetivo (defensivo): tampoco genera fechas", () => {
    expect(buildPendingDateKeys("2026-09-15", "2026-09-13", 14)).toEqual([]);
  });

  it("respeta el límite por tick y deja el resto para el próximo tick", () => {
    expect(buildPendingDateKeys("2026-09-01", "2026-09-20", 5)).toEqual([
      "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06",
    ]);
  });

  it("cruza fin de mes correctamente", () => {
    expect(buildPendingDateKeys("2026-09-29", "2026-10-02", 14)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("runAttendanceInactivityCatchUp — Etapa 15M.19A", () => {
  it("Caso G — antes de la ventana diaria: no toca el checkpoint ni procesa nada", async () => {
    const result = await runAttendanceInactivityCatchUp(BEFORE_DAILY_WINDOW);

    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: false });
    expect(mockedCheckpoint.findLastProcessedDateKey).not.toHaveBeenCalled();
    expect(mockedDetect).not.toHaveBeenCalled();
  });

  it("Caso F — después de la ventana, sin nada pendiente: no reprocesa ni reenvía notificaciones", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-13");

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: false });
    expect(mockedDetect).not.toHaveBeenCalled();
    expect(mockedCheckpoint.advance).not.toHaveBeenCalled();
  });

  it("Caso A — un día pendiente: procesa y avanza el checkpoint a esa fecha", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-12");
    mockedDetect.mockResolvedValue({ date: "2026-09-13", detected: 3, notified: 3 });

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedDetect).toHaveBeenCalledTimes(1);
    expect(mockedDetect).toHaveBeenCalledWith("2026-09-13");
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("attendance-inactivity-daily", "2026-09-13");
    expect(result).toEqual({ ranDates: ["2026-09-13"], detectedTotal: 3, bootstrapped: false });
  });

  it("Caso B / criterio de éxito §42 — viernes 11 procesado, sábado y domingo perdidos: el lunes procesa 12 y 13 en orden, sin duplicar", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-11");
    mockedDetect.mockResolvedValue({ date: "unused", detected: 0, notified: 0 });

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedDetect.mock.calls.map((call) => call[0])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedCheckpoint.advance.mock.calls.map((call) => call[1])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(result.ranDates).toEqual(["2026-09-12", "2026-09-13"]);
    expect(result.failedDate).toBeUndefined();
  });

  it("Caso D — fallo intermedio: procesa 12 OK, 13 falla, NO llega a procesar 14; el checkpoint queda en 12", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-11");
    mockedDetect.mockImplementation(async (dateKey: string) => {
      if (dateKey === "2026-09-13") throw new Error("boom");
      return { date: dateKey, detected: 0, notified: 0 };
    });
    // "ayer" = 14 respecto a esta referencia, para tener 3 fechas pendientes (12,13,14).
    const reference = new Date("2026-09-15T08:00:00.000Z");

    const result = await runAttendanceInactivityCatchUp(reference);

    expect(mockedDetect.mock.calls.map((call) => call[0])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedCheckpoint.advance).toHaveBeenCalledTimes(1);
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("attendance-inactivity-daily", "2026-09-12");
    expect(result.ranDates).toEqual(["2026-09-12"]);
    expect(result.failedDate).toBe("2026-09-13");
  });

  it("Caso E — reintento tras el fallo: el próximo tick retoma exactamente en la fecha que había fallado", async () => {
    // Simula un proceso nuevo (o el siguiente tick) leyendo el checkpoint ya
    // avanzado hasta 12 por el intento anterior — sin ningún estado en
    // memoria compartido entre esta llamada y la anterior.
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-12");
    mockedDetect.mockResolvedValue({ date: "2026-09-13", detected: 0, notified: 0 });

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedDetect).toHaveBeenCalledTimes(1);
    expect(mockedDetect).toHaveBeenCalledWith("2026-09-13");
    expect(result.ranDates).toEqual(["2026-09-13"]);
  });

  it("Caso C — reinicio del proceso: no depende de ningún estado module-level, sólo de lo que devuelve el repository en cada llamada", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-11");
    await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);
    const firstCallDates = mockedDetect.mock.calls.map((call) => call[0]);

    vi.clearAllMocks();
    mockedCheckpoint.advance.mockResolvedValue(undefined);
    mockedDetect.mockResolvedValue({ date: "unused", detected: 0, notified: 0 });
    // "Proceso nuevo": el checkpoint en DB ya refleja el avance de la corrida anterior.
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-13");

    await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(firstCallDates).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedDetect).not.toHaveBeenCalled(); // nada pendiente en el "proceso nuevo": ya estaba al día
  });

  it("Caso H — bootstrap sin configurar: inicializa el checkpoint en 'ayer' y NO reprocesa histórico", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue(null);

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheckpoint.advance).toHaveBeenCalledTimes(1);
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("attendance-inactivity-daily", "2026-09-13");
    expect(mockedDetect).not.toHaveBeenCalled();
    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: true });
  });

  it("bootstrap con ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE configurado: arranca desde esa fecha, no desde 'ayer'", async () => {
    env.ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE = "2026-09-10";
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue(null);

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheckpoint.advance).toHaveBeenNthCalledWith(1, "attendance-inactivity-daily", "2026-09-10");
    expect(mockedDetect.mock.calls.map((call) => call[0])).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
    expect(result.bootstrapped).toBe(true);
    expect(result.ranDates).toEqual(["2026-09-11", "2026-09-12", "2026-09-13"]);
  });

  it("respeta ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES: una caída larga se drena en varios ticks, no de una", async () => {
    env.ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES = 2;
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-01");
    // "ayer" respecto a esta referencia queda muy por delante de 2026-09-01.
    const reference = new Date("2026-10-01T08:00:00.000Z");

    const result = await runAttendanceInactivityCatchUp(reference);

    expect(result.ranDates).toHaveLength(2);
    expect(result.ranDates).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("una fecha sin incidentes no genera ninguna llamada extra a advance ni infla detectedTotal", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-12");
    mockedDetect.mockResolvedValue({ date: "2026-09-13", detected: 0, notified: 0 });

    const result = await runAttendanceInactivityCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheckpoint.advance).toHaveBeenCalledTimes(1);
    expect(result.detectedTotal).toBe(0);
  });
});
