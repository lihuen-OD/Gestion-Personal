import { EmployeeStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

const argentinaTimeZone = "America/Argentina/Cordoba";

function localParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: argentinaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

export function previousOperationalDateKey(value = new Date()) {
  const { year, month, day } = localParts(value);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function isInactivityCheckDue(value: Date, hour: number, minute: number) {
  const local = localParts(value);
  return local.hour > hour || (local.hour === hour && local.minute >= minute);
}

function ranges(dateKey: string) {
  const operationalDate = new Date(`${dateKey}T00:00:00.000Z`);
  const nextOperationalDate = new Date(operationalDate.getTime() + 24 * 60 * 60 * 1000);
  const localStart = new Date(`${dateKey}T00:00:00.000-03:00`);
  const localEnd = new Date(localStart.getTime() + 24 * 60 * 60 * 1000);
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
