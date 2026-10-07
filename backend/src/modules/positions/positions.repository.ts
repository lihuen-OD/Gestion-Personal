import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { createRepositoryListCache, pageFromCappedList, REPOSITORY_LIST_CACHE_MAX_ROWS } from "../../shared/cache/repositoryListCache";
import type { CreatePositionInput, ListPositionEmployeesQuery, ListPositionOptionsQuery, ListPositionsQuery, PositionOrgScopeInput, positionListSortKeys, UpdatePositionInput } from "./positions.schemas";
import { resolveOrderBy, type SortOrderByMap } from "../../shared/validation/listSort";
import { orgScopeRowWhere } from "../../shared/prisma/orgScopeWhere";

const positionListOrderBy: SortOrderByMap<(typeof positionListSortKeys)[number], Prisma.PositionOrderByWithRelationInput> = {
  name: (order) => [{ name: order }],
  status: (order) => [{ status: order }, { name: "asc" }],
};
const positionDefaultOrderBy: Prisma.PositionOrderByWithRelationInput[] = [{ status: "asc" }, { name: "asc" }];

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
  orgScopes: {
    include: {
      company: { select: { id: true, code: true, name: true, status: true } },
      businessUnit: { select: { id: true, code: true, name: true, status: true, companyId: true } },
      sector: { select: { id: true, code: true, name: true, status: true, businessUnitId: true } },
      area: { select: { id: true, code: true, name: true, status: true, sectorId: true } },
    },
    orderBy: { createdAt: "asc" },
  },
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
  orgScopes: {
    select: {
      id: true, level: true, companyId: true, businessUnitId: true, sectorId: true, areaId: true,
      company: { select: { id: true, code: true, name: true, status: true } },
      businessUnit: { select: { id: true, code: true, name: true, status: true, companyId: true } },
      sector: { select: { id: true, code: true, name: true, status: true, businessUnitId: true } },
      area: { select: { id: true, code: true, name: true, status: true, sectorId: true } },
    },
  },
} satisfies Prisma.PositionSelect;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const scopeData = (positionId: string, scopes: PositionOrgScopeInput[], createdByUserId?: string) => scopes.map((scope) => ({
  positionId,
  level: scope.level,
  companyId: scope.level === "COMPANY" ? scope.nodeId : null,
  businessUnitId: scope.level === "BUSINESS_UNIT" ? scope.nodeId : null,
  sectorId: scope.level === "SECTOR" ? scope.nodeId : null,
  areaId: scope.level === "AREA" ? scope.nodeId : null,
  createdByUserId: createdByUserId || null,
}));
type PositionRow = Awaited<ReturnType<typeof prisma.position.findMany<{ include: typeof positionInclude }>>>[number];
const POSITION_CACHE_TTL_MS = 120_000;
// Etapa 14I.3: helper compartido (backend/src/shared/cache/
// repositoryListCache.ts) — mismo TTL, misma semántica, sin cambio de
// comportamiento. Ver docs/decisions/BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
const listCache = createRepositoryListCache<PositionRow[]>(POSITION_CACHE_TTL_MS);

export function invalidatePositionsCache() {
  listCache.clear();
}

// A5/A7: semántica compartida con Legajos (shared/prisma/orgScopeWhere.ts).
function scopeWhere(query: ListPositionsQuery): Prisma.PositionWhereInput | undefined {
  const { scopeLevel: level, scopeNodeId: id, scopeMode } = query;
  if (!level || !id || !scopeMode) return undefined;
  return { orgScopes: { some: orgScopeRowWhere(level, id, scopeMode) } };
}

function buildWhere(query: ListPositionsQuery): Prisma.PositionWhereInput {
  const search = query.search?.trim();
  const scope = scopeWhere(query);
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(scope || {}),
    ...(query.salaryRangeCategory ? { salaryCategories: { some: { salaryCategory: { name: query.salaryRangeCategory } } } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { mission: { contains: search, mode: "insensitive" } },
            { sector: { name: { contains: search, mode: "insensitive" } } },
            { orgScopes: { some: { OR: [
              { company: { name: { contains: search, mode: "insensitive" } } },
              { businessUnit: { name: { contains: search, mode: "insensitive" } } },
              { sector: { name: { contains: search, mode: "insensitive" } } },
              { area: { name: { contains: search, mode: "insensitive" } } },
            ] } } },
          ],
        }
      : {}),
  };
}

