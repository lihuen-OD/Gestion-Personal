import { EmployeeStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, argentinaDateParts, argentinaDayRange } from "../../shared/datetime/argentinaTime";
import { workforceService } from "../workforce-management/workforce.service";

export function previousOperationalDateKey(value = new Date()) {
  const { year, month, day } = argentinaDateParts(value);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function isInactivityCheckDue(value: Date, hour: number, minute: number) {
  const local = argentinaDateParts(value);
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}

function ranges(dateKey: string) {
  const operationalDate = argentinaCalendarDate(dateKey);
  const nextOperationalDate = new Date(operationalDate.getTime() + 24 * 60 * 60 * 1000);
  const { startAt: localStart, endAt: localEnd } = argentinaDayRange(dateKey);
  return { operationalDate, nextOperationalDate, localStart, localEnd };
}

// Etapa 12E: en una fecha feriado (DoubleHourRule.kind=FERIADO — nunca por
// nombre de regla), "Sin actividad registrada" sólo tiene sentido para
// quien tenía una expectativa real de trabajar. Esa expectativa la define
// HolidayWorkAssignment (Etapa 12D), nunca "tener turno" ni "estar activo"
// por sí solos. Reutiliza workforceService.holidayDatesInRange (que a su
// vez reutiliza calendarPreview, Etapa 12B) — nunca reimplementa el cálculo
// de calendario ni resuelve el scope (empresa/sector/…) de la regla que
// originó el feriado: "es feriado" queda V1 global por fecha (ver
// docs/decisions/HOLIDAY_INACTIVITY_NOTIFICATIONS_12E.md §6 para la
// limitación documentada) — el scope real de "quién debía trabajar" ya lo
// resuelve HolidayWorkAssignment, que es una decisión explícita de RRHH
// por persona.
export async function detectAttendanceInactivity(dateKey: string) {
  const { operationalDate, nextOperationalDate, localStart, localEnd } = ranges(dateKey);
  // Un único query de calendario + un único query de asignaciones (ambos
  // acotados a esta fecha exacta, nunca un rango ni un loop por empleado) —
  // ver Parte 9 del pedido. `isHoliday` se calcula una sola vez para toda
  // la corrida: todo lo que sigue (candidatos, incidentes, notificaciones)
  // queda scopeado a esta misma `operationalDate`.
  const holidayDays = await workforceService.holidayDatesInRange(operationalDate, operationalDate);
  const isHoliday = holidayDays.length > 0;
  let convokedEmployeeIds: string[] | null = null;
  if (isHoliday) {
    const assignments = await prisma.holidayWorkAssignment.findMany({ where: { date: operationalDate, status: "ACTIVA" }, select: { employeeId: true } });
    convokedEmployeeIds = assignments.map((item) => item.employeeId);
    // Nadie convocado ese feriado: cero candidatos posibles, sin excepción.
    // Cortar acá es sólo claridad — un `id: { in: [] }` abajo resolvería
    // exactamente lo mismo (Prisma lo interpreta como "ningún resultado").
    if (!convokedEmployeeIds.length) return { date: dateKey, detected: 0, notified: 0 };
  }
  const candidates = await prisma.employee.findMany({
    where: {
      status: EmployeeStatus.ACTIVO,
      // Etapa 12E: en feriado, sólo evaluar a quien tenía una convocatoria
      // ACTIVA para esta fecha exacta — una asignación CANCELADA no cuenta
      // (nunca aparece en `convokedEmployeeIds`, ver arriba). En día normal
      // (convokedEmployeeIds === null) no se agrega ningún filtro nuevo —
      // comportamiento idéntico al de antes de esta etapa.
      ...(convokedEmployeeIds ? { id: { in: convokedEmployeeIds } } : {}),
      attendancePunches: { none: { timestamp: { gte: localStart, lt: localEnd } } },
      workShifts: { none: { startAt: { gte: localStart, lt: localEnd } } },
      timeEntries: { none: { date: { gte: operationalDate, lt: nextOperationalDate } } },
      novelties: {
        none: {
          status: { not: "RECHAZADO" },
          fromDate: { lte: operationalDate },
          OR: [
            { toDate: { gte: operationalDate } },
            { toDate: null, noveltyType: { allowsDateTo: true } },
            { toDate: null, noveltyType: { allowsDateTo: false }, fromDate: operationalDate },
          ],
        },
      },
    },
    select: {
      id: true,
      legajo: true,
      firstName: true,
      lastName: true,
      assignments: {
        where: {
          type: "TIME_RESPONSIBLE",
          userId: { not: null },
          OR: [{ status: null }, { status: { in: ["ACTIVO", "Activo"] } }],
        },
        select: { userId: true },
      },
    },
  });

  if (!candidates.length) return { date: dateKey, detected: 0, notified: 0 };

  await prisma.attendanceInactivityIncident.createMany({
    data: candidates.map((employee) => ({
      employeeId: employee.id,
      operationalDate,
      observation: isHoliday
        ? `La persona estaba convocada a trabajar el feriado del ${dateKey} y no se registraron fichadas, horas ni novedades. Requiere revisión.`
        : `No se registraron fichadas, horas ni novedades para el ${dateKey}. Requiere revisión.`,
    })),
    skipDuplicates: true,
  });

  const pendingNotification = await prisma.attendanceInactivityIncident.findMany({
    where: { operationalDate, notifiedAt: null },
    include: {
      employee: {
        select: {
          id: true,
          legajo: true,
          firstName: true,
          lastName: true,
          assignments: {
            where: { type: "TIME_RESPONSIBLE", userId: { not: null }, OR: [{ status: null }, { status: { in: ["ACTIVO", "Activo"] } }] },
            select: { userId: true },
          },
        },
      },
    },
  });
  const rrhh = await prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  let notified = 0;

  for (const incident of pendingNotification) {
    const recipients = Array.from(new Set([
      ...rrhh.map((user) => user.id),
      ...incident.employee.assignments.flatMap((assignment) => assignment.userId ? [assignment.userId] : []),
    ]));
    await prisma.$transaction(async (tx) => {
      if (recipients.length) {
        await tx.systemNotification.createMany({
          data: recipients.map((recipientUserId) => ({
            recipientUserId,
            type: "SIN_ACTIVIDAD_REGISTRADA",
            priority: "ALTA",
            title: "Sin actividad registrada",
            message: isHoliday
              ? `${incident.employee.lastName}, ${incident.employee.firstName} · Legajo ${incident.employee.legajo} estaba convocado a trabajar el feriado del ${dateKey} y no registra actividad.`
              : `${incident.employee.lastName}, ${incident.employee.firstName} · Legajo ${incident.employee.legajo} no registra actividad para el ${dateKey}.`,
            entityType: "AttendanceInactivityIncident",
            entityId: incident.id,
            link: `/asistencia?observationDate=${dateKey}`,
          })),
        });
      }
      await tx.attendanceInactivityIncident.update({ where: { id: incident.id }, data: { notifiedAt: new Date() } });
    });
    notified += recipients.length;
  }

  return { date: dateKey, detected: candidates.length, notified };
}
