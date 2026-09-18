import { env } from "../../config/env";
import { jobCheckpointRepository } from "../../shared/jobs/jobCheckpoint.repository";
import { nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { detectAttendanceInactivity, isInactivityCheckDue, previousOperationalDateKey } from "./attendanceInactivity.service";

/**
 * Etapa 15M.19A (docs/decisions/DURABLE_ATTENDANCE_INACTIVITY_SCHEDULER_15M19A.md).
 * Único identificador de este job en `JobCheckpoint` — una fila por job.
 */
export const ATTENDANCE_INACTIVITY_JOB_KEY = "attendance-inactivity-daily";

export interface AttendanceInactivityCatchUpResult {
  ranDates: string[];
  detectedTotal: number;
  bootstrapped: boolean;
  /** Presente sólo si una fecha falló a mitad del catch-up — ver §Fallo parcial de la decisión. */
  failedDate?: string;
}

/**
 * Fechas operativas pendientes entre `lastProcessedDateKey` (exclusivo) y
 * `targetDateKey` (inclusive), en orden ascendente y topeadas a `limit`.
 * Función pura — sin Prisma, sin I/O — para poder fijar la aritmética de
 * catch-up con tests que no dependan de mocks de base de datos.
 */
export function buildPendingDateKeys(lastProcessedDateKey: string, targetDateKey: string, limit: number): string[] {
  const pending: string[] = [];
  let cursor = lastProcessedDateKey;
  while (cursor < targetDateKey && pending.length < limit) {
    cursor = nextCalendarDateKey(cursor);
    pending.push(cursor);
  }
  return pending;
}

/**
 * Reemplaza, dentro de `clockPunchMaintenance.ts`, la llamada directa a
 * `detectAttendanceInactivity(previousOperationalDateKey(now))` gateada por
 * la variable module-level `lastInactivityDateKey`. Esa variable vivía sólo
 * en memoria del proceso Node y se perdía en cada restart/deploy/cold start
 * de Render — cualquier día cuyo tick de las 01:00 ARG no llegara a correr
 * quedaba sin evaluar para siempre, sin posibilidad de recuperarlo (ver
 * diagnóstico 15M.18 §5/§6). Ahora "último día procesado con éxito" vive en
 * `JobCheckpoint` (Postgres/Neon): un reinicio retoma exactamente donde
 * quedó en vez de saltear los días intermedios.
 *
 * Esta función NO cambia:
 * - cuándo corre el chequeo dentro del día (sigue gateado por
 *   `isInactivityCheckDue`, hora configurable vía
 *   `ATTENDANCE_INACTIVITY_CHECK_HOUR/MINUTE`);
 * - qué evalúa por fecha (`detectAttendanceInactivity` no se toca en esta
 *   etapa — sus exclusiones pendientes, ej. descanso semanal/WorkRegime,
 *   quedan explícitamente para 15M.19B).
 *
 * Sólo cambia CUÁNTOS días atrasados procesa por tick y CÓMO recuerda por
 * dónde iba.
 */
export async function runAttendanceInactivityCatchUp(reference: Date = new Date()): Promise<AttendanceInactivityCatchUpResult> {
  if (!isInactivityCheckDue(reference, env.ATTENDANCE_INACTIVITY_CHECK_HOUR, env.ATTENDANCE_INACTIVITY_CHECK_MINUTE)) {
    return { ranDates: [], detectedTotal: 0, bootstrapped: false };
  }

  const targetDateKey = previousOperationalDateKey(reference);
  let lastProcessedDateKey = await jobCheckpointRepository.findLastProcessedDateKey(ATTENDANCE_INACTIVITY_JOB_KEY);
  let bootstrapped = false;

  if (lastProcessedDateKey === null) {
    // Bootstrap (Opción A — ver decisión 15M.19A): primera vez que este job
    // corre con checkpoint persistido (tabla recién migrada, o key nueva).
    // Nunca reprocesa histórico por defecto — inicializa el checkpoint en
    // "ayer" y el catch-up real arranca recién desde la fecha siguiente.
    // ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE permite elegir un punto de
    // partida distinto de forma explícita (ej. se sabe que hubo una caída
    // puntual justo antes de este deploy) — nunca se hardcodea en código.
    const bootstrapDateKey = env.ATTENDANCE_INACTIVITY_BOOTSTRAP_DATE ?? targetDateKey;
    await jobCheckpointRepository.advance(ATTENDANCE_INACTIVITY_JOB_KEY, bootstrapDateKey);
    console.info("ATTENDANCE_INACTIVITY_CHECKPOINT_BOOTSTRAPPED", { dateKey: bootstrapDateKey });
    lastProcessedDateKey = bootstrapDateKey;
    bootstrapped = true;
  }

  const pendingDateKeys = buildPendingDateKeys(lastProcessedDateKey, targetDateKey, env.ATTENDANCE_INACTIVITY_MAX_CATCHUP_DATES);
  if (!pendingDateKeys.length) return { ranDates: [], detectedTotal: 0, bootstrapped };

  console.info("ATTENDANCE_INACTIVITY_CATCHUP_STARTED", {
    from: pendingDateKeys[0],
    to: pendingDateKeys[pendingDateKeys.length - 1],
    count: pendingDateKeys.length,
  });

  const ranDates: string[] = [];
  let detectedTotal = 0;
  for (const dateKey of pendingDateKeys) {
    try {
      const result = await detectAttendanceInactivity(dateKey);
      // El checkpoint sólo avanza DESPUÉS de que `detectAttendanceInactivity`
      // resolvió sin lanzar — ver §Fallo parcial de la decisión 15M.19A para
      // por qué no hace falta una transacción que abarque ambos pasos: la
      // idempotencia ya existente (createMany skipDuplicates + notifiedAt)
      // hace segura una reejecución de la misma fecha si el proceso muere
      // entre esta línea y la siguiente.
      await jobCheckpointRepository.advance(ATTENDANCE_INACTIVITY_JOB_KEY, dateKey);
      ranDates.push(dateKey);
      detectedTotal += result.detected;
      console.info("ATTENDANCE_INACTIVITY_CATCHUP_DATE_PROCESSED", { dateKey, detected: result.detected });
    } catch (error) {
      // No avanzar el checkpoint más allá del fallo, y no seguir con fechas
      // más nuevas: quedarían "adelante" de una fecha que nunca se procesó.
      console.error("ATTENDANCE_INACTIVITY_CATCHUP_DATE_FAILED", {
        severity: "critical",
        dateKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ranDates, detectedTotal, bootstrapped, failedDate: dateKey };
    }
  }

  return { ranDates, detectedTotal, bootstrapped };
}
