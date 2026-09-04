import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreatePositionInput, ListPositionOptionsQuery, ListPositionsQuery, UpdatePositionInput } from "./positions.schemas";

const positionInclude = {
  sector: {
    include: {
      area: {
        include: {
          establishment: {
            include: {
              businessUnit: true,
              company: true,
            },
          },
        },
      },
    },
  },
  salaryCategories: { include: { salaryCategory: true } },
  _count: { select: { employees: true } },
} satisfies Prisma.PositionInclude;

// Etapa 14D.4: select liviano para catálogos/selectores — usado hoy sólo por
// Legajos (`usePositions`/`useActivePositions` en EmployeeLaborFields.tsx/
// LaborTrackedFields.tsx, y `resolveRelations` en employeeApiService.ts).
// Excluye exactamente lo que ningún consumidor de Legajos lee (confirmado
// leyendo los 3 call sites completos, ver docs/decisions/
// POSITIONS_PERFORMANCE_FOR_EMPLOYEES_14D4.md): las 7 columnas JSON
// (responsibilities/internalRelations/externalRelations/competencies/
// workConditions/performanceIndicators/evaluationCriteria) + `description`,
// la relación `establishment.company` (registro completo de Company) y
// `_count.employees` (assignedCount, sólo se muestra en PuestosPage). Todo lo
// demás (escalares baratos + cadena de NOMBRES de sector/area/establishment/
// businessUnit + salaryCategories) se mantiene idéntico a `positionInclude`
// para poder reusar el mismo mapper del frontend (`mapFromApi`) sin
// duplicarlo — el shape que sí expone es un subconjunto exacto, nunca
// distinto, de lo que ya devuelve `GET /positions`.
const positionOptionSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  lastUpdatedAt: true,
  sectorId: true,
  createdAt: true,
  updatedAt: true,
  sector: {
    select: {
      id: true,
      name: true,
      area: {
        select: {
          id: true,
          name: true,
          establishment: {
            select: {
              id: true,
              name: true,
              businessUnit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  salaryCategories: {
    select: { salaryCategory: { select: { id: true, name: true, order: true } } },
  },
} satisfies Prisma.PositionSelect;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
type PositionRow = Awaited<ReturnType<typeof prisma.position.findMany<{ include: typeof positionInclude }>>>[number];
const POSITION_CACHE_TTL_MS = 120_000;
let listCache: { data: PositionRow[]; expiresAt: number } | null = null;

export function invalidatePositionsCache() {
  listCache = null;
}

// Etapa 9E: areaId/establishmentId/businessUnitId se resuelven navegando la
// misma cadena sector->area->establishment->businessUnit que ya usa
// positionInclude para mostrar los derivados — sin agregar ninguna columna
// nueva, sólo filtros anidados sobre relaciones existentes.
function buildWhere(query: ListPositionsQuery): Prisma.PositionWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.areaId ? { sector: { areaId: query.areaId } } : {}),
    ...(query.establishmentId ? { sector: { area: { establishmentId: query.establishmentId } } } : {}),
    ...(query.businessUnitId ? { sector: { area: { establishment: { businessUnitId: query.businessUnitId } } } } : {}),
    ...(query.salaryRangeCategory ? { salaryCategories: { some: { salaryCategory: { name: query.salaryRangeCategory } } } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { mission: { contains: search, mode: "insensitive" } },
            { sector: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

function dataFromInput(input: CreatePositionInput | UpdatePositionInput): Prisma.PositionUncheckedCreateInput | Prisma.PositionUncheckedUpdateInput {
  const {
    salaryCategoryIds: _salaryCategoryIds,
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
        query.sectorId ||
        query.areaId ||
        query.establishmentId ||
        query.businessUnitId ||
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

  // Etapa 14D.4: catálogo liviano — mismo criterio de "sin filtros pedidos
  // hoy" que llevó a no exponer `search` en el schema (§ arriba). Orden
  // estable (mismo criterio que `findMany`: status asc, name asc) para que
  // selects/catálogos no salten de posición entre renders.
  findOptions(query: ListPositionOptionsQuery) {
    return prisma.position.findMany({
      where: query.status ? { status: query.status } : {},
      select: positionOptionSelect,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: query.take,
    });
  },

  findAssignedEmployees(positionId: string, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.findMany({
      where: { AND: [{ positionId, status: "ACTIVO" }, accessWhere] },
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
    return prisma.$transaction(async (tx) => {
      const item = await tx.position.create({ data: dataFromInput(input) as Prisma.PositionUncheckedCreateInput });
      if (input.salaryCategoryIds.length) {
        await tx.positionSalaryCategory.createMany({
          data: input.salaryCategoryIds.map((salaryCategoryId) => ({ positionId: item.id, salaryCategoryId })),
          skipDuplicates: true,
        });
      }
      return item;
    });
  },

  update(id: string, input: UpdatePositionInput) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.position.update({ where: { id }, data: dataFromInput(input) as Prisma.PositionUncheckedUpdateInput });
      if (input.salaryCategoryIds !== undefined) {
        await tx.positionSalaryCategory.deleteMany({ where: { positionId: id } });
        if (input.salaryCategoryIds.length) {
          await tx.positionSalaryCategory.createMany({
            data: input.salaryCategoryIds.map((salaryCategoryId) => ({ positionId: id, salaryCategoryId })),
            skipDuplicates: true,
          });
        }
      }
      return item;
    });
  },

  delete(id: string) {
    return prisma.position.delete({ where: { id } });
  },
};
