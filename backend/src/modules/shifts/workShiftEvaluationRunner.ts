import { prisma } from "../../shared/prisma/client";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";
import { attendanceRecipients, notifyUsers } from "../workforce-management/workforce.service";
import { resolveActiveWorkRegime } from "../work-regimes/workRegimes.service";
import { hourConceptsRepository } from "../hour-concepts/hourConcepts.repository";
import {
  evaluateEntryPunctuality,
  evaluateExitPunctuality,
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
  // Etapa 13E.1: legacy -- ningún camino de código genera este tipo de acá
  // en adelante (ver alertTypeForMatch más abajo). Se conserva en el enum de
  // Prisma y en estos mapas de labels/severidad/mensaje sólo para que las
  // filas de ShiftAlert ya persistidas antes de esta etapa se sigan
  // mostrando correctamente en "Alertas de Turnos" -- ver
  // docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md.
  | "POSSIBLE_SHIFT_CONFIGURATION_MISSING"
  | "JORNADA_INSUFICIENTE"
  | "JORNADA_EXTENDIDA"
  // Etapa 13I: legacy -- ya no se genera (ver evaluateShiftEntry más abajo).
  // El umbral (480 min) estaba hardcodeado, sin ningún campo de Turno/Régimen
  // que lo respaldara, y generaba ruido para regímenes flexibles/turnos
  // partidos. Se conserva en el enum de Prisma y en estos mapas sólo para
  // que las filas ya persistidas se sigan mostrando correctamente -- ver
  // docs/decisions/SHIFT_REST_BETWEEN_SHIFTS_DISABLED_13I.md.
  | "DESCANSO_INSUFICIENTE"
  | "POSIBLE_OLVIDO_SALIDA"
  | "CONCEPTO_NO_HABILITADO"
  | "SEGMENTO_SIN_CLASIFICAR";
type ShiftAlertSeverityValue = "INFO" | "ADVERTENCIA" | "CRITICA";

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
  // Etapa 13E (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md): el
  // label anterior ("Posible falta de configuración de turno") afirmaba un
  // hecho de configuración cuando en realidad es sólo una coincidencia
  // horaria contra un turno que no le pertenece al empleado (GENERAL_UNASSIGNED
  // en matchShiftForEmployee) -- nunca una certeza. "Revisar..." pide una
  // acción sin afirmar el diagnóstico.
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Revisar configuración de turno",
  JORNADA_INSUFICIENTE: "Jornada por debajo del mínimo",
  JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente entre jornadas",
  POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
  CONCEPTO_NO_HABILITADO: "Concepto horario detectado pero no habilitado para el empleado",
  SEGMENTO_SIN_CLASIFICAR: "Tramo de jornada sin concepto horario compatible",
};

const DEFAULT_ALERT_NOTIFICATION_MESSAGE = "La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente.";

