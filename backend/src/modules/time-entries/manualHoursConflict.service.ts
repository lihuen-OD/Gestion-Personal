import type { ApprovalStatus, Prisma } from "@prisma/client";
import { argentinaCalendarDate, argentinaDayRange, calendarDateKey, formatArgentinaDate, nextCalendarDateKey, periodCalendarBounds, periodFromCalendarDate, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { employeePeriodKey, findProtectedClosurePeriods, ProtectedClosurePeriodError } from "../../shared/monthlyClosure/closurePeriodGuard";
import { prisma } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import { formatEmployeeReference, loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { auditService, clearAuditDerivedCaches, type AuditContext } from "../audit/audit.service";
import { lockEmployeeDays } from "../employee-day-offs/employeeDayLock";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { clearShiftAlertReadCaches } from "../shifts/shiftAlert.cache";
import { workShiftOperationalDateKey } from "../shifts/workShiftEvaluation.service";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots, type RebuiltClosureSnapshot } from "../workforce-management/closureSnapshot";
import { clearNotificationsListCache } from "../workforce-management/workforce.cache";
import { manualHoursDecisionOf, resolutionNoteByDecision, type ManualHoursDecision } from "./manualHoursConflict";
import { manualHoursConflictRepository as repository, type ManualHoursConflictRow, type NormalEntryRow } from "./manualHoursConflict.repository";
import { clockNormalEntryCreateData, clockNormalEntryUpdateData, resolveSpecialHourRulesByDate, specialHoursRulesNote, type ClockNormalEntryTarget } from "./timeEntries.repository";
import type { ManualHoursConflictsQuery, ResolveManualHoursConflictInput } from "./timeEntries.schemas";
import { syncAutomaticHourConceptBreakdownsSafely } from "./timeEntries.service";
import { isAutomaticTimeEntrySource } from "./workedTimeAccounting";
import { clearWorkedTimeDerivedReadCaches } from "./workedTimeReadCaches";

/**
 * Revisión de una fichada sobre horas cargadas a mano
 * (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md): listado para Carga de horas
 * y la decisión del responsable. La contabilidad no se toca acá: "Usar horas
 * fichadas" deja en la fila de Horas base exactamente lo que la salida habría
 * escrito (mismos builders) y todos los consumidores la leen como siempre;
 * "Mantener carga manual" no cambia ninguna hora.
 */

export type ManualHoursConflictDay = {
  date: string;
  // Fila de Horas base de esa fecha fijada por una persona (null: no hay).
  manualMinutes: number | null;
  manualStatus: ApprovalStatus | null;
  // Minutos de los tramos de ESTA jornada en esa fecha.
  clockMinutes: number;
  // Lo que computa hoy la fila de Horas base de esa fecha (cualquier origen).
  countedMinutes: number;
};

export type ManualHoursConflictView = {
  id: string;
  employee: { id: string; legajo: string; firstName: string; lastName: string };
  operationalDate: string;
  status: "PENDIENTE" | "RESUELTA";
  decision: ManualHoursDecision | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  shift: { id: string; startAt: Date; endAt: Date | null; totalMinutes: number | null };
  days: ManualHoursConflictDay[];
  manualMinutes: number;
  clockMinutes: number;
  differenceMinutes: number;
};

const minutesOf = (row: Pick<NormalEntryRow, "hours">) => Math.round(Number(row.hours) * 60);

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

type ShiftDays = {
  operationalDateKey: string;
  dayKeys: string[];
  segmentsByDate: Map<string, { minutes: number; last: { id: string; startAt: Date; endAt: Date } }>;
};

/** Fechas de la jornada: las de sus tramos más su fecha operativa (una nocturna es UNA revisión). */
export function shiftDays(shift: ManualHoursConflictRow["workShift"]): ShiftDays {
  const segmentsByDate: ShiftDays["segmentsByDate"] = new Map();
  for (const segment of shift.timeSegments) {
    const key = calendarDateKey(segment.date);
    const current = segmentsByDate.get(key);
    segmentsByDate.set(key, { minutes: (current?.minutes ?? 0) + segment.minutes, last: { id: segment.id, startAt: segment.fromDateTime, endAt: segment.toDateTime } });
  }
  const operationalDateKey = workShiftOperationalDateKey(shift.startAt, shift.shiftTemplate);
  return { operationalDateKey, dayKeys: [...new Set([...segmentsByDate.keys(), operationalDateKey])].sort(), segmentsByDate };
}

// Ante un duplicado histórico (dos filas del mismo día), la más reciente de
// cada origen, igual que closeOpenWorkShift.
function rowsOnDate(rows: NormalEntryRow[], employeeId: string, dateKey: string) {
  const sameDay = rows.filter((row) => row.employeeId === employeeId && calendarDateKey(row.date) === dateKey);
  return {
    manual: sameDay.filter((row) => !isAutomaticTimeEntrySource(row.source)).at(-1) ?? null,
    automatic: sameDay.filter((row) => isAutomaticTimeEntrySource(row.source)).at(-1) ?? null,
  };
}

/** Horas por fecha que vio quien decidió (auditoría de la decisión); null si no son legibles. */
function decidedDays(audit: Prisma.JsonValue | undefined): Array<Omit<ManualHoursConflictDay, "countedMinutes">> | null {
  const days = audit && typeof audit === "object" && !Array.isArray(audit) ? (audit as { days?: unknown }).days : null;
  if (!Array.isArray(days)) return null;
  return days.filter((day): day is ManualHoursConflictDay => Boolean(day) && typeof day === "object" && typeof (day as ManualHoursConflictDay).date === "string");
}

/**
 * Pendiente: horas manuales y fichadas vigentes. Resuelta: las que vio quien
 * decidió (si se usaron las fichadas, la carga manual ya no existe como fila),
 * y lo que computa hoy cada fecha.
 */
export function toManualHoursConflictView(alert: ManualHoursConflictRow, rows: NormalEntryRow[], decisionAudit?: Prisma.JsonValue): ManualHoursConflictView {
  const { operationalDateKey, dayKeys, segmentsByDate } = shiftDays(alert.workShift);
  const decided = alert.status === "PENDIENTE" ? null : decidedDays(decisionAudit);
  const days = dayKeys.map((dateKey): ManualHoursConflictDay => {
    const { manual, automatic } = rowsOnDate(rows, alert.employee.id, dateKey);
    const countedMinutes = (manual ? minutesOf(manual) : 0) + (automatic ? minutesOf(automatic) : 0);
    const atDecision = decided?.find((day) => day.date === dateKey);
    if (atDecision) return { date: dateKey, manualMinutes: atDecision.manualMinutes, manualStatus: atDecision.manualStatus, clockMinutes: atDecision.clockMinutes, countedMinutes };
    return {
      date: dateKey,
      manualMinutes: manual ? minutesOf(manual) : null,
      manualStatus: manual?.status ?? null,
      clockMinutes: segmentsByDate.get(dateKey)?.minutes ?? 0,
      countedMinutes,
    };
  });
  const manualMinutes = days.reduce((sum, day) => sum + (day.manualMinutes ?? 0), 0);
  const clockMinutes = days.reduce((sum, day) => sum + day.clockMinutes, 0);
  return {
    id: alert.id,
    employee: alert.employee,
    operationalDate: operationalDateKey,
    status: alert.status === "PENDIENTE" ? "PENDIENTE" : "RESUELTA",
    decision: manualHoursDecisionOf(alert.resolutionNote),
    resolvedAt: alert.resolvedAt,
    resolvedByName: alert.resolvedBy?.name ?? null,
    shift: { id: alert.workShift.id, startAt: alert.workShift.startAt, endAt: alert.workShift.endAt, totalMinutes: alert.workShift.totalMinutes },
    days,
    manualMinutes,
    clockMinutes,
    differenceMinutes: clockMinutes - manualMinutes,
  };
}

async function loadViews(alerts: ManualHoursConflictRow[], db?: Parameters<typeof repository.findNormalEntries>[1] & Parameters<typeof repository.findDecisionAudits>[1]) {
  const [rows, audits] = await Promise.all([
    repository.findNormalEntries(alerts.map((alert) => ({ employeeId: alert.employee.id, dateKeys: shiftDays(alert.workShift).dayKeys })), db),
    repository.findDecisionAudits(alerts.filter((alert) => alert.status !== "PENDIENTE").map((alert) => alert.id), db),
  ]);
  return alerts.map((alert) => toManualHoursConflictView(alert, rows, audits.get(alert.id)));
}

function periodsOf(view: Pick<ManualHoursConflictView, "days">) {
  return [...new Set(view.days.map((day) => periodFromCalendarDate(argentinaCalendarDate(day.date))))];
}

export const manualHoursConflictService = {
  /** Revisiones (pendientes y resueltas) cuya jornada toca el período, dentro del alcance del usuario. */
  async list(query: ManualHoursConflictsQuery, user: Express.AuthUser) {
    const bounds = periodCalendarBounds(query.period);
    // Una jornada que toca el período empieza a lo sumo un día antes o
    // termina a lo sumo un día después (la fecha operativa difiere ±1 día).
    const alerts = await repository.findConflicts({
      employee: employeeAccessWhere(user),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      workShift: {
        startAt: {
          gte: argentinaDayRange(previousCalendarDateKey(calendarDateKey(bounds.start))).startAt,
          lt: argentinaDayRange(nextCalendarDateKey(calendarDateKey(bounds.end))).endAt,
        },
      },
    });
    const views = await loadViews(alerts);
    return { items: views.filter((view) => periodsOf(view).includes(query.period)) };
  },

  async resolve(id: string, input: ResolveManualHoursConflictInput, user: Express.AuthUser, audit?: AuditContext) {
    const target = await repository.findTarget(id);
    if (!target) throw new AppError("No encontramos la revisión solicitada.", 404, "MANUAL_HOURS_CONFLICT_NOT_FOUND");
    // Un id fuera del alcance del usuario responde 403 sin revelar nada más.
    if (!(await repository.countEmployeeInScope(target.employeeId, employeeAccessWhere(user)))) {
      throw new AppError("Employee not found or outside your scope", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
    }

    const isRrhh = user.role === roles.rrhh;
    const correctionReason = input.correctionReason?.trim() || null;
    const outcome = await prisma.$transaction(async (tx) => {
      const alert = (await repository.findConflict(id, tx))!;
      const { operationalDateKey, dayKeys, segmentsByDate } = shiftDays(alert.workShift);
      const employeeId = alert.employee.id;
      // El mismo lock persona+día que la salida y la carga manual: la
      // decisión ve el estado final de esas fechas y dos decisiones
      // simultáneas sobre la misma revisión se serializan.
      await lockEmployeeDays(tx, dayKeys.map((dateKey) => ({ employeeId, dateKey })));
      const state = await repository.findDecisionState(tx, id);
      if (state.status !== "PENDIENTE") {
        // Reintento de la misma decisión: sin cambios. Otra decisión: conflicto.
        if (manualHoursDecisionOf(state.resolutionNote) === input.decision) return { changed: false as const };
        throw new AppError("Esta revisión ya fue resuelta.", 409, "MANUAL_HOURS_CONFLICT_ALREADY_RESOLVED");
      }

      const rows = await repository.findNormalEntries([{ employeeId, dateKeys: dayKeys }], tx);
      const before = toManualHoursConflictView({ ...alert, status: "PENDIENTE" }, rows);
      const pairs = periodsOf(before).map((period) => ({ employeeId, period }));
      let rebuilt: RebuiltClosureSnapshot[] = [];

      if (input.decision === "USE_CLOCK") {
        const protectedPeriods = await findProtectedClosurePeriods(tx, pairs);
        if (protectedPeriods.size) {
          if (!isRrhh) {
            throw new ProtectedClosurePeriodError(
              [...protectedPeriods.entries()].map(([key, status]) => ({ employeeId, period: key.split(":")[1]!, status })),
              "El período ya fue enviado o aprobado: sólo RRHH puede usar las horas fichadas, con motivo.",
            );
          }
          if (!correctionReason) throw new AppError("El período ya fue enviado o aprobado: indicá el motivo de la corrección.", 400, "MANUAL_HOURS_CORRECTION_REASON_REQUIRED");
        }
        const normalHourConceptId = alert.workShift.hourConceptId ?? await repository.findNormalHourConceptId(tx);
        // El mismo motor de Horas Especiales que la salida (puede responder
        // SPECIAL_HOUR_SCOPE_HISTORY_MISSING: nada se escribe).
        const specialHours = await resolveSpecialHourRulesByDate(employeeId, dayKeys.map(argentinaCalendarDate), tx);
        for (const dateKey of dayKeys) {
          const segment = segmentsByDate.get(dateKey) ?? null;
          const minutes = segment?.minutes ?? 0;
          const { manual, automatic } = rowsOnDate(rows, employeeId, dateKey);
          const { matchedRules, multiplier } = specialHours.get(dateKey)!;
          const target: ClockNormalEntryTarget = {
            employeeId,
            normalHourConceptId,
            workShiftId: alert.workShift.id,
            source: alert.workShift.source,
            date: argentinaCalendarDate(dateKey),
            minutes,
            lastSegment: segment?.last ?? null,
            multiplier,
            rulesNote: specialHoursRulesNote(matchedRules, multiplier, minutes),
          };
          if (manual) {
            const replacementNote = `Revisión: se reemplazó la carga manual (${formatMinutes(minutesOf(manual))}) por las horas fichadas (${formatMinutes(minutes)}). `;
            await repository.updateEntry(tx, manual.id, clockNormalEntryUpdateData(manual, target, "REPLACE", replacementNote));
          } else if (automatic && minutes > 0) {
            await repository.updateEntry(tx, automatic.id, clockNormalEntryUpdateData(automatic, target, "MERGE"));
          } else if (minutes > 0) {
            await repository.createEntry(tx, clockNormalEntryCreateData(target));
          }
        }
        // La jornada pasa a computar como cualquier fichada procesada (Motor
        // B la toma después del commit); en un período protegido sigue
        // observada, como una salida que cae en uno.
        await repository.updateShift(tx, alert.workShift.id, {
          status: protectedPeriods.size ? "OBSERVADO" : "PROCESADO",
          observation: [alert.workShift.observation, "Revisión: se usaron las horas fichadas."].filter(Boolean).join(" · "),
        });
        const closures = (await findClosuresForEmployeePeriods(tx, pairs)).filter((closure) => !protectedPeriods.has(employeePeriodKey(closure)));
        rebuilt = await rebuildClosureSnapshots(tx, closures, { reason: "MANUAL_HOURS_CONFLICT_RESOLVED", date: operationalDateKey });
      }

      await repository.markResolved(tx, id, { userId: user.id, resolutionNote: resolutionNoteByDecision[input.decision] });
      const after = (await loadViews([(await repository.findConflict(id, tx))!], tx))[0]!;
      const dateLabel = formatArgentinaDate(operationalDateKey);
      const decisionText = input.decision === "USE_CLOCK"
        ? `se usaron las horas fichadas (${formatMinutes(before.clockMinutes)}) en lugar de la carga manual (${formatMinutes(before.manualMinutes)})`
        : `se mantuvo la carga manual (${formatMinutes(before.manualMinutes)}); la fichada (${formatMinutes(before.clockMinutes)}) queda como evidencia`;
      // En la misma transacción: si la auditoría falla, la decisión se revierte.
      await auditService.registerWithin(tx, {
        ...audit,
        action: "UPDATE",
        entity: "ShiftAlert",
        entityId: id,
        description: `Se resolvió la actividad fichada sobre horas cargadas manualmente de ${formatEmployeeReference(alert.employee)} del ${dateLabel}: ${decisionText}.${correctionReason ? ` Motivo: ${correctionReason}` : ""}`,
        before: { decision: null, operationalDate: operationalDateKey, days: before.days, manualMinutes: before.manualMinutes, clockMinutes: before.clockMinutes } as Prisma.InputJsonValue,
        after: { decision: input.decision, operationalDate: operationalDateKey, days: after.days, correctionReason } as Prisma.InputJsonValue,
      });
      return { changed: true as const, rebuilt, periods: pairs.map((pair) => pair.period), employeeId, dateLabel };
    }, { timeout: 20_000 });

    if (outcome.changed) {
      clearWorkedTimeDerivedReadCaches();
      clearShiftAlertReadCaches();
      clearNotificationsListCache();
      clearAuditDerivedCaches();
      await auditClosureRecalculations(outcome.rebuilt, `la revisión de la fichada del ${outcome.dateLabel}`, audit, (ids) => loadEmployeeReferences(prisma, ids));
      // Motor B (desgloses automáticos) recién ahora ve la jornada procesada.
      if (input.decision === "USE_CLOCK") {
        for (const period of outcome.periods) await syncAutomaticHourConceptBreakdownsSafely(outcome.employeeId, period, undefined, audit);
      }
    }
    return (await loadViews([(await repository.findConflict(id))!]))[0]!;
  },
};
