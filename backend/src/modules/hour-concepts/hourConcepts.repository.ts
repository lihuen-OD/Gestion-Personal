import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateHourConceptInput, ListHourConceptsQuery, UpdateHourConceptInput } from "./hourConcepts.schemas";

function buildWhere(query: ListHourConceptsQuery): Prisma.HourConceptWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const hourConceptsRepository = {
  findMany(query: ListHourConceptsQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.hourConcept.findMany({
        where,
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.hourConcept.count({ where }),
    ]);
  },

  create(data: CreateHourConceptInput) {
    return prisma.hourConcept.create({ data });
  },

  update(id: string, data: UpdateHourConceptInput) {
    return prisma.hourConcept.update({ where: { id }, data });
  },
};
