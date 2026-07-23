export const DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES = 1200;
export const DEFAULT_MAXIMUM_INFORMATIVE_MINUTES = 600;
const ARGENTINA_OFFSET_MINUTES = -180;

export type ShiftAssignmentStatusRef = "HABILITADO" | "DESHABILITADO";

export interface ShiftTemplateRef {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  entryToleranceBeforeMinutes: number;
  entryToleranceAfterMinutes: number;
  exitToleranceBeforeMinutes: number;
  exitToleranceAfterMinutes: number;
  minimumMinutesForCompliance: number | null;
  maximumInformativeMinutes: number | null;
  missingOutAlertAfterMinutes: number | null;
  absoluteOpenShiftLimitMinutes: number;
}

export interface EmployeeShiftAssignmentRef {
  shiftTemplateId: string;
  status: ShiftAssignmentStatusRef;
}

export type ShiftMatchCase = "ENABLED" | "DISABLED_FOR_EMPLOYEE" | "GENERAL_UNASSIGNED" | "NO_MATCH";

export interface ShiftMatchResult {
  case: ShiftMatchCase;
  template: ShiftTemplateRef | null;
  differenceMinutes: number | null;
}

function scheduledDateFor(reference: Date, time: string, addDay = false) {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(reference);
  result.setHours(hours || 0, minutes || 0, 0, 0);
  if (addDay) result.setDate(result.getDate() + 1);
  return result;
}

function differenceInMinutes(actual: Date, scheduled: Date) {
  return Math.round((actual.getTime() - scheduled.getTime()) / 60_000);
}

// Busca la ocurrencia (hoy, ayer o mañana) del horario de inicio más cercana a `actualAt`, para no fallar cerca de la medianoche.
function closestOccurrence(actualAt: Date, startTime: string) {
  const today = scheduledDateFor(actualAt, startTime);
  const candidates = [today, new Date(today.getTime() - 24 * 60 * 60_000), new Date(today.getTime() + 24 * 60 * 60_000)]
    .map((scheduledAt) => ({ scheduledAt, differenceMinutes: differenceInMinutes(actualAt, scheduledAt) }))
    .sort((a, b) => Math.abs(a.differenceMinutes) - Math.abs(b.differenceMinutes));
  return candidates[0]!;
}

// Turnos propios del empleado: ventana generosa (hasta ~una jornada máxima de más tarde) para no perder el ejemplo de "20 min tarde",
// pero acotada, para que una fichada realmente ajena a todos sus turnos pueda caer en Caso C/D en vez de forzar siempre el más cercano.
function closestOwnMatch(actualAt: Date, templates: ShiftTemplateRef[]): { template: ShiftTemplateRef; differenceMinutes: number } | null {
  const candidates = templates
    .map((template) => ({ template, ...closestOccurrence(actualAt, template.startTime) }))
    .filter(({ template, differenceMinutes }) => {
      const after = (template.maximumInformativeMinutes ?? DEFAULT_MAXIMUM_INFORMATIVE_MINUTES) + template.entryToleranceAfterMinutes;
      return differenceMinutes >= -template.entryToleranceBeforeMinutes && differenceMinutes <= after;
    })
    .sort((a, b) => Math.abs(a.differenceMinutes) - Math.abs(b.differenceMinutes));
  return candidates[0] ?? null;
}

function closestWithinTolerance(actualAt: Date, templates: ShiftTemplateRef[]): { template: ShiftTemplateRef; differenceMinutes: number } | null {
  const candidates = templates
    .map((template) => ({ template, ...closestOccurrence(actualAt, template.startTime) }))
    .filter(({ template, differenceMinutes }) => differenceMinutes >= -template.entryToleranceBeforeMinutes && differenceMinutes <= template.entryToleranceAfterMinutes)
    .sort((a, b) => Math.abs(a.differenceMinutes) - Math.abs(b.differenceMinutes));
  return candidates[0] ?? null;
}

export function hasNoShiftAssignments(employeeAssignments: EmployeeShiftAssignmentRef[]) {
  return employeeAssignments.length === 0;
}

