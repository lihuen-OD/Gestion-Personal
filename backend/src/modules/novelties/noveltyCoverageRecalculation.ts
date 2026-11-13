/**
 * Recálculo automático de la cobertura de novedades por eventos
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13, etapa 5). Única función
 * para todos los módulos que cambian una fuente que lee el motor (relación
 * laboral, historia laboral, turnos, plantillas, regímenes, francos,
 * convocatorias, reglas de Horas Especiales y configuración del tipo).
 *
 *   evento → alcance (legajos + fechas + novedades) → períodos protegidos
 *   → recálculo por diferencia (persistNoveltyCoverageWithin, modo SKIP)
 *   → resoluciones manuales conservadas o descartadas (motor)
 *   → snapshots de cierres abiertos → resumen auditable.
 *
 * Corre SIEMPRE dentro de la transacción del cambio que lo dispara. Nunca
 * recalcula todo: sólo las novedades del alcance y sólo las fechas de la
 * ventana. Las cachés se limpian en el controller después del commit
 * (`clearNoveltyCoverageReadCaches`).
 */
import type { Prisma } from "@prisma/client";
import { calendarDateKey, formatArgentinaDate, humanizePeriodEs, nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { employeePeriodKey, findProtectedClosurePeriods, uniqueEmployeePeriods, type EmployeePeriod } from "../../shared/monthlyClosure/closurePeriodGuard";
import { loadEmployeeReferences } from "../../shared/audit/employeeReference";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { AuditContext, RegisterAuditInput } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots, type RebuiltClosureSnapshot } from "../workforce-management/closureSnapshot";
import { lockEmployeeCoverage, lockNoveltyCoverageGlobally, noveltyCoverageEnd, persistNoveltyCoverageWithin, type DroppedCoverageResolution } from "./noveltyCoverage.service";

type Db = PrismaTransactionClient;

/** Qué fuente cambió (queda en el snapshot reconstruido y en la auditoría). */
export type NoveltyCoverageRecalculationSource =
  | "LABOR_MOVEMENT_CHANGED"
  | "LABOR_HISTORY_CHANGED"
  | "SHIFT_ASSIGNMENT_CHANGED"
  | "SHIFT_TEMPLATE_CHANGED"
  | "WORK_REGIME_CHANGED"
  | "EMPLOYEE_DAY_OFF_CHANGED"
  | "HOLIDAY_WORK_ASSIGNMENT_CHANGED"
  | "SPECIAL_HOUR_RULE_CHANGED"
  | "NOVELTY_TYPE_CHANGED";

/** `label`: causa en lenguaje de negocio, sin ids ("cambio de francos del 16/11/2026"). */
export type NoveltyCoverageRecalculationReason = { source: NoveltyCoverageRecalculationSource; label: string };

/**
 * Alcance del recálculo. Sin `employeeIds` ni `noveltyIds` es un evento
 * global: toma el lock global EXCLUSIVO. `from`/`to` son fechas calendario
 * inclusive (`null`/ausente = sin límite de ese lado) y también acotan las
 * filas que se reescriben. `touchesDate` descarta novedades que no tienen
 * ninguna fecha alcanzada (p. ej. una regla de domingos).
 */
export type NoveltyCoverageScope = {
  employeeIds?: string[];
  noveltyIds?: string[];
  noveltyTypeIds?: string[];
  from?: Date | null;
  to?: Date | null;
  /** Sólo tipos que aplican multiplicadores (regla que no es FERIADO). */
  onlySpecialHourTypes?: boolean;
  /** Incluye tipos sin tiempo (NONE): sólo un cambio de configuración del tipo los afecta. */
  includeNoneTypes?: boolean;
  touchesDate?: (dateKey: string) => boolean;
};

export type NoveltyCoverageRecalculation = {
  source: NoveltyCoverageRecalculationSource;
  label: string;
  novelties: number;
  employees: number;
  changedNovelties: number;
  changedEmployees: number;
  changedDays: number;
  pendingReviewDays: number;
  droppedResolutions: DroppedCoverageResolution[];
  /** Pares con cierre protegido que no se reinterpretaron. */
  protectedPeriods: EmployeePeriod[];
  /** Pares con algún día cambiado (los snapshots abiertos de estos se reconstruyen). */
  changedPairs: EmployeePeriod[];
  rebuiltClosures: RebuiltClosureSnapshot[];
};

