import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { env } from "../../config/env";
import { jobCheckpointRepository } from "../../shared/jobs/jobCheckpoint.repository";
import { checkMissingEntriesForElapsedDate } from "./missingEntry.service";
import { runMissingEntryCatchUp } from "./missingEntryScheduler";

/**
 * Etapa 15M.19F (docs/decisions/MISSING_ENTRY_CROSS_MIDNIGHT_RECONCILIATION_15M19F.md).
 * Mismo patrón de test que attendanceInactivityScheduler.test.ts (15M.19A) —
 * `buildPendingDateKeys` es función pura y ya tiene su propia batería de
 * tests ahí, reutilizada tal cual acá (no se repite). Este archivo prueba la
 * orquestación propia de `runMissingEntryCatchUp`: su checkpoint
 * independiente ("missing-entry-catchup"), bootstrap, multi-día, fallo
 * parcial e idempotencia ante reinicio.
 */
vi.mock("../../shared/jobs/jobCheckpoint.repository", () => ({
  jobCheckpointRepository: { findLastProcessedDateKey: vi.fn(), advance: vi.fn() },
}));

vi.mock("./missingEntry.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./missingEntry.service")>();
  return { ...actual, checkMissingEntriesForElapsedDate: vi.fn() };
});

const mockedCheckpoint = jobCheckpointRepository as unknown as { findLastProcessedDateKey: Mock; advance: Mock };
const mockedCheck = checkMissingEntriesForElapsedDate as unknown as Mock;

// 2026-09-14 08:00 UTC = 2026-09-14 05:00 ART (después de la ventana diaria
// por defecto, 01:00 ART) — "ayer" en Argentina es 2026-09-13. Mismo
// escenario de referencia que attendanceInactivityScheduler.test.ts: viernes
// 11/09 procesado, backend no corrió sábado 12 ni domingo 13, vuelve el
// lunes 14.
const MONDAY_AFTER_WINDOW = new Date("2026-09-14T08:00:00.000Z");
// 2026-09-14 03:30 UTC = 2026-09-14 00:30 ART — antes de la ventana de 01:00.
const BEFORE_DAILY_WINDOW = new Date("2026-09-14T03:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockedCheckpoint.advance.mockResolvedValue(undefined);
  mockedCheck.mockResolvedValue({ created: 0, resolved: 0 });
});

afterEach(() => {
  env.MISSING_ENTRY_MAX_CATCHUP_DATES = 14;
});

