import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { noveltiesRepository } from "./novelties.repository";
import type { CreateNoveltyInput, ListNoveltiesQuery, RejectNoveltyInput } from "./novelties.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related employee, novelty type or hour concept not found", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

const roleLabels: Record<string, string> = {
  [roles.rrhh]: "Nivel 1 - RRHH",
  [roles.supervision]: "Nivel 2 - Supervisión / Gestión",
  [roles.cargaHoraria]: "Nivel 3 - Administrativo de Carga Horaria",
};

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function assertCanApprove(novelty: Awaited<ReturnType<typeof noveltiesRepository.findById>>, user: Express.AuthUser) {
  if (user.role === roles.rrhh) return;
  const approvalRoles = asStringArray(novelty?.noveltyType.approvalRoles);
  const roleLabel = roleLabels[user.role] || user.role;
  if (!approvalRoles.includes(roleLabel) && !approvalRoles.includes(user.role)) {
    throw new AppError("User cannot approve or reject this novelty type", 403, "NOVELTY_APPROVAL_FORBIDDEN");
  }
}

function assertCanLoad(type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>, user: Express.AuthUser) {
  if (user.role === roles.rrhh) return;
  const allowedLoadRoles = asStringArray(type?.allowedLoadRoles);
  const roleLabel = roleLabels[user.role] || user.role;
  if (!allowedLoadRoles.includes(roleLabel) && !allowedLoadRoles.includes(user.role)) {
    throw new AppError("User cannot create this novelty type", 403, "NOVELTY_LOAD_FORBIDDEN");
  }
}

async function ensureEmployeesVisible(employeeIds: string[], user: Express.AuthUser) {
  const uniqueIds = Array.from(new Set(employeeIds));
  const count = await noveltiesRepository.countEmployees(uniqueIds, employeeAccessWhere(user));
  if (count !== uniqueIds.length) {
    throw new AppError("One or more employees were not found or are outside your scope", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
  }
}

async function ensureNoveltyTypeReady(input: CreateNoveltyInput) {
  const type = await noveltiesRepository.findNoveltyType(input.noveltyTypeId);
  if (!type || type.status !== "ACTIVO") {
    throw new AppError("Novelty type not found or inactive", 400, "NOVELTY_TYPE_NOT_AVAILABLE");
  }
  if (!type.allowsHours && input.quantityHours) {
    throw new AppError("This novelty type does not allow quantity hours", 400, "NOVELTY_HOURS_NOT_ALLOWED");
  }
  if (!type.allowsDateTo && input.toDate) {
    throw new AppError("This novelty type does not allow toDate", 400, "NOVELTY_TO_DATE_NOT_ALLOWED");
  }
  if (type.hasValidity && !input.toDate) {
    throw new AppError("This novelty type requires fromDate and toDate", 400, "NOVELTY_VALIDITY_REQUIRED");
  }
  return type;
}

export const noveltiesService = {
  async list(query: ListNoveltiesQuery, user: Express.AuthUser) {
    const [items, total] = await noveltiesRepository.findMany(query, employeeAccessWhere(user));
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async create(input: CreateNoveltyInput, user: Express.AuthUser, audit?: AuditContext) {
    await ensureEmployeesVisible(input.employeeIds, user);
    const type = await ensureNoveltyTypeReady(input);
    assertCanLoad(type, user);
    const status = type.requiresApproval ? "PENDIENTE" : "APROBADO";
    const items = await execute(() =>
      noveltiesRepository.createMany(input, status, user.id, {
        createZeroTimeEntries: type.setsWorkedHoursToZero,
        noveltyName: type.name,
      }),
    );

    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "Novelty",
      entityId: items[0]?.id || input.noveltyTypeId,
      description: `Se cargaron ${items.length} novedades ${type.code} - ${type.name}.`,
      after: items as Prisma.InputJsonValue,
    });

    return items;
  },

  async approve(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await noveltiesRepository.findById(id);
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    assertCanApprove(before, user);
    if (before.status !== "PENDIENTE" && before.status !== "EN_REVISION") {
      throw new AppError("Only pending novelties can be approved", 400, "NOVELTY_STATUS_NOT_APPROVABLE");
    }

    const item = await execute(() => noveltiesRepository.approve(id, user.id));
    await auditService.register({
      ...audit,
      action: "APPROVE",
      entity: "Novelty",
      entityId: item.id,
      description: `Se aprobo novedad ${item.noveltyType.code} del legajo ${item.employee.legajo}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async reject(id: string, input: RejectNoveltyInput, user: Express.AuthUser, audit?: AuditContext) {
    const before = await noveltiesRepository.findById(id);
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    assertCanApprove(before, user);
    if (before.status !== "PENDIENTE" && before.status !== "EN_REVISION") {
      throw new AppError("Only pending novelties can be rejected", 400, "NOVELTY_STATUS_NOT_REJECTABLE");
    }

    const item = await execute(() => noveltiesRepository.reject(id));
    await auditService.register({
      ...audit,
      action: "REJECT",
      entity: "Novelty",
      entityId: item.id,
      description: `Se rechazo novedad ${item.noveltyType.code} del legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason } as Prisma.InputJsonValue,
    });
    return item;
  },
};
