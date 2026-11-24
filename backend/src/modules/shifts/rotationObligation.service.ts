/**
 * Obligaciones EFECTIVAS de rotación por (empleado, fecha operativa) — R4.3b
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5).
 *
 * Única fuente de bloques efectivos para la obligación de asistencia y para
 * la evidencia de ingreso. Combina, en lote, el plan de rotación del núcleo
 * (`resolveRotationDayPlan`, R4.2) con TODAS las precedencias del resolver
 * central (`resolveExpectedShift`, política WORK_OBLIGATION): feriado por
 * calendario, convocatoria con su plantilla (prevalece sobre el plan),
 * franco, régimen SIN_TURNO, REST / MISSING / CONFLICT. No hay un resolver
 * paralelo: este módulo sólo carga datos en lote y llama a los dos núcleos.
 *
 * Sólo cubre a los miembros vigentes de una rotación ACTIVA (plan no nulo);
 * los demás empleados siguen el camino legacy de turnos fijos.
 * Consultas por lote: cargador (1–2) y, si hay miembros, feriados,
 * francos, convocatorias y regímenes (una cada una) — nunca por empleado ni
 * por día.
 */
import { argentinaCalendarDate, argentinaDateKey, calendarDateKey, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { workforceService } from "../workforce-management/workforce.service";
import { activeRegimeKindOn, resolveExpectedShift, type ExpectedShiftResolution, type RegimePeriod } from "./expectedShiftResolver";
import { loadRotationConfiguration, type LoadedRotationTemplate } from "./rotationPlan.loader";
import { resolveRotationDayPlan, type ExpectedBlock, type ExpectedDayPlan } from "./rotationPlan";

export type RotationObligation = {
  employeeId: string;
  dateKey: string;
  plan: ExpectedDayPlan<LoadedRotationTemplate>;
  resolution: ExpectedShiftResolution<object, { employeeId: string }>;
  /** Bloques que efectivamente obligan (los del plan o el de una convocatoria con plantilla); vacío sin obligación. */
  blocks: ExpectedBlock<LoadedRotationTemplate>[];
};

export type RotationObligationReader = Pick<
  PrismaTransactionClient,
  "shiftRotationCrewMember" | "shiftRotation" | "employeeDayOff" | "holidayWorkAssignment" | "employeeWorkRegime"
>;

const convocationTemplateSelect = {
  id: true,
  code: true,
  startTime: true,
  endTime: true,
  crossesMidnight: true,
  status: true,
  entryToleranceBeforeMinutes: true,
  entryToleranceAfterMinutes: true,
  exitToleranceBeforeMinutes: true,
  exitToleranceAfterMinutes: true,
  minimumMinutesForCompliance: true,
  maximumInformativeMinutes: true,
  missingOutAlertAfterMinutes: true,
  absoluteOpenShiftLimitMinutes: true,
} as const;

/** Mapa empleado → (fecha → obligación efectiva). Sólo incluye (empleado, fecha) con plan de rotación. */
export type RotationObligationMap = Map<string, Map<string, RotationObligation>>;

export async function resolveRotationObligations(
  input: { dateKeys: string[]; employeeIds?: string[]; activeEmployeesOnly?: boolean },
  db: RotationObligationReader = prisma,
): Promise<RotationObligationMap> {
  const result: RotationObligationMap = new Map();
  const dateKeys = [...new Set(input.dateKeys)].sort();
  if (!dateKeys.length) return result;
  const fromKey = dateKeys[0]!;
  const toKey = dateKeys[dateKeys.length - 1]!;
  const configuration = await loadRotationConfiguration(db, { fromKey, toKey, employeeIds: input.employeeIds, activeEmployeesOnly: input.activeEmployeesOnly });
  const memberIds = [...new Set(configuration.memberships.map((membership) => membership.employeeId))];
  if (!memberIds.length) return result;

  const from = argentinaCalendarDate(fromKey);
  const to = argentinaCalendarDate(toKey);
  const [holidayDays, dayOffs, convocations, regimeRows] = await Promise.all([
    workforceService.holidayDatesInRange(from, to),
    db.employeeDayOff.findMany({ where: { employeeId: { in: memberIds }, status: "ACTIVO", date: { gte: from, lte: to } }, select: { employeeId: true, date: true } }),
    db.holidayWorkAssignment.findMany({
      where: { employeeId: { in: memberIds }, status: "ACTIVA", date: { gte: from, lte: to } },
      select: { employeeId: true, date: true, shiftTemplate: { select: convocationTemplateSelect } },
    }),
    db.employeeWorkRegime.findMany({
      where: { employeeId: { in: memberIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
      select: { employeeId: true, effectiveFrom: true, effectiveTo: true, workRegime: { select: { kind: true } } },
    }),
  ]);
  // Feriado por calendario, sin alcance (deuda P7, igual que la obligación legacy).
  const holidays = new Set(holidayDays.map((day) => (typeof day.date === "string" ? day.date : calendarDateKey(day.date as Date))));
  const dayOffKeys = new Set(dayOffs.map((row) => `${row.employeeId}|${calendarDateKey(row.date)}`));
  const convocationByKey = new Map(convocations.map((row) => [`${row.employeeId}|${calendarDateKey(row.date)}`, row]));
  const regimesByEmployee = new Map<string, RegimePeriod[]>();
  for (const row of regimeRows) {
    const list = regimesByEmployee.get(row.employeeId) ?? [];
    list.push({ effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, kind: row.workRegime.kind });
    regimesByEmployee.set(row.employeeId, list);
  }

  for (const employeeId of memberIds) {
    for (const dateKey of dateKeys) {
      const plan = resolveRotationDayPlan(employeeId, dateKey, configuration);
      if (!plan) continue;
      const key = `${employeeId}|${dateKey}`;
      const convocation = convocationByKey.get(key) ?? null;
      const resolution = resolveExpectedShift(
        {
          dateKey,
          assignments: [],
          dayOff: dayOffKeys.has(key),
          holiday: holidays.has(dateKey) ? "IN_SCOPE" : null,
          convocation: convocation ? { employeeId } : null,
          regimeKind: activeRegimeKindOn(regimesByEmployee.get(employeeId) ?? [], argentinaCalendarDate(dateKey)),
          rotationPlan: plan,
          convocationTemplate: convocation?.shiftTemplate ?? null,
        },
        "WORK_OBLIGATION",
      );
      // Los bloques salen del plan (plantillas cargadas) o de la plantilla de la
      // convocatoria (misma selección): ambos son LoadedRotationTemplate.
      const blocks = (resolution.obligation === "SHIFT" ? resolution.blocks : []) as ExpectedBlock<LoadedRotationTemplate>[];
      const byDate = result.get(employeeId) ?? new Map<string, RotationObligation>();
      byDate.set(dateKey, { employeeId, dateKey, plan, resolution, blocks });
      result.set(employeeId, byDate);
    }
  }
  return result;
}

/** Fechas operativas D−1, D y D+1 de un instante (D = fecha argentina del instante). */
export function neighborDateKeys(instant: Date): [string, string, string] {
  const dateKey = argentinaDateKey(instant);
  return [previousCalendarDateKey(dateKey), dateKey, nextCalendarDateKey(dateKey)];
}

/**
 * R4.3b/R4.4: bloques EFECTIVOS (todas las precedencias aplicadas) de cada
 * empleado en las fechas dadas, ordenados por inicio — única fuente para la
 * evidencia de ingreso (R4.3b) y para la fichada (R4.4). Devuelve también las
 * obligaciones por fecha, para clasificar lo que no tiene bloque.
 */
export async function effectiveBlocksAround(
  employeeIds: string[],
  dateKeys: string[],
  db: RotationObligationReader = prisma,
): Promise<{ obligations: RotationObligationMap; blocksByEmployee: Map<string, ExpectedBlock<LoadedRotationTemplate>[]> }> {
  const obligations = await resolveRotationObligations({ dateKeys, employeeIds }, db);
  const blocksByEmployee = new Map<string, ExpectedBlock<LoadedRotationTemplate>[]>();
  for (const employeeId of employeeIds) {
    const byKey = new Map<string, ExpectedBlock<LoadedRotationTemplate>>();
    for (const obligation of obligations.get(employeeId)?.values() ?? []) for (const block of obligation.blocks) byKey.set(block.obligationKey, block);
    blocksByEmployee.set(employeeId, [...byKey.values()].sort((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime()));
  }
  return { obligations, blocksByEmployee };
}
