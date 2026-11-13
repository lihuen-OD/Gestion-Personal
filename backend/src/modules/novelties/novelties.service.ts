import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { argentinaCalendarDate, calendarDateKey, calendarDaysInclusive, formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { evaluateSpecialHourRulesByDate, SpecialHourScopeHistoryMissingError } from "../time-entries/timeEntries.repository";
import { formatMinutes } from "../time-entries/manualHoursConflict.service";
import { noveltiesRepository } from "./novelties.repository";
import type {
  CorrectionNoveltyInput,
  CreateNoveltyCommand,
  CreateNoveltyInput,
  ListNoveltiesQuery,
  NoveltyCoveragePreviewInput,
  NoveltyCoverageResolutionInput,
  RejectNoveltyInput,
} from "./novelties.schemas";
import {
  assertNoveltyCoverageWritableWithin,
  computeNoveltyCoverage,
  coverageDayLabel,
  coverageRangeDays,
  loadRealWorkedMinutesOnDate,
  MAX_COVERAGE_RANGE_DAYS,
  MAX_COVERAGE_ROWS_PER_OPERATION,
  persistNoveltyCoverageWithin,
  toCoverageAppError,
  type CoveragePersistSummary,
} from "./noveltyCoverage.service";
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

// Etapa 15L.2B.1 (corrección puntual, docs/decisions/
// NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md): antes de esta corrección, esta
// función también rechazaba quantityHours/quantityDays según
// `finnegansValueUnit` -- mezclaba la capacidad OPERATIVA de la novedad
// (¿puede cargar esta cantidad?, que depende de `allowsHours` y se valida
// aparte en NOVELTY_HOURS_NOT_ALLOWED, abajo) con la interpretación de
// EXPORTACIÓN de esa cantidad (qué representa Valor 1 en Finnegans, que
// depende únicamente de `finnegansValueUnit` y es un concepto del
// exportador, no de esta validación). Ahora sólo queda la única regla que
// es genuinamente de integridad de datos, independiente de cualquier
// unidad: no tiene sentido cargar horas Y días a la vez para el mismo
// evento.
function assertQuantityCoherence(input: CreateNoveltyInput) {
  if (input.quantityHours != null && input.quantityDays != null) {
    throw new AppError("Esta novedad admite horas o días, no ambos a la vez.", 400, "NOVELTY_QUANTITY_UNIT_CONFLICT");
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
  assertQuantityCoherence(input);
  if (!type.allowsDateRange && input.toDate && !sameUtcDate(input.toDate, input.fromDate)) {
    throw new AppError("This novelty type does not allow toDate", 400, "NOVELTY_TO_DATE_NOT_ALLOWED");
  }
  if (type.finnegansRequiresValidity && type.allowsDateRange && !input.toDate) {
    throw new AppError("This novelty type requires fromDate and toDate", 400, "NOVELTY_VALIDITY_REQUIRED");
  }
  assertCoverageInput(input, type);
  return type;
}

// Motor de cobertura — Etapa 3 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md):
// lo que el motor necesita para calcular sin inventar.
function assertCoverageInput(input: Pick<CreateNoveltyInput, "fromDate" | "toDate" | "quantityHours" | "observation" | "employeeIds">, type: NonNullable<Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>>) {
  if (type.requiresObservation && !input.observation?.trim()) {
    throw new AppError("Esta novedad requiere una observación.", 400, "NOVELTY_OBSERVATION_REQUIRED");
  }
  if (type.coverageMode === "NONE") return;
  if (type.coverageMode === "MANUAL_MINUTES" && input.quantityHours == null) {
    throw new AppError("Indicá el tiempo de la novedad.", 400, "NOVELTY_MANUAL_QUANTITY_REQUIRED");
  }
  // Sin fecha hasta la novedad es de un único día, aunque el tipo admita rango.
  const toDate = type.allowsDateRange ? input.toDate ?? input.fromDate : input.fromDate;
  const days = coverageRangeDays(input.fromDate, toDate);
  if (days > MAX_COVERAGE_RANGE_DAYS) {
    throw new AppError(`Una novedad que registra tiempo puede abarcar hasta ${MAX_COVERAGE_RANGE_DAYS} días.`, 400, "NOVELTY_COVERAGE_RANGE_TOO_LONG");
  }
  if (days * new Set(input.employeeIds).size > MAX_COVERAGE_ROWS_PER_OPERATION) {
    throw new AppError(`La carga generaría más de ${MAX_COVERAGE_ROWS_PER_OPERATION} días de cobertura. Cargala en partes más chicas.`, 400, "NOVELTY_COVERAGE_TOO_LARGE");
  }
}

// Mismo criterio que francos (EMPLOYEE_DAY_OFF.md §12): sobre un período ya
// enviado a cierre sólo RRHH corrige, con motivo.
function correctionPolicy(user: Express.AuthUser, correctionReason: string | null | undefined) {
  const reason = correctionReason?.trim() || null;
  return { allowCorrection: user.role === roles.rrhh && Boolean(reason), reason, isRrhh: user.role === roles.rrhh };
}

function assertCorrectionReason(protectedPeriods: unknown[], policy: ReturnType<typeof correctionPolicy>) {
  if (protectedPeriods.length && policy.isRrhh && !policy.reason) {
    throw new AppError("Indicá el motivo de la corrección: el período ya fue enviado a cierre.", 400, "NOVELTY_CORRECTION_REASON_REQUIRED");
  }
}

const NOVELTY_TRANSACTION_OPTIONS = { timeout: 30_000 };

// RRHH sin motivo recibe el pedido de motivo; el resto, PERIOD_CLOSED.
async function guardNoveltyMutation(tx: PrismaTransactionClient, novelty: Parameters<typeof assertNoveltyCoverageWritableWithin>[1], policy: ReturnType<typeof correctionPolicy>, dateKey?: string) {
  const periods = await assertNoveltyCoverageWritableWithin(tx, novelty, { allowCorrection: policy.isRrhh, ...(dateKey ? { dateKey } : {}) });
  assertCorrectionReason(periods, policy);
  return periods;
}

function normalizeCreateInput(input: CreateNoveltyInput, type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>): CreateNoveltyInput {
  if (!type?.allowsDateRange) {
    return { ...input, toDate: null };
  }
  return input;
}

// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md): el
// backend pasa a ser la única autoridad de `quantityDays` -- deja de
// confiar en lo que mande el cliente (antes: el frontend lo calculaba
// recortado al mes de `fromDate`, lógica duplicada en NoveltyModal.tsx/
// EmployeeHoursPage.tsx). `allowsHours` sigue siendo la única señal que
// decide qué campo aplica, mismo criterio ya establecido en la Etapa
// 15L.2B.1 -- no se vuelve a acoplar nada a `finnegansValueUnit` (que sólo
// interpreta el valor ya persistido para el exportador, nunca decide si
// existe). `allowsHours=true` -> `quantityHours` queda tal cual lo mandó el
// cliente (dato manual, sin cálculo); `quantityDays` siempre `null`.
// `allowsHours=false` -> `quantityDays` = días calendario inclusivos del
// rango REAL (`calendarDaysInclusive`, sin recortar a ningún mes: la
// pertenencia mensual de la novedad ya la decide `fromDate` en el
// exportador, Etapa 15L.3B.1 — la cantidad no necesita repetir ese
// recorte); `quantityHours` siempre `null`. Se aplica DESPUÉS de
// `normalizeCreateInput` para que un tipo con `allowsDateRange=false`
// calcule sobre `toDate=null` (1 día), nunca sobre un `toDate` extendido
// que igual se iba a descartar.
//
// Motor de cobertura — Etapa 1 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md):
// en un tipo de cantidad manual (`coverageMode = MANUAL_MINUTES`, siempre de
// un único día) la cantidad canónica es `quantityMinutes`; mientras el
// formulario siga enviando horas, el backend la deriva de `quantityHours`
// (mismo redondeo que el backfill de la migración) y rechaza más de 24 h en
// un día en vez de recortarlas. En cualquier otro modo queda `null`.
const MAX_MINUTES_PER_DAY = 1440;

function resolveQuantities(input: CreateNoveltyInput, type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>): CreateNoveltyCommand {
  if (type?.allowsHours) {
    return { ...input, quantityDays: null, quantityMinutes: manualQuantityMinutes(input, type) };
  }
  return { ...input, quantityHours: null, quantityDays: calendarDaysInclusive(input.fromDate, input.toDate), quantityMinutes: null };
}

function manualQuantityMinutes(input: CreateNoveltyInput, type: NonNullable<Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>>) {
  if (type.coverageMode !== "MANUAL_MINUTES" || input.quantityHours == null) return null;
  const minutes = Math.round(input.quantityHours * 60);
  if (minutes > MAX_MINUTES_PER_DAY) {
    throw new AppError("La cantidad de una novedad de un único día no puede superar 24 h.", 400, "NOVELTY_MANUAL_QUANTITY_EXCEEDS_DAY");
  }
  return minutes;
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

type ApprovalResult = { before: NonNullable<Awaited<ReturnType<typeof noveltiesRepository.findById>>>; item: Awaited<ReturnType<typeof noveltiesRepository.approve>>; periods: unknown[] };

async function approveWithin(tx: PrismaTransactionClient, ids: string[], user: Express.AuthUser, policy: ReturnType<typeof correctionPolicy>): Promise<ApprovalResult[]> {
  const results: ApprovalResult[] = [];
  for (const id of ids) {
    // Etapa 3: alcance del legajo (antes approve leía sin filtrar por alcance).
    const before = await noveltiesRepository.findById(id, employeeAccessWhere(user), tx);
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    assertCanApprove(before, user);
    if (before.status !== "PENDIENTE" && before.status !== "EN_REVISION") {
      throw new AppError("Only pending novelties can be approved", 400, "NOVELTY_STATUS_NOT_APPROVABLE");
    }
    const periods = await guardNoveltyMutation(tx, before, policy);
    // Etapa 15G.1: aprobar sólo cambia status/auditoría — nunca crea ni
    // modifica TimeEntry, sea cual sea `timeEntryBehavior` del tipo.
    const item = await noveltiesRepository.approve(id, user.id, tx);
    results.push({ before, item, periods });
  }
  return results;
}

async function auditApproval(result: ApprovalResult, policy: ReturnType<typeof correctionPolicy>, audit?: AuditContext) {
  const { before, item, periods } = result;
  await auditService.register({
    ...audit,
    action: "APPROVE",
    entity: "Novelty",
    entityId: item.id,
    description: `Se aprobo novedad ${item.noveltyType.code} del legajo ${item.employee.legajo}.${periods.length ? ` Corrección sobre período cerrado. Motivo: ${policy.reason}` : ""}`,
    before: before as Prisma.InputJsonValue,
    after: { ...item, ...(periods.length ? { correctionReason: policy.reason } : {}) } as Prisma.InputJsonValue,
  });
}

function coverageAuditText(summary: CoveragePersistSummary) {
  if (!summary.days) return "";
  return ` Cobertura: ${summary.days} día(s)${summary.pendingReviewDays ? `, ${summary.pendingReviewDays} para revisar` : ""}.`;
}

type CoverageDayViewInput = {
  dateKey: string;
  outcome: Parameters<typeof coverageDayLabel>[0]["outcome"];
  scheduleReviewReason: Parameters<typeof coverageDayLabel>[0]["scheduleReviewReason"];
  expectedMinutes: number | null;
  baseMinutes: number;
  multiplier: number;
  reviewStatus: string;
  resolution: string | null;
  resolvedBaseMinutes: number | null;
  effectiveBaseMinutes: number;
  computedMinutes: number;
  countsTowardTotal: boolean;
};

function coverageDayView(day: CoverageDayViewInput) {
  return {
    date: day.dateKey,
    outcome: day.outcome,
    scheduleReviewReason: day.scheduleReviewReason,
    reviewStatus: day.reviewStatus,
    label: coverageDayLabel(day),
    expectedMinutes: day.expectedMinutes,
    baseMinutes: day.baseMinutes,
    resolution: day.resolution,
    resolvedBaseMinutes: day.resolvedBaseMinutes,
    effectiveBaseMinutes: day.effectiveBaseMinutes,
    multiplier: day.multiplier,
    computedMinutes: day.computedMinutes,
    countsTowardTotal: day.countsTowardTotal,
  };
}

function coverageTotals(days: Array<{ outcome: string; reviewStatus: string; effectiveBaseMinutes: number; computedMinutes: number }>) {
  return {
    days: days.length,
    coveredDays: days.filter((day) => day.effectiveBaseMinutes > 0).length,
    pendingReviewDays: days.filter((day) => day.reviewStatus === "PENDING").length,
    baseMinutes: days.reduce((sum, day) => sum + day.effectiveBaseMinutes, 0),
    computedMinutes: days.reduce((sum, day) => sum + day.computedMinutes, 0),
  };
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
    const normalizedInput = resolveQuantities(normalizeCreateInput(input, type), type);
    assertCanLoad(type, user);
    await ensureNoOverlap(normalizedInput, type);
    // Etapa 15L.2A (docs/decisions/NOVELTY_TYPE_MODEL_NORMALIZATION_15L2A.md,
    // punto 15): RRHH sigue siendo la autoridad final -- crea siempre
    // APROBADO. Para el resto de los roles, requiresApproval del tipo ahora
    // decide de verdad: `false` autoaprueba, cualquier otro valor (incluido
    // ausente, por defecto seguro) sigue pidiendo aprobación como hasta hoy.
    const status = user.role === roles.rrhh || type.requiresApproval === false ? "APROBADO" : "PENDIENTE";
    // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
    // decisión funcional final — crear una novedad NUNCA crea ni modifica
    // TimeEntry, sea cual sea el status resultante o `timeEntryBehavior` del
    // tipo. El fichador y la carga horaria manual son la única fuente de
    // verdad de horas reales; Novedades es sólo justificación administrativa.
    // Etapa 3: la cobertura diaria (NoveltyDayCoverage, nunca TimeEntry) se
    // genera en la misma transacción; si no se puede calcular sin inventar
    // (historia laboral faltante) o el período está cerrado, no se crea nada.
    const policy = correctionPolicy(user, input.correctionReason);
    const { items, coverage } = await execute(() =>
      prisma.$transaction(async (tx) => {
        const created = await noveltiesRepository.createMany(normalizedInput, status, user.id, tx);
        const summary = await persistNoveltyCoverageWithin(tx, created.map((item) => item.id), {
          protectedPeriods: policy.allowCorrection ? "ALLOW_CORRECTION" : "REJECT",
        });
        return { items: created, coverage: summary };
      }, NOVELTY_TRANSACTION_OPTIONS),
    ).catch((error) => {
      if (error instanceof AppError && error.code === "PERIOD_CLOSED" && policy.isRrhh && !policy.reason) {
        throw new AppError("Indicá el motivo de la corrección: el período ya fue enviado a cierre.", 400, "NOVELTY_CORRECTION_REASON_REQUIRED");
      }
      throw error;
    });

    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "Novelty",
      entityId: items[0]?.id || normalizedInput.noveltyTypeId,
      description: `Se cargaron ${items.length} novedades ${type.code} - ${type.name}.${coverageAuditText(coverage)}${coverage.protectedPeriods.length ? ` Corrección sobre período cerrado. Motivo: ${policy.reason}` : ""}`,
      after: { items, coverage, ...(coverage.protectedPeriods.length ? { correctionReason: policy.reason } : {}) } as unknown as Prisma.InputJsonValue,
    });

    // Etapa 15L.2A: sólo notifica si de verdad queda pendiente -- con
    // requiresApproval=false ya nace APROBADO y no hay nada que revisar.
    if (status === "PENDIENTE") {
      await notifyRrhh({ type: "NOVEDAD_PENDIENTE", title: "Nueva novedad pendiente", message: `${items.length} novedad(es) requieren aprobación de RH.`, entityType: "Novelty", entityId: items[0]?.id, link: "/pendientes", priority: "ALTA" });
    }

    return redactPiiForRole(items, user);
  },

  async approve(id: string, user: Express.AuthUser, audit?: AuditContext, input: CorrectionNoveltyInput = {}) {
    const policy = correctionPolicy(user, input.correctionReason);
    // Etapa 3: alcance del legajo + guard de cierres en la misma transacción.
    // Aprobar no reescribe la cobertura (el estado se lee al contabilizar).
    const [result] = await execute(() => prisma.$transaction((tx) => approveWithin(tx, [id], user, policy), NOVELTY_TRANSACTION_OPTIONS));
    await auditApproval(result!, policy, audit);
    return redactPiiForRole(result!.item, user);
  },

  // Etapa 3: atómico — si una novedad del lote no se puede aprobar, no se
  // aprueba ninguna (antes se aprobaban una por una y un error dejaba el lote
  // a medias). Sin motivo de corrección: un período cerrado rechaza el lote.
  async approveMany(ids: string[], user: Express.AuthUser, audit?: AuditContext) {
    if (user.role !== roles.rrhh) throw new AppError("Solo RH puede aprobar novedades en lote", 403, "NOVELTY_BULK_APPROVAL_FORBIDDEN");
    const uniqueIds = [...new Set(ids)];
    const policy = correctionPolicy(user, null);
    const results = await execute(() => prisma.$transaction((tx) => approveWithin(tx, uniqueIds, user, policy), NOVELTY_TRANSACTION_OPTIONS));
    for (const result of results) await auditApproval(result, policy, audit);
    return results.map((result) => redactPiiForRole(result.item, user));
  },

  async reject(id: string, input: RejectNoveltyInput, user: Express.AuthUser, audit?: AuditContext) {
    // Etapa 3: el motivo del rechazo es también el motivo de una corrección
    // de RRHH sobre un período cerrado.
    const policy = correctionPolicy(user, input.reason);
    const { before, item, periods } = await execute(() =>
      prisma.$transaction(async (tx) => {
        const before = await noveltiesRepository.findById(id, employeeAccessWhere(user), tx);
        if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
        assertCanApprove(before, user);
        if (before.status !== "PENDIENTE" && before.status !== "EN_REVISION") {
          throw new AppError("Only pending novelties can be rejected", 400, "NOVELTY_STATUS_NOT_REJECTABLE");
        }
        const periods = await guardNoveltyMutation(tx, before, policy);
        const item = await noveltiesRepository.reject(id, tx);
        // Una novedad rechazada no tiene cobertura: sus filas derivadas se
        // eliminan (la auditoría conserva la novedad completa).
        await tx.noveltyDayCoverage.deleteMany({ where: { noveltyId: id } });
        return { before, item, periods };
      }, NOVELTY_TRANSACTION_OPTIONS),
    );
    await auditService.register({
      ...audit,
      action: "REJECT",
      entity: "Novelty",
      entityId: item.id,
      description: `Se rechazo novedad ${item.noveltyType.code} del legajo ${item.employee.legajo}. Motivo: ${input.reason}${periods.length ? " (corrección sobre período cerrado)" : ""}`,
      before: before as Prisma.InputJsonValue,
      after: { item, reason: input.reason, ...(periods.length ? { correctionReason: input.reason } : {}) } as Prisma.InputJsonValue,
    });
    return redactPiiForRole(item, user);
  },

  async remove(id: string, user: Express.AuthUser, audit?: AuditContext, input: CorrectionNoveltyInput = {}) {
    const policy = correctionPolicy(user, input.correctionReason);
    const before = await noveltiesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    if (before.documents.length) {
      throw new AppError("Novelty has related documents", 409, "NOVELTY_DELETE_HAS_DOCUMENTS");
    }
    // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
    // Novedades nunca crea ni modifica TimeEntry bajo ningún caso, así que no
    // hay ninguna razón administrativa para bloquear el borrado por el
    // comportamiento horario del tipo.
    if (before.status === "APROBADO" && before.noveltyType.exportsToFinnegans) {
      throw new AppError("Approved exportable novelty cannot be deleted", 409, "NOVELTY_DELETE_EXPORTABLE_APPROVED");
    }

    // Etapa 3: guard de cierres en la misma transacción; la cobertura cae
    // por Cascade (dato derivado).
    const periods = await execute(() =>
      prisma.$transaction(async (tx) => {
        const periods = await guardNoveltyMutation(tx, before, policy);
        await noveltiesRepository.remove(id, tx);
        return periods;
      }, NOVELTY_TRANSACTION_OPTIONS),
    );
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "Novelty",
      entityId: id,
      description: `Se elimino la novedad ${before.noveltyType.code} del legajo ${before.employee.legajo}.${periods.length ? ` Corrección sobre período cerrado. Motivo: ${policy.reason}` : ""}`,
      before: before as Prisma.InputJsonValue,
      ...(periods.length ? { after: { correctionReason: policy.reason } as Prisma.InputJsonValue } : {}),
    });
    return { id };
  },

  // ── Cobertura (etapa 3) ──────────────────────────────────────────────────

  /**
   * Vista previa: el mismo motor que la persistencia, sin escribir nada. Mismos
   * permisos y alcance que la carga.
   */
  async previewCoverage(input: NoveltyCoveragePreviewInput, user: Express.AuthUser) {
    await ensureEmployeesVisible(input.employeeIds, user);
    const type = await noveltiesRepository.findNoveltyType(input.noveltyTypeId);
    if (!type || type.status !== "ACTIVO") throw new AppError("Novelty type not found or inactive", 400, "NOVELTY_TYPE_NOT_AVAILABLE");
    assertCanLoad(type, user);
    if (!type.allowsDateRange && input.toDate && !sameUtcDate(input.toDate, input.fromDate)) {
      throw new AppError("This novelty type does not allow toDate", 400, "NOVELTY_TO_DATE_NOT_ALLOWED");
    }
    assertCoverageInput({ ...input, observation: "vista previa" }, type);
    const quantityMinutes = type.coverageMode === "MANUAL_MINUTES" && input.quantityHours != null ? Math.round(input.quantityHours * 60) : null;
    const toDate = type.allowsDateRange ? input.toDate ?? input.fromDate : input.fromDate;
    if (type.coverageMode === "NONE" && coverageRangeDays(input.fromDate, toDate) > MAX_COVERAGE_RANGE_DAYS) {
      throw new AppError(`La vista previa abarca hasta ${MAX_COVERAGE_RANGE_DAYS} días.`, 400, "NOVELTY_COVERAGE_RANGE_TOO_LONG");
    }
    const employeeIds = [...new Set(input.employeeIds)];
    const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, legajo: true, firstName: true, lastName: true } });
    let computed;
    try {
      computed = await computeNoveltyCoverage(prisma, employeeIds.map((employeeId) => ({ key: employeeId, employeeId, type, fromDate: input.fromDate, toDate, quantityMinutes })));
    } catch (error) {
      const employee = employees.find((item) => item.id === (error as { employeeId?: string }).employeeId);
      throw toCoverageAppError(error, employee);
    }
    return {
      noveltyType: { id: type.id, code: type.code, name: type.name },
      employees: employees.map((employee) => {
        const days = computed.get(employee.id) ?? [];
        return {
          employee,
          days: days.map(coverageDayView),
          totals: coverageTotals(days),
        };
      }),
    };
  },

  /** Cobertura diaria persistida de una novedad (respeta el alcance del legajo). */
  async getCoverage(id: string, user: Express.AuthUser) {
    const novelty = await noveltiesRepository.findById(id, employeeAccessWhere(user));
    if (!novelty) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    const rows = await prisma.noveltyDayCoverage.findMany({
      where: { noveltyId: id },
      orderBy: { date: "asc" },
      include: { shiftTemplate: { select: { code: true, name: true } }, resolvedBy: { select: { name: true } } },
    });
    const days = rows.map((row) => {
      const effectiveBaseMinutes = row.resolvedBaseMinutes ?? row.baseMinutes;
      const multiplier = Number(row.appliedMultiplier);
      return {
        ...coverageDayView({
          dateKey: calendarDateKey(row.date),
          outcome: row.outcome,
          scheduleReviewReason: row.scheduleReviewReason,
          expectedMinutes: row.expectedMinutes,
          baseMinutes: row.baseMinutes,
          multiplier,
          reviewStatus: row.reviewStatus,
          resolution: row.resolution,
          resolvedBaseMinutes: row.resolvedBaseMinutes,
          effectiveBaseMinutes,
          computedMinutes: Math.round(effectiveBaseMinutes * multiplier),
          countsTowardTotal: row.countsTowardTotal,
        }),
        shiftTemplate: row.shiftTemplate,
        resolvedBy: row.resolvedBy?.name ?? null,
        resolvedAt: row.resolvedAt,
        resolutionNote: row.resolutionNote,
      };
    });
    return {
      novelty: { id: novelty.id, status: novelty.status, fromDate: novelty.fromDate, toDate: novelty.toDate, noveltyType: { code: novelty.noveltyType.code, name: novelty.noveltyType.name } },
      days,
      totals: coverageTotals(days),
    };
  },

  /**
   * Resolución manual de un día en revisión (jornada o relación laboral sin
   * resolver): confirmar 0 h o indicar las horas base. Nunca "aceptar con
   * trabajo real". Guarda autor, fecha, nota y los minutos reales del día.
   */
  async resolveCoverageDay(id: string, dateKey: string, input: NoveltyCoverageResolutionInput, user: Express.AuthUser, audit?: AuditContext) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(argentinaCalendarDate(dateKey).getTime()) || calendarDateKey(argentinaCalendarDate(dateKey)) !== dateKey) {
      throw new AppError("Fecha inválida: usá el formato AAAA-MM-DD.", 400, "VALIDATION_ERROR");
    }
    const policy = correctionPolicy(user, input.correctionReason);
    const outcome = await execute(() =>
      prisma.$transaction(async (tx) => {
        const novelty = await noveltiesRepository.findById(id, employeeAccessWhere(user), tx);
        if (!novelty) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
        if (novelty.status === "RECHAZADO") throw new AppError("Una novedad rechazada no tiene cobertura.", 409, "NOVELTY_COVERAGE_REJECTED");
        const type = await noveltiesRepository.findNoveltyType(novelty.noveltyTypeId, tx);
        if (!type) throw new AppError("Novelty type not found", 404, "NOVELTY_TYPE_NOT_FOUND");
        assertCanLoad(type, user);
        const periods = await guardNoveltyMutation(tx, novelty, policy, dateKey);
        const date = argentinaCalendarDate(dateKey);
        const row = await tx.noveltyDayCoverage.findUnique({ where: { noveltyId_date: { noveltyId: id, date } } });
        if (!row) throw new AppError("Ese día no pertenece a la cobertura de la novedad.", 404, "NOVELTY_COVERAGE_DAY_NOT_FOUND");
        // Sólo los días con jornada o relación laboral sin resolver se
        // resuelven a mano (también para corregir una resolución anterior).
        // La falta de historia para un feriado nunca llega acá: es un error.
        if (row.outcome !== "SCHEDULE_UNRESOLVED") {
          throw new AppError("Este día no está en revisión.", 409, "NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW");
        }
        const baseMinutes = input.resolution === "CONFIRMED_ZERO" ? 0 : input.baseMinutes!;
        let multiplier = 1;
        if (type.coverageAppliesSpecialHours && baseMinutes > 0) {
          const evaluation = (await evaluateSpecialHourRulesByDate(novelty.employeeId, [date], tx)).get(dateKey);
          if (evaluation?.missingHistory) throw new SpecialHourScopeHistoryMissingError(evaluation.missingHistory);
          multiplier = evaluation?.resolution.multiplier ?? 1;
        }
        const workedMinutes = await loadRealWorkedMinutesOnDate(tx, novelty.employeeId, dateKey);
        const updated = await tx.noveltyDayCoverage.update({
          where: { id: row.id },
          data: {
            reviewStatus: "RESOLVED",
            resolution: input.resolution,
            resolvedBaseMinutes: baseMinutes,
            resolvedAgainstWorkedMinutes: workedMinutes,
            resolvedByUserId: user.id,
            resolvedAt: new Date(),
            resolutionNote: input.note,
            appliedMultiplier: multiplier,
          },
        });
        return { novelty, type, before: row, updated, periods };
      }, NOVELTY_TRANSACTION_OPTIONS),
    );
    const { novelty, type, before, updated, periods } = outcome;
    const result = input.resolution === "CONFIRMED_ZERO" ? "sin horas (0 h confirmadas)" : `${formatMinutes(input.baseMinutes!)} base${Number(updated.appliedMultiplier) !== 1 ? ` × ${Number(updated.appliedMultiplier)}` : ""}`;
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Novelty",
      entityId: id,
      description: `Se resolvió la cobertura de ${type.name} de ${formatEmployeeReference(novelty.employee)} para el ${formatArgentinaDate(dateKey)}: ${result}. Nota: ${input.note}${periods.length ? ` Corrección sobre período cerrado. Motivo: ${policy.reason}` : ""}`,
      before: before as unknown as Prisma.InputJsonValue,
      after: { ...updated, ...(periods.length ? { correctionReason: policy.reason } : {}) } as unknown as Prisma.InputJsonValue,
    });
    return coverageDayView({
      dateKey,
      outcome: updated.outcome,
      scheduleReviewReason: updated.scheduleReviewReason,
      expectedMinutes: updated.expectedMinutes,
      baseMinutes: updated.baseMinutes,
      multiplier: Number(updated.appliedMultiplier),
      reviewStatus: updated.reviewStatus,
      resolution: updated.resolution,
      resolvedBaseMinutes: updated.resolvedBaseMinutes,
      effectiveBaseMinutes: updated.resolvedBaseMinutes ?? updated.baseMinutes,
      computedMinutes: Math.round((updated.resolvedBaseMinutes ?? updated.baseMinutes) * Number(updated.appliedMultiplier)),
      countsTowardTotal: updated.countsTowardTotal,
    });
  },
};
