import { Prisma } from "@prisma/client";
import { accountingNoveltyCoverageSelect, accountNoveltyDay, toAccountingNoveltyCoverage } from "../time-entries/workedTimeAccounting";
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
import type { CoverageDayResult } from "./noveltyCoverage.engine";
import { assertDocumentBatchSize, compensateNoveltyDocuments, persistNoveltyDocumentsWithin, uploadNoveltyDocuments } from "./noveltyDocuments";
import type {
  CreateNoveltyCommand,
  CreateNoveltyInput,
  CreateNoveltyWithDocumentInput,
  ListNoveltiesQuery,
  NoveltyDocumentInput,
  NoveltyCoveragePreviewInput,
  NoveltyCoverageResolutionInput,
  UpdateNoveltyInput,
} from "./novelties.schemas";
import {
  assertNoveltyCoverageWritableWithin,
  computeNoveltyCoverage,
  coverageDayLabel,
  coverageRangeDays,
  loadRealWorkedMinutesByDay,
  loadRealWorkedMinutesOnDate,
  MAX_COVERAGE_RANGE_DAYS,
  MAX_COVERAGE_ROWS_PER_OPERATION,
  persistNoveltyCoverageWithin,
  toCoverageAppError,
  type CoveragePersistSummary,
} from "./noveltyCoverage.service";
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

function canLoadType(type: { allowedLoadRoles?: unknown } | null | undefined, user: Express.AuthUser) {
  if (user.role === roles.rrhh) return true;
  const allowedLoadRoles = asStringArray(type?.allowedLoadRoles);
  const roleLabel = roleLabels[user.role] || user.role;
  return allowedLoadRoles.includes(roleLabel) || allowedLoadRoles.includes(user.role);
}

/**
 * Máximo de cobertura de un día ajustado a mano (NOVELTY_COVERAGE_ENGINE.md
 * §19): el valor fijo del tipo, la cantidad cargada o la jornada conocida.
 * `null` = sin tope propio (tipo según jornada con la jornada sin resolver:
 * rige el límite general de 24 h del schema).
 */
export function coverageAdjustmentMaxMinutes(
  type: { coverageMode: string; coverageFixedMinutes: number | null },
  quantityMinutes: number | null,
  row: { outcome: string; expectedMinutes: number | null },
): number | null {
  if (type.coverageMode === "FIXED_MINUTES") return type.coverageFixedMinutes ?? 0;
  if (type.coverageMode === "MANUAL_MINUTES") return quantityMinutes ?? 0;
  if (type.coverageMode === "EXPECTED_SCHEDULE") return row.outcome === "SCHEDULE_UNRESOLVED" || row.expectedMinutes === null ? null : row.expectedMinutes;
  return 0;
}