// Etapa 13E: cuerpo de notificación específico sólo para los tipos donde el
// mensaje genérico ("la fichada requiere seguimiento") no comunica qué
// revisar -- el resto de los 12 tipos sigue usando el mensaje genérico
// (mismo criterio ya establecido en 13A: no introducir contenido dinámico
// por instancia, sólo variar el texto fijo por TIPO).
const messageByAlertType: Partial<Record<ShiftAlertTypeValue, string>> = {
  POSSIBLE_SHIFT_CONFIGURATION_MISSING:
    "La persona registró una fichada, pero no tiene un turno asignado compatible para ese horario. Revisá si corresponde asignarle un turno.",
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
      message: messageByAlertType[input.type] ?? DEFAULT_ALERT_NOTIFICATION_MESSAGE,
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

// Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
// matchShiftForEmployee (entrada, único llamador de esta función) ya nunca
// produce GENERAL_UNASSIGNED — la búsqueda contra turnos ajenos se eliminó
// por completo. POSSIBLE_SHIFT_CONFIGURATION_MISSING queda sin ningún caso
// funcional real que la dispare: el enum de Prisma se conserva (alertas
// históricas ya persistidas siguen existiendo y se siguen mostrando
// correctamente en "Alertas de Turnos"), pero no hay ningún camino de código
// que vuelva a crear una fila nueva de este tipo. Si resolveMatchForExit
// (salida) resolviera GENERAL_UNASSIGNED en su escenario residual (una
// asignación que dejó de existir entre el ingreso y la salida — ver ese
// comentario más abajo), tampoco corresponde alertar: esta función nunca se
// llama desde salida.
function alertTypeForMatch(match: ShiftMatchResult): ShiftAlertTypeValue | null {
  if (match.case === "DISABLED_FOR_EMPLOYEE") return "SHIFT_NOT_ENABLED_FOR_EMPLOYEE";
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
//
// Etapa 13E.1: POSSIBLE_SHIFT_CONFIGURATION_MISSING queda en esta lista sin
// efecto práctico -- alertTypeForMatch nunca vuelve a devolver ese tipo, así
// que la condición de abajo jamás se evalúa para él. Se deja tal cual (no se
// achica el Set) porque no cuesta nada mantenerlo y documenta la intención
// histórica; si el tipo se retirara del todo más adelante, este Set es uno
// de los lugares a revisar.
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

  // Etapa 13E: un turno GENERAL_UNASSIGNED (ajeno -- coincide por horario
  // pero no está asignado a este empleado) nunca se adopta como el turno real
  // de esta jornada. Antes de la Etapa 13E sí se escribía acá, y ese dato
  // "contaminaba" evaluaciones posteriores que confían en
  // shift.shiftTemplateId/shift.maxAllowedMinutes -- evaluateWorkedDuration
  // en la salida (JORNADA_INSUFICIENTE/EXTENDIDA contra el mínimo/máximo de
  // un turno ajeno), checkMissingOutRisk (POSIBLE_OLVIDO_SALIDA contra
  // missingOutAlertAfterMinutes de un turno ajeno) y expireOpenWorkShifts
  // (auto-cierre contra maxAllowedMinutes de un turno ajeno). ENABLED y
  // DISABLED_FOR_EMPLOYEE sí siguen adoptando el turno: en ambos casos existe
  // una ShiftAssignment real del empleado a ese ShiftTemplate (habilitada o
  // no), evidencia genuina, no una coincidencia.
  //
  // Etapa 13E.1 (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md):
  // matchShiftForEmployee (entrada) ya nunca produce GENERAL_UNASSIGNED -- la
  // búsqueda contra turnos ajenos se eliminó en el origen (workShiftEvaluation.service.ts).
  // La condición `match.case !== "GENERAL_UNASSIGNED"` de acá abajo queda
  // como defensa en profundidad (nunca hace daño, documenta la invariante) —
  // no como el mecanismo que evita la adopción, que ahora es estructural.
  if (match.template && match.case !== "GENERAL_UNASSIGNED") {
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

  // Etapa 13I (docs/decisions/SHIFT_REST_BETWEEN_SHIFTS_DISABLED_13I.md):
  // DESCANSO_INSUFICIENTE deja de generarse -- el umbral (480 min) estaba
  // hardcodeado, sin ningún campo de ShiftTemplate/WorkRegime detrás (Etapa
  // 13C, hallazgo confirmado), y no distingue empleados con turno fijo de
  // regímenes flexibles/turnos partidos, generando ruido/falsas alarmas para
  // esa población. Se quita la consulta de `previousShift` y la llamada a
  // `createShiftAlert` -- una consulta menos por evaluación de entrada, sin
  // efecto en ninguna otra alerta. `evaluateRestPeriod` (workShiftEvaluation.service.ts)
  // se conserva intacta y exportada, sin llamador en producción por ahora,
  // lista para reactivarse si en el futuro se define una configuración real
  // de descanso mínimo por régimen/turno. El tipo `DESCANSO_INSUFICIENTE`
  // sigue en el enum de Prisma, en `severityByAlertType`/`labelByAlertType`
  // y en el schema Zod -- las alertas ya persistidas siguen renderizando
  // correctamente en "Alertas de Turnos"/"Notificaciones", legacy, no se
  // genera ninguna fila nueva.
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

// Etapa 13D (docs/decisions/SHIFT_SEGMENT_UNCLASSIFIED_POLICY_13D.md),
// ampliado por la Etapa 13H.1 (docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H_1.md):
// sin ningún concepto horario ADICIONAL habilitado, un tramo
// SIN_CONCEPTO_COMPATIBLE no es un hallazgo real -- es la situación esperada
// de cualquier empleado que nunca tuvo Sereno/Guardia/Colectivo/etc. Hasta
// 13H.1 esto sólo apagaba el AVISO (la ShiftAlert se persistía siempre,
// "interna"); RRHH seguía viéndola como hallazgo asociado en Alertas de
// Turnos (Etapa 13H), sin ningún indicio de que no había nada que revisar.
// Desde 13H.1 esta misma consulta también decide si corresponde CREAR la
// ShiftAlert -- sin concepto adicional, no se persiste en absoluto (ver
// isSegmentoSinClasificarEligible más abajo). Una sola consulta por cierre,
// sólo si hay al menos un segmento sin clasificar (nunca por segmento).
async function isSegmentoSinClasificarNotifiable(employeeId: string, sinClasificarCount: number): Promise<boolean> {
  if (sinClasificarCount === 0) return false;
  return hourConceptsRepository.findHasAdditionalConceptEnabled(employeeId);
}

async function applyClassificationAlerts(
  employeeId: string,
  workShiftId: string,
  segments: ClassifiedSegmentAlertInput[],
  options: { notifyConceptoNoHabilitado: boolean; persistSegmentoSinClasificar: boolean; notifySegmentoSinClasificar: boolean },
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
      notify: options.notifyConceptoNoHabilitado,
    });
  }

  // Etapa 13H.1: sin concepto adicional esperado (persistSegmentoSinClasificar
  // en false), la ShiftAlert ni se crea -- no hay ningún hallazgo real que
  // registrar (Regla 2 del pedido: "la ausencia de concepto horario adicional
  // no es un problema"). Con concepto adicional, se sigue persistiendo
  // siempre que haya un tramo sin clasificar (trazabilidad interna, "no
  // ocultar problemas de configuración"), y notifySegmentoSinClasificar ya
  // llega resuelto por el llamador (13D + la política unificada de 13G).
  const sinClasificar = byStatus("SIN_CONCEPTO_COMPATIBLE");
  if (sinClasificar.length > 0 && options.persistSegmentoSinClasificar) {
    await createShiftAlert({
      employeeId,
      workShiftId,
      type: "SEGMENTO_SIN_CLASIFICAR",
      actualAt: sinClasificar[0]!.startAt,
      differenceMinutes: sinClasificar.reduce((sum, segment) => sum + segment.minutes, 0),
      notify: options.notifySegmentoSinClasificar,
    });
  }
}

