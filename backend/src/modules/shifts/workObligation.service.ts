import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, argentinaDayRange, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";
import { workforceService } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegimesForDate } from "../work-regimes/workRegimes.service";
import { isShiftAssignmentActiveOnDate, isShiftAssignmentApplicableOnWeekday, type ShiftTemplateRef } from "./workShiftEvaluation.service";
import { toTemplateRef } from "./workShiftEvaluationRunner";

export interface WorkObligationCandidate {
  employeeId: string;
  template: ShiftTemplateRef;
  scheduledStartAt: Date;
}

export interface WorkObligationResolution {
  isHoliday: boolean;
  candidates: WorkObligationCandidate[];
}

/**
 * Etapa 15M.19B (docs/decisions/MISSING_EXPECTED_ENTRY_15M19B.md): única
 * fuente de "¿quién tiene obligación REAL de trabajar esta fecha operativa?"
 * — reutilizada tanto por el chequeo intradía de falta de ingreso
 * (missingEntry.service.ts) como por el chequeo diario de inactividad
 * (attendanceInactivity.service.ts). Tener un turno asignado no alcanza por
 * sí solo: la asignación debe estar HABILITADO, vigente para esta fecha,
 * aplicable a este día de la semana (`ShiftAssignment.weekdays`), su
 * `ShiftTemplate` debe estar ACTIVO, el empleado debe estar ACTIVO, su
 * régimen (si tiene uno vigente) no puede ser `SIN_TURNO` — y si la fecha es
 * feriado, sólo cuenta si además está convocado explícitamente
 * (`HolidayWorkAssignment` ACTIVA, Etapa 12D/12E, sin tocar esa lógica).
 *
 * `TURNO_FLEXIBLE` y la ausencia de régimen vigente NO se excluyen acá: 15M.7D
 * ya estableció que una `ShiftAssignment` propia HABILITADA y aplicable es,
 * en sí misma, la "obligación explícita" que ese régimen exige (nunca se
 * infiere de una plantilla global) — el fallback sin régimen ya era
 * conservador por diseño (15M.7C). Sólo `SIN_TURNO` se excluye siempre,
 * incluso si conserva asignaciones históricas (mismo criterio que
 * `shouldSuppressMissingShiftAlert`, pero sin su componente
 * `alertOnOutOfShift`: ese flag sólo gobierna alertas de "no pude identificar
 * el turno", una pregunta distinta de "sé exactamente qué turno le
 * corresponde y no fichó").
 *
 * Novedades y evidencia de actividad (fichadas/jornadas/horas cargadas) NO
 * se resuelven acá — son un chequeo posterior, distinto para cada llamador
 * (todo el día transcurrido vs. sólo lo que ya pasó de tolerancia).
 */
export async function resolveWorkObligationCandidates(dateKey: string): Promise<WorkObligationResolution> {
  const referenceDate = argentinaCalendarDate(dateKey);
  const referenceInstant = argentinaDayRange(dateKey).startAt;

  const holidayDays = await workforceService.holidayDatesInRange(referenceDate, referenceDate);
  const isHoliday = holidayDays.length > 0;
  let convokedEmployeeIds: string[] | null = null;
  if (isHoliday) {
    const assignments = await prisma.holidayWorkAssignment.findMany({ where: { date: referenceDate, status: "ACTIVA" }, select: { employeeId: true } });
    convokedEmployeeIds = assignments.map((item) => item.employeeId);
    if (!convokedEmployeeIds.length) return { isHoliday, candidates: [] };
  }

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: "HABILITADO",
      employee: { status: "ACTIVO" },
      shiftTemplate: { status: "ACTIVO" },
      ...(convokedEmployeeIds ? { employeeId: { in: convokedEmployeeIds } } : {}),
    },
    include: { shiftTemplate: true },
  });

  const earliestByEmployee = new Map<string, { template: ShiftTemplateRef; scheduledStartAt: Date }>();
  for (const assignment of assignments) {
    const vigency = { effectiveFrom: assignment.effectiveFrom, effectiveTo: assignment.effectiveTo, weekdays: assignment.weekdays };
    if (!isShiftAssignmentActiveOnDate(vigency, referenceDate) || !isShiftAssignmentApplicableOnWeekday(vigency, referenceDate)) continue;

    const template = toTemplateRef(assignment.shiftTemplate);
    const scheduledStartAt = scheduledInstantForShiftTime(referenceInstant, template.startTime);
    const current = earliestByEmployee.get(assignment.employeeId);
    if (!current || scheduledStartAt < current.scheduledStartAt) {
      earliestByEmployee.set(assignment.employeeId, { template, scheduledStartAt });
    }
  }

  if (!earliestByEmployee.size) return { isHoliday, candidates: [] };

  const regimes = await resolveActiveWorkRegimesForDate(referenceDate);
  const candidates: WorkObligationCandidate[] = [];
  for (const [employeeId, data] of earliestByEmployee) {
    if (regimes.get(employeeId)?.kind === "SIN_TURNO") continue;
    candidates.push({ employeeId, template: data.template, scheduledStartAt: data.scheduledStartAt });
  }

  return { isHoliday, candidates };
}
