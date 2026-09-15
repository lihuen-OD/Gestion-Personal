import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { noveltiesRepository } from "./novelties.repository";
import type { CreateNoveltyInput, ListNoveltiesQuery, RejectNoveltyInput } from "./novelties.schemas";
import { notifyRrhh } from "../workforce-management/workforce.service";
import { redactPiiForRole } from "../../shared/security/piiRedaction";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related employee, novelty type, hour concept or user not found", 400, "RELATION_CONSTRAINT");
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

function sameUtcDate(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate();
}

async function ensureNoveltyTypeReady(input: CreateNoveltyInput) {
  const type = await noveltiesRepository.findNoveltyType(input.noveltyTypeId);
  if (!type || type.status !== "ACTIVO") {
    throw new AppError("Novelty type not found or inactive", 400, "NOVELTY_TYPE_NOT_AVAILABLE");
  }
  if (!type.allowsHours && input.quantityHours) {
    throw new AppError("This novelty type does not allow quantity hours", 400, "NOVELTY_HOURS_NOT_ALLOWED");
  }
  if (!type.allowsDateTo && input.toDate && !sameUtcDate(input.toDate, input.fromDate)) {
    throw new AppError("This novelty type does not allow toDate", 400, "NOVELTY_TO_DATE_NOT_ALLOWED");
  }
  if (type.hasValidity && type.allowsDateTo && !input.toDate) {
    throw new AppError("This novelty type requires fromDate and toDate", 400, "NOVELTY_VALIDITY_REQUIRED");
  }
  return type;
}

function normalizeCreateInput(input: CreateNoveltyInput, type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>): CreateNoveltyInput {
  if (!type?.allowsDateTo) {
    return { ...input, toDate: null };
  }
  return input;
}

function rangeBounds(fromDate: Date, toDate: Date | null | undefined) {
  const end = toDate || fromDate;
  return { start: fromDate.getTime(), end: end.getTime() };
}

// Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md):
// bloquea crear una novedad del MISMO tipo para el MISMO empleado cuyo
// rango se superponga con una ya activa (cualquier status salvo
// RECHAZADO). Dos niveles con el mismo código de error no aplica —
// se distingue el mensaje según el rango exista igual (duplicado exacto,
// típicamente el caso "mismo día") o sólo se superponga parcialmente
// (p. ej. dos rangos de "Vacaciones" que se pisan). NO evalúa
// compatibilidad entre tipos distintos (Vacaciones vs. Licencia médica,
// Ausencia vs. Llegada tarde, etc.) porque el modelo actual (`NoveltyType`)
// no tiene ningún campo que permita inferir esa incompatibilidad con
// seguridad — inventar esa regla a partir del nombre/kind del tipo violaría
// la instrucción explícita de esta etapa. Queda documentado como deuda para
// una etapa posterior si se define una matriz de compatibilidad real.
async function ensureNoOverlap(input: CreateNoveltyInput, type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>) {
  const uniqueEmployeeIds = Array.from(new Set(input.employeeIds));
  const conflicts = await noveltiesRepository.findOverlapping(uniqueEmployeeIds, input.noveltyTypeId, input.fromDate, input.toDate || null);
  if (!conflicts.length) return;

  const newRange = rangeBounds(input.fromDate, input.toDate);
  const isExactDuplicate = conflicts.some((conflict) => {
    const existingRange = rangeBounds(conflict.fromDate, conflict.toDate);
    return existingRange.start === newRange.start && existingRange.end === newRange.end;
  });

  const legajos = Array.from(new Set(conflicts.map((conflict) => conflict.employee.legajo))).sort();
  const employeeLabel = legajos.length === 1 ? `el legajo ${legajos[0]}` : `los legajos ${legajos.join(", ")}`;
  const typeName = type?.name || "seleccionada";

  if (isExactDuplicate) {
    throw new AppError(`Ya existe una novedad "${typeName}" para ${employeeLabel} en la fecha seleccionada.`, 409, "NOVELTY_DUPLICATE");
  }
  throw new AppError(`Ya existe una novedad "${typeName}" para ${employeeLabel} que se superpone con el rango de fechas seleccionado.`, 409, "NOVELTY_OVERLAP");
}

