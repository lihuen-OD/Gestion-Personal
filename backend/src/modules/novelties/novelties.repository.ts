import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateNoveltyInput, ListNoveltiesQuery } from "./novelties.schemas";

const noveltyInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, dni: true, firstName: true, lastName: true, status: true } },
  noveltyType: { include: { finnegansLinks: { where: { status: "ACTIVO" }, orderBy: { priority: "asc" } } } },
  targetHourConcept: true,
  documents: { include: { category: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.NoveltyInclude;

function buildWhere(query: ListNoveltiesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.NoveltyWhereInput {
  const search = query.search?.trim();
  return {
    employee: employeeAccessWhere,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.noveltyTypeId ? { noveltyTypeId: query.noveltyTypeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.exportable !== undefined
      ? {
          noveltyType: {
            exportsToFinnegans: query.exportable,
            ...(query.exportable ? { finnegansLinks: { some: { status: "ACTIVO" } } } : {}),
          },
        }
      : {}),
    ...(query.from || query.to
      ? {
          fromDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { employee: { legajo: { contains: search, mode: "insensitive" } } },
            { employee: { dni: { contains: search, mode: "insensitive" } } },
            { employee: { firstName: { contains: search, mode: "insensitive" } } },
            { employee: { lastName: { contains: search, mode: "insensitive" } } },
            { noveltyType: { code: { contains: search, mode: "insensitive" } } },
            { noveltyType: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
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

function dateRange(from: Date, to?: Date | null) {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endDate = to || from;
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  const days: Date[] = [];
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor));
  }
  return days;
}

async function findZeroHourConcept(tx: Prisma.TransactionClient, employeeId: string, targetHourConceptId?: string | null) {
  if (targetHourConceptId) {
    return tx.employeeHourConcept.findFirst({
      where: {
        employeeId,
        hourConceptId: targetHourConceptId,
        hourConcept: { status: "ACTIVO" },
      },
      include: { hourConcept: true },
    });
  }

  return tx.employeeHourConcept.findFirst({
    where: {
      employeeId,
      hourConcept: { name: "Hora normal", kind: "NORMAL", status: "ACTIVO" },
    },
    include: { hourConcept: true },
  });
}

async function syncZeroTimeEntries(
  tx: Prisma.TransactionClient,
  input: CreateNoveltyInput,
  noveltyName: string,
  createdByUserId?: string | null,
) {
  const observation = `Generado automáticamente por novedad que bloquea carga horaria: ${noveltyName}.`;
  const days = dateRange(input.fromDate, input.toDate);

  for (const employeeId of input.employeeIds) {
    const enabledConcept = await findZeroHourConcept(tx, employeeId, input.targetHourConceptId);
    if (!enabledConcept) continue;

    for (const date of days) {
      const existing = await tx.timeEntry.findFirst({
        where: {
          employeeId,
          hourConceptId: enabledConcept.hourConceptId,
          date,
        },
        select: { id: true, status: true, observation: true },
      });

      if (existing?.status === "APROBADO" || existing?.status === "CERRADO") continue;

      if (existing) {
        await tx.timeEntry.update({
          where: { id: existing.id },
          data: {
            hours: 0,
            totalMinutes: 0,
            status: "EN_REVISION",
            observation: existing.observation ? `${existing.observation} | ${observation}` : observation,
          },
        });
        continue;
      }

      await tx.timeEntry.create({
        data: {
          employeeId,
          hourConceptId: enabledConcept.hourConceptId,
          date,
          period: periodFromDate(date),
          day: dayFromDate(date),
          hours: 0,
          totalMinutes: 0,
          status: "EN_REVISION",
          observation,
          createdByUserId: createdByUserId || null,
        },
      });
    }
  }
}

export const noveltiesRepository = {
  findMany(query: ListNoveltiesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.novelty.findMany({
        where,
        include: noveltyInclude,
        orderBy: [{ fromDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.take,
      }),
      prisma.novelty.count({ where }),
    ]);
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.novelty.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: noveltyInclude,
    });
  },

  findNoveltyType(id: string) {
    return prisma.noveltyType.findUnique({ where: { id }, include: { finnegansLinks: true } });
  },

  countEmployees(ids: string[], employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: { in: ids } }, employeeAccessWhere] } });
  },

  createMany(
    input: CreateNoveltyInput,
    status: "PENDIENTE" | "APROBADO",
    createdByUserId?: string | null,
    options: { createZeroTimeEntries?: boolean; noveltyName?: string } = {},
  ) {
    return prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        input.employeeIds.map((employeeId) =>
          tx.novelty.create({
            data: {
              employeeId,
              noveltyTypeId: input.noveltyTypeId,
              status,
              fromDate: input.fromDate,
              toDate: input.toDate || null,
              quantityHours: input.quantityHours || null,
              quantityDays: input.quantityDays || null,
              observation: input.observation || null,
              targetHourConceptId: input.targetHourConceptId || null,
              createdByUserId: createdByUserId || null,
            },
            select: { id: true },
          }),
        ),
      );

      if (options.createZeroTimeEntries) {
        await syncZeroTimeEntries(tx, input, options.noveltyName || "Novedad", createdByUserId);
      }

      return tx.novelty.findMany({
        where: {
          id: { in: created.map((item) => item.id) },
        },
        include: noveltyInclude,
        orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }],
      });
    });
  },

  approve(id: string, approvedByUserId: string) {
    return prisma.novelty.update({
      where: { id },
      data: {
        status: "APROBADO",
        approvedByUserId,
        approvedAt: new Date(),
        rejectedAt: null,
      },
      include: noveltyInclude,
    });
  },

  reject(id: string) {
    return prisma.novelty.update({
      where: { id },
      data: {
        status: "RECHAZADO",
        approvedByUserId: null,
        approvedAt: null,
        rejectedAt: new Date(),
      },
      include: noveltyInclude,
    });
  },
};
