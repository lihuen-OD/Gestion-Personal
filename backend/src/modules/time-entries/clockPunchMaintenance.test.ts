import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { maintainClockPunchAttempts } from "./clockPunchMaintenance";
import { timeEntriesRepository } from "./timeEntries.repository";
import { notifyMissingExit } from "./timeEntries.service";
import { checkMissingOutRisk } from "../shifts/openShiftMonitor.service";

// R1.1 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.1): el tick de
// mantenimiento de 60 s es quien avisa FALTA_SALIDA después del cierre técnico
// de expireOpenWorkShifts (que no inventa la salida, ver
// timeEntries.repository.test.ts «R1.1-C»). Sin base: todo lo que el tick
// invoca está mockeado; sólo se observa la orquestación.
vi.mock("../../config/env", () => ({
  env: { CLOCK_ATTEMPT_PROCESSING_TTL_MS: 120_000, CLOCK_ATTEMPT_RETENTION_DAYS: 30, CLOCK_ATTEMPT_MAINTENANCE_INTERVAL_MS: 60_000 },
}));
vi.mock("./timeEntries.repository", () => ({
  timeEntriesRepository: {
    expireOpenWorkShifts: vi.fn(),
    expireClockPunchAttempts: vi.fn().mockResolvedValue({ count: 0 }),
    deleteClockPunchAttempts: vi.fn().mockResolvedValue({ count: 0 }),
  },
}));
vi.mock("./timeEntries.service", () => ({ notifyMissingExit: vi.fn() }));
vi.mock("../../shared/storage/storageFiles.repository", () => ({ storageFilesRepository: { countUnlinkedPunchEvidence: vi.fn().mockResolvedValue(0) } }));
vi.mock("./attendanceInactivityScheduler", () => ({ runAttendanceInactivityCatchUp: vi.fn().mockResolvedValue({ detectedTotal: 0, ranDates: [] }) }));
vi.mock("./missingEntry.service", () => ({ checkMissingExpectedEntries: vi.fn().mockResolvedValue({ candidates: 0, due: 0, created: 0, resolved: 0 }) }));
vi.mock("./missingEntryScheduler", () => ({ runMissingEntryCatchUp: vi.fn().mockResolvedValue({ detectedTotal: 0, ranDates: [], bootstrapped: false }) }));
vi.mock("../shifts/openShiftMonitor.service", () => ({ checkMissingOutRisk: vi.fn().mockResolvedValue({ checked: 0, created: 0 }) }));
vi.mock("../clock-devices/clockDevices.service", () => ({ clockDevicesService: { cleanupStalePending: vi.fn().mockResolvedValue({ deleted: 0 }) } }));
vi.mock("../../shared/storage/storageArchive.worker", () => ({ processStorageArchiveBatch: vi.fn().mockResolvedValue(undefined) }));

const expireOpenWorkShifts = timeEntriesRepository.expireOpenWorkShifts as unknown as Mock;
const notify = notifyMissingExit as unknown as Mock;

describe("R1.1-C — mantenimiento: aviso FALTA_SALIDA tras el cierre técnico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("avisa una vez por cada jornada cerrada, con su legajo, jornada e inicio (eventAt = ingreso, no una salida inventada)", async () => {
    const saturday = new Date("2026-11-07T07:00:00.000-03:00");
    const friday = new Date("2026-11-06T07:00:00.000-03:00");
    expireOpenWorkShifts.mockResolvedValueOnce({
      count: 2,
      items: [
        { employeeId: "employee-juanjo", workShiftId: "shift-sat", startAt: saturday },
        { employeeId: "employee-jose", workShiftId: "shift-0700", startAt: friday },
      ],
    });
    notify.mockResolvedValue(undefined);

    await maintainClockPunchAttempts();

    expect(notify.mock.calls).toEqual([
      ["employee-juanjo", "shift-sat", saturday],
      ["employee-jose", "shift-0700", friday],
    ]);
    expect(checkMissingOutRisk).toHaveBeenCalledTimes(1);
  });

  it("un aviso que falla no impide los siguientes ni el resto del tick", async () => {
    expireOpenWorkShifts.mockResolvedValueOnce({
      count: 2,
      items: [
        { employeeId: "employee-a", workShiftId: "shift-a", startAt: new Date("2026-11-07T07:00:00.000-03:00") },
        { employeeId: "employee-b", workShiftId: "shift-b", startAt: new Date("2026-11-07T08:00:00.000-03:00") },
      ],
    });
    notify.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    await maintainClockPunchAttempts();

    expect(notify).toHaveBeenCalledTimes(2);
    expect(checkMissingOutRisk).toHaveBeenCalledTimes(1);
  });

  it("sin jornadas vencidas no avisa nada", async () => {
    expireOpenWorkShifts.mockResolvedValueOnce({ count: 0, items: [] });

    await maintainClockPunchAttempts();

    expect(notify).not.toHaveBeenCalled();
  });
});
