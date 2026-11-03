import type { WorkShiftSource } from "@prisma/client";
import { argentinaCalendarDate, argentinaDateKey, calendarDateKey, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { workShiftOperationalDateKey } from "../shifts/workShiftEvaluation.service";
import { notifyShiftAlert } from "../shifts/workShiftEvaluationRunner";
import { isAutomaticTimeEntrySource } from "./workedTimeAccounting";

/**
 * Horas cargadas a mano + actividad del fichador en la misma jornada
 * (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md).
 *
 * La fichada nunca se rechaza ni modifica las horas manuales: la jornada queda
 * `OBSERVADO` sin cargar horas (fichadas, fotos y tramos se conservan), las
 * horas manuales siguen computando y la alerta `ACTIVIDAD_SOBRE_CARGA_MANUAL`
 * pide a un responsable que decida. Este módulo es el único criterio de "fecha
 * con horas manuales" para la salida, el post-proceso y la resolución.
 */

export const MANUAL_HOURS_CONFLICT_ALERT_TYPE = "ACTIVIDAD_SOBRE_CARGA_MANUAL" as const;

export const MANUAL_HOURS_SHIFT_NOTE = "La fecha ya tenía horas cargadas manualmente: la fichada quedó registrada como evidencia y sus horas no se cargaron automáticamente. Requiere revisión.";

// Marcan la decisión en ShiftAlert.resolutionNote (mismo criterio que
// DAY_OFF_CANCELED_ALERT_NOTE): la lectura compara contra estas constantes.
export const KEEP_MANUAL_RESOLUTION_NOTE = "Se mantuvo la carga manual. La fichada queda como evidencia.";
export const USE_CLOCK_RESOLUTION_NOTE = "Se usaron las horas fichadas en lugar de la carga manual.";

export type ManualHoursDecision = "KEEP_MANUAL" | "USE_CLOCK";

export function manualHoursDecisionOf(resolutionNote: string | null | undefined): ManualHoursDecision | null {
  if (resolutionNote === KEEP_MANUAL_RESOLUTION_NOTE) return "KEEP_MANUAL";
  if (resolutionNote === USE_CLOCK_RESOLUTION_NOTE) return "USE_CLOCK";
  return null;
}

export const resolutionNoteByDecision: Record<ManualHoursDecision, string> = {
  KEEP_MANUAL: KEEP_MANUAL_RESOLUTION_NOTE,
  USE_CLOCK: USE_CLOCK_RESOLUTION_NOTE,
};

type Db = PrismaTransactionClient;
type ShiftForOperationalDate = { startAt: Date; shiftTemplateId: string | null };

/**
 * La fecha operativa (EMPLOYEE_DAY_OFF.md §4) difiere a lo sumo un día de la
 * del ingreso (= la del primer tramo) y puede no tener tramos (p. ej. ingreso
 * 00:15 tarde a un turno 23:00–07:00). Fechas a revisar: las de los tramos
 * más el día anterior y el siguiente al ingreso.
 */
export function candidateDateKeys(segmentDateKeys: string[]): string[] {
  const sorted = [...new Set(segmentDateKeys)].sort();
  if (!sorted.length) return [];
  return [...new Set([previousCalendarDateKey(sorted[0]!), ...sorted, nextCalendarDateKey(sorted[0]!)])].sort();
}

export async function operationalDateKeyForShift(db: Pick<Db, "shiftTemplate">, shift: ShiftForOperationalDate): Promise<string> {
  const template = shift.shiftTemplateId
    ? await db.shiftTemplate.findUnique({ where: { id: shift.shiftTemplateId }, select: { startTime: true, endTime: true, crossesMidnight: true } })
    : null;
  return workShiftOperationalDateKey(shift.startAt, template);
}

export type NormalEntryOnDate = { date: Date; source: WorkShiftSource | null };

/**
 * Única regla: una jornada del fichador choca con horas manuales si una fecha
 * de sus tramos, o su fecha operativa, ya tiene una fila de Horas base fijada
 * por una persona (carga manual o corrección: `isAutomaticTimeEntrySource`
 * falso), en cualquier estado. Devuelve esas fechas ordenadas.
 */
export function manualHoursDateKeys(entries: NormalEntryOnDate[], segmentDateKeys: Iterable<string>, operationalDateKey: string | null): string[] {
  const days = new Set(segmentDateKeys);
  if (operationalDateKey) days.add(operationalDateKey);
  return [...new Set(entries.filter((entry) => !isAutomaticTimeEntrySource(entry.source)).map((entry) => calendarDateKey(entry.date)).filter((key) => days.has(key)))].sort();
}

/** ¿Hace falta la fecha operativa? Sólo si hay una fila manual en una fecha candidata sin tramos. */
export function needsOperationalDate(entries: NormalEntryOnDate[], segmentDateKeys: Iterable<string>): boolean {
  const days = new Set(segmentDateKeys);
  return entries.some((entry) => !isAutomaticTimeEntrySource(entry.source) && !days.has(calendarDateKey(entry.date)));
}

export const normalBaseConceptWhere = { systemRole: "NORMAL_BASE" } as const;

export function calendarDatesOf(dateKeys: Iterable<string>): Date[] {
  return [...new Set(dateKeys)].sort().map(argentinaCalendarDate);
}

/**
 * Aviso de la alerta que creó la salida (sin notificar, para no arriesgar la
 * transacción de la fichada). Paso `manual-hours-notice` del post-proceso
 * durable; el cierre manual de RRHH lo llama después del commit. Sólo avisa
 * una alerta todavía pendiente.
 */
export async function notifyManualHoursConflict(workShiftId: string, options: { db?: Db } = {}): Promise<boolean> {
  const alert = await (options.db ?? prisma).shiftAlert.findUnique({
    where: { workShiftId_type: { workShiftId, type: MANUAL_HOURS_CONFLICT_ALERT_TYPE } },
    select: { id: true, employeeId: true, status: true, actualAt: true },
  });
  if (!alert || alert.status !== "PENDIENTE") return false;
  await notifyShiftAlert({ id: alert.id, employeeId: alert.employeeId, type: MANUAL_HOURS_CONFLICT_ALERT_TYPE, actualAt: alert.actualAt }, options.db);
  return true;
}

/**
 * Vencimiento sin salida (expireOpenWorkShifts y el rollover del ingreso): si
 * la fecha del ingreso ya tiene Horas base fijadas por una persona, la jornada
 * queda FALTA_SALIDA sin agregar la fila automática de 0 h al lado (la fila
 * manual sigue siendo la única de ese día). Sin lock: lo único que una carrera
 * con una carga manual puede dejar es esa fila de 0 h, que no cambia horas, y
 * el rollover corre en el request del fichador (F12_PERF_5.md).
 */
export async function hasManualNormalEntryOnStartDate(db: Pick<Db, "timeEntry">, input: { employeeId: string; hourConceptId: string; startAt: Date }): Promise<boolean> {
  const dateKey = argentinaDateKey(input.startAt);
  const rows = await db.timeEntry.findMany({
    where: { employeeId: input.employeeId, hourConceptId: input.hourConceptId, date: argentinaCalendarDate(dateKey) },
    select: { date: true, source: true },
  });
  return manualHoursDateKeys(rows, [dateKey], null).length > 0;
}
