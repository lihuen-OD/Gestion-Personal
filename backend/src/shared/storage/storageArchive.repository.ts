import { prisma } from "../prisma/client";
import type { PrismaTransactionClient } from "../prisma/client";
import type { PersistedStorageProvider } from "./storage.types";

/**
 * F12-PERF-4 (docs/decisions/F12_PERF_3_4.md): outbox durable del archivo
 * secundario. El job nace en la MISMA transacción que su StorageFile primario
 * (nunca hay archivo sin job ni job sin archivo) y lo procesa
 * storageArchive.worker fuera del camino crítico de la fichada.
 *
 * complete/retry/fail exigen el attemptCount del claim (fencing): un worker
 * cuyo lease venció y fue reclamado por otro ya no puede cerrar el job.
 */
export const storageArchiveRepository = {
  enqueue(tx: PrismaTransactionClient, sourceStorageFileId: string, targetProvider: PersistedStorageProvider) {
    return tx.storageArchiveJob.create({ data: { sourceStorageFileId, targetProvider } });
  },

  async claimNext(now: Date, leaseMs: number) {
    return prisma.$transaction(async (tx) => {
      const claimable = {
        OR: [
          { status: "PENDING" as const, nextAttemptAt: { lte: now } },
          { status: "PROCESSING" as const, leaseExpiresAt: { lt: now } },
        ],
      };
      const candidate = await tx.storageArchiveJob.findFirst({
        where: claimable,
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;
      const claimed = await tx.storageArchiveJob.updateMany({
        where: { id: candidate.id, ...claimable },
        data: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          startedAt: candidate.startedAt || now,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (claimed.count !== 1) return null;
      return tx.storageArchiveJob.findUnique({
        where: { id: candidate.id },
        include: { sourceStorageFile: true },
      });
    });
  },

  complete(id: string, attemptCount: number, targetStorageKey: string, now: Date) {
    return prisma.storageArchiveJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "COMPLETED", targetStorageKey, completedAt: now, leaseExpiresAt: null },
    });
  },

  retry(id: string, attemptCount: number, nextAttemptAt: Date, code: string, message: string) {
    return prisma.storageArchiveJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "PENDING", nextAttemptAt, leaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: message },
    });
  },

  fail(id: string, attemptCount: number, code: string, message: string) {
    return prisma.storageArchiveJob.updateMany({
      where: { id, status: "PROCESSING", attemptCount },
      data: { status: "FAILED", leaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: message },
    });
  },
};