describe("runMissingEntryCatchUp — Etapa 15M.19F", () => {
  it("antes de la ventana diaria: no toca el checkpoint ni procesa nada", async () => {
    const result = await runMissingEntryCatchUp(BEFORE_DAILY_WINDOW);

    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: false });
    expect(mockedCheckpoint.findLastProcessedDateKey).not.toHaveBeenCalled();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("bootstrap sin checkpoint previo: inicializa en 'ayer' y NO reprocesa histórico, con su PROPIA key (nunca 'attendance-inactivity-daily')", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue(null);

    const result = await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheckpoint.findLastProcessedDateKey).toHaveBeenCalledWith("missing-entry-catchup");
    expect(mockedCheckpoint.advance).toHaveBeenCalledTimes(1);
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("missing-entry-catchup", "2026-09-13");
    expect(mockedCheck).not.toHaveBeenCalled();
    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: true });
  });

  it("nada pendiente (checkpoint ya al día): no reprocesa", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-13");

    const result = await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    expect(result).toEqual({ ranDates: [], detectedTotal: 0, bootstrapped: false });
    expect(mockedCheck).not.toHaveBeenCalled();
    expect(mockedCheckpoint.advance).not.toHaveBeenCalled();
  });

  it("un día pendiente: procesa y avanza el checkpoint propio a esa fecha", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-12");
    mockedCheck.mockResolvedValue({ created: 1, resolved: 0 });

    const result = await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(mockedCheck).toHaveBeenCalledWith("2026-09-13");
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("missing-entry-catchup", "2026-09-13");
    expect(result).toEqual({ ranDates: ["2026-09-13"], detectedTotal: 1, bootstrapped: false });
  });

  it("E) backend caído viernes->lunes: recupera sábado y domingo en orden, sin duplicar, en un solo tick", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-11"); // viernes ya procesado
    mockedCheck.mockResolvedValue({ created: 0, resolved: 0 });

    const result = await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW); // lunes 14/09

    expect(mockedCheck.mock.calls.map((call) => call[0])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedCheckpoint.advance.mock.calls.map((call) => call[1])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(result.ranDates).toEqual(["2026-09-12", "2026-09-13"]);
    expect(result.failedDate).toBeUndefined();
  });

  it("F) fecha futura respecto de 'ayer' nunca se procesa: sólo llega hasta el objetivo (previousOperationalDateKey), nunca más allá", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-13");
    mockedCheck.mockResolvedValue({ created: 0, resolved: 0 });

    // "ayer" respecto a esta referencia es 2026-09-14 -- 09-15 (futuro) nunca debe aparecer.
    await runMissingEntryCatchUp(new Date("2026-09-15T08:00:00.000Z"));

    expect(mockedCheck.mock.calls.map((call) => call[0])).toEqual(["2026-09-14"]);
    expect(mockedCheck.mock.calls.map((call) => call[0])).not.toContain("2026-09-15");
  });

  it("fallo intermedio: procesa 12 OK, 13 falla, NO llega a procesar 14; el checkpoint propio queda en 12", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-11");
    mockedCheck.mockImplementation(async (dateKey: string) => {
      if (dateKey === "2026-09-13") throw new Error("boom");
      return { created: 0, resolved: 0 };
    });
    const reference = new Date("2026-09-15T08:00:00.000Z"); // "ayer" = 14, 3 fechas pendientes (12,13,14)

    const result = await runMissingEntryCatchUp(reference);

    expect(mockedCheck.mock.calls.map((call) => call[0])).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedCheckpoint.advance).toHaveBeenCalledTimes(1);
    expect(mockedCheckpoint.advance).toHaveBeenCalledWith("missing-entry-catchup", "2026-09-12");
    expect(result.ranDates).toEqual(["2026-09-12"]);
    expect(result.failedDate).toBe("2026-09-13");
  });

  it("L) segundo tick del mismo día, checkpoint ya avanzado: no vuelve a procesar la misma fecha", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-12");
    await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);
    expect(mockedCheck).toHaveBeenCalledTimes(1);

    mockedCheck.mockClear();
    mockedCheckpoint.advance.mockClear();
    // Segundo tick del mismo proceso, el checkpoint YA está en 13.
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-13");
    const result = await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    expect(mockedCheck).not.toHaveBeenCalled();
    expect(mockedCheckpoint.advance).not.toHaveBeenCalled();
    expect(result.ranDates).toEqual([]);
  });

  it("M) reinicio del proceso: no depende de ningún estado module-level, sólo de lo que devuelve el checkpoint repository", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-11");
    await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);
    const firstCallDates = mockedCheck.mock.calls.map((call) => call[0]);

    vi.clearAllMocks();
    mockedCheckpoint.advance.mockResolvedValue(undefined);
    mockedCheck.mockResolvedValue({ created: 0, resolved: 0 });
    // "Proceso nuevo": el checkpoint en DB ya refleja el avance de la corrida anterior.
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValueOnce("2026-09-13");

    await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    expect(firstCallDates).toEqual(["2026-09-12", "2026-09-13"]);
    expect(mockedCheck).not.toHaveBeenCalled(); // nada pendiente en el "proceso nuevo": ya estaba al día
  });

  it("respeta MISSING_ENTRY_MAX_CATCHUP_DATES: una caída larga se drena en varios ticks, no de una", async () => {
    env.MISSING_ENTRY_MAX_CATCHUP_DATES = 2;
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-01");
    const reference = new Date("2026-10-01T08:00:00.000Z");

    const result = await runMissingEntryCatchUp(reference);

    expect(result.ranDates).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("checkpoint independiente del de inactividad diaria: nunca lee ni escribe 'attendance-inactivity-daily'", async () => {
    mockedCheckpoint.findLastProcessedDateKey.mockResolvedValue("2026-09-12");
    mockedCheck.mockResolvedValue({ created: 0, resolved: 0 });

    await runMissingEntryCatchUp(MONDAY_AFTER_WINDOW);

    for (const call of mockedCheckpoint.findLastProcessedDateKey.mock.calls) {
      expect(call[0]).not.toBe("attendance-inactivity-daily");
    }
    for (const call of mockedCheckpoint.advance.mock.calls) {
      expect(call[0]).not.toBe("attendance-inactivity-daily");
    }
  });
});
