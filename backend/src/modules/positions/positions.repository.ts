import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreatePositionInput, ListPositionsQuery, UpdatePositionInput } from "./positions.schemas";

const positionInclude = {
  area: true,
  sector: true,
  salaryCategories: { include: { salaryCategory: true } },
  _count: { select: { employees: true } },
} satisfies Prisma.PositionInclude;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
type PositionRow = Awaited<ReturnType<typeof prisma.position.findMany<{ include: typeof positionInclude }>>>[number];
const POSITION_CACHE_TTL_MS = 120_000;
let listCache: { data: PositionRow[]; expiresAt: number } | null = null;

export function invalidatePositionsCache() {
  listCache = null;
}

function buildWhere(query: ListPositionsQuery): Prisma.PositionWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.businessUnitName ? { businessUnitName: query.businessUnitName } : {}),
    ...(query.establishmentName ? { establishmentName: query.establishmentName } : {}),
    ...(query.areaDepartment ? { areaDepartment: query.areaDepartment } : {}),
    ...(query.sector ? { sectorName: query.sector } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { mission: { contains: search, mode: "insensitive" } },
            { areaDepartment: { contains: search, mode: "insensitive" } },
            { sectorName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function dataFromInput(input: CreatePositionInput | UpdatePositionInput): Prisma.PositionUncheckedCreateInput | Prisma.PositionUncheckedUpdateInput {
  const {
    sector,
    businessUnitNames,
    establishmentNames,
    sectorNames,
    salaryRangeCategories,
    responsibilities,
    internalRelations,
    externalRelations,
    competencies,
    workConditions,
    performanceIndicators,
    evaluationCriteria,
    ...data
  } = input;
  return {
    ...data,
    ...(sector !== undefined ? { sectorName: sector } : {}),
    ...(businessUnitNames !== undefined ? { businessUnitNames: json(businessUnitNames) } : {}),
    ...(establishmentNames !== undefined ? { establishmentNames: json(establishmentNames) } : {}),
    ...(sectorNames !== undefined ? { sectorNames: json(sectorNames) } : {}),
    ...(salaryRangeCategories !== undefined ? { salaryRangeCategories: json(salaryRangeCategories) } : {}),
    ...(responsibilities !== undefined ? { responsibilities: json(responsibilities) } : {}),
    ...(internalRelations !== undefined ? { internalRelations: json(internalRelations) } : {}),
    ...(externalRelations !== undefined ? { externalRelations: json(externalRelations) } : {}),
    ...(competencies !== undefined ? { competencies: json(competencies) } : {}),
    ...(workConditions !== undefined ? { workConditions: json(workConditions) } : {}),
    ...(performanceIndicators !== undefined ? { performanceIndicators: json(performanceIndicators) } : {}),
    ...(evaluationCriteria !== undefined ? { evaluationCriteria: json(evaluationCriteria) } : {}),
  };
}

export const positionsRepository = {
  async findMany(query: ListPositionsQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    const hasFilters = Boolean(
      query.status ||
        query.businessUnitName ||
        query.establishmentName ||
        query.areaDepartment ||
        query.sector ||
        query.salaryRangeCategory ||
        query.search?.trim(),
    );

    if (!hasFilters) {
      if (!listCache || Date.now() >= listCache.expiresAt) {
        const data = await prisma.position.findMany({
          where,
          include: positionInclude,
          orderBy: [{ status: "asc" }, { name: "asc" }],
          take: 500,
        });
        listCache = { data, expiresAt: Date.now() + POSITION_CACHE_TTL_MS };
      }
      return [listCache.data.slice(skip, skip + query.take), listCache.data.length] as const;
    }

    return prisma.$transaction([
      prisma.position.findMany({
        where,
        include: positionInclude,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.position.count({ where }),
    ]);
  },

  findById(id: string) {
    return prisma.position.findUniqueOrThrow({
      where: { id },
      include: positionInclude,
    });
  },

  findAssignedEmployees(positionId: string) {
    return prisma.employee.findMany({
      where: { positionId, status: "ACTIVO" },
      select: {
        id: true,
        legajo: true,
        legajoFinnegans: true,
        cuil: true,
        dni: true,
        firstName: true,
        lastName: true,
        status: true,
        receiptCategory: true,
        internalCategory: true,
        position: { select: { id: true, name: true, code: true } },
        sector: { select: { id: true, name: true } },
        costCenter: { select: { id: true, name: true } },
        companies: {
          include: { company: { select: { id: true, name: true } } },
          orderBy: { isPrimary: "desc" },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 500,
    });
  },

  create(input: CreatePositionInput) {
    return prisma.position.create({ data: dataFromInput(input) as Prisma.PositionUncheckedCreateInput });
  },

  update(id: string, input: UpdatePositionInput) {
    return prisma.position.update({ where: { id }, data: dataFromInput(input) as Prisma.PositionUncheckedUpdateInput });
  },

  delete(id: string) {
    return prisma.position.delete({ where: { id } });
  },
};