/** Lock de cobertura por legajo (con el global compartido), para tomarlo antes que los de cierre. */
export async function lockNoveltyCoverageForEmployees(db: Db, employeeIds: string[]) {
  await lockEmployeeCoverage(db, employeeIds);
}

/** Ventana que cubre todas las vigencias (antes y después de un cambio); `to` nulo = abierta. */
export function coverageWindowOf(ranges: Array<{ from: Date; to: Date | null } | null | undefined>): { from: Date; to: Date | null } | null {
  const present = ranges.filter((range): range is { from: Date; to: Date | null } => Boolean(range));
  if (!present.length) return null;
  const from = new Date(Math.min(...present.map((range) => range.from.getTime())));
  const to = present.some((range) => range.to === null) ? null : new Date(Math.max(...present.map((range) => range.to!.getTime())));
  return { from, to };
}

/** Tope de días-legajo calculados por tanda (cada tanda hace consultas fijas). */
const DAYS_PER_BATCH = 10_000;

export function emptyNoveltyCoverageRecalculation(reason: NoveltyCoverageRecalculationReason): NoveltyCoverageRecalculation {
  return {
    source: reason.source,
    label: reason.label,
    novelties: 0,
    employees: 0,
    changedNovelties: 0,
    changedEmployees: 0,
    changedDays: 0,
    pendingReviewDays: 0,
    droppedResolutions: [],
    protectedPeriods: [],
    changedPairs: [],
    rebuiltClosures: [],
  };
}

function scopeWhere(scope: NoveltyCoverageScope): Prisma.NoveltyWhereInput {
  const and: Prisma.NoveltyWhereInput[] = [{ status: { not: "RECHAZADO" } }];
  if (scope.employeeIds) and.push({ employeeId: { in: [...new Set(scope.employeeIds)] } });
  if (scope.noveltyIds) and.push({ id: { in: [...new Set(scope.noveltyIds)] } });
  if (scope.noveltyTypeIds) and.push({ noveltyTypeId: { in: [...new Set(scope.noveltyTypeIds)] } });
  if (!scope.includeNoneTypes || scope.onlySpecialHourTypes) {
    and.push({ noveltyType: { ...(scope.includeNoneTypes ? {} : { coverageMode: { not: "NONE" } }), ...(scope.onlySpecialHourTypes ? { coverageAppliesSpecialHours: true } : {}) } });
  }
  // [fromDate, toDate ?? fromDate] toca [from, to] (toDate nulo = un día).
  if (scope.to) and.push({ fromDate: { lte: scope.to } });
  if (scope.from) and.push({ OR: [{ toDate: { gte: scope.from } }, { toDate: null, fromDate: { gte: scope.from } }] });
  return { AND: and };
}

function touchesAnyDate(novelty: { fromDate: Date; toDate: Date | null }, scope: NoveltyCoverageScope) {
  if (!scope.touchesDate) return true;
  const start = scope.from && scope.from > novelty.fromDate ? scope.from : novelty.fromDate;
  const end = noveltyCoverageEnd(novelty);
  const last = scope.to && scope.to < end ? scope.to : end;
  for (let key = calendarDateKey(start), stop = calendarDateKey(last); key <= stop; key = nextCalendarDateKey(key)) {
    if (scope.touchesDate(key)) return true;
  }
  return false;
}

/**
 * Recalcula la cobertura del alcance dentro de la transacción `db`.
 * `rebuildSnapshots: false` deja la reconstrucción a quien llama (cuando el
 * mismo evento reconstruye después los mismos cierres, p. ej. francos o
 * reglas): usar `rebuildNoveltyCoverageSnapshots` con `changedPairs`.
 */
