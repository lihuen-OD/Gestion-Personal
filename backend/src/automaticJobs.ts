import { env } from "./config/env";
import { startClockPunchMaintenance } from "./modules/time-entries/clockPunchMaintenance";

/**
 * Único punto de arranque de tareas automáticas del backend.
 *
 * `startClockPunchMaintenance` agrupa todos los procesos periódicos que
 * escriben datos hoy: vencimientos, alertas de turnos, falta de ingreso,
 * retención de intentos y catch-ups diarios. Mantener esta compuerta fuera de
 * `createApp` permite levantar la API para QA sin iniciar ningún job.
 */
export function startAutomaticJobs(): boolean {
  if (!env.AUTOMATIC_JOBS_ENABLED) {
    console.info("AUTOMATIC_JOBS_DISABLED");
    return false;
  }

  startClockPunchMaintenance();
  return true;
}
