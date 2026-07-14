import { env } from "../../config/env";
import { timeEntriesRepository } from "./timeEntries.repository";
import { storageFilesRepository } from "../../shared/storage/storageFiles.repository";

let running = false;
let lastOrphanCount: number | undefined;

export async function maintainClockPunchAttempts() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const expiredShifts = await timeEntriesRepository.expireOpenWorkShifts(new Date(now));
    if (expiredShifts.count > 0) {
      console.warn("CLOCK_WORK_SHIFTS_MISSING_EXIT", {
        severity: "warning",
        count: expiredShifts.count,
        rule: "ZERO_HOURS_REQUIRES_REVIEW",
      });
    }
    const expired = await timeEntriesRepository.expireClockPunchAttempts(
      new Date(now - env.CLOCK_ATTEMPT_PROCESSING_TTL_MS),
    );
    if (expired.count > 0) {
      console.error("CLOCK_ATTEMPTS_PROCESSING_EXPIRED", {
        severity: "critical",
        count: expired.count,
        processingTtlMs: env.CLOCK_ATTEMPT_PROCESSING_TTL_MS,
      });
    }

    const removed = await timeEntriesRepository.deleteClockPunchAttempts(
      new Date(now - env.CLOCK_ATTEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
    if (removed.count > 0) {
      console.info("CLOCK_ATTEMPTS_RETENTION_APPLIED", {
        count: removed.count,
        retentionDays: env.CLOCK_ATTEMPT_RETENTION_DAYS,
      });
    }

    const orphanCount = await storageFilesRepository.countUnlinkedPunchEvidence(
      new Date(now - Math.max(env.CLOCK_ATTEMPT_PROCESSING_TTL_MS, 10 * 60 * 1000)),
    );
    if (orphanCount > 0 && orphanCount !== lastOrphanCount) {
      console.error("CLOCK_STORAGE_ORPHAN_EVIDENCE_DETECTED", {
        severity: "critical",
        count: orphanCount,
      });
    }
    lastOrphanCount = orphanCount;
  } catch (error) {
    console.error("CLOCK_ATTEMPT_MAINTENANCE_FAILED", {
      severity: "critical",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

export function startClockPunchMaintenance() {
  void maintainClockPunchAttempts();
  const timer = setInterval(() => void maintainClockPunchAttempts(), env.CLOCK_ATTEMPT_MAINTENANCE_INTERVAL_MS);
  timer.unref();
}