export const noveltiesService = {
  async list(query: ListNoveltiesQuery, user: Express.AuthUser) {
    const [items, total] = await noveltiesRepository.findMany(query, employeeAccessWhere(user));
    return {
      items: redactPiiForRole(items, user),
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
    const normalizedInput = normalizeCreateInput(input, type);
    assertCanLoad(type, user);
    await ensureNoOverlap(normalizedInput, type);
    const status = user.role === roles.rrhh ? "APROBADO" : "PENDIENTE";
    // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
    // decisión funcional final — crear una novedad NUNCA crea ni modifica
    // TimeEntry, sea cual sea el status resultante o los campos horarios del
    // tipo (setsWorkedHoursToZero/blocksTimeEntry/timeImpact). El fichador y
    // la carga horaria manual son la única fuente de verdad de horas reales;
    // Novedades es sólo justificación administrativa.
    const items = await execute(() => noveltiesRepository.createMany(normalizedInput, status, user.id));

    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "Novelty",
      entityId: items[0]?.id || normalizedInput.noveltyTypeId,
      description: `Se cargaron ${items.length} novedades ${type.code} - ${type.name}.`,
      after: items as Prisma.InputJsonValue,
    });

    if (user.role !== roles.rrhh) {
      await notifyRrhh({ type: "NOVEDAD_PENDIENTE", title: "Nueva novedad pendiente", message: `${items.length} novedad(es) requieren aprobación de RH.`, entityType: "Novelty", entityId: items[0]?.id, link: "/pendientes", priority: "ALTA" });
    }

    return redactPiiForRole(items, user);
  },

  async approve(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await noveltiesRepository.findById(id);
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    assertCanApprove(before, user);
    if (before.status !== "PENDIENTE" && before.status !== "EN_REVISION") {
      throw new AppError("Only pending novelties can be approved", 400, "NOVELTY_STATUS_NOT_APPROVABLE");
    }

    // Etapa 15G.1: aprobar sólo cambia status/auditoría — nunca crea ni
    // modifica TimeEntry, ni siquiera para un tipo con setsWorkedHoursToZero.
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
    return redactPiiForRole(item, user);
  },

  async approveMany(ids: string[], user: Express.AuthUser, audit?: AuditContext) {
    if (user.role !== roles.rrhh) throw new AppError("Solo RH puede aprobar novedades en lote", 403, "NOVELTY_BULK_APPROVAL_FORBIDDEN");
    const uniqueIds = [...new Set(ids)];
    const approved = [];
    for (const id of uniqueIds) approved.push(await this.approve(id, user, audit));
    return approved;
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
    return redactPiiForRole(item, user);
  },

  async remove(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await noveltiesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    if (before.documents.length) {
      throw new AppError("Novelty has related documents", 409, "NOVELTY_DELETE_HAS_DOCUMENTS");
    }
    // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
    // hasta este ajuste, un tipo con `setsWorkedHoursToZero` bloqueaba el
    // borrado citando que la novedad "generó TimeEntry" — cierto cuando ese
    // campo todavía escribía horas. Ahora Novedades nunca crea ni modifica
    // TimeEntry bajo ningún caso, así que ese motivo ya no puede darse; se
    // quitó el guard en vez de renombrarlo (no queda ninguna razón
    // administrativa real para bloquear el borrado sólo por este campo).
    if (before.status === "APROBADO" && before.noveltyType.exportsToFinnegans) {
      throw new AppError("Approved exportable novelty cannot be deleted", 409, "NOVELTY_DELETE_EXPORTABLE_APPROVED");
    }

    await execute(() => noveltiesRepository.remove(id));
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "Novelty",
      entityId: id,
      description: `Se elimino la novedad ${before.noveltyType.code} del legajo ${before.employee.legajo}.`,
      before: before as Prisma.InputJsonValue,
    });
    return { id };
  },
};
