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
  // Etapa 14H.6: findMany + count son lecturas independientes (ninguna
  // depende del resultado de la otra) — $transaction([...]) las pinaba a una
  // única conexión de Neon en serie sin ganar concurrencia real. A
  // diferencia de hourConcepts/documentCategories (donde este mismo
  // antipatrón sólo se ejercitaba en una rama con filtros activos), acá se
  // usaba SIEMPRE — es el único camino de findMany, sin una rama alternativa
  // sin filtros — así que este fix se ejercita en cada carga de la pantalla,
  // no sólo en un caller secundario. Mismo patrón ya aplicado 12+ veces en
  // las series 14G/14H — where/orderBy/skip/take sin cambios.
  findMany(query: ListAuditParametersQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return Promise.all([
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

  create(data: CreateAuditParameterInput, user?: { id: string; name: string }) {
    const mapped = mapData(data) as Prisma.AuditParameterUncheckedCreateInput;
    return prisma.auditParameter.create({
      data: {
        ...mapped,
        createdByUserId: user?.id,
        createdByUserName: user?.name,
        updatedByUserId: user?.id,
        updatedByUserName: user?.name,
      },
    });
  },

  update(id: string, data: UpdateAuditParameterInput, user?: { id: string; name: string }) {
    const mapped = mapData(data) as Prisma.AuditParameterUncheckedUpdateInput;
    return prisma.auditParameter.update({
      where: { id },
      data: {
        ...mapped,
        updatedByUserId: user?.id,
        updatedByUserName: user?.name,
      },
    });
  },
};
