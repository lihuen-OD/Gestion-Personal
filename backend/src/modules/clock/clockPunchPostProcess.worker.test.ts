import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { automaticHourConceptBreakdownsService } from "../employees/automaticHourConceptBreakdowns.service";
import { evaluateShiftEntry, evaluateShiftExit, resolveOpenShiftOverflowAlert } from "../shifts/workShiftEvaluationRunner";
import { notifyMissingExit } from "../time-entries/timeEntries.service";
import { clearAuditDerivedCaches } from "../audit/audit.service";
import { clearShiftAlertReadCaches } from "../shifts/shiftAlert.cache";
import { clearNotificationsListCache } from "../workforce-management/workforce.cache";
import { clearEmployeeTimeGridCache } from "../employees/employees.controller";
import { ClockPunchPostProcessLeaseLost, clockPunchPostProcessRepository } from "./clockPunchPostProcess.repository";
import {
  drainClockPunchPostProcess,
  kickClockPunchPostProcess,
  POSTPROCESS_STEPS,
  processClaimedClockPunchPostProcessJob,
  startClockPunchPostProcessWorker,
  stopClockPunchPostProcessWorker,
} from "./clockPunchPostProcess.worker";

/**
 * PERF-5D (docs/decisions/F12_PERF_5.md): unidad del worker del post-proceso
 * durable. La base real (claim, orden por jornada, lease, fencing, reinicio)
 * se prueba en clockPunchPostProcess.integration.test.ts; acá, con repositorio
 * y colaboradores mockeados, la secuencia de pasos, su idempotencia, el manejo
 * de fallos y el drenado.
 */
const STEP_TX = { marker: "step-tx" };

vi.mock("../../shared/prisma/client", () => ({
  prisma: { $transaction: vi.fn() },
}));

vi.mock("./clockPunchPostProcess.repository", async () => {
  const actual = await vi.importActual<typeof import("./clockPunchPostProcess.repository")>("./clockPunchPostProcess.repository");
  return {
    ClockPunchPostProcessLeaseLost: actual.ClockPunchPostProcessLeaseLost,
    clockPunchPostProcessRepository: {
      claimNext: vi.fn(),
      lockForStep: vi.fn(),
      markStep: vi.fn(),
      complete: vi.fn(),
      retry: vi.fn(),
      fail: vi.fn(),
      countHeldElsewhere: vi.fn(),
      countUnfinished: vi.fn(),
      enqueue: vi.fn(),
    },
  };
});

vi.mock("../employees/automaticHourConceptBreakdowns.service", () => ({
  automaticHourConceptBreakdownsService: { recalculateForEmployeePeriod: vi.fn() },
}));
vi.mock("../shifts/workShiftEvaluationRunner", () => ({
  evaluateShiftEntry: vi.fn(),
  evaluateShiftExit: vi.fn(),
  resolveOpenShiftOverflowAlert: vi.fn(),
}));
vi.mock("../time-entries/timeEntries.service", () => ({ notifyMissingExit: vi.fn() }));
vi.mock("../time-entries/timeEntries.repository", () => ({ ROLLOVER_OVERFLOW_RESOLUTION_NOTE: "nota-rollover" }));
vi.mock("../time-entries/timeEntries.cache", () => ({ clearTimeEntriesReadCaches: vi.fn() }));
vi.mock("../audit/audit.service", () => ({ clearAuditDerivedCaches: vi.fn() }));
vi.mock("../shifts/shiftAlert.cache", () => ({ clearShiftAlertReadCaches: vi.fn() }));
vi.mock("../workforce-management/workforce.cache", () => ({ clearNotificationsListCache: vi.fn() }));
vi.mock("../employees/employees.controller", () => ({ clearEmployeeTimeGridCache: vi.fn() }));

const repo = clockPunchPostProcessRepository as unknown as Record<"claimNext" | "lockForStep" | "markStep" | "complete" | "retry" | "fail" | "countHeldElsewhere", Mock>;
const mockedTransaction = prisma.$transaction as unknown as Mock;
const mockedRecalculate = automaticHourConceptBreakdownsService.recalculateForEmployeePeriod as unknown as Mock;

