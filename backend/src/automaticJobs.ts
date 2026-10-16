import { env } from "./config/env";
import { startClockPunchMaintenance } from "./modules/time-entries/clockPunchMaintenance";
import { startClockPunchPostProcessWorker } from "./modules/clock/clockPunchPostProcess.worker";

/**
 * Único punto de arranque de tareas automáticas del backend.
 *
 * `startClockPunchMaintenance` agrupa todos los procesos periódicos que
 * escriben datos hoy: vencimientos, alertas de turnos, falta de ingreso,
 * retención de intentos y catch-ups diarios. Mantener esta compuerta fuera de
 * `createApp` permite levantar la API para QA sin iniciar ningún job.
 */
export function startAutomaticJobs(): boolean {
  // PERF-5D: el post-proceso durable de fichadas sigue a la compuerta general
  // salvo que CLOCK_POSTPROCESS_WORKER_ENABLED la fije explícitamente.
  if (env.CLOCK_POSTPROCESS_WORKER_ENABLED ?? env.AUTOMATIC_JOBS_ENABLED) startClockPunchPostProcessWorker();
  if (!env.AUTOMATIC_JOBS_ENABLED) {
    console.info("AUTOMATIC_JOBS_DISABLED");
    return false;
  }

  startClockPunchMaintenance();
  return true;
}