// Una sola alerta por tipo por jornada, aunque varios segmentos compartan el
// mismo problema (createShiftAlert ya upsertea por [workShiftId, type], pero
// llamarlo una vez por segmento igual dispararia una notificacion por
// llamada — se agrega antes de notificar, para cumplir "no generar alertas
// duplicadas por el mismo problema"). No genera nada si todos los segmentos
// quedaron SUGERIDO/MANUAL. Uso standalone (ej. createWorkShift, alta manual
// de un día completo sin evaluateShiftExit) — CONCEPTO_NO_HABILITADO siempre
// notifica; SEGMENTO_SIN_CLASIFICAR respeta 13D/13H.1 (sin concepto
// adicional esperado, ni se persiste ni notifica) pero, a diferencia de
// evaluateShiftExit, no compite por un único "ganador" contra otras alertas
// -- este camino nunca evalúa puntualidad/duración, así que "elegible"
// (persistir) y "notificable" son la misma condición acá (ver Etapa 13G,
// docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md §11, "qué NO
// se tocó").
export async function notifyClassificationAlerts(employeeId: string, workShiftId: string, segments: ClassifiedSegmentAlertInput[]) {
  const sinClasificarCount = segments.filter((segment) => segment.conceptStatus === "SIN_CONCEPTO_COMPATIBLE").length;
  const segmentoSinClasificarEligible = await isSegmentoSinClasificarNotifiable(employeeId, sinClasificarCount);
  await applyClassificationAlerts(employeeId, workShiftId, segments, {
    notifyConceptoNoHabilitado: true,
    persistSegmentoSinClasificar: segmentoSinClasificarEligible,
    notifySegmentoSinClasificar: segmentoSinClasificarEligible,
  });
}

