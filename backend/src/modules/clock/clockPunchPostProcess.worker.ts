import type { ClockPunchPostProcessKind, Prisma } from "@prisma/client";
import type { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { clearAuditDerivedCaches, type AuditContext } from "../audit/audit.service";
import { automaticHourConceptBreakdownsService } from "../employees/automaticHourConceptBreakdowns.service";
import { clearEmployeeTimeGridCache } from "../employees/employees.controller";
import { clearShiftAlertReadCaches } from "../shifts/shiftAlert.cache";
import { evaluateShiftEntry, evaluateShiftExit, resolveOpenShiftOverflowAlert } from "../shifts/workShiftEvaluationRunner";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { ROLLOVER_OVERFLOW_RESOLUTION_NOTE } from "../time-entries/timeEntries.repository";
import { notifyMissingExit } from "../time-entries/timeEntries.service";
import { clearNotificationsListCache } from "../workforce-management/workforce.cache";
import { entryPayloadSchema, exitPayloadSchema, rolloverPayloadSchema } from "./clockPunchPostProcess.payload";
import {
  ClockPunchPostProcessLeaseLost,
  clockPunchPostProcessRepository as repository,
  type ClaimedClockPunchPostProcessJob,
  type ClockPunchPostProcessScope,
} from "./clockPunchPostProcess.repository";

/**
 * PERF-5D (docs/decisions/F12_PERF_5.md): lo que una fichada hacía después de
 * su commit y antes del 201 (alertas, avisos, adopción de turno, Motor B) corre
 * acá, desde el outbox durable `ClockPunchPostProcessJob`.
 *
 * - La garantía es la fila del job, creada en la transacción de la fichada. El
 *   `kick` del controller sólo adelanta el próximo tick; el intervalo (y
 *   cualquier otra instancia) recoge lo que quede PENDING tras un reinicio.
 * - Cada paso confirma sus efectos y su marca (`stepsCompleted`) en una sola
 *   transacción, bajo el lock de la fila del job y con fencing por
 *   attemptCount: un reintento retoma desde el primer paso sin marca y nunca
 *   duplica alertas, avisos, desgloses ni auditoría.
 * - Un fallo nunca invalida la fichada: el job vuelve a PENDING con backoff y,
 *   agotados los intentos, queda FAILED (log crítico + fila con el error). El
 *   cierre mensual no avanza con jobs sin terminar de su período.
 */
const LEASE_MS = 2 * 60_000;
// Backoff 5 s·2^(n-1) con techo de 15 min: 12 intentos cubren ~1 h de
// indisponibilidad antes de dejar el job FAILED.
const MAX_ATTEMPTS = 12;
// Las evaluaciones leen configuración por el cliente global mientras la
// transacción del paso está abierta: margen sobre el default de 5 s de Prisma.
const STEP_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

export const POSTPROCESS_STEPS = {
  overflowResolution: "overflow-resolution",
  missingExitNotice: "missing-exit-notice",
  entryEvaluation: "entry-evaluation",
  exitEvaluation: "exit-evaluation",
  breakdowns: (period: string) => `breakdowns:${period}`,
} as const;

function leaseUntil() {
  return new Date(Date.now() + LEASE_MS);
}

function nextRetry(attemptCount: number) {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + base + Math.floor(Math.random() * Math.max(1, base * 0.2)));
}

// Para la fila del job: el código y la última línea del mensaje (en los
// errores de Prisma es la del motor/base; las anteriores son el call site).
function safeError(error: unknown) {
  const rawCode = error instanceof AppError ? error.code : (error as { code?: unknown } | null)?.code;
  const code = typeof rawCode === "string" && rawCode ? rawCode : "CLOCK_POSTPROCESS_UNKNOWN";
  const lines = (error instanceof Error ? error.message : "Clock punch post-process failed").split("\n").map((line) => line.trim()).filter(Boolean);
  return { code: code.slice(0, 100), message: (lines.at(-1) ?? "Clock punch post-process failed").slice(0, 500) };
}

function parsePayload<T extends z.ZodTypeAny>(schema: T, job: ClaimedClockPunchPostProcessJob): z.output<T> {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) throw new AppError("Invalid clock punch post-process payload", 500, "CLOCK_POSTPROCESS_PAYLOAD_INVALID");
  return parsed.data;
}

// Errores que un reintento no cambia: el job queda FAILED de inmediato.
const terminalCodes = new Set(["CLOCK_POSTPROCESS_PAYLOAD_INVALID", "CLOCK_POSTPROCESS_KIND_UNSUPPORTED"]);

/**
 * Corre un paso: si ya tiene marca no hace nada; si no, efectos + marca en una
 * transacción con la fila del job bloqueada (fencing por attemptCount).
 */
async function runStep(job: ClaimedClockPunchPostProcessJob, step: string, effect: (tx: PrismaTransactionClient) => Promise<unknown>) {
  if (job.stepsCompleted.includes(step)) return;
  await prisma.$transaction(async (tx) => {
    const done = await repository.lockForStep(tx, job.id, job.attemptCount);
    if (done.includes(step)) return;
    await effect(tx);
    await repository.markStep(tx, job.id, step, leaseUntil());
  }, STEP_TRANSACTION_OPTIONS);
  job.stepsCompleted.push(step);
}

