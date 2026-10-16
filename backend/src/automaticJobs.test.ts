import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "./config/env";

const { startClockPunchMaintenance, startClockPunchPostProcessWorker } = vi.hoisted(() => ({
  startClockPunchMaintenance: vi.fn(),
  startClockPunchPostProcessWorker: vi.fn(),
}));

vi.mock("./modules/time-entries/clockPunchMaintenance", () => ({ startClockPunchMaintenance }));
vi.mock("./modules/clock/clockPunchPostProcess.worker", () => ({ startClockPunchPostProcessWorker }));

import { startAutomaticJobs } from "./automaticJobs";

type MutableEnv = { AUTOMATIC_JOBS_ENABLED: boolean; CLOCK_POSTPROCESS_WORKER_ENABLED?: boolean };

describe("startAutomaticJobs", () => {
  const original = env.AUTOMATIC_JOBS_ENABLED;
  const originalWorker = env.CLOCK_POSTPROCESS_WORKER_ENABLED;

  afterEach(() => {
    (env as MutableEnv).AUTOMATIC_JOBS_ENABLED = original;
    (env as MutableEnv).CLOCK_POSTPROCESS_WORKER_ENABLED = originalWorker;
    startClockPunchMaintenance.mockReset();
    startClockPunchPostProcessWorker.mockReset();
  });

  it("no inicia ningún scheduler cuando la compuerta está desactivada", () => {
    (env as MutableEnv).AUTOMATIC_JOBS_ENABLED = false;
    (env as MutableEnv).CLOCK_POSTPROCESS_WORKER_ENABLED = undefined;

    expect(startAutomaticJobs()).toBe(false);
    expect(startClockPunchMaintenance).not.toHaveBeenCalled();
    expect(startClockPunchPostProcessWorker).not.toHaveBeenCalled();
  });

  it("conserva el arranque habitual cuando la compuerta está activa (y el post-proceso de fichadas la sigue)", () => {
    (env as MutableEnv).AUTOMATIC_JOBS_ENABLED = true;
    (env as MutableEnv).CLOCK_POSTPROCESS_WORKER_ENABLED = undefined;

    expect(startAutomaticJobs()).toBe(true);
    expect(startClockPunchMaintenance).toHaveBeenCalledOnce();
    expect(startClockPunchPostProcessWorker).toHaveBeenCalledOnce();
  });

  // PERF-5D (docs/decisions/F12_PERF_5.md): un backend de QA puede procesar
  // el post-proceso de sus fichadas sin arrancar el resto de los schedulers.
  it("CLOCK_POSTPROCESS_WORKER_ENABLED=true arranca sólo el worker del post-proceso con la compuerta general apagada", () => {
    (env as MutableEnv).AUTOMATIC_JOBS_ENABLED = false;
    (env as MutableEnv).CLOCK_POSTPROCESS_WORKER_ENABLED = true;

    expect(startAutomaticJobs()).toBe(false);
    expect(startClockPunchPostProcessWorker).toHaveBeenCalledOnce();
    expect(startClockPunchMaintenance).not.toHaveBeenCalled();
  });

  it("CLOCK_POSTPROCESS_WORKER_ENABLED=false lo apaga aunque la compuerta general esté activa", () => {
    (env as MutableEnv).AUTOMATIC_JOBS_ENABLED = true;
    (env as MutableEnv).CLOCK_POSTPROCESS_WORKER_ENABLED = false;

    expect(startAutomaticJobs()).toBe(true);
    expect(startClockPunchPostProcessWorker).not.toHaveBeenCalled();
    expect(startClockPunchMaintenance).toHaveBeenCalledOnce();
  });
});
