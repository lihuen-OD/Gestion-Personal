import { env } from "../../config/env";
import { jobCheckpointRepository } from "../../shared/jobs/jobCheckpoint.repository";
import { isInactivityCheckDue, previousOperationalDateKey } from "./attendanceInactivity.service";
import { buildPendingDateKeys } from "./attendanceInactivityScheduler";
import { checkMissingEntriesForElapsedDate } from "./missingEntry.service";

/**
 * Etapa 15M.19F (docs/decisions/MISSING_ENTRY_CROSS_MIDNIGHT_RECONCILIATION_15M19F.md).
 * Único identificador de este job en `JobCheckpoint` — una fila por job.
 * A propósito NUNCA se reutiliza `ATTENDANCE_INACTIVITY_JOB_KEY`
 * ("attendance-inactivity-daily", ver attendanceInactivityScheduler.ts): son
 * checkpoints de negocio distintos (uno cubre SIN_ACTIVIDAD_REGISTRADA sobre
 * el día completo, el otro FALTA_INGRESO sobre una obligación puntual) que
 * deben poder avanzar de forma independiente.
 */
export const MISSING_ENTRY_JOB_KEY = "missing-entry-catchup";

export interface MissingEntryCatchUpResult {
  ranDates: string[];
  detectedTotal: number;
  bootstrapped: boolean;
  /** Presente sólo si una fecha falló a mitad del catch-up. */
  failedDate?: string;
}

/**
 * `checkMissingExpectedEntries` (missingEntry.service.ts) sólo evalúa el día
 * operativo de HOY, en cada tick de 60s — nunca vuelve atrás por sí solo. Si
 * el proceso estuvo caído durante la ventana en la que venció la tolerancia
 * de una obligación (ej. turno nocturno 23:00), esa obligación queda sin
 * evaluar para siempre en cuanto "hoy" avanza — el bug real reportado
 * (caso "Sereno").
 *
 * Esta función cubre exactamente ese hueco, reutilizando el MISMO mecanismo
 * de checkpoint durable que `attendanceInactivityScheduler.ts` (15M.19A):
 * misma tabla (`JobCheckpoint`), mismo contrato de `jobCheckpointRepository`
 * (avanza sólo hacia adelante, seguro ante reinicios), mismo bootstrap
 * conservador (nunca reprocesa histórico en la primera corrida), misma
 * `buildPendingDateKeys` (función pura, reutilizada tal cual, sin
 * reimplementarla) — pero con su PROPIA key de checkpoint.
 *
 * También reutiliza `isInactivityCheckDue` (genérico pese al nombre: "¿ya
 * pasó tal hora del día en Argentina?") con el mismo
 * `ATTENDANCE_INACTIVITY_CHECK_HOUR/MINUTE` que el catch-up diario — no hace
 * falta una hora de corte distinta: el mismo margen después de medianoche
 * que hace seguro evaluar "ayer" como día completo para SIN_ACTIVIDAD_REGISTRADA
 * también lo hace para FALTA_INGRESO.
 *
 * Por diseño, cada fecha pendiente se procesa con
 * `checkMissingEntriesForElapsedDate` (crea Y resuelve) — esto además
 * resuelve automáticamente, sin trabajo extra, un incidente de un turno que
 * cruza medianoche cuyo ingreso (tardío) recién se registró después de las
 * 00:00 del día siguiente.
 */
export async function runMissingEntryCatchUp(reference: Date = new Date()): Promise<MissingEntryCatchUpResult> {
  if (!isInactivityCheckDue(reference, env.ATTENDANCE_INACTIVITY_CHECK_HOUR, env.ATTENDANCE_INACTIVITY_CHECK_MINUTE)) {
    return { ranDates: [], detectedTotal: 0, bootstrapped: false };
  }

  const targetDateKey = previousOperationalDateKey(reference);
  let lastProcessedDateKey = await jobCheckpointRepository.findLastProcessedDateKey(MISSING_ENTRY_JOB_KEY);
  let bootstrapped = false;

  if (lastProcessedDateKey === null) {
    // Bootstrap: nunca reprocesa histórico — inicializa el checkpoint en
    // "ayer" y el catch-up real arranca recién desde la fecha siguiente.
    // Mismo criterio que attendanceInactivityScheduler (15M.19A §Bootstrap).
    await jobCheckpointRepository.advance(MISSING_ENTRY_JOB_KEY, targetDateKey);
    console.info("MISSING_ENTRY_CHECKPOINT_BOOTSTRAPPED", { dateKey: targetDateKey });
    lastProcessedDateKey = targetDateKey;
    bootstrapped = true;
  }

  const pendingDateKeys = buildPendingDateKeys(lastProcessedDateKey, targetDateKey, env.MISSING_ENTRY_MAX_CATCHUP_DATES);
  if (!pendingDateKeys.length) return { ranDates: [], detectedTotal: 0, bootstrapped };

  console.info("MISSING_ENTRY_CATCHUP_STARTED", {
    from: pendingDateKeys[0],
    to: pendingDateKeys[pendingDateKeys.length - 1],
    count: pendingDateKeys.length,
  });

  const ranDates: string[] = [];
  let detectedTotal = 0;
  for (const dateKey of pendingDateKeys) {
    try {
      const result = await checkMissingEntriesForElapsedDate(dateKey);
      // El checkpoint sólo avanza DESPUÉS de que la fecha se procesó sin
      // lanzar — igual criterio que 15M.19A: la idempotencia ya existente
      // (createMany skipDuplicates + notifiedAt) hace segura una
      // reejecución de la misma fecha si el proceso muere entre esta línea
      // y la siguiente.
      await jobCheckpointRepository.advance(MISSING_ENTRY_JOB_KEY, dateKey);
      ranDates.push(dateKey);
      detectedTotal += result.created;
      console.info("MISSING_ENTRY_CATCHUP_DATE_PROCESSED", { dateKey, created: result.created, resolved: result.resolved });
    } catch (error) {
      // No avanzar el checkpoint más allá del fallo, y no seguir con fechas
      // más nuevas: quedarían "adelante" de una fecha que nunca se procesó.
      console.error("MISSING_ENTRY_CATCHUP_DATE_FAILED", {
        severity: "critical",
        dateKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ranDates, detectedTotal, bootstrapped, failedDate: dateKey };
    }
  }

  return { ranDates, detectedTotal, bootstrapped };
}
