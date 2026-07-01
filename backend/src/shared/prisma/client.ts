import { Prisma, PrismaClient } from "@prisma/client";
import { isProduction } from "../../config/env";
import { recordPrismaQuery } from "../observability/requestMetrics";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient<Prisma.PrismaClientOptions, "query"> | undefined;
  // eslint-disable-next-line no-var
  var prismaQueryLoggerAttached: boolean | undefined;
}

export const prisma =
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
  globalThis.prisma = prisma;
}

if (!isProduction && !globalThis.prismaQueryLoggerAttached) {
  prisma.$on("query", (event) => {
    recordPrismaQuery(event.query, event.duration);
  });
  globalThis.prismaQueryLoggerAttached = true;
}
