import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { hourConceptRulesRepository } from "./hourConceptRules.repository";
import type { CreateHourConceptRuleInput, ListHourConceptRulesQuery, UpdateHourConceptRuleInput } from "./hourConceptRules.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      throw new AppError("No encontramos la regla de concepto horario solicitada", 404, "HOUR_CONCEPT_RULE_NOT_FOUND");
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

async function assertAutomaticAdditionalConcept(hourConceptId: string) {
  const concept = await hourConceptRulesRepository.findHourConceptConfiguration(hourConceptId);
  if (!concept) throw new AppError("No encontramos el concepto horario solicitado", 404, "HOUR_CONCEPT_NOT_FOUND");
  if (concept.systemRole === "NORMAL_BASE") {
    throw new AppError("Horas normales no admite reglas de desglose", 409, "HOUR_CONCEPT_RULE_BASE_NOT_ALLOWED");
  }
  if (concept.status !== "ACTIVO" || concept.deletedAt) {
    throw new AppError("El concepto debe estar activo para configurar reglas", 409, "HOUR_CONCEPT_RULE_INACTIVE_CONCEPT");
  }
  if (concept.loadMode === "MANUAL") {
    throw new AppError("Los conceptos manuales no admiten reglas automáticas", 409, "HOUR_CONCEPT_RULE_MANUAL_NOT_ALLOWED");
  }
}

function publicRule<T extends { priority: number }>(item: T): Omit<T, "priority"> {
  const { priority: _legacyPriority, ...result } = item;
  return result;
}

async function auditRuleChange(
  action: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE",
  item: { id: string; hourConceptId: string; startTime: string; endTime: string },
  audit: AuditContext | undefined,
  before?: unknown,
) {
  const verb = { CREATE: "Se creó", UPDATE: "Se actualizó", ACTIVATE: "Se activó", DEACTIVATE: "Se inactivó" }[action];
  await auditService.register({
    ...audit,
    action,
    entity: "HourConceptRule",
    entityId: item.id,
    description: `${verb} la regla horaria ${item.startTime}-${item.endTime} del concepto ${item.hourConceptId}.`,
    before: before as Prisma.InputJsonValue | undefined,
    after: item as Prisma.InputJsonValue,
  });
}

export const hourConceptRulesService = {
  async list(query: ListHourConceptRulesQuery) {
    const [items, total] = await hourConceptRulesRepository.findMany(query);
    return {
      items: items.map(publicRule),
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },

  async getById(id: string) {
    return publicRule(await execute(() => hourConceptRulesRepository.findById(id)));
  },

  async getByConcept(hourConceptId: string) {
    await assertAutomaticAdditionalConcept(hourConceptId);
    const items = await hourConceptRulesRepository.findByConceptId(hourConceptId);
    return items.map(publicRule);
  },

  async create(data: CreateHourConceptRuleInput, audit?: AuditContext) {
    await assertAutomaticAdditionalConcept(data.hourConceptId);

    const item = await execute(() => hourConceptRulesRepository.create(data));
    await auditRuleChange("CREATE", item, audit);
    return publicRule(item);
  },

  async update(id: string, data: UpdateHourConceptRuleInput, audit?: AuditContext) {
    const before = await execute(() => hourConceptRulesRepository.findById(id));
    await assertAutomaticAdditionalConcept(data.hourConceptId ?? before.hourConceptId);

    const merged = {
      startTime: data.startTime ?? before.startTime,
      endTime: data.endTime ?? before.endTime,
      crossesMidnight: data.crossesMidnight ?? before.crossesMidnight,
      status: data.status ?? before.status,
    };
    if (merged.startTime === merged.endTime) {
      throw new AppError("startTime y endTime no pueden ser iguales", 400, "HOUR_CONCEPT_RULE_INVALID_RANGE");
    }
    const item = await execute(() => hourConceptRulesRepository.update(id, data));
    const action = data.status && data.status !== before.status ? (data.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await auditRuleChange(action, item, audit, before);
    return publicRule(item);
  },

  async updateStatus(id: string, status: "ACTIVO" | "INACTIVO", audit?: AuditContext) {
    return hourConceptRulesService.update(id, { status }, audit);
  },
};