// Cascada: turnos propios del empleado (habilitado o deshabilitado, el más cercano gana, sin tolerancia) → turnos generales del sistema (sí con tolerancia, por no haber relación previa) → sin coincidencia.
export function matchShiftForEmployee(input: {
  actualAt: Date;
  employeeAssignments: EmployeeShiftAssignmentRef[];
  activeTemplates: ShiftTemplateRef[];
}): ShiftMatchResult {
  const templatesById = new Map(input.activeTemplates.map((template) => [template.id, template]));
  const enabledIds = new Set(input.employeeAssignments.filter((a) => a.status === "HABILITADO").map((a) => a.shiftTemplateId));
  const disabledIds = new Set(input.employeeAssignments.filter((a) => a.status === "DESHABILITADO").map((a) => a.shiftTemplateId));
  const ownTemplates = [...enabledIds, ...disabledIds].map((id) => templatesById.get(id)).filter((t): t is ShiftTemplateRef => Boolean(t));

  const ownMatch = closestOwnMatch(input.actualAt, ownTemplates);
  if (ownMatch) {
    return { case: enabledIds.has(ownMatch.template.id) ? "ENABLED" : "DISABLED_FOR_EMPLOYEE", template: ownMatch.template, differenceMinutes: ownMatch.differenceMinutes };
  }

  const assignedIds = new Set([...enabledIds, ...disabledIds]);
  const generalTemplates = input.activeTemplates.filter((template) => !assignedIds.has(template.id));
  const generalMatch = closestWithinTolerance(input.actualAt, generalTemplates);
  if (generalMatch) return { case: "GENERAL_UNASSIGNED", template: generalMatch.template, differenceMinutes: generalMatch.differenceMinutes };

  return { case: "NO_MATCH", template: null, differenceMinutes: null };
}

export interface EntryPunctualityResult {
  evaluated: boolean;
  lateArrival: boolean;
  differenceMinutes: number | null;
}

/** Solo se afirma puntualidad de ingreso cuando el turno coincidente está HABILITADO para el empleado (Caso A). */
export function evaluateEntryPunctuality(match: ShiftMatchResult): EntryPunctualityResult {
  if (match.case !== "ENABLED" || !match.template || match.differenceMinutes === null) {
    return { evaluated: false, lateArrival: false, differenceMinutes: null };
  }
  return { evaluated: true, lateArrival: match.differenceMinutes > match.template.entryToleranceAfterMinutes, differenceMinutes: match.differenceMinutes };
}

export interface ExitPunctualityResult {
  evaluated: boolean;
  earlyLeave: boolean;
  lateLeave: boolean;
  differenceMinutes: number | null;
  scheduledExitAt: Date | null;
}

/** Solo se afirma puntualidad de salida cuando el turno coincidente está HABILITADO para el empleado (Caso A). */
export function evaluateExitPunctuality(input: { match: ShiftMatchResult; startAt: Date; actualExitAt: Date }): ExitPunctualityResult {
  if (input.match.case !== "ENABLED" || !input.match.template) {
    return { evaluated: false, earlyLeave: false, lateLeave: false, differenceMinutes: null, scheduledExitAt: null };
  }
  const template = input.match.template;
  const scheduledExitAt = scheduledDateFor(input.startAt, template.endTime, template.crossesMidnight);
  const differenceMinutes = differenceInMinutes(input.actualExitAt, scheduledExitAt);
  return {
    evaluated: true,
    earlyLeave: differenceMinutes < -template.exitToleranceBeforeMinutes,
    lateLeave: differenceMinutes > template.exitToleranceAfterMinutes,
    differenceMinutes,
    scheduledExitAt,
  };
}

export interface DurationEvaluationResult {
  insufficientHours: boolean;
  extendedShift: boolean;
  maximumThresholdUsed: number | null;
  minimumThresholdUsed: number | null;
}

