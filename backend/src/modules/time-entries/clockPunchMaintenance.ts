import { env } from "../../config/env";
import { timeEntriesRepository } from "./timeEntries.repository";
import { notifyMissingExit } from "./timeEntries.service";
import { storageFilesRepository } from "../../shared/storage/storageFiles.repository";
import { runAttendanceInactivityCatchUp } from "./attendanceInactivityScheduler";
import { checkMissingExpectedEntries } from "./missingEntry.service";
import { checkMissingOutRisk } from "../shifts/openShiftMonitor.service";

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
      for (const item of expiredShifts.items) {
        try {
          await notifyMissingExit(item.employeeId, item.workShiftId);
        } catch (error) {
          console.error("CLOCK_WORK_SHIFT_NOTIFY_FAILED", {
            severity: "critical",
            workShiftId: item.workShiftId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    try {
      await checkMissingOutRisk(new Date(now));
    } catch (error) {
      console.error("CLOCK_MISSING_OUT_RISK_CHECK_FAILED", {
        severity: "critical",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Etapa 15M.19B: falta de ingreso intradía — reutiliza este mismo
    // scheduler de 60s (sin setInterval nuevo). No gatea por hora del día:
    // resolveWorkObligationCandidates/isToleranceExpired ya deciden por sí
    // solos si hay algo que hacer, y la idempotencia de
    // AttendanceInactivityIncident hace seguro reevaluar cada tick.
    try {
      const missingEntry = await checkMissingExpectedEntries(new Date(now));
      if (missingEntry.created > 0 || missingEntry.resolved > 0) {
        console.info("MISSING_EXPECTED_ENTRY_CHECKED", missingEntry);
      }
    } catch (error) {
      console.error("MISSING_EXPECTED_ENTRY_CHECK_FAILED", {
        severity: "critical",
        error: error instanceof Error ? error.message : String(error),
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

    try {
      const catchUp = await runAttendanceInactivityCatchUp(new Date());
      if (catchUp.detectedTotal > 0 || catchUp.ranDates.length > 0) {
        console.info("ATTENDANCE_INACTIVITY_DETECTED", catchUp);
      }
    } catch (error) {
      console.error("ATTENDANCE_INACTIVITY_CATCHUP_FAILED", {
        severity: "critical",
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
