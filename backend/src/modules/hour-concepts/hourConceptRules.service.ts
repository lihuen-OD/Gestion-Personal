import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { hourConceptRulesRepository } from "./hourConceptRules.repository";
import type { CreateHourConceptRuleInput, ListHourConceptRulesQuery, UpdateHourConceptRuleInput } from "./hourConceptRules.schemas";

export interface RuleTimeWindow {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

// Intervalos (en minutos desde medianoche, [inicio, fin)) que representa una
// regla recurrente diaria. Una regla que no cruza medianoche es un solo
// intervalo; una que cruza se parte en dos ([start,1440) y [0,end)) para
// poder compararla con álgebra de intervalos simple, sin fechas reales — a
// diferencia de ruleOccurrencesOverlapping (hourConceptClassification.ts),
// que resuelve ocurrencias contra un rango de fechas concreto, esto compara
// las DEFINICIONES de dos reglas entre sí, en abstracto.
export function ruleTimeIntervals(rule: RuleTimeWindow): Array<[number, number]> {
  const start = toMinutes(rule.startTime);
  const end = toMinutes(rule.endTime);
  if (!rule.crossesMidnight) return [[start, end]];
  return [
    [start, 24 * 60],
    [0, end],
  ];
}

function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

// Dos reglas se solapan si algún tramo horario de una cae dentro de algún
// tramo de la otra, sin importar el día calendario — son definiciones
// recurrentes, no instantes. 07:00–21:00 y 21:00–04:00 NO se solapan (son
// consecutivas); 21:00–04:00 y 23:00–07:00 sí.
export function ruleTimeWindowsOverlap(a: RuleTimeWindow, b: RuleTimeWindow): boolean {
  const intervalsA = ruleTimeIntervals(a);
  const intervalsB = ruleTimeIntervals(b);
  return intervalsA.some((ia) => intervalsB.some((ib) => intervalsOverlap(ia, ib)));
}

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

async function assertHourConceptExists(hourConceptId: string) {
  const concept = await hourConceptRulesRepository.hourConceptExists(hourConceptId);
  if (!concept) throw new AppError("No encontramos el concepto horario solicitado", 404, "HOUR_CONCEPT_NOT_FOUND");
}

// V1 (decisión cerrada): universo GLOBAL, no por hourConceptId — ver nota en
// hourConceptRulesRepository.findActiveExcept. Solo se valida si la regla
// candidata queda ACTIVA: una regla INACTIVO nunca puede ser ambigua porque
// no participa en la clasificación.
async function assertNoAmbiguousOverlap(candidate: RuleTimeWindow & { priority: number; status: "ACTIVO" | "INACTIVO" }, excludeId?: string) {
  if (candidate.status !== "ACTIVO") return;
  const activeRules = await hourConceptRulesRepository.findActiveExcept(excludeId);
  const ambiguous = activeRules.find((rule) => rule.priority === candidate.priority && ruleTimeWindowsOverlap(rule, candidate));
  if (ambiguous) {
    throw new AppError(
      `La regla se superpone con otra activa de igual prioridad (${ambiguous.startTime}-${ambiguous.endTime}, priority ${ambiguous.priority}) — la clasificación quedaría ambigua. Cambiá la prioridad o el horario.`,
      409,
      "HOUR_CONCEPT_RULE_AMBIGUOUS_OVERLAP",
    );
  }
}

async function auditRuleChange(
  action: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE",
  item: { id: string; hourConceptId: string; startTime: string; endTime: string; priority: number },
  audit: AuditContext | undefined,
  before?: unknown,
) {
  const verb = { CREATE: "Se creó", UPDATE: "Se actualizó", ACTIVATE: "Se activó", DEACTIVATE: "Se inactivó" }[action];
  await auditService.register({
    ...audit,
    action,
    entity: "HourConceptRule",
    entityId: item.id,
    description: `${verb} la regla horaria ${item.startTime}-${item.endTime} (priority ${item.priority}) del concepto ${item.hourConceptId}.`,
    before: before as Prisma.InputJsonValue | undefined,
    after: item as Prisma.InputJsonValue,
  });
}

export const hourConceptRulesService = {
  async list(query: ListHourConceptRulesQuery) {
    const [items, total] = await hourConceptRulesRepository.findMany(query);
    return {
      items,
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },

  getById(id: string) {
    return execute(() => hourConceptRulesRepository.findById(id));
  },

  async getByConcept(hourConceptId: string) {
    await assertHourConceptExists(hourConceptId);
    return hourConceptRulesRepository.findByConceptId(hourConceptId);
  },

  async create(data: CreateHourConceptRuleInput, audit?: AuditContext) {
    await assertHourConceptExists(data.hourConceptId);
    await assertNoAmbiguousOverlap(data);

    const item = await execute(() => hourConceptRulesRepository.create(data));
    await auditRuleChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateHourConceptRuleInput, audit?: AuditContext) {
    const before = await execute(() => hourConceptRulesRepository.findById(id));
    if (data.hourConceptId) await assertHourConceptExists(data.hourConceptId);

    const merged = {
      startTime: data.startTime ?? before.startTime,
      endTime: data.endTime ?? before.endTime,
      crossesMidnight: data.crossesMidnight ?? before.crossesMidnight,
      priority: data.priority ?? before.priority,
      status: data.status ?? before.status,
    };
    if (merged.startTime === merged.endTime) {
      throw new AppError("startTime y endTime no pueden ser iguales", 400, "HOUR_CONCEPT_RULE_INVALID_RANGE");
    }
    await assertNoAmbiguousOverlap(merged, id);

    const item = await execute(() => hourConceptRulesRepository.update(id, data));
    const action = data.status && data.status !== before.status ? (data.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await auditRuleChange(action, item, audit, before);
    return item;
  },

  async updateStatus(id: string, status: "ACTIVO" | "INACTIVO", audit?: AuditContext) {
    return hourConceptRulesService.update(id, { status }, audit);
  },
};