export async function recalculateNoveltyCoverage(
  db: Db,
  scope: NoveltyCoverageScope,
  reason: NoveltyCoverageRecalculationReason,
  options: { rebuildSnapshots?: boolean; skipSnapshotPairs?: EmployeePeriod[] } = {},
): Promise<NoveltyCoverageRecalculation> {
  const result = emptyNoveltyCoverageRecalculation(reason);
  if (scope.employeeIds?.length === 0 || scope.noveltyIds?.length === 0 || scope.noveltyTypeIds?.length === 0) return result;

  // Locks antes de leer: global exclusivo si el evento alcanza a cualquier
  // legajo; si no, compartido + por legajo (orden de §13.6).
  if (!scope.employeeIds && !scope.noveltyIds) await lockNoveltyCoverageGlobally(db);
  else if (scope.employeeIds) await lockEmployeeCoverage(db, scope.employeeIds);

  const candidates = await db.novelty.findMany({
    where: scopeWhere(scope),
    select: { id: true, employeeId: true, fromDate: true, toDate: true },
    orderBy: [{ employeeId: "asc" }, { fromDate: "asc" }, { id: "asc" }],
  });
  const novelties = candidates.filter((novelty) => touchesAnyDate(novelty, scope));
  result.novelties = novelties.length;
  result.employees = new Set(novelties.map((novelty) => novelty.employeeId)).size;
  if (!novelties.length) return result;

  // Tandas acotadas por días: consultas fijas por tanda, nunca por día.
  const window = { from: scope.from ?? null, to: scope.to ?? null };
  const batches: string[][] = [];
  let current: string[] = [];
  let days = 0;
  for (const novelty of novelties) {
    const start = window.from && window.from > novelty.fromDate ? window.from : novelty.fromDate;
    const end = window.to && window.to < noveltyCoverageEnd(novelty) ? window.to : noveltyCoverageEnd(novelty);
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    if (current.length && days + span > DAYS_PER_BATCH) {
      batches.push(current);
      current = [];
      days = 0;
    }
    current.push(novelty.id);
    days += span;
  }
  if (current.length) batches.push(current);

  const protectedPairs = new Map<string, EmployeePeriod>();
  const changedPairs = new Map<string, EmployeePeriod>();
  const changedNovelties = new Set<string>();
  for (const ids of batches) {
    const summary = await persistNoveltyCoverageWithin(db, ids, { protectedPeriods: "SKIP", window });
    result.changedDays += summary.changedDays;
    result.pendingReviewDays += summary.pendingReviewDays;
    result.droppedResolutions.push(...summary.droppedResolutionDetails);
    for (const pair of summary.protectedPeriods) protectedPairs.set(employeePeriodKey(pair), pair);
    for (const pair of summary.changedPairs) changedPairs.set(employeePeriodKey(pair), pair);
    for (const id of summary.changedNoveltyIds) changedNovelties.add(id);
  }
  const employeeOf = new Map(novelties.map((novelty) => [novelty.id, novelty.employeeId]));
  result.changedNovelties = changedNovelties.size;
  result.changedEmployees = new Set([...changedNovelties].map((id) => employeeOf.get(id))).size;
  result.protectedPeriods = uniqueEmployeePeriods(protectedPairs.values());
  result.changedPairs = uniqueEmployeePeriods(changedPairs.values());

  if (options.rebuildSnapshots !== false) {
    result.rebuiltClosures = await rebuildNoveltyCoverageSnapshots(db, result.changedPairs, reason, options.skipSnapshotPairs);
  }
  return result;
}

/**
 * Reconstruye los snapshots de cierres NO protegidos de esos pares (motivo
 * NOVELTY_COVERAGE_CHANGED). Un cierre ENVIADO/APROBADO/CORRECCION_PENDIENTE
 * nunca se reconstruye automáticamente.
 */
export async function rebuildNoveltyCoverageSnapshots(db: Db, pairs: EmployeePeriod[], reason: NoveltyCoverageRecalculationReason, skip: EmployeePeriod[] = []): Promise<RebuiltClosureSnapshot[]> {
  const skipped = new Set(skip.map(employeePeriodKey));
  const targets = uniqueEmployeePeriods(pairs).filter((pair) => !skipped.has(employeePeriodKey(pair)));
  if (!targets.length) return [];
  const protectedPairs = await findProtectedClosurePeriods(db, targets);
  const closures = (await findClosuresForEmployeePeriods(db, targets)).filter((closure) => !protectedPairs.has(employeePeriodKey(closure)));
  return rebuildClosureSnapshots(db, closures, { reason: "NOVELTY_COVERAGE_CHANGED", source: reason.source, label: reason.label });
}

