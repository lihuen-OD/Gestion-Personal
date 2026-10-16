import { AsyncLocalStorage } from "node:async_hooks";

/**
 * PERF-5A (docs/decisions/F12_PERF_5.md): presupuesto de queries de una fichada
 * por fase, medido en producción sin costo relevante. Cuenta OPERACIONES Prisma
 * de modelo (las que pasan por la extensión de shared/prisma/client.ts) dentro
 * del request de photo-punch:
 * - pre: desde que entra al controller hasta abrir la transacción de la fichada;
 * - tx: dentro de esa transacción;
 * - post: después del COMMIT y antes de responder.
 * No incluye sentencias de control (BEGIN/COMMIT) ni `$queryRaw`; el conteo
 * exacto de sentencias SQL lo fija clockPunchPerf.integration.test.ts. Nunca
 * registra SQL, parámetros ni datos del empleado.
 */
export type ClockPunchQueryPhase = "pre" | "tx" | "post";

type ClockPunchQueryBudget = {
  requestId: string;
  phase: ClockPunchQueryPhase;
  counts: Record<ClockPunchQueryPhase, number>;
};

const storage = new AsyncLocalStorage<ClockPunchQueryBudget>();

export function runWithClockPunchQueryBudget<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
  return storage.run({ requestId, phase: "pre", counts: { pre: 0, tx: 0, post: 0 } }, operation);
}

export function markClockPunchQueryPhase(phase: ClockPunchQueryPhase) {
  const budget = storage.getStore();
  if (budget) budget.phase = phase;
}

export function countClockPunchQuery() {
  const budget = storage.getStore();
  if (budget) budget.counts[budget.phase] += 1;
}

export function emitClockPunchQueryBudget(result: "success" | "error") {
  const budget = storage.getStore();
  if (!budget) return;
  const { pre, tx, post } = budget.counts;
  console.info(JSON.stringify({ level: "info", event: "clock_punch_query_budget", requestId: budget.requestId, pre, tx, post, total: pre + tx + post, result }));
}
