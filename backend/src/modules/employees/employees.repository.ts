import { EmployeeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateEmployeeDocumentInput,
  CreateEmployeeInput,
  CreateEmployeeBlockHistoryInput,
  CreateLaborMovementInput,
  CreateEmployeeFieldHistoryInput,
  EmployeeAssignmentInput,
  ListEmployeeHistoryQuery,
  ListEmployeeOrgChartQuery,
  ListEmployeesQuery,
  UpdateEmployeeContactInput,
  UpdateEmployeeInput,
  UpsertEmployeeAddressInput,
  UpsertEmployeeTransportInput,
} from "./employees.schemas";

const employeeListSelect = {
  id: true,
  legajo: true,
  legajoFinnegans: true,
  cuil: true,
  dni: true,
  firstName: true,
  lastName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  sector: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, name: true, code: true } },
  companies: { include: { company: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.EmployeeSelect;

const employeeDetailInclude = {
  address: true,
  transport: true,
  sector: { include: { area: { include: { establishment: { include: { businessUnit: true } } } } } },
  costCenter: true,
  position: true,
  companies: { include: { company: true } },
  laborMovements: { orderBy: { effectiveFrom: "desc" } },
  assignments: true,
  hourConcepts: { include: { hourConcept: true } },
  novelties: { include: { noveltyType: true }, orderBy: { fromDate: "desc" }, take: 20 },
  documents: { include: { category: true }, orderBy: { createdAt: "desc" }, take: 20 },
} satisfies Prisma.EmployeeInclude;

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
  const effective = [...movements]
    .filter((movement) => movement.effectiveFrom <= today)
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const current = effective[effective.length - 1];
  return current?.type === "BAJA" ? EmployeeStatus.INACTIVO : EmployeeStatus.ACTIVO;
}

function buildWhere(query: ListEmployeesQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.status ? { status: query.status } : {}),
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

function createEmployeeData(input: CreateEmployeeInput) {
  return {
    legajo: input.legajo,
    legajoFinnegans: input.legajoFinnegans || null,
    cuil: input.cuil,
    dni: input.dni,
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate || null,
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

export const employeesRepository = {
  findMany(query: ListEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where = { AND: [buildWhere(query), accessWhere] };
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

  findById(id: string, accessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.employee.findFirst({ where: { AND: [{ id }, accessWhere] }, include: employeeDetailInclude });
  },

  findByUniqueFields(input: Pick<CreateEmployeeInput, "legajo" | "cuil" | "dni">) {
    return prisma.employee.findFirst({
      where: { OR: [{ legajo: input.legajo }, { cuil: input.cuil }, { dni: input.dni }] },
      select: { id: true, legajo: true, cuil: true, dni: true },
    });
  },

  async syncLaborStatuses() {
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        status: true,
        laborMovements: { select: { type: true, effectiveFrom: true } },
      },
    });
    const changes = employees
      .map((employee) => ({
        id: employee.id,
        currentStatus: employee.status,
        nextStatus: resolveLaborStatus(employee.laborMovements),
      }))
      .filter((item) => item.currentStatus !== item.nextStatus);

    if (!changes.length) {
      return { scanned: employees.length, updated: 0 };
    }

    await prisma.$transaction(
      changes.map((change) =>
        prisma.employee.update({
          where: { id: change.id },
          data: { status: change.nextStatus },
        }),
      ),
    );

    return { scanned: employees.length, updated: changes.length };
  },

  create(input: CreateEmployeeInput, createdByUserId?: string | null) {
    const companies = companyLinks(input.companyIds, input.primaryCompanyId);
    return prisma.employee.create({
      data: {
        ...createEmployeeData(input),
        createdByUserId: createdByUserId || null,
        ...(companies.length ? { companies: { createMany: { data: companies } } } : {}),
        ...(input.address ? { address: { create: input.address } } : {}),
      },
      include: employeeDetailInclude,
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
      include: employeeDetailInclude,
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
      include: employeeDetailInclude,
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
      include: employeeDetailInclude,
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
      include: employeeDetailInclude,
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
          })),
        });
      }
      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeDetailInclude });
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
      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeDetailInclude });
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

      const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeDetailInclude });
      return { employee, movement };
    });
  },

  createDocument(employeeId: string, input: CreateEmployeeDocumentInput & { storageKey: string }, uploadedByUserId?: string | null) {
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
          status: input.status,
          notes: input.notes || null,
          issuedAt: input.issuedAt || null,
          expiresAt: input.expiresAt || null,
          uploadedByUserId: uploadedByUserId || null,
        },
      });

      return tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeDetailInclude });
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
