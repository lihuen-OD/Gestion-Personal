import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type {
  CreateAuditParameterInput,
  ListAuditParametersQuery,
  UpdateAuditParameterInput,
} from "./auditParameters.schemas";

function buildWhere(query: ListAuditParametersQuery): Prisma.AuditParameterWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.scope ? { scope: query.scope } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.requiresReason !== undefined ? { requiresReason: query.requiresReason } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { scope: { contains: search, mode: "insensitive" } },
            { severity: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function mapData(data: CreateAuditParameterInput | UpdateAuditParameterInput) {
  return {
    ...(data.code !== undefined ? { code: data.code } : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.scope !== undefined ? { scope: data.scope } : {}),
    ...(data.severity !== undefined ? { severity: data.severity } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.trackCreate !== undefined ? { trackCreate: data.trackCreate } : {}),
    ...(data.trackUpdate !== undefined ? { trackUpdate: data.trackUpdate } : {}),
    ...(data.trackDeleteOrDeactivate !== undefined ? { trackDeleteOrDeactivate: data.trackDeleteOrDeactivate } : {}),
    ...(data.trackApproval !== undefined ? { trackApproval: data.trackApproval } : {}),
    ...(data.trackExport !== undefined ? { trackExport: data.trackExport } : {}),
    ...(data.requiresReason !== undefined ? { requiresReason: data.requiresReason } : {}),
    ...(data.requiresEffectiveDate !== undefined ? { requiresEffectiveDate: data.requiresEffectiveDate } : {}),
    ...(data.visibleToRoles !== undefined ? { visibleToRoles: data.visibleToRoles } : {}),
    ...(data.notification !== undefined ? { notification: data.notification } : {}),
    ...(data.retention !== undefined ? { retention: data.retention } : {}),
    ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    ...(data.history !== undefined ? { history: data.history } : {}),
  };
}

export const auditParametersRepository = {
  findMany(query: ListAuditParametersQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return prisma.$transaction([
      prisma.auditParameter.findMany({
        where,
        orderBy: [{ status: "asc" }, { scope: "asc" }, { code: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.auditParameter.count({ where }),
    ]);
  },

  findById(id: string) {
    return prisma.auditParameter.findUnique({ where: { id } });
  },

  findByCode(code: string) {
    return prisma.auditParameter.findUnique({ where: { code } });
  },

  create(data: CreateAuditParameterInput, userName?: string) {
    const mapped = mapData(data) as Prisma.AuditParameterCreateInput;
    return prisma.auditParameter.create({
      data: {
        ...mapped,
        createdBy: userName,
        updatedBy: userName,
      },
    });
  },

  update(id: string, data: UpdateAuditParameterInput, userName?: string) {
    const mapped = mapData(data) as Prisma.AuditParameterUpdateInput;
    return prisma.auditParameter.update({
      where: { id },
      data: {
        ...mapped,
        updatedBy: userName,
      },
    });
  },
};