const ACTUAL_AT = "2026-10-16T12:00:00.000Z";
const PREVIOUS_START = "2026-10-15T10:00:00.000Z";
const AUDIT = { userId: null, ipAddress: "10.0.0.1", userAgent: "kiosk" };

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    attendancePunchId: "punch-1",
    workShiftId: "shift-1",
    employeeId: "employee-1",
    kind: "ENTRY",
    status: "PROCESSING",
    periods: ["2026-10"],
    payload: { actualAt: ACTUAL_AT },
    stepsCompleted: [] as string[],
    attemptCount: 1,
    nextAttemptAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lastErrorCode: null,
    lastErrorMessage: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(Date.now() - 1_000),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

const exitJob = (overrides: Record<string, unknown> = {}) => job({
  kind: "EXIT",
  attendancePunchId: "punch-out",
  periods: ["2026-09", "2026-10"],
  payload: { actualAt: ACTUAL_AT, segments: [{ startAt: "2026-10-16T03:00:00.000Z", minutes: 540, conceptStatus: "SUGERIDO" }], audit: AUDIT },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedTransaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(STEP_TX));
  repo.lockForStep.mockResolvedValue([]);
  repo.markStep.mockResolvedValue({ id: "job-1" });
  repo.complete.mockResolvedValue({ count: 1 });
  repo.retry.mockResolvedValue({ count: 1 });
  repo.fail.mockResolvedValue({ count: 1 });
  repo.countHeldElsewhere.mockResolvedValue(0);
  vi.mocked(evaluateShiftEntry).mockResolvedValue(undefined);
  vi.mocked(evaluateShiftExit).mockResolvedValue(undefined);
  vi.mocked(resolveOpenShiftOverflowAlert).mockResolvedValue(undefined);
  vi.mocked(notifyMissingExit).mockResolvedValue(undefined);
  // Motor B real: corre `withinTransaction` dentro de su propia transacción.
  mockedRecalculate.mockImplementation(async (input: { withinTransaction?: (tx: unknown) => Promise<void> }) => {
    await input.withinTransaction?.(STEP_TX);
    return {};
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  stopClockPunchPostProcessWorker();
});

describe("PERF-5D — pasos del post-proceso por tipo", () => {
  it("ENTRY: evalúa el ingreso en la transacción del paso, marca el paso, completa sin el contexto de auditoría y limpia los cachés derivados", async () => {
    const claimed = job();

    await expect(processClaimedClockPunchPostProcessJob(claimed)).resolves.toEqual({ processed: true, jobId: "job-1", status: "COMPLETED" });

    expect(evaluateShiftEntry).toHaveBeenCalledWith("employee-1", "shift-1", new Date(ACTUAL_AT), { db: STEP_TX });
    expect(repo.lockForStep).toHaveBeenCalledWith(STEP_TX, "job-1", 1);
    expect(repo.markStep).toHaveBeenCalledWith(STEP_TX, "job-1", POSTPROCESS_STEPS.entryEvaluation, expect.any(Date));
    expect(repo.lockForStep.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(evaluateShiftEntry).mock.invocationCallOrder[0]!);
    expect(vi.mocked(evaluateShiftEntry).mock.invocationCallOrder[0]).toBeLessThan(repo.markStep.mock.invocationCallOrder[0]!);
    expect(repo.complete).toHaveBeenCalledWith("job-1", 1, { actualAt: ACTUAL_AT }, expect.any(Date));
    for (const clear of [clearAuditDerivedCaches, clearShiftAlertReadCaches, clearNotificationsListCache, clearEmployeeTimeGridCache]) expect(clear).toHaveBeenCalled();
  });

  it("ROLLOVER_ENTRY: resuelve la alerta de la jornada vencida, avisa la falta de salida (eventAt = su inicio) y evalúa el ingreso nuevo, en ese orden y cada uno en su paso", async () => {
    const claimed = job({ kind: "ROLLOVER_ENTRY", payload: { actualAt: ACTUAL_AT, previousShift: { id: "shift-old", startAt: PREVIOUS_START } } });

    await expect(processClaimedClockPunchPostProcessJob(claimed)).resolves.toMatchObject({ status: "COMPLETED" });

    expect(resolveOpenShiftOverflowAlert).toHaveBeenCalledWith("shift-old", "nota-rollover", STEP_TX);
    expect(notifyMissingExit).toHaveBeenCalledWith("employee-1", "shift-old", new Date(PREVIOUS_START), { db: STEP_TX, rethrow: true });
    expect(evaluateShiftEntry).toHaveBeenCalledWith("employee-1", "shift-1", new Date(ACTUAL_AT), { db: STEP_TX });
    const order = [resolveOpenShiftOverflowAlert, notifyMissingExit, evaluateShiftEntry].map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(repo.markStep.mock.calls.map((call) => call[2])).toEqual([POSTPROCESS_STEPS.overflowResolution, POSTPROCESS_STEPS.missingExitNotice, POSTPROCESS_STEPS.entryEvaluation]);
  });

  it("EXIT: Motor B por período (auditoría y marca en su transacción) y después la evaluación de salida, que relee la jornada y propaga sus fallos", async () => {
    const claimed = exitJob();

    await expect(processClaimedClockPunchPostProcessJob(claimed)).resolves.toMatchObject({ status: "COMPLETED" });

    expect(mockedRecalculate).toHaveBeenCalledTimes(2);
    expect(mockedRecalculate.mock.calls.map((call) => call[0].period)).toEqual(["2026-09", "2026-10"]);
    expect(mockedRecalculate).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-1", createdByUserId: null, audit: AUDIT, withinTransaction: expect.any(Function) }));
    expect(evaluateShiftExit).toHaveBeenCalledWith("employee-1", "shift-1", new Date(ACTUAL_AT), [{ startAt: new Date("2026-10-16T03:00:00.000Z"), minutes: 540, conceptStatus: "SUGERIDO" }], undefined, { db: STEP_TX, rethrow: true });
    expect(repo.markStep.mock.calls.map((call) => call[2])).toEqual(["breakdowns:2026-09", "breakdowns:2026-10", POSTPROCESS_STEPS.exitEvaluation]);
    expect(mockedRecalculate.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(evaluateShiftExit).mock.invocationCallOrder[0]!);
    // La IP y el user agent no quedan en el job completado.
    expect(repo.complete).toHaveBeenCalledWith("job-1", 1, { actualAt: ACTUAL_AT, segments: expect.any(Array) }, expect.any(Date));
  });
});

describe("PERF-5D — idempotencia y fallos", () => {
  it("un reintento retoma desde el primer paso sin marca: no repite Motor B ni la auditoría de un período ya confirmado", async () => {
    const claimed = exitJob({ stepsCompleted: ["breakdowns:2026-09"], attemptCount: 2 });

    await processClaimedClockPunchPostProcessJob(claimed);

    expect(mockedRecalculate).toHaveBeenCalledTimes(1);
    expect(mockedRecalculate).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-10" }));
    expect(repo.lockForStep).toHaveBeenCalledWith(STEP_TX, "job-1", 2);
  });

  it("un paso que la fila ya tiene marcado (visto bajo su lock) no vuelve a ejecutar sus efectos", async () => {
    repo.lockForStep.mockResolvedValueOnce([POSTPROCESS_STEPS.entryEvaluation]);

    await expect(processClaimedClockPunchPostProcessJob(job())).resolves.toMatchObject({ status: "COMPLETED" });

    expect(evaluateShiftEntry).not.toHaveBeenCalled();
    expect(repo.markStep).not.toHaveBeenCalled();
  });

  it("falla la notificación de un paso: vuelve a PENDING con backoff, el paso queda sin marca y nada se da por completado", async () => {
    vi.mocked(notifyMissingExit).mockRejectedValueOnce(new Error("notification insert failed"));
    const claimed = job({ kind: "ROLLOVER_ENTRY", payload: { actualAt: ACTUAL_AT, previousShift: { id: "shift-old", startAt: PREVIOUS_START } } });
    const before = Date.now();

    await expect(processClaimedClockPunchPostProcessJob(claimed)).resolves.toMatchObject({ status: "RETRY" });

    expect(repo.markStep.mock.calls.map((call) => call[2])).toEqual([POSTPROCESS_STEPS.overflowResolution]);
    expect(evaluateShiftEntry).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
    const [, attempt, nextAttemptAt, code, message] = repo.retry.mock.calls[0]!;
    expect(attempt).toBe(1);
    expect((nextAttemptAt as Date).getTime()).toBeGreaterThanOrEqual(before + 5_000);
    expect([code, message]).toEqual(["CLOCK_POSTPROCESS_UNKNOWN", "notification insert failed"]);
    // Lo confirmado por el primer paso ya es visible.
    expect(clearShiftAlertReadCaches).toHaveBeenCalled();
  });

  it("falla Motor B (no PERIOD_CLOSED): se reintenta el job y la evaluación de salida espera", async () => {
    mockedRecalculate.mockRejectedValueOnce(new AppError("Concurrent automatic recalculation; retry the operation", 409, "AUTOMATIC_BREAKDOWN_CONCURRENT_CONFLICT"));

    await expect(processClaimedClockPunchPostProcessJob(exitJob())).resolves.toMatchObject({ status: "RETRY" });

    expect(evaluateShiftExit).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith("job-1", 1, expect.any(Date), "AUTOMATIC_BREAKDOWN_CONCURRENT_CONFLICT", expect.any(String));
  });

  it("PERIOD_CLOSED de Motor B conserva el criterio previo: el período cerrado no se regenera, el paso se da por cumplido y el job termina", async () => {
    mockedRecalculate.mockRejectedValueOnce(new AppError("The period is closed for recalculation", 409, "PERIOD_CLOSED"));

    await expect(processClaimedClockPunchPostProcessJob(exitJob({ periods: ["2026-10"] }))).resolves.toMatchObject({ status: "COMPLETED" });

    expect(repo.markStep.mock.calls.map((call) => call[2])).toEqual(["breakdowns:2026-10", POSTPROCESS_STEPS.exitEvaluation]);
    expect(console.error).toHaveBeenCalledWith("AUTOMATIC_BREAKDOWN_SYNC_FAILED", expect.objectContaining({ severity: "warning", code: "PERIOD_CLOSED", period: "2026-10" }));
  });

  it("agotados los intentos queda FAILED (observable: fila + log crítico) y la fichada no se toca", async () => {
    vi.mocked(evaluateShiftEntry).mockRejectedValueOnce(new Error("still failing"));

    await expect(processClaimedClockPunchPostProcessJob(job({ attemptCount: 12 }))).resolves.toMatchObject({ status: "FAILED" });

    expect(repo.fail).toHaveBeenCalledWith("job-1", 12, "CLOCK_POSTPROCESS_UNKNOWN", "still failing");
    expect(repo.retry).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("CLOCK_POSTPROCESS_FAILED", expect.objectContaining({ severity: "critical", jobId: "job-1", workShiftId: "shift-1" }));
  });

  it("un payload inválido es terminal: FAILED en el primer intento, sin ejecutar pasos", async () => {
    await expect(processClaimedClockPunchPostProcessJob(job({ payload: { actualAt: "no-es-fecha" } }))).resolves.toMatchObject({ status: "FAILED" });

    expect(evaluateShiftEntry).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith("job-1", 1, "CLOCK_POSTPROCESS_PAYLOAD_INVALID", expect.any(String));
  });

  it("lease perdido (otro worker reclamó el job): no escribe efectos ni reprograma ni falla el job", async () => {
    repo.lockForStep.mockRejectedValueOnce(new ClockPunchPostProcessLeaseLost("job-1"));

    await expect(processClaimedClockPunchPostProcessJob(job())).resolves.toMatchObject({ status: "LEASE_LOST" });

    expect(evaluateShiftEntry).not.toHaveBeenCalled();
    expect(repo.retry).not.toHaveBeenCalled();
    expect(repo.fail).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it("si al completar el lease ya no es suyo (fencing), no informa COMPLETED", async () => {
    repo.complete.mockResolvedValueOnce({ count: 0 });

    await expect(processClaimedClockPunchPostProcessJob(job())).resolves.toMatchObject({ status: "LEASE_LOST" });
  });
});

describe("PERF-5D — drenado en línea (cierre mensual / cierre manual)", () => {
  it("intenta cada job pendiente una sola vez (incluidos FAILED y en backoff) y termina cuando nadie más tiene uno tomado", async () => {
    repo.claimNext.mockResolvedValueOnce(job({ id: "job-a" })).mockResolvedValueOnce(job({ id: "job-b" })).mockResolvedValueOnce(null);

    await expect(drainClockPunchPostProcess({ employeeIds: ["employee-1"] })).resolves.toEqual({ attempted: 2 });

    expect(repo.claimNext).toHaveBeenNthCalledWith(1, expect.any(Date), expect.any(Number), { employeeIds: ["employee-1"], includeFailed: true, ignoreBackoff: true, excludeIds: [] });
    expect(repo.claimNext).toHaveBeenNthCalledWith(3, expect.any(Date), expect.any(Number), expect.objectContaining({ excludeIds: ["job-a", "job-b"] }));
    expect(repo.countHeldElsewhere).toHaveBeenCalledWith({ employeeIds: ["employee-1"], excludeIds: ["job-a", "job-b"] }, expect.any(Date));
  });

  it("espera a un job que otro worker tiene tomado y lo procesa cuando se libera", async () => {
    repo.claimNext.mockResolvedValueOnce(null).mockResolvedValueOnce(job({ id: "job-held" })).mockResolvedValueOnce(null);
    repo.countHeldElsewhere.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(drainClockPunchPostProcess({ workShiftId: "shift-1" }, { waitMs: 5_000 })).resolves.toEqual({ attempted: 1 });
  });

  it("no espera más que waitMs y nunca lanza (la garantía la da la guarda del cierre)", async () => {
    repo.claimNext.mockResolvedValue(null);
    repo.countHeldElsewhere.mockResolvedValue(1);

    const started = Date.now();
    await expect(drainClockPunchPostProcess({ employeeIds: ["employee-1"] }, { waitMs: 400 })).resolves.toEqual({ attempted: 0 });
    expect(Date.now() - started).toBeLessThan(2_000);

    repo.claimNext.mockRejectedValueOnce(new Error("db down"));
    await expect(drainClockPunchPostProcess({ employeeIds: ["employee-1"] })).resolves.toEqual({ attempted: 0 });
  });

  it("sin legajos no consulta nada", async () => {
    await expect(drainClockPunchPostProcess({ employeeIds: [] })).resolves.toEqual({ attempted: 0 });
    expect(repo.claimNext).not.toHaveBeenCalled();
  });
});

describe("PERF-5D — arranque y kick", () => {
  it("el kick sin worker local no hace nada (el job queda para el intervalo u otra instancia)", async () => {
    kickClockPunchPostProcess();
    await new Promise((resolve) => setImmediate(resolve));

    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it("al arrancar recoge lo pendiente; el kick adelanta un tick y un segundo arranque no duplica el intervalo", async () => {
    repo.claimNext.mockResolvedValue(null);

    expect(startClockPunchPostProcessWorker()).toBe(true);
    expect(startClockPunchPostProcessWorker()).toBe(false);
    await vi.waitFor(() => expect(repo.claimNext).toHaveBeenCalledTimes(1));

    kickClockPunchPostProcess();
    await vi.waitFor(() => expect(repo.claimNext).toHaveBeenCalledTimes(2));
  });
});