/** Suma de varios recálculos del mismo evento (p. ej. un lote de legajos). */
export function mergeNoveltyCoverageRecalculations(reason: NoveltyCoverageRecalculationReason, items: NoveltyCoverageRecalculation[]): NoveltyCoverageRecalculation {
  const merged = emptyNoveltyCoverageRecalculation(reason);
  for (const item of items) {
    merged.novelties += item.novelties;
    merged.employees += item.employees;
    merged.changedNovelties += item.changedNovelties;
    merged.changedEmployees += item.changedEmployees;
    merged.changedDays += item.changedDays;
    merged.pendingReviewDays += item.pendingReviewDays;
    merged.droppedResolutions.push(...item.droppedResolutions);
    merged.protectedPeriods.push(...item.protectedPeriods);
    merged.changedPairs.push(...item.changedPairs);
    merged.rebuiltClosures.push(...item.rebuiltClosures);
  }
  merged.protectedPeriods = uniqueEmployeePeriods(merged.protectedPeriods);
  merged.changedPairs = uniqueEmployeePeriods(merged.changedPairs);
  return merged;
}

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Resumen en lenguaje de negocio (sin ids). Vacío si no cambió nada. */
export function describeNoveltyCoverageRecalculation(result: NoveltyCoverageRecalculation) {
  if (!result.changedDays && !result.protectedPeriods.length) return "";
  const parts = [
    result.changedDays
      ? `Se recalculó la cobertura de ${plural(result.changedNovelties, "novedad", "novedades")} de ${plural(result.changedEmployees, "empleado", "empleados")} por ${result.label} (${plural(result.changedDays, "día", "días")}).`
      : `La cobertura de novedades no cambió por ${result.label}.`,
  ];
  if (result.droppedResolutions.length) parts.push(`${plural(result.droppedResolutions.length, "resolución manual dejó", "resoluciones manuales dejaron")} de ser necesaria${result.droppedResolutions.length === 1 ? "" : "s"} porque los datos ya permiten calcular el día.`);
  if (result.protectedPeriods.length) {
    const months = [...new Set(result.protectedPeriods.map((pair) => humanizePeriodEs(pair.period)))].join(", ");
    parts.push(`No se reinterpretaron períodos enviados o aprobados (${months}).`);
  }
  return parts.join(" ");
}

/**
 * Auditoría después del commit: un registro resumido por evento (nunca uno
 * por día), uno por resolución manual descartada (trazabilidad de la
 * decisión humana que dejó de aplicar) y uno por snapshot reconstruido.
 */
export async function auditNoveltyCoverageRecalculation(result: NoveltyCoverageRecalculation, audit: AuditContext | undefined) {
  await registerNoveltyCoverageAudit(prisma, result, audit, (input) => auditService.register(input));
}

/** Misma auditoría dentro de una transacción (flujos que auditan con registerWithin). */
export async function auditNoveltyCoverageRecalculationWithin(db: Db, result: NoveltyCoverageRecalculation, audit: AuditContext | undefined) {
  await registerNoveltyCoverageAudit(db, result, audit, (input) => auditService.registerWithin(db, input));
}

async function registerNoveltyCoverageAudit(
  db: Parameters<typeof loadEmployeeReferences>[0],
  result: NoveltyCoverageRecalculation,
  audit: AuditContext | undefined,
  register: (input: RegisterAuditInput) => Promise<unknown>,
) {
  const description = describeNoveltyCoverageRecalculation(result);
  if (!description) return;
  const references = await loadEmployeeReferences(db, [...new Set([...result.droppedResolutions.map((item) => item.employeeId), ...result.rebuiltClosures.map((item) => item.employeeId)])]);
  await register({
    ...audit,
    action: "UPDATE",
    entity: "NoveltyDayCoverage",
    description,
    after: {
      source: result.source,
      novelties: result.changedNovelties,
      employees: result.changedEmployees,
      days: result.changedDays,
      pendingReviewDays: result.pendingReviewDays,
      protectedPeriods: result.protectedPeriods,
      droppedResolutions: result.droppedResolutions.length,
    } as Prisma.InputJsonValue,
  });
  for (const dropped of result.droppedResolutions) {
    await register({
      ...audit,
      action: "UPDATE",
      entity: "NoveltyDayCoverage",
      entityId: dropped.noveltyId,
      description: `Se descartó la resolución manual del ${formatArgentinaDate(dropped.date)} de ${references(dropped.employeeId)}: por ${result.label} los datos ya permiten calcular el día.`,
      before: dropped as unknown as Prisma.InputJsonValue,
      after: { outcome: dropped.newOutcome, scheduleReviewReason: dropped.newReason } as Prisma.InputJsonValue,
    });
  }
  for (const closure of result.rebuiltClosures) {
    await register({
      ...audit,
      action: "UPDATE",
      entity: "MonthlyTimeClosure",
      entityId: closure.id,
      description: `Se recalculó el snapshot del cierre de ${humanizePeriodEs(closure.period)} de ${references(closure.employeeId)} por ${result.label} (cobertura de novedades). El estado del cierre no cambia.`,
      before: { snapshot: closure.before } as Prisma.InputJsonValue,
      after: { snapshot: closure.after } as Prisma.InputJsonValue,
    });
  }
}