/** Las horas reales siempre se computan aparte; esto solo decide si corresponde marcar informativamente jornada corta/extendida. */
export function evaluateWorkedDuration(input: { totalMinutes: number; template: ShiftTemplateRef | null }): DurationEvaluationResult {
  const minimum = input.template?.minimumMinutesForCompliance ?? null;
  const maximum = input.template ? input.template.maximumInformativeMinutes : DEFAULT_MAXIMUM_INFORMATIVE_MINUTES;
  return {
    insufficientHours: minimum !== null && input.totalMinutes < minimum,
    extendedShift: maximum !== null && input.totalMinutes > maximum,
    maximumThresholdUsed: maximum,
    minimumThresholdUsed: minimum,
  };
}

export type OpenShiftRiskLevel = "NORMAL" | "MISSING_OUT" | "EXPIRED";

export interface OpenShiftRiskResult {
  level: OpenShiftRiskLevel;
  minutesOpen: number;
  missingOutThresholdMinutes: number | null;
  absoluteLimitMinutes: number;
  expectedExitAt: Date | null;
}

// El olvido de salida se marca en base a la salida esperada del turno, sin esperar al límite absoluto de seguridad.
export function evaluateOpenShiftRisk(input: { startAt: Date; now: Date; template: ShiftTemplateRef | null }): OpenShiftRiskResult {
  const minutesOpen = differenceInMinutes(input.now, input.startAt);
  const absoluteLimitMinutes = input.template?.absoluteOpenShiftLimitMinutes ?? DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES;

  const expectedExitAt = input.template ? scheduledDateFor(input.startAt, input.template.endTime, input.template.crossesMidnight) : null;

  let missingOutThresholdMinutes: number | null = null;
  if (input.template && input.template.missingOutAlertAfterMinutes !== null && expectedExitAt) {
    const expectedMinutesToExit = differenceInMinutes(expectedExitAt, input.startAt);
    missingOutThresholdMinutes = expectedMinutesToExit + input.template.exitToleranceAfterMinutes + input.template.missingOutAlertAfterMinutes;
  }

  const level: OpenShiftRiskLevel =
    minutesOpen >= absoluteLimitMinutes ? "EXPIRED" : missingOutThresholdMinutes !== null && minutesOpen >= missingOutThresholdMinutes ? "MISSING_OUT" : "NORMAL";

  return { level, minutesOpen, missingOutThresholdMinutes, absoluteLimitMinutes, expectedExitAt };
}

export type NewEntryDecision = "BLOCK_SAME_DAY_OPEN" | "ALLOW_OBSERVED";

function localDayKey(date: Date, offsetMinutes: number) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth()}-${shifted.getUTCDate()}`;
}

// Solo se bloquea el nuevo ingreso si la jornada previa es del mismo día y todavía está en rango normal; si no, se permite observado (nunca se inventa una salida).
export function evaluateNewEntryWithOpenShift(input: { previousOpenShiftStartAt: Date; now: Date; previousShiftRisk: OpenShiftRiskLevel; timezoneOffsetMinutes?: number }): NewEntryDecision {
  const offset = input.timezoneOffsetMinutes ?? ARGENTINA_OFFSET_MINUTES;
  const sameDay = localDayKey(input.previousOpenShiftStartAt, offset) === localDayKey(input.now, offset);
  if (sameDay && input.previousShiftRisk === "NORMAL") return "BLOCK_SAME_DAY_OPEN";
  return "ALLOW_OBSERVED";
}

export interface RestPeriodResult {
  evaluated: boolean;
  restMinutes: number | null;
  insufficientRest: boolean;
}

export function evaluateRestPeriod(input: { previousShiftEndAt: Date | null; currentShiftStartAt: Date; minimumRestMinutes: number }): RestPeriodResult {
  if (!input.previousShiftEndAt) return { evaluated: false, restMinutes: null, insufficientRest: false };
  const restMinutes = differenceInMinutes(input.currentShiftStartAt, input.previousShiftEndAt);
  return { evaluated: true, restMinutes, insufficientRest: restMinutes < input.minimumRestMinutes };
}