function dataFromInput(input: CreatePositionInput | UpdatePositionInput): Prisma.PositionUncheckedCreateInput | Prisma.PositionUncheckedUpdateInput {
  const {
    salaryCategoryIds: _salaryCategoryIds,
    orgScopes: _orgScopes,
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
  transaction<T>(operation: (tx: PrismaTransactionClient) => Promise<T>) {
    return prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async resolveScopeNodes(tx: PrismaTransactionClient, scopes: PositionOrgScopeInput[]) {
    const ids = (level: PositionOrgScopeInput["level"]) => scopes.filter((scope) => scope.level === level).map((scope) => scope.nodeId);
    const [companies, businessUnits, sectors, areas] = await Promise.all([
      tx.company.findMany({ where: { id: { in: ids("COMPANY") } }, select: { id: true, code: true, name: true, status: true } }),
      tx.businessUnit.findMany({ where: { id: { in: ids("BUSINESS_UNIT") } }, select: { id: true, code: true, name: true, status: true, companyId: true } }),
      tx.sector.findMany({ where: { id: { in: ids("SECTOR") } }, select: { id: true, code: true, name: true, status: true, businessUnitId: true, businessUnit: { select: { companyId: true } } } }),
      tx.area.findMany({ where: { id: { in: ids("AREA") } }, select: { id: true, code: true, name: true, status: true, sectorId: true, sector: { select: { businessUnitId: true, businessUnit: { select: { companyId: true } } } } } }),
    ]);
    return { companies, businessUnits, sectors, areas };
  },

  findScopeKeys(tx: PrismaTransactionClient, positionId: string) {
    return tx.positionOrgScope.findMany({ where: { positionId }, select: { level: true, companyId: true, businessUnitId: true, sectorId: true, areaId: true } });
  },

  async findMany(query: ListPositionsQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    const hasFilters = Boolean(
      query.status ||
        query.scopeNodeId ||
        query.salaryRangeCategory ||
        query.search?.trim() ||
        query.sortBy,
    );

    if (!hasFilters) {
      const data = await listCache.getOrLoad(() =>
        prisma.position.findMany({
          where,
          include: positionInclude,
          orderBy: [...positionDefaultOrderBy, { id: "asc" }],
          take: REPOSITORY_LIST_CACHE_MAX_ROWS + 1,
        }),
      );
      const cached = pageFromCappedList(data, query.page, query.take);
      if (cached) return cached;
    }

    // Etapa 14H.7: findMany + count son lecturas independientes (ninguna
    // depende del resultado de la otra) — $transaction([...]) las pinaba a
    // una única conexión de Neon en serie sin ganar concurrencia real. A
    // diferencia de las tarjetas de Configuración (donde este antipatrón se
    // ejercitaba vía un caller externo), acá se ejercita directamente por el
    // propio filtro/búsqueda de PuestosPage.tsx. Mismo patrón ya aplicado
    // 14+ veces en las series 14G/14H — where/orderBy/skip/take sin cambios.
    return Promise.all([
      prisma.position.findMany({
        where,
        include: positionInclude,
        orderBy: resolveOrderBy(query, positionListOrderBy, positionDefaultOrderBy, { id: "asc" }),
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

  // Etapa 14H.7: existencia liviana — usada por listAssignedEmployees()
  // (positions.service.ts) sólo para confirmar que el puesto existe (y
  // mapear P2025 -> 404), descartando el resultado por completo. Antes
  // reusaba findById() (positionInclude completo: 9 columnas JSON + cadena
  // sector->area->establishment->{businessUnit,company} + salaryCategories)
  // para un chequeo que sólo necesita el `id` — mismo criterio de "no traer
  // detalle completo cuando sólo se necesitan pocos campos" ya aplicado en
  // positionOptionSelect (14D.4).
  existsById(id: string) {
    return prisma.position.findUniqueOrThrow({ where: { id }, select: { id: true } });
  },

  // Etapa 14D.4: catálogo liviano — mismo criterio de "sin filtros pedidos
  // hoy" que llevó a no exponer `search` en el schema (§ arriba). Orden
  // estable (mismo criterio que `findMany`: status asc, name asc) para que
  // selects/catálogos no salten de posición entre renders.
  // Etapa 14D.7: `relationLoadStrategy: "join"` para la cadena
  // sector→area→establishment→businessUnit anidada en `positionOptionSelect`
  // — medida y aprobada en 14D.6 (mejora ~85-87%, shape idéntico). NO se
  // aplica a `findMany`/`findById` (arriba, `positionInclude` con `_count` —
  // fuera de alcance, ver riesgos §6 de 14D.6). Ver docs/decisions/
  // PRISMA_RELATION_JOINS_LIMITED_ROLLOUT_14D7.md.
  // Etapa 14H.7: `includeAssignedCount` agrega `_count.employees` al select
  // sólo cuando se pide (default: no, igual que siempre) — habilita reusar
  // este mismo catálogo liviano desde PuestosPage.tsx (tarjetas de resumen +
  // opciones de rango salarial), que sí necesita assignedCount a diferencia
  // de los 3 callers de Legajos (sin cambios para ellos, mismo select por
  // defecto). Ver docs/decisions/POSITIONS_MODULE_PERFORMANCE_14H7.md.
  findOptions(query: ListPositionOptionsQuery) {
    return prisma.position.findMany({
      where: query.status ? { status: query.status } : {},
      select: query.includeAssignedCount
        ? { ...positionOptionSelect, _count: { select: { employees: true } } }
        : positionOptionSelect,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: query.take,
      relationLoadStrategy: "join",
    });
  },

  findAssignedEmployees(positionId: string, query: ListPositionEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeWhereInput = { AND: [{ positionId, status: "ACTIVO" }, accessWhere] };
    return Promise.all([
      prisma.employee.findMany({
      where,
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
      orderBy: resolveOrderBy<"legajo" | "employee", Prisma.EmployeeOrderByWithRelationInput>(
        query,
        { legajo: (order) => [{ legajo: order }], employee: (order) => [{ lastName: order }, { firstName: order }] },
        [{ lastName: "asc" }, { firstName: "asc" }],
        { id: "asc" },
      ),
      skip: (query.page - 1) * query.take,
      take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  async createWithin(tx: PrismaTransactionClient, input: CreatePositionInput, createdByUserId?: string) {
      const item = await tx.position.create({ data: dataFromInput(input) as Prisma.PositionUncheckedCreateInput });
      if (input.salaryCategoryIds.length) {
        await tx.positionSalaryCategory.createMany({
          data: input.salaryCategoryIds.map((salaryCategoryId) => ({ positionId: item.id, salaryCategoryId })),
          skipDuplicates: true,
        });
      }
      await tx.positionOrgScope.createMany({ data: scopeData(item.id, input.orgScopes, createdByUserId) });
      return item;
  },

  create(input: CreatePositionInput) {
    return prisma.$transaction((tx) => positionsRepository.createWithin(tx, input));
  },

  async updateWithin(tx: PrismaTransactionClient, id: string, input: UpdatePositionInput, createdByUserId?: string) {
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
      if (input.orgScopes !== undefined) {
        await tx.positionOrgScope.deleteMany({ where: { positionId: id } });
        await tx.positionOrgScope.createMany({ data: scopeData(id, input.orgScopes, createdByUserId) });
      }
      return item;
  },

  update(id: string, input: UpdatePositionInput) {
    return prisma.$transaction((tx) => positionsRepository.updateWithin(tx, id, input));
  },

  /**
   * Baja de un puesto (ORG_LOCATION_REORGANIZATION.md §6). Un puesto con
   * personas o referenciado por una regla de horas especiales NO se borra:
   * se inactiva. Borrarlo dejaba `DoubleHourRule.positionId` en NULL (SET NULL
   * antes de M1), y NULL significa "sin restricción": la regla se ampliaba a
   * todos en silencio. Desde M1 la FK es RESTRICT además de este chequeo.
   *
   * Sin dependencias, borra explícitamente sus filas propias (categorías y
   * alcances organizativos) antes del puesto, sin depender de CASCADE.
   * Serializable: una asignación concurrente hace abortar una de las dos
   * transacciones (P2034) en vez de borrar un puesto recién referenciado.
   * `onDone` corre dentro de la misma transacción (auditoría).
   */
  removeOrInactivate(id: string, onDone: (tx: PrismaTransactionClient, outcome: Exclude<PositionRemovalOutcome, { kind: "NOT_FOUND" }>) => Promise<unknown>) {
    return prisma.$transaction(async (tx): Promise<PositionRemovalOutcome> => {
      const current = await tx.position.findUnique({
        where: { id },
        select: { id: true, code: true, name: true, status: true, _count: { select: { employees: true, doubleHourRules: true } } },
      });
      if (!current) return { kind: "NOT_FOUND" };
      const { employees, doubleHourRules } = current._count;
      const position = { id: current.id, code: current.code, name: current.name, status: current.status };
      const outcome: Exclude<PositionRemovalOutcome, { kind: "NOT_FOUND" }> = employees > 0 || doubleHourRules > 0
        ? { kind: "INACTIVATED", position, employees, doubleHourRules }
        : { kind: "DELETED", position };
      if (outcome.kind === "INACTIVATED") {
        await tx.position.update({ where: { id }, data: { status: "INACTIVO" } });
      } else {
        await tx.positionOrgScope.deleteMany({ where: { positionId: id } });
        await tx.positionSalaryCategory.deleteMany({ where: { positionId: id } });
        await tx.position.delete({ where: { id } });
      }
      await onDone(tx, outcome);
      return outcome;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};

export type PositionRemovalOutcome =
  | { kind: "NOT_FOUND" }
  | { kind: "INACTIVATED"; position: { id: string; code: string; name: string; status: string }; employees: number; doubleHourRules: number }
  | { kind: "DELETED"; position: { id: string; code: string; name: string; status: string } };
