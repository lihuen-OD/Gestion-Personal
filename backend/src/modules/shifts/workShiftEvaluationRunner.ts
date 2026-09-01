import { prisma } from "../../shared/prisma/client";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";
import { attendanceRecipients, notifyUsers } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegime } from "../work-regimes/workRegimes.service";
import {
  evaluateEntryPunctuality,
  evaluateExitPunctuality,
  evaluateRestPeriod,
  evaluateWorkedDuration,
  isEarlyArrivalReviewRequired,
  matchShiftForEmployee,
  type EmployeeShiftAssignmentRef,
  type ShiftMatchResult,
  type ShiftTemplateRef,
} from "./workShiftEvaluation.service";

export type ShiftAlertTypeValue =
  | "INGRESO_TARDE"
  | "INGRESO_ANTICIPADO"
  | "SALIDA_ANTICIPADA"
  | "SALIDA_TARDIA"
  | "TURNO_NO_IDENTIFICADO"
  | "SHIFT_NOT_ENABLED_FOR_EMPLOYEE"
  | "POSSIBLE_SHIFT_CONFIGURATION_MISSING"
  | "JORNADA_INSUFICIENTE"
  | "JORNADA_EXTENDIDA"
  | "DESCANSO_INSUFICIENTE"
  | "POSIBLE_OLVIDO_SALIDA"
  | "CONCEPTO_NO_HABILITADO"
  | "SEGMENTO_SIN_CLASIFICAR";
type ShiftAlertSeverityValue = "INFO" | "ADVERTENCIA" | "CRITICA";

const DEFAULT_MINIMUM_REST_MINUTES = 480;

const severityByAlertType: Record<ShiftAlertTypeValue, ShiftAlertSeverityValue> = {
  INGRESO_TARDE: "ADVERTENCIA",
  INGRESO_ANTICIPADO: "INFO",
  SALIDA_ANTICIPADA: "ADVERTENCIA",
  SALIDA_TARDIA: "INFO",
  TURNO_NO_IDENTIFICADO: "ADVERTENCIA",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "ADVERTENCIA",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "INFO",
  JORNADA_INSUFICIENTE: "ADVERTENCIA",
  JORNADA_EXTENDIDA: "INFO",
  DESCANSO_INSUFICIENTE: "ADVERTENCIA",
  POSIBLE_OLVIDO_SALIDA: "ADVERTENCIA",
  CONCEPTO_NO_HABILITADO: "ADVERTENCIA",
  SEGMENTO_SIN_CLASIFICAR: "ADVERTENCIA",
};

const labelByAlertType: Record<ShiftAlertTypeValue, string> = {
  INGRESO_TARDE: "Ingreso fuera de tolerancia",
  INGRESO_ANTICIPADO: "Ingreso anticipado",
  SALIDA_ANTICIPADA: "Salida anticipada",
  SALIDA_TARDIA: "Salida fuera de tolerancia",
  TURNO_NO_IDENTIFICADO: "Turno no identificado",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "Turno no habilitado para el empleado",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Posible falta de configuración de turno",
  JORNADA_INSUFICIENTE: "Jornada por debajo del mínimo",
  JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente entre jornadas",
  POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
  CONCEPTO_NO_HABILITADO: "Concepto horario detectado pero no habilitado para el empleado",
  SEGMENTO_SIN_CLASIFICAR: "Tramo de jornada sin concepto horario compatible",
};

export function toTemplateRef(template: ShiftTemplateLike): ShiftTemplateRef {
  return {
    id: template.id,
    code: template.code,
    startTime: template.startTime,
    endTime: template.endTime,
    crossesMidnight: template.crossesMidnight,
    entryToleranceBeforeMinutes: template.entryToleranceBeforeMinutes,
    entryToleranceAfterMinutes: template.entryToleranceAfterMinutes,
    exitToleranceBeforeMinutes: template.exitToleranceBeforeMinutes,
    exitToleranceAfterMinutes: template.exitToleranceAfterMinutes,
    minimumMinutesForCompliance: template.minimumMinutesForCompliance,
    maximumInformativeMinutes: template.maximumInformativeMinutes,
    missingOutAlertAfterMinutes: template.missingOutAlertAfterMinutes,
    absoluteOpenShiftLimitMinutes: template.absoluteOpenShiftLimitMinutes,
  };
}