function assertCanLoad(type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>, user: Express.AuthUser) {
  if (!canLoadType(type, user)) throw new AppError("User cannot create this novelty type", 403, "NOVELTY_LOAD_FORBIDDEN");
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

const NOVELTY_TRANSACTION_OPTIONS = { timeout: 30_000 };

// Un período CERRADO responde PERIOD_CLOSED para todos los roles hasta su
// reapertura auditada.
async function guardNoveltyMutation(tx: PrismaTransactionClient, novelty: Parameters<typeof assertNoveltyCoverageWritableWithin>[1], dateKey?: string) {
  await assertNoveltyCoverageWritableWithin(tx, novelty, { allowCorrection: false, ...(dateKey ? { dateKey } : {}) });
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
async function ensureNoOverlap(input: CreateNoveltyInput, type: Awaited<ReturnType<typeof noveltiesRepository.findNoveltyType>>, excludeId?: string) {
  const uniqueEmployeeIds = Array.from(new Set(input.employeeIds));
  const conflicts = await noveltiesRepository.findOverlapping(uniqueEmployeeIds, input.noveltyTypeId, input.fromDate, input.toDate || null, excludeId);
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

/**
 * Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15): cómo quedará el día frente al
 * trabajo real ya registrado, con la MISMA función que la grilla y el cierre
 * (`accountNoveltyDay`). Se evalúa como aprobada para mostrar si va a sumar,
 * si es informativa o si quedará para revisión; el estado inicial real se
 * informa aparte (`initialStatus`).
 */
function previewDayAccounting(employeeId: string, noveltyTypeId: string, day: CoverageDayResult, workedMinutes: number) {
  const [item] = accountNoveltyDay([{
    employeeId,
    day: Number(day.dateKey.slice(8, 10)),
    dateKey: day.dateKey,
    noveltyId: "preview",
    noveltyTypeId,
    status: "APROBADO",
    outcome: day.outcome,
    scheduleReviewReason: day.scheduleReviewReason,
    baseMinutes: day.baseMinutes,
    resolvedBaseMinutes: day.resolvedBaseMinutes,
    multiplier: day.multiplier,
    countsTowardTotal: day.countsTowardTotal,
    realWorkCompatibility: day.realWorkCompatibility,
    expectedMinutes: day.expectedMinutes,
    reviewStatus: day.reviewStatus,
    resolution: day.resolution,
    resolvedAgainstWorkedMinutes: day.resolvedAgainstWorkedMinutes,
  }], workedMinutes).items;
  // Una sola cobertura no rechazada siempre produce un ítem.
  return { workedMinutes, stateWhenApproved: item!.state, reviewReasons: item!.reviewReasons };
}

/**
 * Alta de novedades (una por legajo). `document` sólo llega por
 * createWithDocument; un tipo que exige documentación no se crea sin ella
 * (NOVELTY_COVERAGE_ENGINE.md §15.1).
 */
async function createNovelties(input: CreateNoveltyInput, document: NoveltyDocumentInput | null, user: Express.AuthUser, audit?: AuditContext) {
  // Antes de cualquier lectura o subida: con documento, lotes de hasta 25 personas.
  if (document) assertDocumentBatchSize(input.employeeIds);
  await ensureEmployeesVisible(input.employeeIds, user);
  const type = await ensureNoveltyTypeReady(input);
  if (type.requiresDocumentation && !document) {
    throw new AppError("Este tipo de novedad requiere adjuntar documentación.", 400, "NOVELTY_DOCUMENTATION_REQUIRED");
  }
  const normalizedInput = resolveQuantities(normalizeCreateInput(input, type), type);
  assertCanLoad(type, user);
  await ensureNoOverlap(normalizedInput, type);
  // Toda novedad cargada por N1/N2/N3 autorizado es efectiva al guardar.
  const status = "APROBADO" as const;
  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // decisión funcional final — crear una novedad NUNCA crea ni modifica
  // TimeEntry, sea cual sea el status resultante o `timeEntryBehavior` del
  // tipo. El fichador y la carga horaria manual son la única fuente de
  // verdad de horas reales; Novedades es sólo justificación administrativa.
  // Etapa 3: la cobertura diaria (NoveltyDayCoverage, nunca TimeEntry) se
  // genera en la misma transacción; si no se puede calcular sin inventar
  // (historia laboral faltante) o el período está cerrado, no se crea nada.
  // Documento: se sube antes de la transacción (sin red adentro) y se
  // compensa si la transacción falla (noveltyDocuments.ts).
  const uploads = document ? await uploadNoveltyDocuments([...new Set(normalizedInput.employeeIds)], document, user, audit) : [];
  const { items, coverage, documents } = await execute(() =>
    prisma.$transaction(async (tx) => {
      const created = await noveltiesRepository.createMany(normalizedInput, status, user.id, tx);
      const summary = await persistNoveltyCoverageWithin(tx, created.map((item) => item.id), {
        protectedPeriods: "REJECT",
      });
      const createdDocuments = document ? await persistNoveltyDocumentsWithin(tx, uploads, created, document, audit?.userId) : [];
      return { items: created, coverage: summary, documents: createdDocuments };
    }, NOVELTY_TRANSACTION_OPTIONS),
  ).catch(async (error) => {
    await compensateNoveltyDocuments(uploads);
    throw error;
  });

  await auditService.register({
    ...audit,
    action: "CREATE",
    entity: "Novelty",
    entityId: items[0]?.id || normalizedInput.noveltyTypeId,
    description: `Se cargaron ${items.length} novedades ${type.code} - ${type.name}.${coverageAuditText(coverage)}${documents.length ? ` Con documentación (${documents.length} archivo${documents.length === 1 ? "" : "s"}).` : ""}`,
    after: { items, coverage, documents } as unknown as Prisma.InputJsonValue,
  });

  return redactPiiForRole(items, user);
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

  /** Alta sin documento: un tipo que exige documentación se rechaza (usar createWithDocument). */
  create(input: CreateNoveltyInput, user: Express.AuthUser, audit?: AuditContext) {
    return createNovelties(input, null, user, audit);
  },

  /**
   * Etapa 8 (NOVELTY_COVERAGE_ENGINE.md §15.1): alta con su documento, de
   * forma coordinada (ver noveltyDocuments.ts). Nunca queda una novedad que
   * exige documentación sin su documento.
   */
  createWithDocument(input: CreateNoveltyWithDocumentInput, user: Express.AuthUser, audit?: AuditContext) {
    const { document, ...noveltyInput } = input;
    return createNovelties(noveltyInput, document, user, audit);
  },

  async update(id: string, input: UpdateNoveltyInput, user: Express.AuthUser, audit?: AuditContext) {
    const before = await noveltiesRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
    const merged: CreateNoveltyInput = {
      employeeIds: [before.employeeId],
      noveltyTypeId: input.noveltyTypeId ?? before.noveltyTypeId,
      fromDate: input.fromDate ?? before.fromDate,
      toDate: input.toDate !== undefined ? input.toDate : before.toDate,
      quantityHours: input.quantityHours !== undefined ? input.quantityHours : before.quantityHours == null ? null : Number(before.quantityHours),
      quantityDays: input.quantityDays !== undefined ? input.quantityDays : before.quantityDays == null ? null : Number(before.quantityDays),
      observation: input.observation !== undefined ? input.observation : before.observation,
      targetHourConceptId: input.targetHourConceptId !== undefined ? input.targetHourConceptId : before.targetHourConceptId,
    };
    const type = await ensureNoveltyTypeReady(merged);
    assertCanLoad(type, user);
    const normalized = resolveQuantities(normalizeCreateInput(merged, type), type);
    await ensureNoOverlap(normalized, type, id);
    const item = await execute(() => prisma.$transaction(async (tx) => {
      await guardNoveltyMutation(tx, before);
      const updated = await noveltiesRepository.update(id, {
        noveltyTypeId: normalized.noveltyTypeId,
        fromDate: normalized.fromDate,
        toDate: normalized.toDate,
        quantityHours: normalized.quantityHours,
        quantityDays: normalized.quantityDays,
        quantityMinutes: normalized.quantityMinutes,
        observation: normalized.observation,
        targetHourConceptId: normalized.targetHourConceptId,
      }, tx);
      await persistNoveltyCoverageWithin(tx, [id], { protectedPeriods: "REJECT" });
      return updated;
    }, NOVELTY_TRANSACTION_OPTIONS));
    await auditService.register({ ...audit, action: "UPDATE", entity: "Novelty", entityId: id, description: `Se corrigió la novedad ${item.noveltyType.code} del legajo ${item.employee.legajo}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return redactPiiForRole(item, user);
  },

  async remove(id: string, user: Express.AuthUser, audit?: AuditContext) {
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
    await execute(() =>
      prisma.$transaction(async (tx) => {
        await guardNoveltyMutation(tx, before);
        await noveltiesRepository.remove(id, tx);
      }, NOVELTY_TRANSACTION_OPTIONS),
    );
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
    const worked = await loadRealWorkedMinutesByDay(prisma, employeeIds, calendarDateKey(input.fromDate), calendarDateKey(toDate));
    return {
      noveltyType: { id: type.id, code: type.code, name: type.name },
      initialStatus: "APROBADO" as const,
      employees: employees.map((employee) => {
        const days = computed.get(employee.id) ?? [];
        const workedByDay = worked.get(employee.id);
        return {
          employee,
          days: days.map((day) => ({ ...coverageDayView(day), ...previewDayAccounting(employee.id, type.id, day, workedByDay?.get(day.dateKey) ?? 0) })),
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
      // §18: quien puede cargar el tipo puede ajustar un día (mismo criterio que la resolución).
      canAdjust: canLoadType(novelty.noveltyType, user),
      novelty: {
        id: novelty.id,
        status: novelty.status,
        fromDate: novelty.fromDate,
        toDate: novelty.toDate,
        quantityMinutes: novelty.quantityMinutes,
        noveltyType: { code: novelty.noveltyType.code, name: novelty.noveltyType.name, coverageMode: novelty.noveltyType.coverageMode, coverageFixedMinutes: novelty.noveltyType.coverageFixedMinutes },
      },
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
    const outcome = await execute(() =>
      prisma.$transaction(async (tx) => {
        const novelty = await noveltiesRepository.findById(id, employeeAccessWhere(user), tx);
        if (!novelty) throw new AppError("Novelty not found", 404, "NOVELTY_NOT_FOUND");
        if (novelty.status === "RECHAZADO") throw new AppError("Una novedad rechazada no tiene cobertura.", 409, "NOVELTY_COVERAGE_REJECTED");
        const type = await noveltiesRepository.findNoveltyType(novelty.noveltyTypeId, tx);
        if (!type) throw new AppError("Novelty type not found", 404, "NOVELTY_TYPE_NOT_FOUND");
        assertCanLoad(type, user);
        await guardNoveltyMutation(tx, novelty, dateKey);
        const date = argentinaCalendarDate(dateKey);
        const row = await tx.noveltyDayCoverage.findUnique({ where: { noveltyId_date: { noveltyId: id, date } } });
        if (!row) throw new AppError("Ese día no pertenece a la cobertura de la novedad.", 404, "NOVELTY_COVERAGE_DAY_NOT_FOUND");
        // Ajuste manual de un día (NOVELTY_COVERAGE_ENGINE.md §17 a §19): la
        // regla automática es la del tipo; RRHH (o quien puede cargar el
        // tipo) puede corregir un día concreto entre 0 y el máximo que el
        // tipo admite ese día, con nota y auditoría. Prevalece hasta
        // RESTORE_AUTOMATIC.
        // - CONFIRMED_ZERO: siempre ("no cubre este día").
        // - SET_BASE_MINUTES: 1..máximo — el valor fijo del tipo, la
        //   cantidad cargada (manual) o la jornada conocida (según jornada);
        //   sin tope propio sólo si la jornada de un tipo según jornada no se
        //   pudo determinar. Nunca contra trabajo real incompatible, ni
        //   superando la jornada (con trabajo real o con otras coberturas, P5).
        // - RESTORE_AUTOMATIC: deshace la resolución y recalcula el día.
        // La falta de historia para un feriado nunca llega acá: es un error.
        if (type.coverageMode === "NONE") {
          throw new AppError("Este tipo de novedad no registra tiempo: no hay cobertura para ajustar.", 409, "NOVELTY_COVERAGE_DAY_NOT_IN_REVIEW");
        }
        if (input.resolution === "RESTORE_AUTOMATIC") {
          if (row.reviewStatus !== "RESOLVED") throw new AppError("Este día no tiene una resolución manual para deshacer.", 409, "NOVELTY_COVERAGE_DAY_NOT_RESOLVED");
          await tx.noveltyDayCoverage.update({
            where: { id: row.id },
            data: { reviewStatus: "NOT_REQUIRED", resolution: null, resolvedBaseMinutes: null, resolvedAgainstWorkedMinutes: null, resolvedByUserId: null, resolvedAt: null, resolutionNote: null },
          });
          // Mismo cálculo que cualquier recálculo: el día vuelve a la regla del tipo.
          await persistNoveltyCoverageWithin(tx, [id], { protectedPeriods: "REJECT", window: { from: date, to: date } });
          const updated = await tx.noveltyDayCoverage.findUniqueOrThrow({ where: { id: row.id } });
          return { novelty, type, before: row, updated };
        }
        const workedMinutes = await loadRealWorkedMinutesOnDate(tx, novelty.employeeId, dateKey);
        if (input.resolution === "SET_BASE_MINUTES") {
          const requested = input.baseMinutes!;
          const maximum = coverageAdjustmentMaxMinutes(type, novelty.quantityMinutes, row);
          if (maximum !== null && requested > maximum) {
            const range = maximum > 0 ? `entre 0 h y ${formatMinutes(maximum)}` : "0 h";
            throw new AppError(`Para esta novedad, la cobertura de ese día puede ser ${range}.`, 400, "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED");
          }
          if (workedMinutes > 0 && row.realWorkCompatibility === "INCOMPATIBLE") {
            throw new AppError(
              "Esta novedad no puede coexistir con trabajo registrado ese día: corregí primero las horas del legajo o indicá que la novedad no cubre este día.",
              400,
              "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED",
            );
          }
          if (row.expectedMinutes !== null && workedMinutes > 0 && workedMinutes + requested > row.expectedMinutes) {
            throw new AppError(
              `El trabajo registrado más la cobertura superaría la jornada esperada (${formatMinutes(row.expectedMinutes)}).`,
              400,
              "NOVELTY_COVERAGE_EXCEEDS_EXPECTED",
            );
          }
          // P5: con el valor pedido, las coberturas del día no pueden superar la jornada.
          const others = await tx.noveltyDayCoverage.findMany({
            where: { employeeId: novelty.employeeId, date, noveltyId: { not: id }, novelty: { status: { not: "RECHAZADO" } } },
            select: accountingNoveltyCoverageSelect,
          });
          const candidate = {
            ...toAccountingNoveltyCoverage({ ...row, novelty: { status: novelty.status } }),
            status: "APROBADO" as const,
            reviewStatus: "RESOLVED" as const,
            resolution: "SET_BASE_MINUTES" as const,
            resolvedBaseMinutes: requested,
            resolvedAgainstWorkedMinutes: workedMinutes,
          };
          const item = accountNoveltyDay([candidate, ...others.map(toAccountingNoveltyCoverage)], workedMinutes).items.find((entry) => entry.noveltyId === id);
          if (item?.reviewReasons.includes("COVERAGE_TOTAL_EXCEEDS_EXPECTED")) {
            throw new AppError(
              "Con ese valor, las novedades de este día superarían la jornada esperada: indicá cuál no cubre este día o corregí la novedad.",
              400,
              "NOVELTY_COVERAGE_RESOLUTION_NOT_ALLOWED",
            );
          }
        }
        const baseMinutes = input.resolution === "CONFIRMED_ZERO" ? 0 : input.baseMinutes!;
        let multiplier = 1;
        if (type.coverageAppliesSpecialHours && baseMinutes > 0) {
          const evaluation = (await evaluateSpecialHourRulesByDate(novelty.employeeId, [date], tx)).get(dateKey);
          if (evaluation?.missingHistory) throw new SpecialHourScopeHistoryMissingError(evaluation.missingHistory);
          multiplier = evaluation?.resolution.multiplier ?? 1;
        }
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
        return { novelty, type, before: row, updated };
      }, NOVELTY_TRANSACTION_OPTIONS),
    );
    const { novelty, type, before, updated } = outcome;
    const result =
      input.resolution === "RESTORE_AUTOMATIC"
        ? "se deshizo la resolución manual y el día vuelve al cálculo automático"
        : input.resolution === "CONFIRMED_ZERO"
          ? "sin horas (0 h confirmadas)"
          : `${formatMinutes(input.baseMinutes!)} base${Number(updated.appliedMultiplier) !== 1 ? ` × ${Number(updated.appliedMultiplier)}` : ""}`;
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "Novelty",
      entityId: id,
      description: `Se resolvió la cobertura de ${type.name} de ${formatEmployeeReference(novelty.employee)} para el ${formatArgentinaDate(dateKey)}: ${result}. Nota: ${input.note}`,
      before: before as unknown as Prisma.InputJsonValue,
      after: updated as unknown as Prisma.InputJsonValue,
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
