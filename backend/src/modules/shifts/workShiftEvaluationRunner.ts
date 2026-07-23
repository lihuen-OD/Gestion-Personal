import { prisma } from "../../shared/prisma/client";
import type { ShiftTemplateLike } from "./shiftTemplateRef.types";
import { attendanceRecipients, notifyUsers } from "../workforce-management/workforce.service";
import {
  evaluateEntryPunctuality,
  evaluateExitPunctuality,
  evaluateRestPeriod,
  evaluateWorkedDuration,
  matchShiftForEmployee,
  type EmployeeShiftAssignmentRef,
  type ShiftMatchResult,
  type ShiftTemplateRef,
} from "./workShiftEvaluation.service";

export type ShiftAlertTypeValue =
  | "INGRESO_TARDE"
  | "SALIDA_ANTICIPADA"
  | "SALIDA_TARDIA"
  | "TURNO_NO_IDENTIFICADO"
  | "SHIFT_NOT_ENABLED_FOR_EMPLOYEE"
  | "POSSIBLE_SHIFT_CONFIGURATION_MISSING"
  | "JORNADA_INSUFICIENTE"
  | "JORNADA_EXTENDIDA"
  | "DESCANSO_INSUFICIENTE"
  | "POSIBLE_OLVIDO_SALIDA";
type ShiftAlertSeverityValue = "INFO" | "ADVERTENCIA" | "CRITICA";

const DEFAULT_MINIMUM_REST_MINUTES = 480;

const severityByAlertType: Record<ShiftAlertTypeValue, ShiftAlertSeverityValue> = {
  INGRESO_TARDE: "ADVERTENCIA",
  SALIDA_ANTICIPADA: "ADVERTENCIA",
  SALIDA_TARDIA: "INFO",
  TURNO_NO_IDENTIFICADO: "ADVERTENCIA",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "ADVERTENCIA",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "INFO",
  JORNADA_INSUFICIENTE: "ADVERTENCIA",
  JORNADA_EXTENDIDA: "INFO",
  DESCANSO_INSUFICIENTE: "ADVERTENCIA",
  POSIBLE_OLVIDO_SALIDA: "ADVERTENCIA",
};

const labelByAlertType: Record<ShiftAlertTypeValue, string> = {
  INGRESO_TARDE: "Ingreso fuera de tolerancia",
  SALIDA_ANTICIPADA: "Salida anticipada",
  SALIDA_TARDIA: "Salida fuera de tolerancia",
  TURNO_NO_IDENTIFICADO: "Turno no identificado",
  SHIFT_NOT_ENABLED_FOR_EMPLOYEE: "Turno no habilitado para el empleado",
  POSSIBLE_SHIFT_CONFIGURATION_MISSING: "Posible falta de configuración de turno",
  JORNADA_INSUFICIENTE: "Jornada por debajo del mínimo",
  JORNADA_EXTENDIDA: "Jornada extendida",
  DESCANSO_INSUFICIENTE: "Descanso insuficiente entre jornadas",
  POSIBLE_OLVIDO_SALIDA: "Posible olvido de salida",
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
  const employeeAssignments: EmployeeShiftAssignmentRef[] = assignments.map((a) => ({ shiftTemplateId: a.shiftTemplateId, status: a.status }));
  const activeTemplates = templates.map(toTemplateRef);
  return { employeeAssignments, activeTemplates };
}

export async function createShiftAlert(input: { employeeId: string; workShiftId: string; type: ShiftAlertTypeValue; scheduledAt?: Date; actualAt: Date; differenceMinutes?: number | null }) {
  const severity = severityByAlertType[input.type];
  const alert = await prisma.shiftAlert.upsert({
    where: { workShiftId_type: { workShiftId: input.workShiftId, type: input.type } },
    create: { employeeId: input.employeeId, workShiftId: input.workShiftId, type: input.type, severity, scheduledAt: input.scheduledAt, actualAt: input.actualAt, differenceMinutes: input.differenceMinutes ?? undefined },
    update: { actualAt: input.actualAt, scheduledAt: input.scheduledAt, differenceMinutes: input.differenceMinutes ?? undefined, severity, status: "PENDIENTE" },
  });
  await notifyUsers(await attendanceRecipients(input.employeeId), {
    type: "ALERTA_FICHADA",
    title: labelByAlertType[input.type],
    message: "La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente.",
    entityType: "ShiftAlert",
    entityId: alert.id,
    link: "/asistencia",
    priority: "ALTA",
  });
  return alert;
}

function alertTypeForMatch(match: ShiftMatchResult): ShiftAlertTypeValue | null {
  if (match.case === "DISABLED_FOR_EMPLOYEE") return "SHIFT_NOT_ENABLED_FOR_EMPLOYEE";
  if (match.case === "GENERAL_UNASSIGNED") return "POSSIBLE_SHIFT_CONFIGURATION_MISSING";
  if (match.case === "NO_MATCH") return "TURNO_NO_IDENTIFICADO";
  return null;
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
  if (configurationAlertType) {
    await createShiftAlert({ employeeId, workShiftId, type: configurationAlertType, actualAt, differenceMinutes: match.differenceMinutes });
  }

  const punctuality = evaluateEntryPunctuality(match);
  if (punctuality.evaluated && punctuality.lateArrival) {
    await createShiftAlert({ employeeId, workShiftId, type: "INGRESO_TARDE", actualAt, differenceMinutes: punctuality.differenceMinutes });
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

export async function evaluateShiftExit(employeeId: string, workShiftId: string, actualAt: Date) {
  const shift = await prisma.workShift.findUnique({ where: { id: workShiftId } });
  if (!shift) return;
  const match = await resolveMatchForExit(employeeId, shift.shiftTemplateId);

  const punctuality = evaluateExitPunctuality({ match, startAt: shift.startAt, actualExitAt: actualAt });
  if (punctuality.evaluated) {
    if (punctuality.earlyLeave) {
      await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_ANTICIPADA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes });
    }
    if (punctuality.lateLeave) {
      await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_TARDIA", actualAt, scheduledAt: punctuality.scheduledExitAt ?? undefined, differenceMinutes: punctuality.differenceMinutes });
    }
  }

  const duration = evaluateWorkedDuration({ totalMinutes: shift.totalMinutes ?? 0, template: match.template });
  if (duration.insufficientHours) {
    await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_INSUFICIENTE", actualAt, differenceMinutes: shift.totalMinutes });
  }
  if (duration.extendedShift) {
    await createShiftAlert({ employeeId, workShiftId, type: "JORNADA_EXTENDIDA", actualAt, differenceMinutes: shift.totalMinutes });
  }
}
