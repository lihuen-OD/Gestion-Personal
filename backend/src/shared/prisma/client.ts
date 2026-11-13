import { Prisma, PrismaClient } from "@prisma/client";
import { isProduction, shouldRecordQueryMetrics } from "../../config/env";
import { recordPrismaQuery } from "../observability/requestMetrics";
import { countClockPunchQuery } from "../observability/clockPunchQueryBudget";
import { BLOCKED_TEST_DATABASE_URL, evaluateTestDatabaseGuard } from "./testDatabaseGuard";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient<Prisma.PrismaClientOptions, "query"> | undefined;
}

// Bajo vitest, una base que no sea local de integración queda bloqueada antes
// de conectar (testDatabaseGuard.ts): Prisma apunta a un puerto local
// inalcanzable y toda consulta de modelo falla con un mensaje claro.
const testDatabaseGuard = evaluateTestDatabaseGuard(process.env);

const prismaClient =
  globalThis.prisma ??
  new PrismaClient<Prisma.PrismaClientOptions, "query">({
    ...(testDatabaseGuard.blocked ? { datasourceUrl: BLOCKED_TEST_DATABASE_URL } : {}),
    log:
      !isProduction
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "error" },
            { emit: "stdout", level: "warn" },
          ]
        : [{ emit: "stdout", level: "error" }],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prismaClient;
}

export const prisma = prismaClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (testDatabaseGuard.blocked) throw new Error(testDatabaseGuard.message);
        const startedAt = performance.now();
        // PERF-5A: no-op fuera de un request de fichada (sin store en el ALS).
        countClockPunchQuery();
        try {
          return await query(args);
        } finally {
          // Etapa 14B.2: antes hardcodeado a `!isProduction` (nunca corría en
          // production). Ahora sigue a PERFORMANCE_LOGGING_ENABLED +
          // PERFORMANCE_LOG_INCLUDE_QUERY_METRICS — apagado por defecto en
          // production, activable de forma explícita y controlada.
          if (shouldRecordQueryMetrics()) {
            recordPrismaQuery(`${model}.${operation}`, performance.now() - startedAt);
          }
        }
      },
    },
  },
});

// El cliente está extendido (métricas), así que su `tx` no es
// Prisma.TransactionClient: se deriva del callback real de `prisma.$transaction`.
// Sirve para funciones que corren dentro de la transacción de quien las llama
// (o directo sobre `prisma`).
type TransactionCallback = Extract<Parameters<typeof prisma.$transaction>[0], (...args: never[]) => unknown>;
export type PrismaTransactionClient = Parameters<TransactionCallback>[0];
