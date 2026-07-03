import { Prisma, PrismaClient } from "@prisma/client";
import { isProduction } from "../../config/env";
import { recordPrismaQuery } from "../observability/requestMetrics";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient<Prisma.PrismaClientOptions, "query"> | undefined;
}

const prismaClient =
  globalThis.prisma ??
  new PrismaClient<Prisma.PrismaClientOptions, "query">({
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
        const startedAt = performance.now();
        try {
          return await query(args);
        } finally {
          if (!isProduction) {
            recordPrismaQuery(`${model}.${operation}`, performance.now() - startedAt);
          }
        }
      },
    },
  },
});