// Etapa 13G (docs/decisions/SHIFT_EXIT_SINGLE_NOTIFICATION_POLICY_13G.md):
// política única de notificación visible para un cierre de salida. Antes de
// esta etapa, SALIDA_TARDIA, JORNADA_EXTENDIDA y CONCEPTO_NO_HABILITADO
// notificaban siempre, sin participar en ninguna cascada de supresión (la de
// la Etapa 13B sólo cubría SALIDA_ANTICIPADA/JORNADA_INSUFICIENTE/
// SEGMENTO_SIN_CLASIFICAR) -- un mismo cierre con, por ejemplo, un concepto
// no habilitado + jornada extendida + salida tardía generaba 3
// notificaciones simultáneas (caso real: legajo 09 "Granja"). Ahora, de
// TODOS los tipos que puede generar un cierre de salida, como máximo uno
// notifica -- el de mayor prioridad según este orden. El resto se sigue
// persistiendo siempre como ShiftAlert (trazabilidad completa en "Alertas de
// Turnos", "no ocultar problemas críticos"), sólo se suprime el AVISO.
const EXIT_ALERT_NOTIFICATION_PRIORITY: readonly ShiftAlertTypeValue[] = [
  // Contradicción real de configuración: el tramo matcheó un concepto que
  // existe, pero el empleado no lo tiene habilitado -- requiere revisión de
  // configuración, no sólo de horario.
  "CONCEPTO_NO_HABILITADO",
  // Superó el máximo configurado/informativo de horas.
  "JORNADA_EXTENDIDA",
  // Salió después del horario/tolerancia, sin llegar a "extendida".
  "SALIDA_TARDIA",
  // Salió antes del horario/tolerancia. Nunca compite realmente contra
  // SALIDA_TARDIA (evaluateExitPunctuality las computa como mutuamente
  // excluyentes sobre el mismo differenceMinutes), pero sí puede coincidir
  // con JORNADA_EXTENDIDA en un caso límite (ingreso muy anticipado + salida
  // antes de horario, con el total igual por encima del máximo).
  "SALIDA_ANTICIPADA",
  // Por debajo del mínimo configurado -- normalmente ya explicada por una
  // salida anticipada, pero puede darse sola (ingreso tardío, salida puntual).
  "JORNADA_INSUFICIENTE",
  // La señal más débil (Etapa 13C/13D) -- último en la prioridad, y sólo
  // llega a "fired" (ver más abajo) si además el empleado tiene algún
  // concepto adicional esperado.
  "SEGMENTO_SIN_CLASIFICAR",
];

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

    const punctuality = evaluateExitPunctuality({ match, startAt: shift.startAt, actualExitAt: actualAt });

    // Etapa 10D: régimen (si tiene extendedShiftAlertMinutes seteado) gana por
    // sobre el umbral del turno para decidir JORNADA_EXTENDIDA — ver
    // evaluateWorkedDuration para la prioridad exacta (Régimen → Turno → Default).
    const regime = await resolveActiveWorkRegime(employeeId, actualAt);
    // Etapa 13E: defensa en profundidad -- un turno GENERAL_UNASSIGNED (ajeno)
    // nunca debe gobernar el mínimo/máximo de esta evaluación, ni siquiera si
    // `shift.shiftTemplateId` quedó apuntando a uno por datos previos a esta
    // etapa (no se hizo backfill de jornadas ya persistidas). El punto de
    // escritura (evaluateShiftEntry, más arriba en este archivo) ya dejó de
    // adoptar un turno ajeno para jornadas nuevas -- este `null` cubre el
    // resto: cualquier jornada vieja que ya tuviera uno, o cualquier camino
    // futuro que vuelva a resolver GENERAL_UNASSIGNED acá. Sin cambios para
    // ENABLED/DISABLED_FOR_EMPLOYEE (evidencia real de una asignación).
    const durationTemplate = match.case === "GENERAL_UNASSIGNED" ? null : match.template;
    const duration = evaluateWorkedDuration({ totalMinutes: shift.totalMinutes ?? 0, template: durationTemplate, regimeMaximumMinutes: regime?.extendedShiftAlertMinutes ?? null });

    const byStatus = (status: ClassifiedSegmentAlertInput["conceptStatus"]) => classifiedSegments.filter((segment) => segment.conceptStatus === status);
    const noHabilitadoCount = byStatus("CONCEPTO_NO_HABILITADO").length;
    const sinClasificarCount = byStatus("SIN_CONCEPTO_COMPATIBLE").length;

    // Etapa 13G: qué tipos "dispararon" para este cierre (independientemente
    // de si van a notificar -- todos los que disparan se persisten siempre,
    // ver los createShiftAlert de abajo).
    const fired: Partial<Record<Exclude<ShiftAlertTypeValue, "SEGMENTO_SIN_CLASIFICAR">, boolean>> = {
      CONCEPTO_NO_HABILITADO: noHabilitadoCount > 0,
      JORNADA_EXTENDIDA: duration.extendedShift,
      SALIDA_TARDIA: punctuality.lateLeave,
      SALIDA_ANTICIPADA: punctuality.earlyLeave,
      JORNADA_INSUFICIENTE: duration.insufficientHours,
    };
    // Etapa 13H.1: a diferencia de las otras 5, SEGMENTO_SIN_CLASIFICAR ya no
    // se persiste incondicionalmente -- "elegible" (isSegmentoSinClasificarNotifiable,
    // Etapa 13D: ¿el empleado tiene algún concepto adicional habilitado?)
    // ahora decide si la ShiftAlert se crea en absoluto, no sólo si notifica.
    // Por eso esta consulta ya no puede diferirse a "sólo si ningún tipo de
    // mayor prioridad ganó" (esa optimización de 13G asumía que la única
    // pregunta pendiente era el aviso; acá también hace falta para decidir
    // la persistencia) -- se resuelve siempre que haya al menos un segmento
    // sin clasificar, una sola vez, nunca por segmento.
    const segmentoSinClasificarEligible = sinClasificarCount > 0 && (await isSegmentoSinClasificarNotifiable(employeeId, sinClasificarCount));
    let notifiableWinner: ShiftAlertTypeValue | null = EXIT_ALERT_NOTIFICATION_PRIORITY.find((type) => type !== "SEGMENTO_SIN_CLASIFICAR" && fired[type]) ?? null;
    if (!notifiableWinner && segmentoSinClasificarEligible) {
      notifiableWinner = "SEGMENTO_SIN_CLASIFICAR";
    }

    if (punctuality.earlyLeave) {
      await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_ANTICIPADA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes, notify: notifiableWinner === "SALIDA_ANTICIPADA" });
    }
    if (punctuality.lateLeave) {
      await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_TARDIA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes, notify: notifiableWinner === "SALIDA_TARDIA" });
    }
    if (duration.insufficientHours) {
      await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_INSUFICIENTE", actualAt, differenceMinutes: shift.totalMinutes, notify: notifiableWinner === "JORNADA_INSUFICIENTE" });
    }
    if (duration.extendedShift) {
      await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_EXTENDIDA", actualAt, differenceMinutes: shift.totalMinutes, notify: notifiableWinner === "JORNADA_EXTENDIDA" });
    }

    if (classifiedSegments.length > 0) {
      await applyClassificationAlerts(employeeId, workShiftId, classifiedSegments, {
        notifyConceptoNoHabilitado: notifiableWinner === "CONCEPTO_NO_HABILITADO",
        persistSegmentoSinClasificar: segmentoSinClasificarEligible,
        notifySegmentoSinClasificar: notifiableWinner === "SEGMENTO_SIN_CLASIFICAR",
      });
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
