/**
 * Trabajo no programado — R4.5 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.7).
 *
 * Regla uniforme para fijos y rotación: el motor de obligación decide primero
 * (franco y feriado no convocado no tienen turno exigible) y recién después se
 * clasifica la fichada. Las alertas que dependen de un turno (puntualidad,
 * salida anticipada/tardía, jornada insuficiente o fuera de turno) sólo
 * existen si había obligación.
 *
 * Este archivo tiene la parte pura de la clasificación de fijos (el matching
 * `matchShiftForEmployee` NO cambia: sigue sin mirar franco, feriado ni
 * régimen — A2/A4 de la caracterización) y el cargador mínimo de hechos del
 * día. La rotación se clasifica en `rotationEntry.ts` con el mismo criterio.
 */
import { argentinaCalendarDate, calendarDateKey, calendarWeekdayOfKey, formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { prisma } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { isShiftAssignmentActiveOnDate } from "./expectedShiftResolver";
import type { ShiftMatchResult } from "./workShiftEvaluation.service";

/** Hechos de la fecha operativa que deciden si había un turno exigible. */
export type EntryDayFacts = { dayOff: boolean; holiday: boolean; convoked: boolean };

export type FixedEntryClassification =
  /** Hay turno exigible: matching, adopción y puntualidad exactamente como antes. */
  | { kind: "ASSIGNED" }
  /** Franco: sólo ACTIVIDAD_EN_FRANCO (paso de francos). Sin alertas de turno. */
  | { kind: "DAY_OFF" }
  /** Feriado sin convocatoria: no programado, informativo. Sin alertas de turno. */
  | { kind: "UNSCHEDULED"; reason: UnscheduledWorkReason }
  /** Convocado al feriado sin turno aplicable ese día: sólo diagnóstico. */
  | { kind: "CONVOKED_WITHOUT_SCHEDULE" }
  /** Sin ninguna asignación HABILITADA vigente: configuración legacy (TURNO_NO_IDENTIFICADO, como siempre). */
  | { kind: "NO_ASSIGNMENTS" };

export type UnscheduledWorkReason = "DIA_NO_PROGRAMADO" | "FERIADO_NO_CONVOCADO" | "DESCANSO_ROTACION" | "FUERA_DEL_TURNO";

type AssignmentVigency = { status: string; shiftTemplateId: string; effectiveFrom?: Date; effectiveTo?: Date | null };

/**
 * ¿Tiene una asignación HABILITADA, vigente en la fecha y con plantilla
 * ACTIVA, aunque no incluya ese día de la semana? Distingue "trabaja un día
 * que su turno no incluye" (Juanjo sábado) de "no tiene turno configurado".
 */
export function hasVigentEnabledAssignment(assignments: readonly AssignmentVigency[], activeTemplateIds: ReadonlySet<string>, dateKey: string): boolean {
  const referenceDate = argentinaCalendarDate(dateKey);
  return assignments.some((assignment) => assignment.status === "HABILITADO" && activeTemplateIds.has(assignment.shiftTemplateId) && isShiftAssignmentActiveOnDate(assignment, referenceDate));
}

/**
 * Precedencia (fecha operativa D): franco → feriado no convocado → turno
 * propio que matcheó (el de la convocatoria si tiene plantilla, P8 §20; si no,
 * el habitual) →
 * convocado sin turno → día no incluido en su asignación → sin configuración.
 */
export function classifyFixedEntry(input: { match: Pick<ShiftMatchResult, "case">; facts: EntryDayFacts; hasVigentEnabledAssignment: boolean }): FixedEntryClassification {
  if (input.facts.dayOff) return { kind: "DAY_OFF" };
  if (input.facts.holiday && !input.facts.convoked) return { kind: "UNSCHEDULED", reason: "FERIADO_NO_CONVOCADO" };
  if (input.match.case === "ENABLED" || input.match.case === "DISABLED_FOR_EMPLOYEE") return { kind: "ASSIGNED" };
  if (input.facts.holiday && input.facts.convoked) return { kind: "CONVOKED_WITHOUT_SCHEDULE" };
  if (input.hasVigentEnabledAssignment) return { kind: "UNSCHEDULED", reason: "DIA_NO_PROGRAMADO" };
  return { kind: "NO_ASSIGNMENTS" };
}

/** ¿La fecha operativa deja sin turno exigible a una jornada que igual adoptó su plantilla? */
export function hasNoEnforceableShift(facts: EntryDayFacts): boolean {
  return facts.dayOff || (facts.holiday && !facts.convoked);
}

/**
 * Hechos de (empleado, fecha) con los mismos criterios que la obligación
 * (`resolveWorkObligationCandidates` / `resolveRotationObligations`): feriado
 * por calendario sin alcance (P7, §20), convocatoria ACTIVA, franco ACTIVO.
 * Hasta 3 lecturas, sólo desde el post-proceso asíncrono (nunca en la fichada).
 */
export async function loadEntryDayFacts(employeeId: string, dateKey: string): Promise<EntryDayFacts> {
  const date = argentinaCalendarDate(dateKey);
  // Mismas formas de consulta que la obligación (findMany + filtro por persona).
  const [holidayDays, dayOffs] = await Promise.all([
    workforceService.holidayDatesInRange(date, date),
    prisma.employeeDayOff.findMany({ where: { employeeId, date, status: "ACTIVO" }, select: { employeeId: true } }),
  ]);
  const holiday = holidayDays.some((day) => (typeof day.date === "string" ? day.date.slice(0, 10) : calendarDateKey(day.date as Date)) === dateKey);
  const convocations = holiday
    ? await prisma.holidayWorkAssignment.findMany({ where: { employeeId, date, status: "ACTIVA" }, select: { employeeId: true } })
    : [];
  return {
    dayOff: dayOffs.some((row) => row.employeeId === employeeId),
    holiday,
    convoked: convocations.some((row) => row.employeeId === employeeId),
  };
}

/**
 * P8 (WORKED_TIME_ACCOUNTING_MODEL.md §20): plantilla de la convocatoria ACTIVA
 * de (empleado, fecha) si la fecha es feriado por calendario. Con ella, el
 * matching de la entrada de un turno fijo usa ESA plantilla en lugar de las
 * asignaciones habituales (mismo criterio que la obligación y Novedades).
 * null = sin feriado, sin convocatoria o convocatoria sin plantilla ACTIVA.
 */
export async function loadConvocationTemplateId(employeeId: string, dateKey: string): Promise<string | null> {
  const date = argentinaCalendarDate(dateKey);
  const holidayDays = await workforceService.holidayDatesInRange(date, date);
  if (!holidayDays.length) return null;
  const convocations = await prisma.holidayWorkAssignment.findMany({
    where: { employeeId, date, status: "ACTIVA" },
    select: { shiftTemplateId: true, shiftTemplate: { select: { status: true } } },
  });
  const convocation = convocations[0];
  return convocation?.shiftTemplateId && convocation.shiftTemplate?.status === "ACTIVO" ? convocation.shiftTemplateId : null;
}

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const REASON_TEXT: Record<UnscheduledWorkReason, string> = {
  DIA_NO_PROGRAMADO: "día no incluido en su turno asignado",
  FERIADO_NO_CONVOCADO: "feriado sin convocatoria",
  DESCANSO_ROTACION: "día de descanso de su rotación",
  FUERA_DEL_TURNO: "fuera de los turnos programados del día",
};

/** Nota visible de la clasificación informativa: sin ids técnicos ni datos personales. */
export function unscheduledWorkNote(reason: UnscheduledWorkReason, dateKey: string): string {
  return `Informativa: trabajo sin turno programado el ${WEEKDAY_NAMES[calendarWeekdayOfKey(dateKey)]} ${formatArgentinaDate(dateKey)} (${REASON_TEXT[reason]}). No requiere revisión.`;
}
