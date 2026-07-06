import { ApprovalStatus, EmployeeStatus, Prisma, WorkShiftSource, WorkShiftStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateTimeEntryInput, ListTimeEntriesQuery, TimeEntriesExportQuery, TimeEntriesPeriodEmployeesQuery, UpdateTimeEntryInput } from "./timeEntries.schemas";

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

const statusPriority = ["EN_REVISION", "RECHAZADO", "PENDIENTE", "BORRADOR", "APROBADO", "CERRADO"] as const;
const editableStatuses: ApprovalStatus[] = [ApprovalStatus.BORRADOR, ApprovalStatus.PENDIENTE, ApprovalStatus.DEVUELTO, ApprovalStatus.RECHAZADO];

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

function buildWhere(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.TimeEntryWhereInput {
  const search = query.search?.trim();
  return {
    employee: {
      AND: [
        employeeAccessWhere,
        {
          ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
          ...(search
            ? {
                OR: [
                  { legajo: { contains: search, mode: "insensitive" } },
                  { legajoFinnegans: { contains: search, mode: "insensitive" } },
                  { cuil: { contains: search, mode: "insensitive" } },
                  { dni: { contains: search, mode: "insensitive" } },
                  { firstName: { contains: search, mode: "insensitive" } },
                  { lastName: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
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

function buildPeriodEmployeeWhere(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    AND: [
      employeeAccessWhere,
      {
        status: EmployeeStatus.ACTIVO,
        ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
        ...(search
          ? {
              OR: [
                { legajo: { contains: search, mode: "insensitive" } },
                { legajoFinnegans: { contains: search, mode: "insensitive" } },
                { cuil: { contains: search, mode: "insensitive" } },
                { dni: { contains: search, mode: "insensitive" } },
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    ],
  };
}

function resolvePeriodStatus(statuses: string[]) {
  return statusPriority.find((status) => statuses.includes(status)) || "PENDIENTE";
}

export const timeEntriesRepository = {
  findMany(query: ListTimeEntriesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
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

  async findPeriodEmployees(query: TimeEntriesPeriodEmployeesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildPeriodEmployeeWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;

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
      const entries = employeeIds.length
        ? await tx.timeEntry.findMany({
            where: {
              period: query.period,
              employeeId: { in: employeeIds },
            },
            select: {
              employeeId: true,
              hours: true,
              status: true,
            },
          })
        : [];

      const grouped = new Map<string, { total: number; statuses: string[] }>();
      for (const entry of entries) {
        const current = grouped.get(entry.employeeId) || { total: 0, statuses: [] };
        if (entry.status === ApprovalStatus.APROBADO || entry.status === ApprovalStatus.EN_REVISION) {
          current.total += Number(entry.hours.toString());
        }
        current.statuses.push(entry.status);
        grouped.set(entry.employeeId, current);
      }

      return {
        items: employees.map((employee) => {
          const summary = grouped.get(employee.id);
          return {
            employee,
            summary: {
              total: summary?.total || 0,
              status: resolvePeriodStatus(summary?.statuses || []),
            },
          };
        }),
        total,
      };
    });
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

  createOpenWorkShift(input: { employeeId: string; source: WorkShiftSource; startAt: Date }) {
    return prisma.workShift.create({
      data: {
        employeeId: input.employeeId,
        source: input.source,
        status: WorkShiftStatus.ABIERTO,
        startAt: input.startAt,
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
    source: WorkShiftSource;
    startAt: Date;
    endAt: Date;
    totalMinutes: number;
    observation?: string | null;
    segments: Array<{ date: Date; startAt: Date; endAt: Date; minutes: number; hours: number }>;
    createdByUserId?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
      const workShift = await tx.workShift.create({
        data: {
          employeeId: input.employeeId,
          source: input.source,
          status: "PROCESADO",
          startAt: input.startAt,
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
          observation: input.observation || null,
          createdByUserId: input.createdByUserId || null,
        },
      });

      const entries = [];
      for (const segment of input.segments) {
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
          const nextMinutes = existing.totalMinutes + segment.minutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              hours: nextMinutes / 60,
              totalMinutes: nextMinutes,
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
              date: segment.date,
              period: periodFromDate(segment.date),
              day: dayFromDate(segment.date),
              hours: segment.hours,
              totalMinutes: segment.minutes,
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

      return { workShift, entries };
    });
  },

  closeOpenWorkShift(input: {
    workShiftId: string;
    employeeId: string;
    hourConceptId: string;
    source: WorkShiftSource;
    endAt: Date;
    totalMinutes: number;
    segments: Array<{ date: Date; startAt: Date; endAt: Date; minutes: number; hours: number }>;
  }) {
    return prisma.$transaction(async (tx) => {
      const workShift = await tx.workShift.update({
        where: { id: input.workShiftId },
        data: {
          status: "PROCESADO",
          endAt: input.endAt,
          totalMinutes: input.totalMinutes,
        },
      });

      const entries = [];
      for (const segment of input.segments) {
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
          const nextMinutes = existing.totalMinutes + segment.minutes;
          const currentObservation = existing.observation ? `${existing.observation}\n` : "";
          entries.push(await tx.timeEntry.update({
            where: { id: existing.id },
            data: {
              workShiftId: workShift.id,
              hours: nextMinutes / 60,
              totalMinutes: nextMinutes,
              source: input.source,
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              observation: `${currentObservation}Fichada ${workShift.id}: generado por ingreso/salida.`,
            },
            include: timeEntryInclude,
          }));
        } else {
          entries.push(await tx.timeEntry.create({
            data: {
              employeeId: input.employeeId,
              hourConceptId: input.hourConceptId,
              workShiftId: workShift.id,
              date: segment.date,
              period: periodFromDate(segment.date),
              day: dayFromDate(segment.date),
              hours: segment.hours,
              totalMinutes: segment.minutes,
              status: "BORRADOR",
              segmentStartAt: segment.startAt,
              segmentEndAt: segment.endAt,
              source: input.source,
              observation: "Generado por fichada de ingreso/salida.",
            },
            include: timeEntryInclude,
          }));
        }
      }

      return { workShift, entries };
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
