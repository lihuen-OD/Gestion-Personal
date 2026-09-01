import { ARGENTINA_OFFSET_MINUTES, argentinaCalendarDate, argentinaDateKey, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";

export const DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES = 1200;
export const DEFAULT_MAXIMUM_INFORMATIVE_MINUTES = 600;

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

// effectiveFrom/effectiveTo/weekdays son opcionales a propósito (Etapa 8J):
// en la base ShiftAssignment.effectiveFrom siempre existe (obligatorio desde
// la Etapa 8I), pero a nivel de este helper puro los dejamos opcionales para
// no forzar a todos los fixtures/tests preexistentes (Etapa <8I) a cargar
// vigencia — ausente = sin restricción, igual que si fuera "siempre vigente,
// todos los días".
export interface EmployeeShiftAssignmentRef {
  shiftTemplateId: string;
  status: ShiftAssignmentStatusRef;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  weekdays?: number[];
}

// Vigencia: aplica si effectiveFrom <= fecha y (effectiveTo es null o
// effectiveTo >= fecha) — mismo criterio que EmployeeWorkRegime
// (workRegimes.repository.ts). `referenceDate` debe ser una fecha calendario
// ya resuelta (medianoche UTC), no un instante real — ver
// argentinaCalendarDate/argentinaDateKey.
export function isShiftAssignmentActiveOnDate(assignment: Pick<EmployeeShiftAssignmentRef, "effectiveFrom" | "effectiveTo">, referenceDate: Date): boolean {
  if (assignment.effectiveFrom && assignment.effectiveFrom > referenceDate) return false;
  if (assignment.effectiveTo && assignment.effectiveTo < referenceDate) return false;
  return true;
}

// weekdays sigue el criterio ya usado en el proyecto (DoubleHourRule.weekdays,
// TimeSegment.date.getDay()): 0=domingo..6=sábado. Vacío o ausente = todos
// los días. `referenceDate` ya resuelta a medianoche UTC: getUTCDay() da el
// día de semana correcto sin volver a aplicar ningún corrimiento de huso.
export function isShiftAssignmentApplicableOnWeekday(assignment: Pick<EmployeeShiftAssignmentRef, "weekdays">, referenceDate: Date): boolean {
  if (!assignment.weekdays?.length) return true;
  return assignment.weekdays.includes(referenceDate.getUTCDay());
}

// Combina status + vigencia + weekday contra un INSTANTE real (ej. la
// fichada), resolviendo la fecha calendario Argentina internamente — para
// que ningún llamador tenga que reimplementar esa conversión.
export function isShiftAssignmentApplicableForInstant(assignment: EmployeeShiftAssignmentRef, instant: Date): boolean {
  if (assignment.status !== "HABILITADO") return false;
  const referenceDate = argentinaCalendarDate(argentinaDateKey(instant));
  return isShiftAssignmentActiveOnDate(assignment, referenceDate) && isShiftAssignmentApplicableOnWeekday(assignment, referenceDate);
}

export type ShiftMatchCase = "ENABLED" | "DISABLED_FOR_EMPLOYEE" | "GENERAL_UNASSIGNED" | "NO_MATCH";

export interface ShiftMatchResult {
  case: ShiftMatchCase;
  template: ShiftTemplateRef | null;
  differenceMinutes: number | null;
}

function differenceInMinutes(actual: Date, scheduled: Date) {
  return Math.round((actual.getTime() - scheduled.getTime()) / 60_000);
}

// Busca la ocurrencia (hoy, ayer o mañana) del horario de inicio más cercana a `actualAt`, para no fallar cerca de la medianoche.
function closestOccurrence(actualAt: Date, startTime: string) {
  const today = scheduledInstantForShiftTime(actualAt, startTime);
  const candidates = [today, new Date(today.getTime() - 24 * 60 * 60_000), new Date(today.getTime() + 24 * 60 * 60_000)]
    .map((scheduledAt) => ({ scheduledAt, differenceMinutes: differenceInMinutes(actualAt, scheduledAt) }))
    .sort((a, b) => Math.abs(a.differenceMinutes) - Math.abs(b.differenceMinutes));
  return candidates[0]!;
}

// Etapa 13A: turnos propios del empleado (asignación aplicable ese día) SIEMPRE
// ganan como referencia — sin ventana de tolerancia que los excluya. Antes de
// esta etapa, esta función descartaba el turno propio si la diferencia caía
// fuera de [-entryToleranceBeforeMinutes, maximumInformativeMinutes +
// entryToleranceAfterMinutes]; eso hacía que un ingreso anticipado más allá
// de esos pocos minutos de tolerancia "antes" cayera al buscador de turnos
// generales/ajenos (Caso C/D), pudiendo matchear el turno de otro empleado
// (ej. turno propio 08:30, entrada 08:00, turno ajeno de 08:00 en el
// sistema) o quedar "sin identificar" aunque el empleado sí tuviera turno
// asignado ese día. Regla funcional aprobada (ver
// docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md): si el empleado tiene un
// turno propio aplicable ese día, ese turno es siempre la referencia — nunca
// se busca un turno alternativo no asignado para "hacer match", sin importar
// qué tan lejos esté la fichada de su horario. Con más de un turno propio
// aplicable, gana el más cercano en el tiempo (mismo criterio ya usado desde
// antes de esta etapa — ver "elige el turno más cercano..." en el test).
function closestOwnMatch(actualAt: Date, templates: ShiftTemplateRef[]): { template: ShiftTemplateRef; differenceMinutes: number } | null {
  if (!templates.length) return null;
  const candidates = templates
    .map((template) => ({ template, ...closestOccurrence(actualAt, template.startTime) }))
    .sort((a, b) => Math.abs(a.differenceMinutes) - Math.abs(b.differenceMinutes));
  return candidates[0]!;
}

export function hasNoShiftAssignments(employeeAssignments: EmployeeShiftAssignmentRef[]) {
  return employeeAssignments.length === 0;
}

// Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
// los turnos sólo aplican a un empleado con ShiftAssignment propia. Antes de
// esta etapa, sin turno propio aplicable ese día, se buscaba un segundo
// candidato por coincidencia horaria contra CUALQUIER ShiftTemplate activo
// no asignado a este empleado (`closestWithinTolerance` sobre
// "turnos generales") — eso trataba una coincidencia de horario con el turno
// de otra persona como si fuera evidencia real para este empleado. Regla
// funcional aprobada: que una fichada coincida con el horario de un turno
// ajeno no significa que ese turno le aplique. Se eliminó por completo esa
// búsqueda (y la función `closestWithinTolerance` que la resolvía, sin otro
// llamador) — sin turno propio aplicable, el resultado es directamente
// NO_MATCH, sin ningún paso intermedio de "turno general".
export function matchShiftForEmployee(input: {
  actualAt: Date;
  employeeAssignments: EmployeeShiftAssignmentRef[];
  activeTemplates: ShiftTemplateRef[];
}): ShiftMatchResult {
  const referenceDate = argentinaCalendarDate(argentinaDateKey(input.actualAt));
  const appliesToday = (assignment: EmployeeShiftAssignmentRef) =>
    isShiftAssignmentActiveOnDate(assignment, referenceDate) && isShiftAssignmentApplicableOnWeekday(assignment, referenceDate);

  const templatesById = new Map(input.activeTemplates.map((template) => [template.id, template]));
  const enabledIds = new Set(input.employeeAssignments.filter((a) => a.status === "HABILITADO" && appliesToday(a)).map((a) => a.shiftTemplateId));
  const disabledIds = new Set(input.employeeAssignments.filter((a) => a.status === "DESHABILITADO" && appliesToday(a)).map((a) => a.shiftTemplateId));
  const ownTemplates = [...enabledIds, ...disabledIds].map((id) => templatesById.get(id)).filter((t): t is ShiftTemplateRef => Boolean(t));

  const ownMatch = closestOwnMatch(input.actualAt, ownTemplates);
  if (ownMatch) {
    return { case: enabledIds.has(ownMatch.template.id) ? "ENABLED" : "DISABLED_FOR_EMPLOYEE", template: ownMatch.template, differenceMinutes: ownMatch.differenceMinutes };
  }

  return { case: "NO_MATCH", template: null, differenceMinutes: null };
}

export interface EntryPunctualityResult {
  evaluated: boolean;
  lateArrival: boolean;
  earlyArrival: boolean;
  differenceMinutes: number | null;
}

/**
 * Solo se afirma puntualidad de ingreso cuando el turno coincidente está
 * HABILITADO para el empleado (Caso A) — un turno DESHABILITADO/general no
 * genera ni llegada tarde ni ingreso anticipado, sólo la alerta de
 * configuración correspondiente (ver alertTypeForMatch en el runner).
 *
 * Etapa 13A: agrega `earlyArrival` (ingreso antes de
 * -entryToleranceBeforeMinutes) como contraparte simétrica de `lateArrival`.
 * Con closestOwnMatch ya sin ventana de exclusión (ver más arriba), un turno
 * propio siempre matchea, así que un ingreso antes del horario del turno
 * asignado ahora se clasifica acá en vez de caer en NO_MATCH/GENERAL_UNASSIGNED.
 */
export function evaluateEntryPunctuality(match: ShiftMatchResult): EntryPunctualityResult {
  if (match.case !== "ENABLED" || !match.template || match.differenceMinutes === null) {
    return { evaluated: false, lateArrival: false, earlyArrival: false, differenceMinutes: null };
  }
  const { differenceMinutes, template } = match;
  return {
    evaluated: true,
    lateArrival: differenceMinutes > template.entryToleranceAfterMinutes,
    earlyArrival: differenceMinutes < -template.entryToleranceBeforeMinutes,
    differenceMinutes,
  };
}

// Etapa 13A, caso H del pedido ("entrada muy anticipada", ej. turno 08:30
// con entrada 04:00): un ingreso anticipado sigue siendo INGRESO_ANTICIPADO
// sin importar la magnitud (nunca se reclasifica como turno ajeno ni como
// "no identificado" — el turno asignado sigue siendo la referencia), pero a
// partir de este umbral se sube la severidad de INFO a ADVERTENCIA para que
// RRHH pueda distinguir/filtrar un caso que amerita revisión manual (posible
// error de fichada, doble turno, etc.) de un adelanto normal de unos
// minutos. Umbral propuesto y documentado acá (no configurable por turno:
// no hay hoy ningún campo de "tolerancia de ingreso muy anticipado" en
// ShiftTemplate, y agregar uno sería una migración nueva sin necesidad
// confirmada) — ver docs/decisions/SHIFT_ENTRY_CLASSIFICATION_13A.md.
export const EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES = 240;

export function isEarlyArrivalReviewRequired(differenceMinutes: number): boolean {
  return Math.abs(differenceMinutes) >= EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES;
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
  const scheduledExitAt = scheduledInstantForShiftTime(input.startAt, template.endTime, template.crossesMidnight);
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

/**
 * Las horas reales siempre se computan aparte; esto solo decide si
 * corresponde marcar informativamente jornada corta/extendida.
 *
 * Etapa 10D: prioridad del umbral de jornada extendida = Régimen → Turno →
 * Default. `regimeMaximumMinutes` (WorkRegime.extendedShiftAlertMinutes)
 * gana incondicionalmente cuando está seteado — nunca se combina con el del
 * turno, mismo criterio ya usado por alertOnOutOfShift/openShiftOverflowAction.
 * Si es null/undefined (el caso hoy para todo régimen existente), cae
 * exactamente al comportamiento anterior (turno o default), sin excepción.
 * No afecta minimumMinutesForCompliance/insufficientHours — el pedido de
 * esta etapa es específicamente sobre jornada extendida.
 */
export function evaluateWorkedDuration(input: { totalMinutes: number; template: ShiftTemplateRef | null; regimeMaximumMinutes?: number | null }): DurationEvaluationResult {
  const minimum = input.template?.minimumMinutesForCompliance ?? null;
  const maximum = input.regimeMaximumMinutes ?? (input.template ? input.template.maximumInformativeMinutes : DEFAULT_MAXIMUM_INFORMATIVE_MINUTES);
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

/**
 * El olvido de salida se marca en base a la salida esperada del turno, sin
 * esperar al límite absoluto de seguridad.
 *
 * Etapa 10E: sin turno (o con turno pero sin `missingOutAlertAfterMinutes`
 * configurado), antes de esta etapa `missingOutThresholdMinutes` quedaba
 * `null` para siempre — el nivel nunca llegaba a MISSING_OUT, sólo saltaba
 * directo a EXPIRED al límite absoluto (20h default). Como
 * `checkMissingOutRisk` sólo actúa en MISSING_OUT (EXPIRED lo maneja
 * `expireOpenWorkShifts`, que con régimen ROLLOVER cierra en 0h sin generar
 * ninguna alerta), esto significaba que un olvido de salida sin turno nunca
 * generaba `ShiftAlert` en ningún momento — aunque sí aparecía correctamente
 * en Asistencia (que no depende de ShiftAlert). Hallazgo confirmado en la
 * auditoría 10E.
 *
 * Fix: usar el mismo default ya establecido para "jornada larga"
 * (`DEFAULT_MAXIMUM_INFORMATIVE_MINUTES`, el que ya usa JORNADA_EXTENDIDA
 * cuando no hay turno) como umbral de aviso temprano por defecto.
 * `suppressMissingOutDefault` (true cuando el régimen vigente tiene
 * `alertOnOutOfShift=false`, resuelto por el llamador) apaga sólo este
 * default — nunca un umbral explícito ya configurado en un turno real — para
 * no reintroducir ruido en empleados de régimen flexible/cosecha, que son
 * justamente los que más probablemente no tienen turno asignado.
 */
export function evaluateOpenShiftRisk(input: { startAt: Date; now: Date; template: ShiftTemplateRef | null; suppressMissingOutDefault?: boolean }): OpenShiftRiskResult {
  const minutesOpen = differenceInMinutes(input.now, input.startAt);
  const absoluteLimitMinutes = input.template?.absoluteOpenShiftLimitMinutes ?? DEFAULT_ABSOLUTE_OPEN_SHIFT_LIMIT_MINUTES;

  const expectedExitAt = input.template ? scheduledInstantForShiftTime(input.startAt, input.template.endTime, input.template.crossesMidnight) : null;

  let missingOutThresholdMinutes: number | null = null;
  if (input.template && input.template.missingOutAlertAfterMinutes !== null && expectedExitAt) {
    const expectedMinutesToExit = differenceInMinutes(expectedExitAt, input.startAt);
    missingOutThresholdMinutes = expectedMinutesToExit + input.template.exitToleranceAfterMinutes + input.template.missingOutAlertAfterMinutes;
  } else if (!input.suppressMissingOutDefault) {
    missingOutThresholdMinutes = DEFAULT_MAXIMUM_INFORMATIVE_MINUTES;
  }

  const level: OpenShiftRiskLevel =
    minutesOpen >= absoluteLimitMinutes ? "EXPIRED" : missingOutThresholdMinutes !== null && minutesOpen >= missingOutThresholdMinutes ? "MISSING_OUT" : "NORMAL";

  return { level, minutesOpen, missingOutThresholdMinutes, absoluteLimitMinutes, expectedExitAt };
}

export type NewEntryDecision = "BLOCK_SAME_DAY_OPEN" | "ALLOW_OBSERVED";

// Genérica (no hardcodea Argentina): solo se usa para permitir, en tests, evaluar
// con un offset distinto al default. El uso real siempre pasa por el default
// (ARGENTINA_OFFSET_MINUTES, importado del helper único), nunca reimplementa el
// offset de Argentina.
function offsetDateKey(date: Date, offsetMinutes: number) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth()}-${shifted.getUTCDate()}`;
}

// Solo se bloquea el nuevo ingreso si la jornada previa es del mismo día y todavía está en rango normal; si no, se permite observado (nunca se inventa una salida).
export function evaluateNewEntryWithOpenShift(input: { previousOpenShiftStartAt: Date; now: Date; previousShiftRisk: OpenShiftRiskLevel; timezoneOffsetMinutes?: number }): NewEntryDecision {
  const offset = input.timezoneOffsetMinutes ?? ARGENTINA_OFFSET_MINUTES;
  const sameDay = offsetDateKey(input.previousOpenShiftStartAt, offset) === offsetDateKey(input.now, offset);
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
