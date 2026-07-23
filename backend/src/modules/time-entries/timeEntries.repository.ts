import { ApprovalStatus, EmployeeStatus, Prisma, WorkShiftSource, WorkShiftStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { noveltyCoversDay } from "../novelties/novelties.dateRange";
import type { CreateTimeEntryInput, ListTimeEntriesQuery, TimeEntriesExportQuery, TimeEntriesPeriodEmployeesQuery, UpdateTimeEntryInput } from "./timeEntries.schemas";

function periodRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

const timeEntryInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, firstName: true, lastName: true, status: true } },
  hourConcept: true,
} satisfies Prisma.TimeEntryInclude;

const periodEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  sector: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  companies: { select: { isPrimary: true, company: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.EmployeeSelect;

const statusPriority = ["DEVUELTO", "EN_REVISION", "RECHAZADO", "PENDIENTE", "BORRADOR", "APROBADO", "CERRADO"] as const;
const editableStatuses: ApprovalStatus[] = [ApprovalStatus.BORRADOR, ApprovalStatus.PENDIENTE, ApprovalStatus.DEVUELTO, ApprovalStatus.RECHAZADO];

type PunchEvidenceInput = {
  photoUrl?: string | null;
  photoStoragePath?: string | null;
  photoFileId?: string | null;
  thumbnailFileId?: string | null;
  faceDetected?: boolean;
  faceValidationStatus?: "VALID" | "NO_FACE" | "MULTIPLE_FACES" | "LOW_LIGHT" | "FACE_TOO_SMALL" | "CAMERA_ERROR" | null;
  faceDetectionScore?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  rawPayload?: Prisma.InputJsonValue;
};

function punchEvidenceData(evidence?: PunchEvidenceInput) {
  if (!evidence) return {};
  return {
    photoUrl: evidence.photoUrl || null,
    photoStoragePath: evidence.photoStoragePath || null,
    photoFileId: evidence.photoFileId || null,
    thumbnailFileId: evidence.thumbnailFileId || null,
    faceDetected: Boolean(evidence.faceDetected),
    faceValidationStatus: evidence.faceValidationStatus || null,
    faceDetectionScore: evidence.faceDetectionScore ?? null,
    ipAddress: evidence.ipAddress || null,
    userAgent: evidence.userAgent || null,
    rawPayload: evidence.rawPayload,
  };
}

function periodFromDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function dayFromDate(date: Date) {
  return date.getUTCDate();
}

function minutesFromHours(hours: number) {
  return Math.round(hours * 60);
}

function employeeSearchWhere(search?: string): Prisma.EmployeeWhereInput {
  const trimmed = search?.trim();
  if (!trimmed) return {};
  return {
    OR: [
      { legajo: { contains: trimmed, mode: "insensitive" } },
      { legajoFinnegans: { contains: trimmed, mode: "insensitive" } },
      { cuil: { contains: trimmed, mode: "insensitive" } },
      { dni: { contains: trimmed, mode: "insensitive" } },
      { firstName: { contains: trimmed, mode: "insensitive" } },
      { lastName: { contains: trimmed, mode: "insensitive" } },
    ],
  };
}

function buildWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.TimeEntryWhereInput {
  return {
    employee: {
      AND: [
        employeeAccessWhere,
        {
          ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
          ...employeeSearchWhere(query.search),
        },
      ],
    },
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.hourConceptId ? { hourConceptId: query.hourConceptId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.period ? { period: query.period } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
}

function buildReviewByEmployeeWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  return {
    AND: [
      employeeAccessWhere,
      {
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...employeeSearchWhere(query.search),
        timeEntries: {
          some: {
            ...(query.status ? { status: query.status } : {}),
            ...(query.period ? { period: query.period } : {}),
          },
        },
      },
    ],
  };
}

async function findManyByEmployeeGrouped(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
  const employeeWhere = buildReviewByEmployeeWhere(query, employeeAccessWhere);
  const skip = (query.page - 1) * query.take;

  return prisma.$transaction(async (tx) => {
    const [employees, total] = await Promise.all([
      tx.employee.findMany({
        where: employeeWhere,
        select: periodEmployeeSelect,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      tx.employee.count({ where: employeeWhere }),
    ]);

    const employeeIds = employees.map((employee) => employee.id);
    const entries = employeeIds.length
      ? await tx.timeEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            ...(query.status ? { status: query.status } : {}),
            ...(query.period ? { period: query.period } : {}),
          },
          select: { employeeId: true, hours: true },
        })
      : [];

    const totalHoursByEmployee = new Map<string, number>();
    for (const entry of entries) {
      totalHoursByEmployee.set(entry.employeeId, (totalHoursByEmployee.get(entry.employeeId) || 0) + Number(entry.hours.toString()));
    }

    const items = employees.map((employee) => ({
      employee,
      summary: {
        total: totalHoursByEmployee.get(employee.id) || 0,
        status: query.status || ApprovalStatus.EN_REVISION,
      },
    }));

    return [items, total] as const;
  });
}

function buildPeriodEmployeeWhere(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  return {
    AND: [
      employeeAccessWhere,
      {
        status: EmployeeStatus.ACTIVO,
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...employeeSearchWhere(query.search),
      },
    ],
  };
}

function resolvePeriodStatus(statuses: string[]) {
  return statusPriority.find((status) => statuses.includes(status)) || "PENDIENTE";
}

export const timeEntriesRepository = {
  createClockPunchAttempt(input: { requestId: string; employeeId: string; punchType: "INGRESO" | "SALIDA"; requestHash: string }) {
    return prisma.clockPunchAttempt.create({ data: input });
  },

  findClockPunchAttempt(requestId: string) {
    return prisma.clockPunchAttempt.findUnique({ where: { requestId } });
  },

  completeClockPunchAttempt(requestId: string, response: Prisma.InputJsonValue) {
    return prisma.clockPunchAttempt.update({
      where: { requestId },
      data: { status: "COMPLETED", response, completedAt: new Date(), errorCode: null, errorMessage: null, httpStatus: 200 },
    });
  },

  failClockPunchAttempt(requestId: string, error: { code: string; message: string; httpStatus: number }) {
    return prisma.clockPunchAttempt.update({
      where: { requestId },
      data: { status: "FAILED", errorCode: error.code, errorMessage: error.message, httpStatus: error.httpStatus, completedAt: new Date() },
    });
  },

  expireClockPunchAttempts(processingBefore: Date) {
    return prisma.clockPunchAttempt.updateMany({
      where: { status: "PROCESSING", startedAt: { lt: processingBefore } },
      data: {
        status: "FAILED",
        errorCode: "CLOCK_ATTEMPT_TIMEOUT",
        errorMessage: "La fichada excedió el tiempo máximo de procesamiento.",
        httpStatus: 503,
        completedAt: new Date(),
      },
    });
  },

  deleteClockPunchAttempts(completedBefore: Date) {
    return prisma.clockPunchAttempt.deleteMany({
      where: { status: { in: ["COMPLETED", "FAILED"] }, completedAt: { lt: completedBefore } },
    });
  },

  findMany(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    if (query.view === "byEmployee") return findManyByEmployeeGrouped(query, employeeAccessWhere);
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.timeEntry.findMany({
        where,
        include: timeEntryInclude,
        orderBy: [{ date: "desc" }, { employee: { lastName: "asc" } }],
        skip,
        take: query.take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
  },

  async summary(period: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const countableStatuses = [ApprovalStatus.APROBADO, ApprovalStatus.EN_REVISION];
    const [activeEmployees, employeesWithEntries, pendingEmployees, reviewEmployeeGroups, hoursResult] = await prisma.$transaction([
      prisma.employee.count({
        where: { ...employeeAccessWhere, status: EmployeeStatus.ACTIVO },
      }),
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: {
            some: {
              period,
              status: { in: countableStatuses },
            },
          },
        },
      }),
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: {
            none: {
              period,
              status: { in: countableStatuses },
            },
          },
        },
      }),
      prisma.timeEntry.groupBy({
        by: ["employeeId"],
        orderBy: { employeeId: "asc" },
        where: {
          period,
          employee: employeeAccessWhere,
          status: ApprovalStatus.EN_REVISION,
        },
      }),
      prisma.timeEntry.aggregate({
        where: {
          period,
          employee: employeeAccessWhere,
          status: { in: countableStatuses },
        },
        _sum: { hours: true },
      }),
    ]);

    const countableHours = Number(hoursResult._sum.hours?.toString() || 0);

    return {
      activeEmployees,
      employeesWithEntries,
      pendingEmployees,
      reviewEmployees: reviewEmployeeGroups.length,
      countableHours,
      coverage: activeEmployees ? Math.round((employeesWithEntries / activeEmployees) * 100) : 0,
    };
  },

  async homeCounts(period: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const [sinCargar, devueltos, enRevision] = await prisma.$transaction([
      prisma.employee.count({
        where: {
          ...employeeAccessWhere,
          status: EmployeeStatus.ACTIVO,
          timeEntries: { none: { period } },
        },
      }),
      prisma.timeEntry.count({
        where: { period, employee: employeeAccessWhere, status: ApprovalStatus.DEVUELTO },
      }),
      prisma.timeEntry.count({
        where: { period, employee: employeeAccessWhere, status: ApprovalStatus.EN_REVISION },
      }),
    ]);

    return { sinCargar, devueltos, enRevision };
  },

  pendingNoveltiesCount(employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.novelty.count({
      where: {
        employee: employeeAccessWhere,
        status: { in: [ApprovalStatus.PENDIENTE, ApprovalStatus.EN_REVISION] },
      },
    });
  },

  async attendanceObservedCount(input: { startAt: Date; endAt: Date; employeeAccessWhere: Prisma.EmployeeWhereInput }) {
    const operationalDate = new Date(input.startAt.toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Cordoba" }) + "T00:00:00.000Z");
    const [observedShifts, observedPunches, inactivityIncidents] = await prisma.$transaction([
      prisma.workShift.count({
        where: {
          employee: input.employeeAccessWhere,
          startAt: { lt: input.endAt },
          OR: [{ endAt: null }, { endAt: { gte: input.startAt } }],
          status: { in: [WorkShiftStatus.OBSERVADO, WorkShiftStatus.FALTA_SALIDA, WorkShiftStatus.FALTA_INGRESO, WorkShiftStatus.INVALIDO] },
          reviewStatus: "PENDIENTE",
        },
      }),
      prisma.attendancePunch.count({
        where: {
          employee: input.employeeAccessWhere,
          status: "OBSERVADA",
          reviewStatus: "PENDIENTE",
          startWorkShifts: { none: {} },
          endWorkShifts: { none: {} },
          timestamp: { gte: input.startAt, lt: input.endAt },
        },
      }),
      prisma.attendanceInactivityIncident.count({
        where: { employee: input.employeeAccessWhere, operationalDate, status: "PENDIENTE" },
      }),
    ]);

    return observedShifts + observedPunches + inactivityIncidents;
  },

  async findPeriodEmployees(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildPeriodEmployeeWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    const { start, end } = periodRange(query.period);

    return prisma.$transaction(async (tx) => {
      const [employees, total] = await Promise.all([
        tx.employee.findMany({
          where,
          select: periodEmployeeSelect,
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          skip,
          take: query.take,
        }),
        tx.employee.count({ where }),
      ]);

      const employeeIds = employees.map((employee) => employee.id);
      const [entries, novelties] = await Promise.all([
        employeeIds.length
          ? tx.timeEntry.findMany({
              where: {
                period: query.period,
                employeeId: { in: employeeIds },
              },
              select: {
                employeeId: true,
                day: true,
                hours: true,
                status: true,
                hourConcept: { select: { kind: true } },
                workShift: { select: { status: true } },
              },
            })
          : Promise.resolve([]),
        employeeIds.length
          ? tx.novelty.findMany({
              where: {
                employeeId: { in: employeeIds },
                status: { not: "RECHAZADO" },
                fromDate: { lt: end },
                OR: [{ toDate: null }, { toDate: { gte: start } }],
              },
              select: {
                employeeId: true,
                fromDate: true,
                toDate: true,
                noveltyType: { select: { name: true, allowsDateTo: true } },
              },
            })
          : Promise.resolve([]),
      ]);

      const grouped = new Map<string, { total: number; normal: number; special: number; incidents: number; statuses: string[] }>();
      const dailyGrouped = new Map<string, Map<number, { normal: number; special: number; total: number }>>();
      for (const entry of entries) {
        const current = grouped.get(entry.employeeId) || { total: 0, normal: 0, special: 0, incidents: 0, statuses: [] };
        if (entry.status === ApprovalStatus.APROBADO || entry.status === ApprovalStatus.EN_REVISION) {
          const hours = Number(entry.hours.toString());
          current.total += hours;
          if (entry.hourConcept.kind === "NORMAL") current.normal += hours;
          else current.special += hours;

          const dayMap = dailyGrouped.get(entry.employeeId) || new Map<number, { normal: number; special: number; total: number }>();
          const dayCurrent = dayMap.get(entry.day) || { normal: 0, special: 0, total: 0 };
          dayCurrent.total += hours;
          if (entry.hourConcept.kind === "NORMAL") dayCurrent.normal += hours;
          else dayCurrent.special += hours;
          dayMap.set(entry.day, dayCurrent);
          dailyGrouped.set(entry.employeeId, dayMap);
        }
        if (entry.workShift && ["FALTA_SALIDA", "FALTA_INGRESO", "OBSERVADO", "INVALIDO"].includes(entry.workShift.status)) current.incidents += 1;
        current.statuses.push(entry.status);
        grouped.set(entry.employeeId, current);
      }

      const noveltiesByEmployee = new Map<string, typeof novelties>();
      for (const novelty of novelties) {
        const list = noveltiesByEmployee.get(novelty.employeeId) || [];
        list.push(novelty);
        noveltiesByEmployee.set(novelty.employeeId, list);
      }
      const dayCount = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();

      return {
        items: employees.map((employee) => {
          const summary = grouped.get(employee.id);
          const dayMap = dailyGrouped.get(employee.id);
          const employeeNovelties = noveltiesByEmployee.get(employee.id) || [];
          const dailyBreakdown: Array<{ day: number; normal: number; special: number; total: number; novelty: { label: string } | null }> = [];
          for (let day = 1; day <= dayCount; day++) {
            const dayDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
            const hours = dayMap?.get(day);
            const coveringNovelties = employeeNovelties.filter((novelty) => noveltyCoversDay(novelty, novelty.noveltyType, dayDate));
            if (!hours && !coveringNovelties.length) continue;
            dailyBreakdown.push({
              day,
              normal: hours?.normal || 0,
              special: hours?.special || 0,
              total: hours?.total || 0,
              novelty: coveringNovelties.length ? { label: coveringNovelties.map((novelty) => novelty.noveltyType.name).join(", ") } : null,
            });
          }
          return {
            employee,
            summary: {
              total: summary?.total || 0,
              normal: summary?.normal || 0,
              special: summary?.special || 0,
              incidents: summary?.incidents || 0,
              status: resolvePeriodStatus(summary?.statuses || []),
              dailyBreakdown,
            },
          };
        }),
        total,
      };
    }, { timeout: 15_000 });
  },

  findForExport(query: TimeEntriesExportQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.timeEntry.findMany({
      where: {
        employee: employeeAccessWhere,
        period: query.period,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        status: query.includeInReview ? { in: ["APROBADO", "EN_REVISION"] } : "APROBADO",
      },
      include: {
        employee: {
          include: {
            costCenter: true,
            companies: { include: { company: true }, orderBy: { isPrimary: "desc" } },
          },
        },
        hourConcept: true,
      },
      orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { date: "asc" }],
      take: 5000,
    });
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.timeEntry.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: timeEntryInclude,
    });
  },

  attendanceSummary(input: { startAt: Date; endAt: Date; employeeAccessWhere: Prisma.EmployeeWhereInput }) {
    const employeeSelect = {
      id: true,
      legajo: true,
      dni: true,
      firstName: true,
      lastName: true,
      status: true,
      sector: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, name: true, code: true } },
    } satisfies Prisma.EmployeeSelect;

    return prisma.$transaction(async (tx) => {
      const [workShifts, observedPunches] = await Promise.all([
        tx.workShift.findMany({
          where: {
            employee: input.employeeAccessWhere,
            startAt: { lt: input.endAt },
            OR: [{ endAt: null }, { endAt: { gte: input.startAt } }],
          },
          select: {
            id: true,
            employeeId: true,
            source: true,
            status: true,
            startAt: true,
            endAt: true,
            totalMinutes: true,
            crossesMidnight: true,
            observation: true,
            reviewStatus: true,
            shiftTemplateId: true,
            shiftTemplate: {
              select: {
                id: true,
                code: true,
                name: true,
                startTime: true,
                endTime: true,
                crossesMidnight: true,
                entryToleranceBeforeMinutes: true,
                entryToleranceAfterMinutes: true,
                exitToleranceBeforeMinutes: true,
                exitToleranceAfterMinutes: true,
                minimumMinutesForCompliance: true,
                maximumInformativeMinutes: true,
                missingOutAlertAfterMinutes: true,
                absoluteOpenShiftLimitMinutes: true,
              },
            },
            employee: { select: employeeSelect },
            startPunch: {
              select: {
                id: true,
                timestamp: true,
                source: true,
                status: true,
                observation: true,
                photoStoragePath: true,
                photoFileId: true,
                thumbnailFileId: true,
                photoUrl: true,
                faceDetected: true,
                faceValidationStatus: true,
                faceDetectionScore: true,
              },
            },
            endPunch: {
              select: {
                id: true,
                timestamp: true,
                source: true,
                status: true,
                observation: true,
                photoStoragePath: true,
                photoFileId: true,
                thumbnailFileId: true,
                photoUrl: true,
                faceDetected: true,
                faceValidationStatus: true,
                faceDetectionScore: true,
              },
            },
            timeSegments: {
              select: {
                id: true,
                date: true,
                fromDateTime: true,
                toDateTime: true,
                minutes: true,
                hourConceptName: true,
                isHoliday: true,
                isNight: true,
                isSpecial: true,
                observation: true,
              },
              orderBy: { fromDateTime: "asc" },
            },
            timeEntries: {
              select: {
                id: true,
                date: true,
                hours: true,
                totalMinutes: true,
                status: true,
                observation: true,
                hourConcept: { select: { id: true, name: true, kind: true } },
              },
              orderBy: { date: "asc" },
            },
          },
          orderBy: [{ status: "asc" }, { startAt: "desc" }],
        }),
        tx.attendancePunch.findMany({
          where: {
            employee: input.employeeAccessWhere,
            status: "OBSERVADA",
            reviewStatus: "PENDIENTE",
            startWorkShifts: { none: {} },
            endWorkShifts: { none: {} },
            timestamp: { gte: input.startAt, lt: input.endAt },
          },
          select: {
            id: true,
            employeeId: true,
            type: true,
            timestamp: true,
            source: true,
            status: true,
            observation: true,
            photoStoragePath: true,
            photoFileId: true,
            thumbnailFileId: true,
            photoUrl: true,
            faceDetected: true,
            faceValidationStatus: true,
            faceDetectionScore: true,
            employee: { select: employeeSelect },
          },
          orderBy: { timestamp: "desc" },
        }),
      ]);

      return { workShifts, observedPunches };
    });
  },

  async attendanceObservations(input: {
    startAt?: Date;
    endAt?: Date;
    before?: Date;
    search?: string;
    operationalDate?: Date;
    type: "ALL" | "SHIFT" | "PUNCH" | "INACTIVITY";
    reviewStatus: "PENDIENTE" | "RESUELTA" | "DESCARTADA" | "ALL";
    take: number;
    employeeAccessWhere: Prisma.EmployeeWhereInput;
  }) {
    const employeeWhere: Prisma.EmployeeWhereInput = {
      AND: [
        input.employeeAccessWhere,
        ...(input.search ? [{ OR: [
          { firstName: { contains: input.search, mode: "insensitive" as const } },
          { lastName: { contains: input.search, mode: "insensitive" as const } },
          { legajo: { contains: input.search, mode: "insensitive" as const } },
          { dni: { contains: input.search, mode: "insensitive" as const } },
          { sector: { name: { contains: input.search, mode: "insensitive" as const } } },
        ] }] : []),
      ],
    };
    const reviewWhere = input.reviewStatus === "ALL" ? {} : { reviewStatus: input.reviewStatus };
    const employeeSelect = {
      id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true,
      sector: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, name: true, code: true } },
    } satisfies Prisma.EmployeeSelect;
    const shiftTotalWhere: Prisma.WorkShiftWhereInput = {
      employee: employeeWhere,
      status: { in: ["OBSERVADO", "FALTA_SALIDA", "FALTA_INGRESO", "INVALIDO"] },
      ...reviewWhere,
      ...(input.startAt && input.endAt ? { startAt: { gte: input.startAt, lt: input.endAt } } : {}),
    };
    const shiftWhere: Prisma.WorkShiftWhereInput = {
      ...shiftTotalWhere,
      ...(input.before ? { startAt: { ...(input.startAt ? { gte: input.startAt } : {}), lt: input.before } } : {}),
    };
    const punchTotalWhere: Prisma.AttendancePunchWhereInput = {
      employee: employeeWhere,
      status: { in: ["OBSERVADA", "RECHAZADA"] },
      startWorkShifts: { none: {} },
      endWorkShifts: { none: {} },
      ...reviewWhere,
      ...(input.startAt && input.endAt ? { timestamp: { gte: input.startAt, lt: input.endAt } } : {}),
    };
    const punchWhere: Prisma.AttendancePunchWhereInput = {
      ...punchTotalWhere,
      ...(input.before ? { timestamp: { ...(input.startAt ? { gte: input.startAt } : {}), lt: input.before } } : {}),
    };
    const includeShifts = input.type !== "PUNCH";
    const includePunches = input.type !== "SHIFT" && input.type !== "INACTIVITY";
    const includeActualShifts = includeShifts && input.type !== "INACTIVITY";
    const includeInactivity = input.type === "ALL" || input.type === "INACTIVITY";
    const inactivityWhere: Prisma.AttendanceInactivityIncidentWhereInput = {
      employee: employeeWhere,
      ...(input.reviewStatus === "ALL" ? {} : { status: input.reviewStatus }),
      ...(input.operationalDate ? { operationalDate: input.operationalDate } : {}),
      ...(input.before ? { detectedAt: { lt: input.before } } : {}),
    };
    const inactivityTotalWhere = { ...inactivityWhere, ...(input.before ? { detectedAt: undefined } : {}) };
    const [shifts, punches, inactivity, shiftTotal, punchTotal, inactivityTotal] = await prisma.$transaction([
      includeActualShifts ? prisma.workShift.findMany({
        where: shiftWhere,
        include: {
          employee: { select: employeeSelect },
          startPunch: true,
          endPunch: true,
          timeSegments: { orderBy: { fromDateTime: "asc" } },
          timeEntries: { include: { hourConcept: true }, orderBy: { date: "asc" } },
        },
        orderBy: [{ startAt: "desc" }, { id: "desc" }],
        take: input.take + 1,
      }) : prisma.workShift.findMany({ where: { id: "__none__" } }),
      includePunches ? prisma.attendancePunch.findMany({
        where: punchWhere,
        include: { employee: { select: employeeSelect } },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: input.take + 1,
      }) : prisma.attendancePunch.findMany({ where: { id: "__none__" } }),
      includeInactivity ? prisma.attendanceInactivityIncident.findMany({
        where: inactivityWhere,
        include: { employee: { select: employeeSelect } },
        orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
        take: input.take + 1,
      }) : prisma.attendanceInactivityIncident.findMany({ where: { id: "__none__" } }),
      prisma.workShift.count({ where: includeActualShifts ? shiftTotalWhere : { id: "__none__" } }),
      prisma.attendancePunch.count({ where: includePunches ? punchTotalWhere : { id: "__none__" } }),
      prisma.attendanceInactivityIncident.count({ where: includeInactivity ? inactivityTotalWhere : { id: "__none__" } }),
    ]);
    const items = [
      ...shifts.map((shift) => ({ kind: "SHIFT" as const, occurredAt: shift.startAt, shift })),
      ...punches.map((punch) => ({ kind: "PUNCH" as const, occurredAt: punch.timestamp, punch })),
      ...inactivity.map((incident) => ({ kind: "INACTIVITY" as const, occurredAt: incident.detectedAt, incident })),
    ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, input.take);
    return {
      items,
      total: shiftTotal + punchTotal + inactivityTotal,
      hasMore: shifts.length + punches.length + inactivity.length > items.length,
      nextBefore: items.length ? items[items.length - 1]!.occurredAt : null,
    };
  },

  resolveAttendanceObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, resolution: "RESUELTA" | "DESCARTADA", reason: string, userId: string) {
    const data = { reviewStatus: resolution, reviewNote: reason, reviewedAt: new Date(), reviewedByUserId: userId };
    if (kind === "SHIFT") return prisma.workShift.update({ where: { id }, data });
    if (kind === "PUNCH") return prisma.attendancePunch.update({ where: { id }, data });
    return prisma.attendanceInactivityIncident.update({ where: { id }, data: { status: resolution, reviewNote: reason, reviewedAt: new Date(), reviewedByUserId: userId } });
  },

  findAttendanceObservation(kind: "SHIFT" | "PUNCH" | "INACTIVITY", id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    if (kind === "SHIFT") return prisma.workShift.findFirst({ where: { id, employee: employeeAccessWhere } });
    if (kind === "PUNCH") return prisma.attendancePunch.findFirst({ where: { id, employee: employeeAccessWhere } });
    return prisma.attendanceInactivityIncident.findFirst({ where: { id, employee: employeeAccessWhere } });
  },

  findWorkShiftForAdmin(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.workShift.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: {
        employee: { select: { id: true, legajo: true, dni: true, firstName: true, lastName: true, status: true } },
        timeEntries: { select: { id: true, status: true } },
      },
    });
  },

  findAttendancePunchEvidence(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.attendancePunch.findFirst({
      where: { id, employee: employeeAccessWhere },
      select: {
        id: true,
        employeeId: true,
        type: true,
        timestamp: true,
        source: true,
        photoUrl: true,
        photoStoragePath: true,
        photoFileId: true,
        thumbnailFileId: true,
        photoFile: { select: { id: true, storageKey: true, mimeType: true, driveWebViewLink: true } },
        employee: { select: { legajo: true, firstName: true, lastName: true } },
      },
    });
  },

  observeWorkShift(id: string, reason: string) {
    return prisma.workShift.update({
      where: { id },
      data: {
        status: "OBSERVADO",
        observation: reason,
      },
      include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } },
    });
  },

  markMissingOut(id: string, reason: string) {
    return prisma.workShift.update({
      where: { id },
      data: {
        status: "FALTA_SALIDA",
        observation: reason,
      },
      include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } },
    });
  },

  findEmployeeForShift(input: { employeeId?: string; dni?: string }, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findFirst({
      where: {
        AND: [
          employeeAccessWhere,
          input.employeeId ? { id: input.employeeId } : { dni: input.dni },
        ],
      },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  },

  findEmployeeByDniForClock(dni: string) {
    return prisma.employee.findFirst({
      where: { dni },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  },

  searchEmployeesForClock(search: string) {
    const words = search.split(/\s+/).filter(Boolean);
    return prisma.employee.findMany({
      where: {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          ...(words.length >= 2
            ? [
                {
                  AND: words.map((word) => ({
                    OR: [
                      { firstName: { contains: word, mode: "insensitive" as const } },
                      { lastName: { contains: word, mode: "insensitive" as const } },
                    ],
                  })),
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        legajo: true,
        dni: true,
        firstName: true,
        lastName: true,
        status: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 12,
    });
  },

  findEmployeeByIdForClock(employeeId: string) {
    return prisma.employee.findFirst({
      where: { id: employeeId },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
  },

  findClockValidationContext(employeeId: string) {
    return prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        legajo: true,
        dni: true,
        cuil: true,
        firstName: true,
        lastName: true,
        status: true,
        workShifts: {
          where: { status: WorkShiftStatus.ABIERTO, endAt: null },
          orderBy: { startAt: "desc" },
          take: 1,
          include: { hourConcept: true },
        },
        hourConcepts: {
          where: { hourConcept: { status: "ACTIVO", countsAsWorked: true } },
          include: { hourConcept: true },
        },
      },
    });
  },

  linkClockPunchThumbnail(attendancePunchId: string, thumbnailFileId: string) {
    return prisma.$transaction([
      prisma.attendancePunch.update({ where: { id: attendancePunchId }, data: { thumbnailFileId } }),
      prisma.storageFile.update({ where: { id: thumbnailFileId }, data: { attendancePunchId } }),
    ]);
  },

  findOpenWorkShift(employeeId: string) {
    return prisma.workShift.findFirst({
      where: {
        employeeId,
        status: WorkShiftStatus.ABIERTO,
        endAt: null,
      },
      orderBy: { startAt: "desc" },
    });
  },

  async expireOpenWorkShifts(now: Date) {
    const candidates = await prisma.workShift.findMany({
      where: { status: WorkShiftStatus.ABIERTO, endAt: null, startAt: { lt: now } },
      orderBy: { startAt: "asc" },
      take: 100,
      include: { hourConcept: true },
    });
    const expired = candidates.filter((shift) => now.getTime() - shift.startAt.getTime() > shift.maxAllowedMinutes * 60_000);
    let count = 0;
    const items: Array<{ employeeId: string; workShiftId: string }> = [];
    for (const shift of expired) {
      const concept = shift.hourConcept || (await prisma.employeeHourConcept.findFirst({
        where: { employeeId: shift.employeeId, hourConcept: { kind: "NORMAL", status: "ACTIVO" } },
        include: { hourConcept: true },
      }))?.hourConcept;
      if (!concept) continue;
      const observation = "0 h — Falta registrar la salida. La jornada venció y requiere revisión del encargado.";
      const claimed = await prisma.$transaction(async (tx) => {
        const updated = await tx.workShift.updateMany({
          where: { id: shift.id, status: WorkShiftStatus.ABIERTO, endAt: null },
          data: { status: WorkShiftStatus.FALTA_SALIDA, totalMinutes: 0, hourConceptId: concept.id, hourConceptName: concept.name, observation, closedAt: now },
        });
        if (updated.count !== 1) return false;
        await tx.timeEntry.create({
          data: {
            employeeId: shift.employeeId,
            hourConceptId: concept.id,
            workShiftId: shift.id,
            date: shift.startAt,
            period: periodFromDate(shift.startAt),
            day: dayFromDate(shift.startAt),
            hours: 0,
            totalMinutes: 0,
            status: "APROBADO",
            source: shift.source,
            segmentStartAt: shift.startAt,
            observation,
          },
        });
        return true;
      });
      if (claimed) {
        count += 1;
        items.push({ employeeId: shift.employeeId, workShiftId: shift.id });
      }
    }
    return { count, items };
  },

  createOpenWorkShift(input: { employeeId: string; hourConceptId?: string; hourConceptName?: string; source: WorkShiftSource; startAt: Date; punchEvidence?: PunchEvidenceInput }) {
    return prisma.$transaction(async (tx) => {
      const punch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      return tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          hourConceptId: input.hourConceptId,
          hourConceptName: input.hourConceptName,
          startPunchId: punch.id,
          source: input.source,
          status: WorkShiftStatus.ABIERTO,
          startAt: input.startAt,
          maxAllowedMinutes: 20 * 60,
        },
      });
    });
  },

  rolloverExpiredOpenWorkShift(input: { openWorkShiftId: string; employeeId: string; hourConceptId?: string; hourConceptName?: string; source: WorkShiftSource; startAt: Date; missingOutObservation: string; punchEvidence?: PunchEvidenceInput }) {
    return prisma.$transaction(async (tx) => {
      const previous = await tx.workShift.findFirst({
        where: { id: input.openWorkShiftId, employeeId: input.employeeId, status: WorkShiftStatus.ABIERTO, endAt: null },
        include: { hourConcept: true },
      });
      const previousConcept = previous?.hourConcept || (await tx.employeeHourConcept.findFirst({
        where: { employeeId: input.employeeId, hourConcept: { kind: "NORMAL", status: "ACTIVO" } },
        include: { hourConcept: true },
      }))?.hourConcept;
      const claimed = await tx.workShift.updateMany({
        where: { id: input.openWorkShiftId, employeeId: input.employeeId, status: WorkShiftStatus.ABIERTO, endAt: null },
        data: {
          status: WorkShiftStatus.FALTA_SALIDA,
          observation: input.missingOutObservation,
        },
      });
      if (claimed.count !== 1) throw new Error("WORK_SHIFT_ALREADY_CLOSED");
      if (previous && previousConcept) {
        await tx.timeEntry.create({
          data: {
            employeeId: input.employeeId,
            hourConceptId: previousConcept.id,
            workShiftId: previous.id,
            date: previous.startAt,
            period: periodFromDate(previous.startAt),
            day: dayFromDate(previous.startAt),
            hours: 0,
            totalMinutes: 0,
            status: "APROBADO",
            source: previous.source,
            segmentStartAt: previous.startAt,
            observation: `0 h — ${input.missingOutObservation}`,
          },
        });
      }

      const punch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          observation: "Ingreso habilitado luego de marcar automaticamente la jornada anterior como olvido de salida.",
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      return tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          hourConceptId: input.hourConceptId,
          hourConceptName: input.hourConceptName,
          startPunchId: punch.id,
          source: input.source,
          status: WorkShiftStatus.ABIERTO,
          startAt: input.startAt,
          maxAllowedMinutes: 20 * 60,
        },
      });
    });
  },

  createObservedPunch(input: { employeeId: string; type: "INGRESO" | "SALIDA"; source: WorkShiftSource; timestamp: Date; observation: string; punchEvidence?: PunchEvidenceInput }) {
    return prisma.attendancePunch.create({
      data: {
        employeeId: input.employeeId,
        type: input.type,
        timestamp: input.timestamp,
        source: input.source,
        status: "OBSERVADA",
        observation: input.observation,
        ...punchEvidenceData(input.punchEvidence),
      },
    });
  },

  countEmployeeInScope(employeeId: string, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: employeeId }, employeeAccessWhere] } });
  },

  findDefaultHourConcept(employeeId: string, hourConceptId?: string) {
    if (hourConceptId) {
      return prisma.employeeHourConcept.findUnique({
        where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
        include: { hourConcept: true },
      });
    }
    return prisma.employeeHourConcept.findFirst({
      where: {
        employeeId,
        hourConcept: {
          kind: "NORMAL",
          status: "ACTIVO",
        },
      },
      include: { hourConcept: true },
    });
  },

  findEnabledHourConcept(employeeId: string, hourConceptId: string) {
    return prisma.employeeHourConcept.findUnique({
      where: { employeeId_hourConceptId: { employeeId, hourConceptId } },
      include: { hourConcept: true },
    });
  },

  findDuplicate(employeeId: string, hourConceptId: string, date: Date, exceptId?: string) {
    return prisma.timeEntry.findFirst({
      where: {
        employeeId,
        hourConceptId,
        date,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
  },

  findLockedTimeEntry(employeeId: string, hourConceptId: string, date: Date) {
    return prisma.timeEntry.findFirst({
      // Una fichada automática APROBADA puede recibir otro tramo del mismo día.
      // Sólo el cierre mensual impide que el fichador modifique el total.
      where: { employeeId, hourConceptId, date, status: ApprovalStatus.CERRADO },
      select: { id: true, status: true },
    });
  },

  findBlockingNovelty(employeeId: string, date: Date) {
    return prisma.novelty.findFirst({
      where: {
        employeeId,
        status: { not: "RECHAZADO" },
        fromDate: { lte: date },
        OR: [{ toDate: null }, { toDate: { gte: date } }],
        noveltyType: {
          OR: [
            { blocksTimeEntry: true },
            { setsWorkedHoursToZero: true },
            { timeImpact: "BLOQUEA_CARGA_DIA" },
          ],
        },
      },
      include: { noveltyType: { select: { code: true, name: true } } },
    });
  },

  findOverlappingWorkShift(employeeId: string, startAt: Date, endAt: Date) {
    return prisma.workShift.findFirst({
      where: {
        employeeId,
        status: { not: "ANULADO" },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true, startAt: true, endAt: true },
    });
  },

  create(input: CreateTimeEntryInput, createdByUserId?: string | null) {
    return prisma.timeEntry.create({
      data: {
        employeeId: input.employeeId,
        hourConceptId: input.hourConceptId,
        date: input.date,
        period: periodFromDate(input.date),
        day: dayFromDate(input.date),
        hours: input.hours,
        totalMinutes: minutesFromHours(input.hours),
        status: "BORRADOR",
        observation: input.observation || null,
        createdByUserId: createdByUserId || null,
      },
      include: timeEntryInclude,
    });
  },

  createFromWorkShift(input: {
    employeeId: string;
    hourConceptId: string;
    hourConceptName: string;
    source: WorkShiftSource;
    startAt: Date;
    endAt: Date;
    totalMinutes: number;
    observation?: string | null;
    segments: Array<{ date: Date; startAt: Date; endAt: Date; minutes: number; hours: number }>;
    createdByUserId?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const startPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "INGRESO",
          timestamp: input.startAt,
          source: input.source,
          observation: input.observation || "Fichada manual registrada por administración.",
        },
      });

      const endPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "SALIDA",
          timestamp: input.endAt,
          source: input.source,
          observation: input.observation || "Fichada manual registrada por administración.",
        },
      });

      const workShift = await tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          startPunchId: startPunch.id,
          endPunchId: endPunch.id,
          source: input.source,
          status: "PROCESADO",
          startAt: input.startAt,
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
          crossesMidnight: input.segments.length > 1,
          maxAllowedMinutes: 20 * 60,
          observation: input.observation || null,
          createdByUserId: input.createdByUserId || null,
          closedAt: input.endAt,
        },
      });

      const entries = [];
      const timeSegments = [];
      const doubleHourRules = await tx.doubleHourRule.findMany({
        where: {
          status: "ACTIVO",
          fromDate: { lte: input.endAt },
          OR: [{ toDate: null }, { toDate: { gte: input.segments[0]?.date } }],
          employees: { some: { employeeId: input.employeeId } },
        },
      });
      for (const segment of input.segments) {
        const segmentDay = segment.date.getUTCDay();
        const segmentKey = segment.date.toISOString().slice(0, 10);
        const doubleRule = doubleHourRules.find((rule) => {
          const fromKey = rule.fromDate.toISOString().slice(0, 10);
          const toKey = rule.toDate?.toISOString().slice(0, 10);
          if (rule.recurrenceType === "FECHA") return segmentKey === fromKey;
          if (rule.recurrenceType === "RANGO") return segmentKey >= fromKey && (!toKey || segmentKey <= toKey);
          return segmentKey >= fromKey && (!toKey || segmentKey <= toKey) && rule.weekdays.includes(segmentDay);
        });
        const multiplier = doubleRule ? Number(doubleRule.multiplier) : 1;
        const creditedMinutes = Math.round(segment.minutes * multiplier);
        const timeSegment = await tx.timeSegment.create({
          data: {
            workShiftId: workShift.id,
            employeeId: input.employeeId,
            date: segment.date,
            fromDateTime: segment.startAt,
            toDateTime: segment.endAt,
            minutes: segment.minutes,
            hourConceptId: input.hourConceptId,
            hourConceptName: input.hourConceptName,
            isSpecial: false,
            observation: input.observation || null,
          },
        });
        timeSegments.push(timeSegment);

        const existing = await tx.timeEntry.findFirst({
          where: {
            employeeId: input.employeeId,
            hourConceptId: input.hourConceptId,
            date: segment.date,
          },
          include: timeEntryInclude,
        });

        if (existing && !editableStatuses.includes(existing.status)) {
          throw new Error(`TIME_ENTRY_LOCKED:${existing.id}`);
        }

        if (existing) {
          const nextActualMinutes = (existing.actualMinutes ?? existing.totalMinutes) + segment.minutes;
          const nextMinutes = existing.totalMinutes + creditedMinutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              hours: nextMinutes / 60,
              totalMinutes: nextMinutes,
              actualMinutes: nextActualMinutes,
              appliedMultiplier: multiplier,
              source: input.source,
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              observation: `${currentObservation}Marcación ${workShift.id}: ${input.observation || "jornada registrada por entrada/salida"}`,
            },
            include: timeEntryInclude,
          }));
        } else {
          entries.push(await tx.timeEntry.create({
            data: {
              employeeId: input.employeeId,
              hourConceptId: input.hourConceptId,
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              date: segment.date,
              period: periodFromDate(segment.date),
              day: dayFromDate(segment.date),
              hours: creditedMinutes / 60,
              totalMinutes: creditedMinutes,
              actualMinutes: segment.minutes,
              appliedMultiplier: multiplier,
              status: "BORRADOR",
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              source: input.source,
              observation: input.observation || "Generado por marcación de entrada/salida.",
              createdByUserId: input.createdByUserId || null,
            },
            include: timeEntryInclude,
          }));
        }
      }

      return { workShift, entries, timeSegments };
    }, { timeout: 20_000, maxWait: 5_000 });
  },

  closeOpenWorkShift(input: {
    workShiftId: string;
    employeeId: string;
    hourConceptId: string;
    hourConceptName: string;
    source: WorkShiftSource;
    endAt: Date;
    totalMinutes: number;
    segments: Array<{ date: Date; startAt: Date; endAt: Date; minutes: number; hours: number }>;
    observation?: string | null;
    punchEvidence?: PunchEvidenceInput;
  }) {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.workShift.updateMany({
        where: {
          id: input.workShiftId,
          employeeId: input.employeeId,
          status: "ABIERTO",
          endAt: null,
        },
        data: {
          status: "PROCESADO",
          hourConceptId: input.hourConceptId,
          hourConceptName: input.hourConceptName,
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
          crossesMidnight: input.segments.length > 1,
          closedAt: input.endAt,
          observation: input.observation || undefined,
        },
      });
      if (claimed.count !== 1) {
        throw new Error("WORK_SHIFT_ALREADY_CLOSED");
      }

      const endPunch = await tx.attendancePunch.create({
        data: {
          employeeId: input.employeeId,
          type: "SALIDA",
          timestamp: input.endAt,
          source: input.source,
          observation: input.observation || null,
          ...punchEvidenceData(input.punchEvidence),
        },
      });

      const workShift = await tx.workShift.update({
        where: { id: input.workShiftId },
        data: {
          endPunchId: endPunch.id,
        },
      });

      const entries = [];
      const timeSegments = [];
      const doubleHourRules = await tx.doubleHourRule.findMany({
        where: {
          status: "ACTIVO",
          fromDate: { lte: input.endAt },
          OR: [{ toDate: null }, { toDate: { gte: input.segments[0]?.date } }],
          employees: { some: { employeeId: input.employeeId } },
        },
      });
      for (const segment of input.segments) {
        const segmentDay = segment.date.getUTCDay();
        const segmentKey = segment.date.toISOString().slice(0, 10);
        const doubleRule = doubleHourRules.find((rule) => {
          const fromKey = rule.fromDate.toISOString().slice(0, 10);
          const toKey = rule.toDate?.toISOString().slice(0, 10);
          if (rule.recurrenceType === "FECHA") return segmentKey === fromKey;
          if (rule.recurrenceType === "RANGO") return segmentKey >= fromKey && (!toKey || segmentKey <= toKey);
          return segmentKey >= fromKey && (!toKey || segmentKey <= toKey) && rule.weekdays.includes(segmentDay);
        });
        const multiplier = doubleRule ? Number(doubleRule.multiplier) : 1;
        const creditedMinutes = Math.round(segment.minutes * multiplier);
        const timeSegment = await tx.timeSegment.create({
          data: {
            workShiftId: workShift.id,
            employeeId: input.employeeId,
            date: segment.date,
            fromDateTime: segment.startAt,
            toDateTime: segment.endAt,
            minutes: segment.minutes,
            hourConceptId: input.hourConceptId,
            hourConceptName: input.hourConceptName,
            isSpecial: false,
          },
        });
        timeSegments.push(timeSegment);

        const existing = await tx.timeEntry.findFirst({
          where: {
            employeeId: input.employeeId,
            hourConceptId: input.hourConceptId,
            date: segment.date,
          },
          include: timeEntryInclude,
        });

        if (existing && existing.status !== "APROBADO" && !editableStatuses.includes(existing.status)) {
          throw new Error(`TIME_ENTRY_LOCKED:${existing.id}`);
        }

        if (existing) {
          const nextActualMinutes = (existing.actualMinutes ?? existing.totalMinutes) + segment.minutes;
          const nextMinutes = existing.totalMinutes + creditedMinutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              hours: nextMinutes / 60,
              totalMinutes: nextMinutes,
              actualMinutes: nextActualMinutes,
              appliedMultiplier: multiplier,
              source: input.source,
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              observation: `${currentObservation}Fichada ${workShift.id}: generado por ingreso/salida.${doubleRule ? ` Regla ${doubleRule.name}: ${segment.minutes} min reales computados x${multiplier}.` : ""}`,
              status: "APROBADO",
            },
            include: timeEntryInclude,
          }));
        } else {
          entries.push(await tx.timeEntry.create({
            data: {
              employeeId: input.employeeId,
              hourConceptId: input.hourConceptId,
              workShiftId: workShift.id,
              timeSegmentId: timeSegment.id,
              date: segment.date,
              period: periodFromDate(segment.date),
              day: dayFromDate(segment.date),
              hours: creditedMinutes / 60,
              totalMinutes: creditedMinutes,
              actualMinutes: segment.minutes,
              appliedMultiplier: multiplier,
              status: "APROBADO",
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              source: input.source,
              observation: `Generado por fichada de ingreso/salida.${doubleRule ? ` Regla ${doubleRule.name}: ${segment.minutes} min reales computados x${multiplier}.` : ""}`,
            },
            include: timeEntryInclude,
          }));
        }
      }

      return { workShift, entries, timeSegments };
    });
  },

  update(id: string, before: { employeeId: string; hourConceptId: string; date: Date }, input: UpdateTimeEntryInput) {
    const date = input.date || before.date;
    const hours = input.hours;
    return prisma.timeEntry.update({
      where: { id },
      data: {
        ...(input.hourConceptId !== undefined ? { hourConceptId: input.hourConceptId } : {}),
        ...(input.date !== undefined ? { date, period: periodFromDate(date), day: dayFromDate(date) } : {}),
        ...(hours !== undefined ? { hours, totalMinutes: minutesFromHours(hours) } : {}),
        ...(input.observation !== undefined ? { observation: input.observation || null } : {}),
      },
      include: timeEntryInclude,
    });
  },

  submit(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "EN_REVISION" },
      include: timeEntryInclude,
    });
  },

  approve(id: string, approvedByUserId: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "APROBADO", approvedByUserId, approvedAt: new Date(), rejectedAt: null },
      include: timeEntryInclude,
    });
  },

  reject(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "RECHAZADO", approvedByUserId: null, approvedAt: null, rejectedAt: new Date() },
      include: timeEntryInclude,
    });
  },

  returnForCorrection(id: string) {
    return prisma.timeEntry.update({
      where: { id },
      data: { status: "DEVUELTO", approvedByUserId: null, approvedAt: null, rejectedAt: null },
      include: timeEntryInclude,
    });
  },
};