/**
 * Motor B: el recálculo ya corre en su propia transacción serializable; la
 * marca del paso (y su auditoría) entran en ESA transacción vía
 * `withinTransaction`. PERIOD_CLOSED conserva el criterio previo a PERF-5D
 * (15M.1 §26): el período cerrado no se regenera y el paso se da por cumplido.
 */
async function runBreakdownStep(job: ClaimedClockPunchPostProcessJob, period: string, audit?: AuditContext) {
  const step = POSTPROCESS_STEPS.breakdowns(period);
  if (job.stepsCompleted.includes(step)) return;
  try {
    await automaticHourConceptBreakdownsService.recalculateForEmployeePeriod({
      employeeId: job.employeeId,
      period,
      createdByUserId: audit?.userId,
      audit,
      withinTransaction: async (tx) => {
        const done = await repository.lockForStep(tx, job.id, job.attemptCount);
        // Sólo otro claim pudo marcarlo: se revierte este segundo recálculo.
        if (done.includes(step)) throw new ClockPunchPostProcessLeaseLost(job.id);
        await repository.markStep(tx, job.id, step, leaseUntil());
      },
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "PERIOD_CLOSED") throw error;
    console.error("AUTOMATIC_BREAKDOWN_SYNC_FAILED", { severity: "warning", employeeId: job.employeeId, period, workShiftId: job.workShiftId, code: error.code, error: error.message });
    await runStep(job, step, async () => undefined);
    return;
  }
  job.stepsCompleted.push(step);
}

async function runSteps(job: ClaimedClockPunchPostProcessJob) {
  const kind: ClockPunchPostProcessKind = job.kind;
  if (kind === "ENTRY") {
    const payload = parsePayload(entryPayloadSchema, job);
    await runStep(job, POSTPROCESS_STEPS.entryEvaluation, (tx) => evaluateShiftEntry(job.employeeId, job.workShiftId, payload.actualAt, { db: tx }));
    return;
  }
  if (kind === "ROLLOVER_ENTRY") {
    // Mismo orden que el post-commit previo a PERF-5D: resolver la alerta de
    // la jornada vencida, avisar la falta de salida y evaluar el ingreso nuevo.
    const payload = parsePayload(rolloverPayloadSchema, job);
    await runStep(job, POSTPROCESS_STEPS.overflowResolution, (tx) => resolveOpenShiftOverflowAlert(payload.previousShift.id, ROLLOVER_OVERFLOW_RESOLUTION_NOTE, tx));
    await runStep(job, POSTPROCESS_STEPS.missingExitNotice, (tx) => notifyMissingExit(job.employeeId, payload.previousShift.id, payload.previousShift.startAt, { db: tx, rethrow: true }));
    await runStep(job, POSTPROCESS_STEPS.entryEvaluation, (tx) => evaluateShiftEntry(job.employeeId, job.workShiftId, payload.actualAt, { db: tx }));
    return;
  }
  if (kind === "EXIT") {
    // Mismo orden que antes: Motor B y después la evaluación de salida. La
    // jornada se relee en la transacción del paso (ya con el turno que adoptó
    // su ingreso: el claim garantiza que el job de entrada terminó).
    const payload = parsePayload(exitPayloadSchema, job);
    const audit = payload.audit ?? undefined;
    for (const period of job.periods) await runBreakdownStep(job, period, audit);
    await runStep(job, POSTPROCESS_STEPS.exitEvaluation, (tx) => evaluateShiftExit(job.employeeId, job.workShiftId, payload.actualAt, payload.segments, undefined, { db: tx, rethrow: true }));
    return;
  }
  throw new AppError("Unsupported clock punch post-process kind", 500, "CLOCK_POSTPROCESS_KIND_UNSUPPORTED");
}

// Cachés derivados de lo que escribió el job (las de visibilidad de la
// fichada ya se limpiaron en el request).
function clearPostProcessDerivedCaches() {
  clearAuditDerivedCaches();
  clearShiftAlertReadCaches();
  clearNotificationsListCache();
  clearTimeEntriesReadCaches();
  clearEmployeeTimeGridCache();
}

function withoutAudit(payload: Prisma.JsonValue): Prisma.InputJsonValue {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return (payload ?? {}) as Prisma.InputJsonValue;
  const { audit: _audit, ...rest } = payload as Record<string, Prisma.JsonValue>;
  return rest as Prisma.InputJsonValue;
}

export type ClockPunchPostProcessOutcome = { processed: false } | { processed: true; jobId: string; status: "COMPLETED" | "RETRY" | "FAILED" | "LEASE_LOST" };

export async function processClaimedClockPunchPostProcessJob(job: ClaimedClockPunchPostProcessJob): Promise<ClockPunchPostProcessOutcome> {
  const startedAt = performance.now();
  try {
    await runSteps(job);
    // El contexto de auditoría (IP/user agent) sólo hacía falta para los pasos.
    const completed = await repository.complete(job.id, job.attemptCount, withoutAudit(job.payload), new Date());
    if (completed.count !== 1) throw new ClockPunchPostProcessLeaseLost(job.id);
    clearPostProcessDerivedCaches();
    console.info("CLOCK_POSTPROCESS_COMPLETED", { jobId: job.id, kind: job.kind, attemptCount: job.attemptCount, durationMs: Number((performance.now() - startedAt).toFixed(1)), lagMs: Date.now() - job.createdAt.getTime() });
    return { processed: true, jobId: job.id, status: "COMPLETED" };
  } catch (error) {
    // Lo confirmado por pasos anteriores es visible aunque el job no termine.
    if (job.stepsCompleted.length) clearPostProcessDerivedCaches();
    if (error instanceof ClockPunchPostProcessLeaseLost) {
      console.warn("CLOCK_POSTPROCESS_LEASE_LOST", { jobId: job.id, kind: job.kind, attemptCount: job.attemptCount });
      return { processed: true, jobId: job.id, status: "LEASE_LOST" };
    }
    const safe = safeError(error);
    if (!terminalCodes.has(safe.code) && job.attemptCount < MAX_ATTEMPTS) {
      await repository.retry(job.id, job.attemptCount, nextRetry(job.attemptCount), safe.code, safe.message);
      console.warn("CLOCK_POSTPROCESS_RETRY", { jobId: job.id, kind: job.kind, code: safe.code, attemptCount: job.attemptCount, stepsCompleted: job.stepsCompleted });
      return { processed: true, jobId: job.id, status: "RETRY" };
    }
    await repository.fail(job.id, job.attemptCount, safe.code, safe.message);
    console.error("CLOCK_POSTPROCESS_FAILED", { severity: "critical", jobId: job.id, kind: job.kind, workShiftId: job.workShiftId, employeeId: job.employeeId, code: safe.code, attemptCount: job.attemptCount, stepsCompleted: job.stepsCompleted });
    return { processed: true, jobId: job.id, status: "FAILED" };
  }
}

export async function processOneClockPunchPostProcessJob(scope: ClockPunchPostProcessScope = {}, now = new Date()): Promise<ClockPunchPostProcessOutcome> {
  const job = await repository.claimNext(now, LEASE_MS, scope);
  if (!job) return { processed: false };
  return processClaimedClockPunchPostProcessJob(job);
}

export async function processClockPunchPostProcessBatch(limit = 20, scope: ClockPunchPostProcessScope = {}) {
  const outcomes: ClockPunchPostProcessOutcome[] = [];
  while (outcomes.length < limit) {
    const outcome = await processOneClockPunchPostProcessJob(scope);
    if (!outcome.processed) break;
    outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * Drenado en línea, acotado: intenta una vez cada job sin terminar del alcance
 * (incluidos FAILED y PENDING en backoff, en el orden del claim) y espera,
 * hasta `waitMs`, sólo a los que otro worker tiene tomados con lease vigente.
 * No lanza: quien necesita la garantía la verifica después
 * (`assertClockPunchPostProcessSettled`).
 */
export async function drainClockPunchPostProcess(scope: { employeeIds?: string[]; workShiftId?: string }, options: { waitMs?: number; limit?: number } = {}) {
  if (scope.employeeIds && !scope.employeeIds.length) return { attempted: 0 };
  const deadline = Date.now() + (options.waitMs ?? 10_000);
  const limit = options.limit ?? 100;
  const attempted: string[] = [];
  try {
    while (attempted.length < limit) {
      const outcome = await processOneClockPunchPostProcessJob({ ...scope, includeFailed: true, ignoreBackoff: true, excludeIds: [...attempted] });
      if (outcome.processed) {
        attempted.push(outcome.jobId);
        continue;
      }
      if (Date.now() >= deadline) break;
      if (!(await repository.countHeldElsewhere({ ...scope, excludeIds: [...attempted] }, new Date()))) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error("CLOCK_POSTPROCESS_DRAIN_FAILED", { severity: "warning", error: error instanceof Error ? error.message : String(error) });
  }
  return { attempted: attempted.length };
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;
let rerun = false;

function tick() {
  if (running) {
    rerun = true;
    return;
  }
  running = processClockPunchPostProcessBatch()
    .catch((error) => console.error("CLOCK_POSTPROCESS_TICK_FAILED", { severity: "warning", error: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        tick();
      }
    });
}

export function startClockPunchPostProcessWorker() {
  if (timer) return false;
  timer = setInterval(tick, env.CLOCK_POSTPROCESS_INTERVAL_MS);
  timer.unref();
  // Al arrancar recoge lo que una instancia anterior dejó PENDING o tomado.
  tick();
  console.info("CLOCK_POSTPROCESS_WORKER_STARTED", { intervalMs: env.CLOCK_POSTPROCESS_INTERVAL_MS });
  return true;
}

export function stopClockPunchPostProcessWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Acelerador, nunca la garantía: si el worker corre en este proceso, adelanta
 * el próximo tick. Sin worker local no hace nada (lo recoge otra instancia o
 * el intervalo).
 */
export function kickClockPunchPostProcess() {
  if (!timer) return;
  setImmediate(tick);
}
