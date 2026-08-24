import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateHourConceptRuleInput, ListHourConceptRulesQuery, UpdateHourConceptRuleInput } from "./hourConceptRules.schemas";

const ruleInclude = {
  hourConcept: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HourConceptRuleInclude;

const ruleOrderBy = [{ startTime: "asc" }, { id: "asc" }] satisfies Prisma.HourConceptRuleOrderByWithRelationInput[];

function buildWhere(query: Pick<ListHourConceptRulesQuery, "hourConceptId" | "status" | "crossesMidnight">): Prisma.HourConceptRuleWhereInput {
  return {
    ...(query.hourConceptId ? { hourConceptId: query.hourConceptId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.crossesMidnight !== undefined ? { crossesMidnight: query.crossesMidnight } : {}),
  };
}

export const hourConceptRulesRepository = {
  async findMany(query: ListHourConceptRulesQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    const [items, total] = await prisma.$transaction([
      prisma.hourConceptRule.findMany({ where, include: ruleInclude, orderBy: ruleOrderBy, skip, take: query.take }),
      prisma.hourConceptRule.count({ where }),
    ]);
    return [items, total] as const;
  },

  findById(id: string) {
    return prisma.hourConceptRule.findUniqueOrThrow({ where: { id }, include: ruleInclude });
  },

  findByConceptId(hourConceptId: string) {
    return prisma.hourConceptRule.findMany({ where: { hourConceptId }, include: ruleInclude, orderBy: ruleOrderBy });
  },

  findHourConceptConfiguration(hourConceptId: string) {
    return prisma.hourConcept.findUnique({
      where: { id: hourConceptId },
      select: { id: true, status: true, deletedAt: true, loadMode: true, systemRole: true },
    });
  },

  create(data: CreateHourConceptRuleInput) {
    // priority queda sólo como detalle legacy del clasificador actual. El
    // contrato 6E no lo acepta: toda regla nueva usa el valor neutro fijo 0.
    return prisma.hourConceptRule.create({ data: { ...data, priority: 0 }, include: ruleInclude });
  },

  update(id: string, data: UpdateHourConceptRuleInput) {
    return prisma.hourConceptRule.update({ where: { id }, data, include: ruleInclude });
  },
};
