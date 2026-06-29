import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateNoveltyTypeInput, ListNoveltyTypesQuery, UpdateNoveltyTypeInput } from "./noveltyTypes.schemas";

const noveltyTypeInclude = {
  finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
} satisfies Prisma.NoveltyTypeInclude;

function buildWhere(query: ListNoveltyTypesQuery): Prisma.NoveltyTypeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.exportsToFinnegans !== undefined ? { exportsToFinnegans: query.exportsToFinnegans } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { finnegansLinks: { some: { code: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

function createNoveltyTypeData(input: CreateNoveltyTypeInput) {
  const { finnegansLinks: _links, ...data } = input;
  return data;
}

function updateNoveltyTypeData(input: UpdateNoveltyTypeInput) {
  const { finnegansLinks: _links, ...data } = input;
  return data;
}

export const noveltyTypesRepository = {
  findMany(query: ListNoveltyTypesQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.noveltyType.findMany({
        where,
        include: noveltyTypeInclude,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.noveltyType.count({ where }),
    ]);
  },

  findById(id: string) {
    return prisma.noveltyType.findUniqueOrThrow({
      where: { id },
      include: noveltyTypeInclude,
    });
  },

  create(input: CreateNoveltyTypeInput) {
    return prisma.noveltyType.create({
      data: {
        ...createNoveltyTypeData(input),
        ...(input.finnegansLinks.length
          ? {
              finnegansLinks: {
                createMany: { data: input.finnegansLinks },
              },
            }
          : {}),
      },
      include: noveltyTypeInclude,
    });
  },

  update(id: string, input: UpdateNoveltyTypeInput) {
    const shouldReplaceLinks = input.finnegansLinks !== undefined;
    return prisma.$transaction(async (tx) => {
      const item = await tx.noveltyType.update({
        where: { id },
        data: updateNoveltyTypeData(input),
      });

      if (shouldReplaceLinks) {
        await tx.finnegansNoveltyLink.deleteMany({ where: { noveltyTypeId: id } });
        if (input.finnegansLinks?.length) {
          await tx.finnegansNoveltyLink.createMany({
            data: input.finnegansLinks.map((link) => ({ ...link, noveltyTypeId: id })),
          });
        }
      }

      return tx.noveltyType.findUniqueOrThrow({ where: { id: item.id }, include: noveltyTypeInclude });
    });
  },
};
