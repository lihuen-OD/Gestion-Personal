import { EmployeeStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { argentinaCalendarDate, argentinaDateParts, argentinaDayRange } from "../../shared/datetime/argentinaTime";

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

export async function detectAttendanceInactivity(dateKey: string) {
  const { operationalDate, nextOperationalDate, localStart, localEnd } = ranges(dateKey);
  const candidates = await prisma.employee.findMany({
    where: {
      status: EmployeeStatus.ACTIVO,
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
      observation: `No se registraron fichadas, horas ni novedades para el ${dateKey}. Requiere revisión.`,
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
            message: `${incident.employee.lastName}, ${incident.employee.firstName} · Legajo ${incident.employee.legajo} no registra actividad para el ${dateKey}.`,
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
