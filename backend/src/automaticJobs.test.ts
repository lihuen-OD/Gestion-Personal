import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "./config/env";

const { startClockPunchMaintenance } = vi.hoisted(() => ({
  startClockPunchMaintenance: vi.fn(),
}));

vi.mock("./modules/time-entries/clockPunchMaintenance", () => ({ startClockPunchMaintenance }));

import { startAutomaticJobs } from "./automaticJobs";

describe("startAutomaticJobs", () => {
  const original = env.AUTOMATIC_JOBS_ENABLED;

  afterEach(() => {
    (env as { AUTOMATIC_JOBS_ENABLED: boolean }).AUTOMATIC_JOBS_ENABLED = original;
    startClockPunchMaintenance.mockReset();
  });

  it("no inicia ningún scheduler cuando la compuerta está desactivada", () => {
    (env as { AUTOMATIC_JOBS_ENABLED: boolean }).AUTOMATIC_JOBS_ENABLED = false;

    expect(startAutomaticJobs()).toBe(false);
    expect(startClockPunchMaintenance).not.toHaveBeenCalled();
  });

  it("conserva el arranque habitual cuando la compuerta está activa", () => {
    (env as { AUTOMATIC_JOBS_ENABLED: boolean }).AUTOMATIC_JOBS_ENABLED = true;

    expect(startAutomaticJobs()).toBe(true);
    expect(startClockPunchMaintenance).toHaveBeenCalledOnce();
  });
});
