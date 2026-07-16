import { ApprovalStatus, EmployeeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateEmployeeDocumentInput,
  CreateEmployeeInput,
  CreateEmployeeBlockHistoryInput,
  CreateLaborMovementInput,
  CreateEmployeeFieldHistoryInput,
  EmployeeAssignmentInput,
  EmployeeTimeGridQuery,
  ListEmployeeHistoryQuery,
  ListEmployeeOrgChartQuery,
  ListEmployeeOptionsQuery,
  ListEmployeesQuery,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpsertEmployeeAddressInput,
  UpsertEmployeeTransportInput,
} from "./employees.schemas";

const employeeOptionSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
} satisfies Prisma.EmployeeSelect;

const employeeListSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  sector: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  companies: { include: { company: { select: { id: true, name: true, code: true } } } },
  laborMovements: {
    select: {
      id: true,
      employeeId: true,
      type: true,
      effectiveFrom: true,
      reason: true,
      observation: true,
      createdAt: true,
      createdByUserId: true,
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { effectiveFrom: "desc" as const },
    take: 5,
  },
} satisfies Prisma.EmployeeSelect;

const employeeDetailSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
  address: true,
  transport: true,
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
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
  costCenter: { select: { id: true, name: true, code: true } },
  position: true,
  companies: {
    select: {
      isPrimary: true,
      company: { select: { id: true, name: true, code: true } },
    },
  },
  laborMovements: {
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: "desc" as const },
    take: 50,
  },
  assignments: { take: 100, include: { user: { select: { id: true, name: true, employeeId: true } } } },
  hourConcepts: { select: { hourConcept: { select: { id: true, code: true, name: true } } } },
  novelties: { include: { noveltyType: true }, orderBy: { fromDate: "desc" as const }, take: 20 },
  documents: { include: { category: true }, orderBy: { createdAt: "desc" as const }, take: 20 },
} satisfies Prisma.EmployeeSelect;

const employeeOverviewSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  civilStatus: true,
  nationality: true,
  email: true,
  phone: true,
  mobile: true,
  emergencyContact: true,
  emergencyRelation: true,
  emergencyPhone: true,
  status: true,
  healthInsurance: true,
  agreement: true,
  receiptCategory: true,
  internalCategory: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
  address: true,
  transport: true,
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
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
  costCenter: { select: { id: true, name: true, code: true } },
  position: true,
  companies: {
    select: {
      isPrimary: true,
      company: { select: { id: true, name: true, code: true } },
    },
  },
  laborMovements: {
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: { effectiveFrom: "desc" as const },
    take: 50,
  },
  assignments: { take: 100, include: { user: { select: { id: true, name: true, employeeId: true } } } },
  hourConcepts: { select: { hourConcept: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.EmployeeSelect;

const timeGridEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  sector: {
    select: {
      id: true,
      name: true,
      area: {
        select: {
          establishment: {
            select: {
              name: true,
              businessUnit: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  companies: {
    select: {
      isPrimary: true,
      company: { select: { id: true, name: true, code: true } },
    },
  },
  hourConcepts: { select: { hourConcept: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.EmployeeSelect;

const timeGridCoreEmployeeSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  hourConcepts: { select: { hourConcept: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.EmployeeSelect;

const timeGridTimeEntryInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, firstName: true, lastName: true, status: true } },
  hourConcept: { select: { id: true, code: true, name: true, kind: true, status: true } },
} satisfies Prisma.TimeEntryInclude;

const timeGridNoveltyInclude = {
  employee: { select: { id: true, legajo: true, firstName: true, lastName: true } },
  noveltyType: {
    select: {
      id: true,
      code: true,
      name: true,
      origin: true,
      exportsToFinnegans: true,
      allowsHours: true,
      allowsDateTo: true,
      hasValidity: true,
      blocksTimeEntry: true,
      setsWorkedHoursToZero: true,
      timeImpact: true,
      approvalRoles: true,
      finnegansLinks: {
        where: { status: "ACTIVO" },
        orderBy: { priority: "asc" as const },
        select: { code: true, name: true, hasValidity: true, status: true },
      },
    },
  },
  targetHourConcept: { select: { id: true, name: true } },
  documents: { select: { fileName: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.NoveltyInclude;

function periodRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

type TimeGridCatalogs = {
  noveltyTypes: Awaited<ReturnType<typeof prisma.noveltyType.findMany>>;
  hourConcepts: Awaited<ReturnType<typeof prisma.hourConcept.findMany>>;
};
let timeGridCatalogCache: { data: TimeGridCatalogs; expiresAt: number } | null = null;
const TIME_GRID_CATALOG_CACHE_MS = 120_000;

async function getTimeGridCatalogs() {
  if (timeGridCatalogCache && Date.now() < timeGridCatalogCache.expiresAt) return timeGridCatalogCache.data;
  const [noveltyTypes, hourConcepts] = await Promise.all([
    prisma.noveltyType.findMany({
      where: { status: "ACTIVO" },
      include: { finnegansLinks: { orderBy: [{ priority: "asc" }, { code: "asc" }] } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 500,
    }),
    prisma.hourConcept.findMany({
      where: { status: "ACTIVO" },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      take: 100,
    }),
  ]);
  const data = { noveltyTypes, hourConcepts };
  timeGridCatalogCache = { data, expiresAt: Date.now() + TIME_GRID_CATALOG_CACHE_MS };
  return data;
}

const employeeLaborAuditSelect = {
  id: true,
  legajo: true,
  status: true,
  laborMovements: {
    select: {
      id: true,
      type: true,
      effectiveFrom: true,
      reason: true,
      observation: true,
    },
    orderBy: { effectiveFrom: "desc" as const },
    take: 20,
  },
} satisfies Prisma.EmployeeSelect;

const employeeOrgChartSelect = {
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
  companies: { include: { company: { select: { id: true, name: true, code: true } } } },
  sector: {
    select: {
      id: true,
      name: true,
      code: true,
      area: {
        select: {
          name: true,
          establishment: { select: { name: true, businessUnit: { select: { name: true } } } },
        },
      },
    },
  },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  assignments: { select: { type: true, personName: true } },
} satisfies Prisma.EmployeeSelect;

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function resolveLaborStatus(movements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }>): EmployeeStatus {
  const today = startOfTodayUtc();
  const sorted = [...movements].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const effective = sorted.filter((movement) => movement.effectiveFrom <= today);
  const current = effective[effective.length - 1];
  const scheduledStart = sorted.find((movement) => movement.type === "ALTA" && movement.effectiveFrom > today);
  if (!current && scheduledStart) return EmployeeStatus.INACTIVO;
  return current?.type === "BAJA" ? EmployeeStatus.INACTIVO : EmployeeStatus.ACTIVO;
}

function laborStatusMovements(movements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }>) {
  return movements.map((movement) => ({ effectiveFrom: movement.effectiveFrom, type: movement.type }));
}

function resolveEmployeeStatus(employee: { status: EmployeeStatus; laborMovements: Array<{ type: "ALTA" | "BAJA"; effectiveFrom: Date }> }) {
  if (!employee.laborMovements.length) return employee.status;
  return resolveLaborStatus(laborStatusMovements(employee.laborMovements));
}

function buildWhere(query: ListEmployeesQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
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
  };
}

function buildOrgChartWhere(query: ListEmployeeOrgChartQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    status: query.status,
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
    ...(query.positionId ? { positionId: query.positionId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { legajoFinnegans: { contains: search, mode: "insensitive" } },
            { cuil: { contains: search, mode: "insensitive" } },
            { dni: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { position: { name: { contains: search, mode: "insensitive" } } },
            { sector: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

function buildOptionsWhere(query: ListEmployeeOptionsQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.sectorId ? { sectorId: query.sectorId } : {}),
    ...(query.companyId ? { companies: { some: { companyId: query.companyId } } } : {}),
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
  };
}

function createEmployeeData(input: CreateEmployeeInput) {
  return {
    legajo: input.legajo,
    legajoFinnegans: input.legajoFinnegans || null,
    cuil: input.cuil,
    dni: input.dni,
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate || null,
    gender: input.gender || null,
    civilStatus: input.civilStatus || null,
    nationality: input.nationality || null,
    email: input.email || null,
    phone: input.phone || null,
    mobile: input.mobile || null,
    emergencyContact: input.emergencyContact || null,
    emergencyRelation: input.emergencyRelation || null,
    emergencyPhone: input.emergencyPhone || null,
    status: input.status,
    positionId: input.positionId || null,
    sectorId: input.sectorId || null,
    costCenterId: input.costCenterId || null,
    healthInsurance: input.healthInsurance || null,
    agreement: input.agreement || null,
    receiptCategory: input.receiptCategory || null,
    internalCategory: input.internalCategory || null,
  };
}

function updateEmployeeData(input: UpdateEmployeeInput) {
  return {
    ...(input.legajo !== undefined ? { legajo: input.legajo } : {}),
    ...(input.legajoFinnegans !== undefined ? { legajoFinnegans: input.legajoFinnegans || null } : {}),
    ...(input.cuil !== undefined ? { cuil: input.cuil } : {}),
    ...(input.dni !== undefined ? { dni: input.dni } : {}),
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.birthDate !== undefined ? { birthDate: input.birthDate || null } : {}),
    ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
    ...(input.civilStatus !== undefined ? { civilStatus: input.civilStatus || null } : {}),
    ...(input.nationality !== undefined ? { nationality: input.nationality || null } : {}),
    ...(input.email !== undefined ? { email: input.email || null } : {}),
    ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
    ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
    ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact || null } : {}),
    ...(input.emergencyRelation !== undefined ? { emergencyRelation: input.emergencyRelation || null } : {}),
    ...(input.emergencyPhone !== undefined ? { emergencyPhone: input.emergencyPhone || null } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.positionId !== undefined ? { positionId: input.positionId || null } : {}),
    ...(input.sectorId !== undefined ? { sectorId: input.sectorId || null } : {}),
    ...(input.costCenterId !== undefined ? { costCenterId: input.costCenterId || null } : {}),
    ...(input.healthInsurance !== undefined ? { healthInsurance: input.healthInsurance || null } : {}),
    ...(input.agreement !== undefined ? { agreement: input.agreement || null } : {}),
    ...(input.receiptCategory !== undefined ? { receiptCategory: input.receiptCategory || null } : {}),
    ...(input.internalCategory !== undefined ? { internalCategory: input.internalCategory || null } : {}),
  };
}

function companyLinks(companyIds: string[], primaryCompanyId?: string | null) {
  const uniqueIds = Array.from(new Set(companyIds.filter(Boolean)));
  return uniqueIds.map((companyId, index) => ({
    companyId,
    isPrimary: primaryCompanyId ? companyId === primaryCompanyId : index === 0,
  }));
}

async function fetchSyncBatch(cursor: string | undefined): Promise<Array<{ id: string; currentStatus: EmployeeStatus; nextStatus: EmployeeStatus }>> {
  const rows = await prisma.employee.findMany({
    take: 100,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      laborMovements: { select: { type: true, effectiveFrom: true }, orderBy: { effectiveFrom: "desc" }, take: 5 },
    },
  });
  return rows.map((emp) => ({
    id: emp.id,
    currentStatus: emp.status as EmployeeStatus,
    nextStatus: resolveLaborStatus(emp.laborMovements.map((m) => ({ effectiveFrom: m.effectiveFrom, type: m.type as "ALTA" | "BAJA" }))),
  }));
}

export const employeesRepository = {
  async findMany(query: ListEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildWhere(query), accessWhere, ...(query.status ? [{ status: query.status }] : [])] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeListSelect,
        orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  async summary(accessWhere: Prisma.EmployeeWhereInput) {
    const [statusGroups, pendingTimeEmployeeGroups, missingTimeResponsible] = await prisma.$transaction([
      prisma.employee.groupBy({
        by: ["status"],
        where: accessWhere,
        _count: { _all: true },
      }),
      prisma.timeEntry.groupBy({
        by: ["employeeId"],
        orderBy: { employeeId: "asc" },
        where: {
          employee: accessWhere,
          status: { in: [ApprovalStatus.PENDIENTE, ApprovalStatus.EN_REVISION] },
        },
      }),
      prisma.employee.count({
        where: {
          ...accessWhere,
          status: EmployeeStatus.ACTIVO,
          assignments: { none: { type: "TIME_RESPONSIBLE" } },
        },
      }),
    ]);
    const active = statusGroups.find((group) => group.status === EmployeeStatus.ACTIVO)?._count._all || 0;
    const total = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
    const inactive = total - active;

    return {
      total,
      active,
      inactive,
      missingTimeResponsible,
      pendingTimeLoads: pendingTimeEmployeeGroups.length,
    };
  },

  findOrgChart(query: ListEmployeeOrgChartQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildOrgChartWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeOrgChartSelect,
        orderBy: [{ internalCategory: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findOptions(query: ListEmployeeOptionsQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildOptionsWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.employee.findMany({
        where,
        select: employeeOptionSelect,
        orderBy: [{ status: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: employeeDetailSelect });
  },

  findOverviewById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, select: employeeOverviewSelect });
  },

  async findTimeGrid(id: string, query: EmployeeTimeGridQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const { start, end } = periodRange(query.period);
    const [employee, entries, novelties, catalogs, observedShifts, observedPunches] = await Promise.all([
      prisma.employee.findFirst({
        where: { AND: [{ id }, accessWhere] },
        select: query.includeDetails ? timeGridEmployeeSelect : timeGridCoreEmployeeSelect,
      }),
      prisma.timeEntry.findMany({
        where: { employeeId: id, period: query.period },
        include: timeGridTimeEntryInclude,
        orderBy: [{ date: "asc" }, { hourConcept: { name: "asc" } }],
      }),
      query.includeDetails
        ? prisma.novelty.findMany({
            where: {
              employeeId: id,
              fromDate: { lt: end },
              OR: [{ toDate: null }, { toDate: { gte: start } }],
            },
            include: timeGridNoveltyInclude,
            orderBy: [{ fromDate: "asc" }, { createdAt: "desc" }],
            take: 200,
          })
        : Promise.resolve([]),
      query.includeDetails ? getTimeGridCatalogs() : Promise.resolve(null),
      prisma.workShift.count({
        where: {
          employeeId: id,
          startAt: { gte: start, lt: end },
          status: { in: ["FALTA_SALIDA", "FALTA_INGRESO", "OBSERVADO", "INVALIDO"] },
          reviewStatus: "PENDIENTE",
        },
      }),
      prisma.attendancePunch.count({
        where: {
          employeeId: id,
          timestamp: { gte: start, lt: end },
          status: { in: ["OBSERVADA", "RECHAZADA"] },
          reviewStatus: "PENDIENTE",
          startWorkShifts: { none: {} },
          endWorkShifts: { none: {} },
        },
      }),
    ]);
    if (!employee) return null;

    return {
      employee,
      entries,
      novelties,
      noveltyTypes: catalogs?.noveltyTypes ?? [],
      hourConcepts: catalogs?.hourConcepts ?? [],
      attendanceIssues: observedShifts + observedPunches,
    };
  },

  findLaborAuditSnapshot(id: string) {
    return prisma.employee.findUniqueOrThrow({ where: { id }, select: employeeLaborAuditSelect });
  },

  findByUniqueFields(input: Pick<CreateEmployeeInput, "legajo" | "legajoFinnegans" | "cuil" | "dni">) {
    const uniqueFields: Prisma.EmployeeWhereInput[] = [
      { legajo: input.legajo },
      { cuil: input.cuil },
      { dni: input.dni },
    ];
    if (input.legajoFinnegans) uniqueFields.push({ legajoFinnegans: input.legajoFinnegans });
    return prisma.employee.findFirst({
      where: { OR: uniqueFields },
      select: { id: true, legajo: true, legajoFinnegans: true, cuil: true, dni: true },
    });
  },

  findConflictingUniqueFields(id: string, input: UpdateEmployeeInput) {
    const uniqueFields: Prisma.EmployeeWhereInput[] = [];
    if (input.legajo !== undefined) uniqueFields.push({ legajo: input.legajo });
    if (input.legajoFinnegans) uniqueFields.push({ legajoFinnegans: input.legajoFinnegans });
    if (input.cuil !== undefined) uniqueFields.push({ cuil: input.cuil });
    if (input.dni !== undefined) uniqueFields.push({ dni: input.dni });
    if (!uniqueFields.length) return null;
    return prisma.employee.findFirst({
      where: { id: { not: id }, OR: uniqueFields },
      select: { id: true, legajo: true, legajoFinnegans: true, cuil: true, dni: true },
    });
  },

  async syncLaborStatuses() {
    let cursor: string | undefined = undefined;
    let totalScanned = 0;
    let totalUpdated = 0;

    while (true) {
      const batch = await fetchSyncBatch(cursor);

      if (batch.length === 0) break;

      cursor = batch[batch.length - 1]!.id;
      totalScanned += batch.length;

      const changes = batch
        .filter((emp) => emp.currentStatus !== emp.nextStatus);

      for (const change of changes) {
        await prisma.employee.update({
          where: { id: change.id },
          data: { status: change.nextStatus },
        });
        totalUpdated++;
      }
    }

    return { scanned: totalScanned, updated: totalUpdated };
  },

  create(input: CreateEmployeeInput, createdByUserId?: string | null) {
    const companies = companyLinks(input.companyIds, input.primaryCompanyId);
    const hourConceptIds = Array.from(new Set((input.hourConceptIds || []).filter(Boolean)));
    const initialMovements = input.initialLaborMovement
      ? [{
          type: input.initialLaborMovement.type,
          effectiveFrom: input.initialLaborMovement.effectiveFrom,
          reason: input.initialLaborMovement.reason,
          observation: input.initialLaborMovement.observation || null,
          createdByUserId: createdByUserId || null,
        }]
      : [];
    return prisma.employee.create({
      data: {
        ...createEmployeeData(input),
        ...(initialMovements.length ? { status: resolveLaborStatus(initialMovements) } : {}),
        createdByUserId: createdByUserId || null,
        ...(companies.length ? { companies: { createMany: { data: companies } } } : {}),
        ...(input.address ? { address: { create: input.address } } : {}),
        ...(hourConceptIds.length
          ? { hourConcepts: { createMany: { data: hourConceptIds.map((hourConceptId) => ({ hourConceptId })) } } }
          : {}),
        ...(initialMovements.length ? { laborMovements: { createMany: { data: initialMovements } } } : {}),
      },
      select: employeeDetailSelect,
    });
  },

  update(id: string, input: UpdateEmployeeInput) {
    const shouldReplaceCompanies = input.companyIds !== undefined || input.primaryCompanyId !== undefined;
    const companies = companyLinks(input.companyIds || [], input.primaryCompanyId);

    return prisma.employee.update({
      where: { id },
      data: {
        ...updateEmployeeData(input),
        ...(shouldReplaceCompanies
          ? {
              companies: {
                deleteMany: {},
                ...(companies.length ? { createMany: { data: companies } } : {}),
              },
            }
          : {}),
        ...(input.address
          ? {
              address: {
                upsert: {
                  create: input.address,
                  update: input.address,
                },
              },
            }
          : {}),
      },
      select: employeeDetailSelect,
    });
  },

  updateContact(employeeId: string, input: UpdateEmployeeContactInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile || null } : {}),
        ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact || null } : {}),
        ...(input.emergencyRelation !== undefined ? { emergencyRelation: input.emergencyRelation || null } : {}),
        ...(input.emergencyPhone !== undefined ? { emergencyPhone: input.emergencyPhone || null } : {}),
      },
      select: employeeDetailSelect,
    });
  },

  upsertAddress(employeeId: string, input: UpsertEmployeeAddressInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        address: {
          upsert: {
            create: input,
            update: input,
          },
        },
      },
      select: employeeDetailSelect,
    });
  },

  upsertTransport(employeeId: string, input: UpsertEmployeeTransportInput) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        transport: {
          upsert: {
            create: input,
            update: input,
          },
        },
      },
      select: employeeDetailSelect,
    });
  },

  replaceAssignments(employeeId: string, assignments: EmployeeAssignmentInput[]) {
    return prisma.$transaction(async (tx) => {
      await tx.employeeAssignment.deleteMany({ where: { employeeId } });
      if (assignments.length) {
        await tx.employeeAssignment.createMany({
          data: assignments.map((assignment) => ({
            employeeId,
            type: assignment.type,
            userId: assignment.userId || null,
            personName: assignment.personName || null,
            role: assignment.role || null,
            effectiveFrom: assignment.effectiveFrom || null,
            effectiveTo: assignment.effectiveTo || null,
            status: assignment.status || null,
            notes: assignment.notes || null,
          })),
        });
      }
      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
    });
  },

  replaceHourConcepts(employeeId: string, hourConceptIds: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.employeeHourConcept.deleteMany({ where: { employeeId } });
      const uniqueIds = Array.from(new Set(hourConceptIds.filter(Boolean)));
      if (uniqueIds.length) {
        await tx.employeeHourConcept.createMany({
          data: uniqueIds.map((hourConceptId) => ({ employeeId, hourConceptId })),
        });
      }
      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
    });
  },

  createLaborMovement(employeeId: string, input: CreateLaborMovementInput, createdByUserId?: string | null) {
    return prisma.$transaction(async (tx) => {
      const movement = await tx.laborMovement.create({
        data: {
          employeeId,
          type: input.type,
          effectiveFrom: input.effectiveFrom,
          reason: input.reason,
          observation: input.observation || null,
          createdByUserId: createdByUserId || null,
        },
      });

      const movements = await tx.laborMovement.findMany({
        where: { employeeId },
        select: { type: true, effectiveFrom: true },
      });

      await tx.employee.update({
        where: { id: employeeId },
        data: { status: resolveLaborStatus(movements) },
      });

      const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
      return { employee, movement };
    });
  },

  findDocumentCategory(categoryId: string) {
    return prisma.documentCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, code: true, name: true },
    });
  },

  createDocument(employeeId: string, input: CreateEmployeeDocumentInput & { storageKey: string; storageFileId?: string | null }, uploadedByUserId?: string | null) {
    return prisma.$transaction(async (tx) => {
      await tx.employeeDocument.create({
        data: {
          employeeId,
          categoryId: input.categoryId,
          noveltyId: input.noveltyId || null,
          fileName: input.fileName,
          fileMimeType: input.fileMimeType,
          fileSizeBytes: input.fileSizeBytes,
          storageKey: input.storageKey,
          storageFileId: input.storageFileId || null,
          status: input.status,
          notes: input.notes || null,
          issuedAt: input.issuedAt || null,
          expiresAt: input.expiresAt || null,
          uploadedByUserId: uploadedByUserId || null,
        },
      });

      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: employeeDetailSelect });
    });
  },

  findFieldHistory(employeeId: string, query: ListEmployeeHistoryQuery) {
    return prisma.employeeFieldHistory.findMany({
      where: {
        employeeId,
        ...(query.section ? { section: query.section } : {}),
        ...(query.field ? { field: query.field } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: query.take,
    });
  },

  createFieldHistory(employeeId: string, input: CreateEmployeeFieldHistoryInput, createdByUserId?: string | null) {
    return prisma.employeeFieldHistory.create({
      data: {
        employeeId,
        section: input.section,
        field: input.field,
        fieldLabel: input.fieldLabel,
        oldValue: input.oldValue || null,
        newValue: input.newValue,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        createdByUserId: createdByUserId || null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  },

  findBlockHistory(employeeId: string, query: ListEmployeeHistoryQuery) {
    return prisma.employeeBlockHistory.findMany({
      where: {
        employeeId,
        ...(query.section ? { section: query.section } : {}),
        ...(query.block ? { block: query.block } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      take: query.take,
    });
  },

  createBlockHistory(employeeId: string, input: CreateEmployeeBlockHistoryInput, createdByUserId?: string | null) {
    return prisma.employeeBlockHistory.create({
      data: {
        employeeId,
        section: input.section,
        block: input.block,
        blockLabel: input.blockLabel,
        oldValue: input.oldValue || null,
        newValue: input.newValue,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
        createdByUserId: createdByUserId || null,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  },
};
