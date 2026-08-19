import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateHourConceptRuleInput, ListHourConceptRulesQuery, UpdateHourConceptRuleInput } from "./hourConceptRules.schemas";

const ruleInclude = {
  hourConcept: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HourConceptRuleInclude;

// Orden de respuesta pedido (RRHH necesita ver primero lo que la
// clasificación va a preferir): priority desc, luego startTime asc.
const ruleOrderBy = [{ priority: "desc" }, { startTime: "asc" }] satisfies Prisma.HourConceptRuleOrderByWithRelationInput[];

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

  // Universo de conflicto para la validación de solapamiento ambiguo (ver
  // hourConceptRules.service.ts): global, no por concepto — la clasificación
  // (classifyShiftInterval) compara reglas de TODOS los conceptos habilitados
  // del empleado entre sí, no solo las de un mismo concepto.
  findActiveExcept(excludeId?: string) {
    return prisma.hourConceptRule.findMany({
      where: { status: "ACTIVO", ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
  },

  hourConceptExists(hourConceptId: string) {
    return prisma.hourConcept.findUnique({ where: { id: hourConceptId }, select: { id: true } });
  },

  create(data: CreateHourConceptRuleInput) {
    return prisma.hourConceptRule.create({ data, include: ruleInclude });
  },

  update(id: string, data: UpdateHourConceptRuleInput) {
    return prisma.hourConceptRule.update({ where: { id }, data, include: ruleInclude });
  },
};