async function loadMatchingContext(employeeId: string) {
  const [assignments, templates] = await Promise.all([
    prisma.shiftAssignment.findMany({ where: { employeeId } }),
    prisma.shiftTemplate.findMany({ where: { status: "ACTIVO" } }),
  ]);
  const employeeAssignments: EmployeeShiftAssignmentRef[] = assignments.map((a) => ({
    shiftTemplateId: a.shiftTemplateId,
    status: a.status,
    effectiveFrom: a.effectiveFrom,
    effectiveTo: a.effectiveTo,
    weekdays: a.weekdays,
  }));
  const activeTemplates = templates.map(toTemplateRef);
  return { employeeAssignments, activeTemplates };
}

export async function createShiftAlert(input: {
  employeeId: string;
  workShiftId: string;
  type: ShiftAlertTypeValue;
  scheduledAt?: Date;
  actualAt: Date;
  differenceMinutes?: number | null;
  severity?: ShiftAlertSeverityValue;
  // Etapa 13B: la alerta (ShiftAlert, historial/auditoría) SIEMPRE se
  // persiste — `notify=false` sólo suprime el aviso (SystemNotification) a
  // RRHH, para no duplicar avisos cuando otra alerta de mayor prioridad ya
  // explica el mismo evento de salida (ver política en
  // docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md). Default `true`: no
  // cambia el comportamiento de ningún llamador existente que no lo pase.
  notify?: boolean;
}) {
  // El override solo existe para casos puntuales que ya tienen su propia
  // severidad de negocio explícita (ej. jornada abierta excedida bajo
  // régimen ALERT_ONLY) — no reemplaza la severidad por defecto del tipo.
  const severity = input.severity ?? severityByAlertType[input.type];
  const alert = await prisma.shiftAlert.upsert({
    where: { workShiftId_type: { workShiftId: input.workShiftId, type: input.type } },
    create: { employeeId: input.employeeId, workShiftId: input.workShiftId, type: input.type, severity, scheduledAt: input.scheduledAt, actualAt: input.actualAt, differenceMinutes: input.differenceMinutes ?? undefined },
    update: { actualAt: input.actualAt, scheduledAt: input.scheduledAt, differenceMinutes: input.differenceMinutes ?? undefined, severity, status: "PENDIENTE" },
  });
  if (input.notify === false) return alert;
  // Etapa 10E: la notificación es best-effort — un fallo acá (ej. un
  // problema transitorio de DB al insertar SystemNotification) nunca debe
  // tirar abajo la fichada real que ya se confirmó, ni impedir que la alerta
  // ya persistida quede registrada. Mismo criterio ya usado para
  // resolveOpenShiftOverflowAlert (Etapa 10B).
  try {
    await notifyUsers(await attendanceRecipients(input.employeeId), {
      type: "ALERTA_FICHADA",
      title: labelByAlertType[input.type],
      message: "La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente.",
      entityType: "ShiftAlert",
      entityId: alert.id,
      link: "/asistencia",
      priority: "ALTA",
    });
  } catch (error) {
    console.error("SHIFT_ALERT_NOTIFY_FAILED", {
      severity: "warning",
      shiftAlertId: alert.id,
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return alert;
}

function alertTypeForMatch(match: ShiftMatchResult): ShiftAlertTypeValue | null {
  if (match.case === "DISABLED_FOR_EMPLOYEE") return "SHIFT_NOT_ENABLED_FOR_EMPLOYEE";
  if (match.case === "GENERAL_UNASSIGNED") return "POSSIBLE_SHIFT_CONFIGURATION_MISSING";
  if (match.case === "NO_MATCH") return "TURNO_NO_IDENTIFICADO";
  return null;
}

// Las tres alertas que un régimen con alertOnOutOfShift = false puede
// suprimir: "no tiene turno compatible", "el turno existe pero no está
// habilitado para este empleado" y "posible falta de configuración de
// turno". Las tres son, en esencia, variantes de "este empleado no matcheó
// contra un turno propio válido" — exactamente lo que alertOnOutOfShift=false
// dice que no interesa vigilar para este régimen.
//
// Historial (Etapa 8K): hasta la Etapa 8J, POSSIBLE_SHIFT_CONFIGURATION_MISSING
// quedaba fuera de esta lista a propósito, porque antes solo se generaba
// cuando el empleado no tenía ninguna relación con el turno general que
// matcheó por coincidencia — una señal de configuración real, independiente
// del régimen. Pero desde que matchShiftForEmployee (Etapa 8J) empezó a
// filtrar los turnos "propios" por vigencia/weekday, una asignación
// HABILITADO o DESHABILITADO que no aplica ese día también cae en
// GENERAL_UNASSIGNED si la fichada coincide con la tolerancia general del
// mismo turno — y ese caso SÍ es "este empleado está fuera de su propio
// turno hoy", el escenario exacto que alertOnOutOfShift=false existe para
// silenciar. Se decidió sumarla a la lista en vez de distinguir el origen
// exacto del GENERAL_UNASSIGNED (turno ajeno vs. turno propio no aplicable
// hoy), que hubiera requerido un campo/lógica nueva en ShiftMatchResult sin
// necesidad real.
const SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS: ReadonlySet<ShiftAlertTypeValue> = new Set([
  "TURNO_NO_IDENTIFICADO",
  "SHIFT_NOT_ENABLED_FOR_EMPLOYEE",
  "POSSIBLE_SHIFT_CONFIGURATION_MISSING",
]);

// Si el empleado no tiene régimen vigente, o el régimen vigente exige alertar
// fuera de turno (alertOnOutOfShift = true), el comportamiento es exactamente
// el de siempre: no se suprime nada.
async function isOutOfShiftAlertSuppressed(employeeId: string, actualAt: Date, alertType: ShiftAlertTypeValue): Promise<boolean> {
  if (!SUPPRESSIBLE_OUT_OF_SHIFT_ALERTS.has(alertType)) return false;
  const regime = await resolveActiveWorkRegime(employeeId, actualAt);
  return regime !== null && !regime.alertOnOutOfShift;
}

export async function evaluateShiftEntry(employeeId: string, workShiftId: string, actualAt: Date) {
  const { employeeAssignments, activeTemplates } = await loadMatchingContext(employeeId);
  const match = matchShiftForEmployee({ actualAt, employeeAssignments, activeTemplates });

  if (match.template) {
    await prisma.workShift.update({
      where: { id: workShiftId },
      data: { shiftTemplateId: match.template.id, maxAllowedMinutes: match.template.absoluteOpenShiftLimitMinutes },
    });
  }

  const configurationAlertType = alertTypeForMatch(match);
  if (configurationAlertType && !(await isOutOfShiftAlertSuppressed(employeeId, actualAt, configurationAlertType))) {
    await createShiftAlert({ employeeId, workShiftId, type: configurationAlertType, actualAt, differenceMinutes: match.differenceMinutes });
  }

  const punctuality = evaluateEntryPunctuality(match);
  if (punctuality.evaluated && punctuality.lateArrival) {
    await createShiftAlert({ employeeId, workShiftId, type: "INGRESO_TARDE", actualAt, differenceMinutes: punctuality.differenceMinutes });
  }
  // Etapa 13A: contraparte del bloque anterior — ingreso antes del horario/
  // tolerancia del turno YA asignado al empleado (nunca contra un turno
  // ajeno, ver matchShiftForEmployee/closestOwnMatch). Un adelanto que supera
  // EARLY_ARRIVAL_REVIEW_THRESHOLD_MINUTES sube de severidad (INFO ->
  // ADVERTENCIA) para señalar revisión manual, sin cambiar el tipo de alerta
  // ni bloquear la fichada.
  if (punctuality.evaluated && punctuality.earlyArrival) {
    const severity = isEarlyArrivalReviewRequired(punctuality.differenceMinutes ?? 0) ? "ADVERTENCIA" : undefined;
    await createShiftAlert({ employeeId, workShiftId, type: "INGRESO_ANTICIPADO", actualAt, differenceMinutes: punctuality.differenceMinutes, severity });
  }

  const previousShift = await prisma.workShift.findFirst({
    where: { employeeId, id: { not: workShiftId }, endAt: { not: null } },
    orderBy: { endAt: "desc" },
  });
  const rest = evaluateRestPeriod({ previousShiftEndAt: previousShift?.endAt ?? null, currentShiftStartAt: actualAt, minimumRestMinutes: DEFAULT_MINIMUM_REST_MINUTES });
  if (rest.evaluated && rest.insufficientRest) {
    await createShiftAlert({ employeeId, workShiftId, type: "DESCANSO_INSUFICIENTE", actualAt, differenceMinutes: rest.restMinutes });
  }
}

async function resolveMatchForExit(employeeId: string, shiftTemplateId: string | null): Promise<ShiftMatchResult> {
  if (!shiftTemplateId) return { case: "NO_MATCH", template: null, differenceMinutes: null };
  const [template, assignment] = await Promise.all([
    prisma.shiftTemplate.findUnique({ where: { id: shiftTemplateId } }),
    prisma.shiftAssignment.findUnique({ where: { employeeId_shiftTemplateId: { employeeId, shiftTemplateId } } }),
  ]);
  if (!template) return { case: "NO_MATCH", template: null, differenceMinutes: null };
  const templateRef = toTemplateRef(template);
  if (!assignment) return { case: "GENERAL_UNASSIGNED", template: templateRef, differenceMinutes: null };
  return { case: assignment.status === "HABILITADO" ? "ENABLED" : "DISABLED_FOR_EMPLOYEE", template: templateRef, differenceMinutes: null };
}

// Etapa 10B: cierra el hueco de "alertas huérfanas" detectado en la
// auditoría 10A — cuando una WorkShift pasa de ABIERTO a cualquier estado
// cerrado (salida real, cierre manual de RRHH, auto-expiración por
// mantenimiento, o rollover al registrar un nuevo ingreso sobre una jornada
// vieja), el riesgo que POSIBLE_OLVIDO_SALIDA advertía ya dejó de existir —
// la jornada tiene un desenlace definitivo, revisable por su propio estado
// (FALTA_SALIDA en la bandeja de Asistencia, o la salida real registrada).
// No borra la alerta ni su trazabilidad (resolvedAt/resolutionNote quedan),
// solo actualiza su status — no-op si no había ninguna alerta PENDIENTE para
// esta jornada, y nunca toca alertas de otro workShiftId/empleado (el
// update siempre filtra por este workShiftId puntual).
export async function resolveOpenShiftOverflowAlert(workShiftId: string, note: string) {
  await prisma.shiftAlert.updateMany({
    where: { workShiftId, type: "POSIBLE_OLVIDO_SALIDA", status: "PENDIENTE" },
    data: { status: "RESUELTA", resolvedAt: new Date(), resolutionNote: note },
  });
}

export interface ClassifiedSegmentAlertInput {
  startAt: Date;
  minutes: number;
  conceptStatus: "SUGERIDO" | "MANUAL" | "SIN_CONCEPTO_COMPATIBLE" | "CONCEPTO_NO_HABILITADO";
}

// Etapa 13B: política de alertas de salida duplicadas
// (docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md). Una misma salida corta/
// anticipada podía disparar hasta 3 avisos casi simultáneos que en realidad
// describen el mismo hecho: SALIDA_ANTICIPADA, JORNADA_INSUFICIENTE (jornada
// corta consecuencia de haber salido antes) y SEGMENTO_SIN_CLASIFICAR (un
// tramo residual sin regla de concepto horario compatible, típicamente
// producto del mismo recorte). Ninguna de las 3 ShiftAlert deja de
// persistirse (RRHH sigue viendo el detalle completo en Alertas de Turnos,
// "no ocultar problemas críticos") — sólo se suprime el AVISO
// (SystemNotification) de la de menor prioridad cuando una de mayor
// prioridad ya explica el mismo evento, para no saturar a RRHH con 3
// notificaciones por una sola salida. Prioridad: SALIDA_ANTICIPADA (nunca se
// suprime) > JORNADA_INSUFICIENTE (se suprime su aviso sólo si hubo salida
// anticipada) > SEGMENTO_SIN_CLASIFICAR (se suprime su aviso si hubo salida
// anticipada o jornada insuficiente). CONCEPTO_NO_HABILITADO queda fuera de
// esta cascada a propósito: es un problema de configuración real e
// independiente del horario de salida (un concepto que matcheó pero no está
// habilitado para el empleado), nunca "consecuencia" de una salida
// anticipada — siempre notifica. SALIDA_TARDIA/JORNADA_EXTENDIDA tampoco
// participan: son el cluster de "jornada larga", ortogonal al de "jornada
// corta" que esta política resuelve.
async function applyClassificationAlerts(
  employeeId: string,
  workShiftId: string,
  segments: ClassifiedSegmentAlertInput[],
  options: { notify: boolean },
) {
  const byStatus = (status: ClassifiedSegmentAlertInput["conceptStatus"]) => segments.filter((segment) => segment.conceptStatus === status);

  const noHabilitado = byStatus("CONCEPTO_NO_HABILITADO");
  if (noHabilitado.length > 0) {
    await createShiftAlert({
      employeeId,
      workShiftId,
      type: "CONCEPTO_NO_HABILITADO",
      actualAt: noHabilitado[0]!.startAt,
      differenceMinutes: noHabilitado.reduce((sum, segment) => sum + segment.minutes, 0),
    });
  }

  const sinClasificar = byStatus("SIN_CONCEPTO_COMPATIBLE");
  if (sinClasificar.length > 0) {
    await createShiftAlert({
      employeeId,
      workShiftId,
      type: "SEGMENTO_SIN_CLASIFICAR",
      actualAt: sinClasificar[0]!.startAt,
      differenceMinutes: sinClasificar.reduce((sum, segment) => sum + segment.minutes, 0),
      notify: options.notify,
    });
  }
}

// Una sola alerta por tipo por jornada, aunque varios segmentos compartan el
// mismo problema (createShiftAlert ya upsertea por [workShiftId, type], pero
// llamarlo una vez por segmento igual dispararia una notificacion por
// llamada — se agrega antes de notificar, para cumplir "no generar alertas
// duplicadas por el mismo problema"). No genera nada si todos los segmentos
// quedaron SUGERIDO/MANUAL. Uso standalone (ej. createWorkShift, alta manual
// de un día completo sin evaluateShiftExit) — siempre notifica, sin la
// supresión por prioridad de la Etapa 13B (que sólo aplica al cerrar una
// jornada abierta real, ver evaluateShiftExit).
export async function notifyClassificationAlerts(employeeId: string, workShiftId: string, segments: ClassifiedSegmentAlertInput[]) {
  await applyClassificationAlerts(employeeId, workShiftId, segments, { notify: true });
}

// Etapa 13B: además de las alertas de puntualidad/duración, ahora acepta los
// segmentos ya clasificados de la misma salida (`classifiedSegments`) para
// poder aplicar la política de prioridad de arriba en un solo lugar — antes,
// el llamador invocaba `notifyClassificationAlerts` por separado, sin forma
// de saber si `SALIDA_ANTICIPADA`/`JORNADA_INSUFICIENTE` ya habían disparado
// para la misma jornada.
//
// Toda la función es best-effort: el cierre real (WorkShift/TimeEntry/
// TimeSegment) ya se persistió en una transacción propia antes de llamar
// acá (ver timeEntries.repository.ts:closeOpenWorkShift) — un error acá
// (ej. un problema transitorio de DB al crear una ShiftAlert) nunca debe
// revertir ni enmascarar una salida que ya se guardó con éxito. Antes de
// esta etapa, cualquier excepción acá se propagaba sin capturar hasta el
// llamador (timeEntries.service.ts), que la trataba igual que un fallo real
// de guardado: limpiaba la evidencia fotográfica ya referenciada por la
// fichada persistida y devolvía 503 "El intento no fue confirmado" — un
// diagnóstico falso, porque el intento sí se había confirmado. Ver
// docs/decisions/SHIFT_EXIT_CLASSIFICATION_13B.md §4.
export async function evaluateShiftExit(
  employeeId: string,
  workShiftId: string,
  actualAt: Date,
  classifiedSegments: ClassifiedSegmentAlertInput[] = [],
) {
  try {
    const shift = await prisma.workShift.findUnique({ where: { id: workShiftId } });
    if (!shift) return;
    await resolveOpenShiftOverflowAlert(workShiftId, "Resuelta automáticamente: la jornada se cerró con una salida registrada.");
    // Etapa 13B: `resolveMatchForExit` nunca busca contra turnos ajenos — usa
    // exclusivamente `shift.shiftTemplateId`, ya resuelto en el ingreso
    // (Etapa 13A: siempre el turno propio del empleado cuando aplica ese
    // día). Confirmado con test de regresión, sin necesidad de cambios acá.
    const match = await resolveMatchForExit(employeeId, shift.shiftTemplateId);

    let earlyLeave = false;
    const punctuality = evaluateExitPunctuality({ match, startAt: shift.startAt, actualExitAt: actualAt });
    if (punctuality.evaluated) {
      earlyLeave = punctuality.earlyLeave;
      if (punctuality.earlyLeave) {
        await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_ANTICIPADA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes });
      }
      if (punctuality.lateLeave) {
        await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_TARDIA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes });
      }
    }

    // Etapa 10D: régimen (si tiene extendedShiftAlertMinutes seteado) gana por
    // sobre el umbral del turno para decidir JORNADA_EXTENDIDA — ver
    // evaluateWorkedDuration para la prioridad exacta (Régimen → Turno → Default).
    const regime = await resolveActiveWorkRegime(employeeId, actualAt);
    const duration = evaluateWorkedDuration({ totalMinutes: shift.totalMinutes ?? 0, template: match.template, regimeMaximumMinutes: regime?.extendedShiftAlertMinutes ?? null });
    if (duration.insufficientHours) {
      // Etapa 13B: si ya hubo SALIDA_ANTICIPADA, la jornada corta es
      // consecuencia del mismo evento — se persiste igual (detalle/auditoría)
      // pero sin un segundo aviso redundante.
      await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_INSUFICIENTE", actualAt, differenceMinutes: shift.totalMinutes, notify: !earlyLeave });
    }
    if (duration.extendedShift) {
      await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_EXTENDIDA", actualAt, differenceMinutes: shift.totalMinutes });
    }

    if (classifiedSegments.length > 0) {
      // Etapa 13B: suprime el aviso de SEGMENTO_SIN_CLASIFICAR si alguna de
      // las dos alertas de mayor prioridad ya disparó para esta misma salida.
      await applyClassificationAlerts(employeeId, workShiftId, classifiedSegments, { notify: !earlyLeave && !duration.insufficientHours });
    }
  } catch (error) {
    console.error("EVALUATE_SHIFT_EXIT_FAILED", {
      severity: "critical",
      employeeId,
      workShiftId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Política de rollover por régimen (etapa de Turnos V1): una WorkShift
// abierta que superó el límite operativo, para un empleado en régimen
// ALERT_ONLY, nunca se cierra ni se reemplaza automáticamente. En su lugar
// se marca para revisión de RRHH con una alerta crítica — se reutiliza
// POSIBLE_OLVIDO_SALIDA (createShiftAlert ya deduplica por
// [workShiftId, type]: evaluar la misma jornada más de una vez actualiza la
// misma fila, no crea una nueva).
export async function flagOpenShiftOverflowForReview(employeeId: string, workShiftId: string, minutesOpen: number, now: Date) {
  await createShiftAlert({
    employeeId,
    workShiftId,
    type: "POSIBLE_OLVIDO_SALIDA",
    actualAt: now,
    differenceMinutes: minutesOpen,
    severity: "CRITICA",
  });
}
