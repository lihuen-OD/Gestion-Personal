import type { Prisma } from "@prisma/client";
import { argentinaCalendarDate } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { ExpectedShiftPreviewQuery } from "./shiftExpectedPreview.schemas";

type Db = PrismaTransactionClient;

const rotationPreviewSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  shiftGroup: { select: { id: true, code: true, name: true } },
  crews: { orderBy: [{ sortOrder: "asc" as const }, { code: "asc" as const }], select: { id: true, code: true, name: true, status: true } },
  versions: {
    orderBy: { effectiveFrom: "asc" as const },
    select: { id: true, effectiveFrom: true, effectiveTo: true, cycleLengthWeeks: true, anchorWeekStart: true },
  },
} satisfies Prisma.ShiftRotationSelect;

const employeePreviewSelect = {
  id: true,
  legajo: true,
  firstName: true,
  lastName: true,
  status: true,
} satisfies Prisma.EmployeeSelect;

function intersectingMembershipWhere(rotationId: string, from: Date, to: Date): Prisma.ShiftRotationCrewMemberWhereInput {
  return {
    crew: { rotationId },
    effectiveFrom: { lte: to },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
  };
}

export const shiftExpectedPreviewRepository = {
  /** R8: grupo de cada plantilla, para ocultar las de grupos no administrables. */
  async templateGroups(ids: string[], db: Db = prisma) {
    if (!ids.length) return new Map<string, string | null>();
    const rows = await db.shiftTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, shiftGroupId: true } });
    return new Map(rows.map((row) => [row.id, row.shiftGroupId]));
  },

  findRotation(id: string, db: Db = prisma) {
    return db.shiftRotation.findUnique({ where: { id }, select: rotationPreviewSelect });
  },

  async findEmployees(
    query: ExpectedShiftPreviewQuery,
    accessWhere: Prisma.EmployeeWhereInput,
    db: Db = prisma,
  ) {
    const from = argentinaCalendarDate(query.from);
    const to = argentinaCalendarDate(query.to);
    const where: Prisma.EmployeeWhereInput = {
      AND: [accessWhere, { shiftRotationMemberships: { some: intersectingMembershipWhere(query.rotationId, from, to) } }],
    };
    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { legajo: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.take,
        take: query.take,
        select: employeePreviewSelect,
      }),
      db.employee.count({ where }),
    ]);
    return { items, total };
  },

  findMemberships(rotationId: string, employeeIds: string[], fromKey: string, toKey: string, db: Db = prisma) {
    if (!employeeIds.length) return Promise.resolve([]);
    const from = argentinaCalendarDate(fromKey);
    const to = argentinaCalendarDate(toKey);
    return db.shiftRotationCrewMember.findMany({
      where: {
        employeeId: { in: employeeIds },
        ...intersectingMembershipWhere(rotationId, from, to),
      },
      orderBy: [{ employeeId: "asc" }, { effectiveFrom: "asc" }],
      select: { id: true, employeeId: true, crewId: true, effectiveFrom: true, effectiveTo: true },
    });
  },
};

export type PreviewRotationRow = NonNullable<Awaited<ReturnType<typeof shiftExpectedPreviewRepository.findRotation>>>;
export type PreviewEmployeeRow = Awaited<ReturnType<typeof shiftExpectedPreviewRepository.findEmployees>>["items"][number];
export type PreviewMembershipRow = Awaited<ReturnType<typeof shiftExpectedPreviewRepository.findMemberships>>[number];
