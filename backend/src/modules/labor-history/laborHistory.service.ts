import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate, humanizePeriodEs, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { findProtectedClosurePeriods, ProtectedClosurePeriodError, type EmployeePeriod } from "../../shared/monthlyClosure/closurePeriodGuard";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { laborHistoryRepository as repository, type HistoryReader, type ScalarDimension } from "./laborHistory.repository";
import { monthsBetween, planChangeFrom, sameIdSet, type ChangePlan, type DateKey } from "./laborHistory.periods";
import type { EngineScopeHistory, ScopeNodeSnapshot } from "./laborHistory.scope";

/**
 * Historia temporal de las entradas mutables del motor de horas especiales
 * (D-5, docs/decisions/ORG_LOCATION_REORGANIZATION.md §19).
 *
 * Todas las escrituras corren DENTRO de la transacción de quien cambia el dato
 * (legajo o puesto), junto con la columna vigente, el historial visible y la
 * auditoría. Un cambio desde D:
 * - nunca reescribe fechas anteriores a D (sólo cierra en D − 1 la vigencia
 *   que contiene a D);
 * - no recalcula horas, desgloses ni cierres (§17.4);
 * - se rechaza si alcanza un período ENVIADO/APROBADO/CORRECCION_PENDIENTE de
 *   alguna persona afectada (lock compartido + relectura del cierre, §18.1).
 */

type Tx = PrismaTransactionClient;

export type EmployeeLaborDimension = "POSITION" | "COST_CENTER" | "EMPLOYER";

export const employeeLaborDimensionLabels: Record<EmployeeLaborDimension, string> = {
  POSITION: "Puesto",
  COST_CENTER: "Centro de costo",
  EMPLOYER: "Empresa empleadora",
};

export type EmployeeLaborChanges = { positionId?: string | null; costCenterId?: string | null; companyIds?: string[] };

type DimensionValue = string | null | string[];

export type RecordedHistoryChange = {
  dimension: EmployeeLaborDimension | "POSITION_SCOPE";
  kind: "OPEN" | "SPLIT" | "REPLACE";
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
  /** Valor de la vigencia anterior (SPLIT) o corregida (REPLACE). */
  previous?: DimensionValue | ScopeNodeSnapshot[];
  value: DimensionValue | ScopeNodeSnapshot[];
};

type Affected = { employeeId: string; fromKey: DateKey; toKey: DateKey | null };

/**
 * Protección de cierres (§18.1): lock compartido por legajo + período y
 * relectura del estado dentro de la transacción. Rechaza el cambio completo si
 * algún período alcanzado está protegido; no hay escrituras parciales.
 */
async function assertAffectedClosuresWritable(tx: Tx, affected: Affected[], effectiveFrom: DateKey, todayKey: DateKey) {
  if (!affected.length) return;
  const pairs: EmployeePeriod[] = [];
  for (const item of affected) {
    const lastKey = item.toKey && item.toKey < todayKey ? item.toKey : todayKey;
    if (item.fromKey <= lastKey) for (const period of monthsBetween(item.fromKey, lastKey)) pairs.push({ employeeId: item.employeeId, period });
  }
  // Cierres ya creados en meses posteriores (no deberían existir, pero se protegen igual).
  const existing = await repository.findClosurePeriodsFrom(tx, [...new Set(affected.map((item) => item.employeeId))], effectiveFrom.slice(0, 7));
  for (const closure of existing) {
    const reached = affected.some((item) => item.employeeId === closure.employeeId && closure.period >= item.fromKey.slice(0, 7) && (!item.toKey || closure.period <= item.toKey.slice(0, 7)));
    if (reached) pairs.push(closure);
  }
  const protectedPeriods = await findProtectedClosurePeriods(tx, pairs);
  if (!protectedPeriods.size) return;
  const periods = [...protectedPeriods.entries()].map(([key, status]) => {
    const [employeeId, period] = key.split(":");
    return { employeeId: employeeId!, period: period!, status };
  });
  const months = [...new Set(periods.map((item) => humanizePeriodEs(item.period)))].join(", ");
  throw new ProtectedClosurePeriodError(
    periods,
    `El cambio desde el ${formatArgentinaDate(effectiveFrom)} alcanza períodos ya enviados o aprobados (${months}) y no se registró. Elegí una fecha posterior a esos períodos o pedí antes su corrección explícita.`,
  );
}

async function applyScalarPlan(tx: Tx, dimension: ScalarDimension, employeeId: string, value: string | null, plan: ChangePlan<string | null>, reason: string, createdByUserId: string | null) {
  if (plan.kind === "OPEN") await repository.createScalarPeriod(tx, dimension, employeeId, value, { effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, reason, createdByUserId });
  if (plan.kind === "SPLIT") {
    // Primero se cierra la vigente: la exclusión de la base no es diferida.
    await repository.closeScalarPeriod(tx, dimension, plan.closePeriodId, plan.closeTo);
    await repository.createScalarPeriod(tx, dimension, employeeId, value, { effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, reason, createdByUserId });
  }
  if (plan.kind === "REPLACE") await repository.replaceScalarPeriodValue(tx, dimension, plan.periodId, value, reason);
}

async function applyEmployerPlan(tx: Tx, employeeId: string, companyIds: string[], plan: ChangePlan<string[]>, reason: string, createdByUserId: string | null) {
  if (plan.kind === "OPEN") await repository.createEmployerPeriod(tx, employeeId, companyIds, { effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, reason, createdByUserId });
  if (plan.kind === "SPLIT") {
    await repository.closeEmployerPeriod(tx, plan.closePeriodId, plan.closeTo);
    await repository.createEmployerPeriod(tx, employeeId, companyIds, { effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, reason, createdByUserId });
  }
  if (plan.kind === "REPLACE") await repository.replaceEmployerPeriodCompanies(tx, plan.periodId, companyIds, reason);
}

function recorded(dimension: RecordedHistoryChange["dimension"], plan: Exclude<ChangePlan<unknown>, { kind: "NONE" }>, value: RecordedHistoryChange["value"]): RecordedHistoryChange {
  return {
    dimension,
    kind: plan.kind,
    effectiveFrom: plan.effectiveFrom,
    effectiveTo: plan.effectiveTo,
    ...(plan.kind === "OPEN" ? {} : { previous: plan.previous as RecordedHistoryChange["previous"] }),
    value,
  };
}

const nodeKey = (node: ScopeNodeSnapshot) => `${node.level}:${node.nodeId}:${node.areaSectorId ?? ""}`;
export const sameScopeNodes = (a: readonly ScopeNodeSnapshot[], b: readonly ScopeNodeSnapshot[]) => sameIdSet(a.map(nodeKey), b.map(nodeKey));

export function isLaborHistoryOverlapError(error: unknown) {
  return error instanceof Error && /_no_overlap|23P01/.test(error.message);
}

/** Errores de persistencia de la historia → respuestas legibles (los demás se relanzan). */
export function mapLaborHistoryPersistenceError(error: unknown) {
  if (isLaborHistoryOverlapError(error)) {
    throw new AppError("Otra operación registró al mismo tiempo una vigencia que se superpone. Actualizá la pantalla e intentá nuevamente.", 409, "LABOR_HISTORY_OVERLAP");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    throw new AppError("Otra operación modificó estos datos al mismo tiempo. Actualizá la pantalla e intentá nuevamente.", 409, "LABOR_HISTORY_CONCURRENT_CHANGE");
  }
}

export const laborHistoryService = {
  /**
   * Alta de legajo: abre la historia de puesto, centro de costo, empresas
   * empleadoras y sector anterior ("sin sector": el alta ya no lo asigna)
   * desde la fecha de ingreso declarada. No hay fechas anteriores que cubrir.
   */
  async openEmployeeHistoryWithin(tx: Tx, input: { employeeId: string; effectiveFrom: DateKey; positionId: string | null; costCenterId: string | null; companyIds: string[]; reason: string; createdByUserId: string | null }) {
    const period = { effectiveFrom: input.effectiveFrom, effectiveTo: null, reason: input.reason, createdByUserId: input.createdByUserId };
    await repository.createScalarPeriod(tx, "POSITION", input.employeeId, input.positionId, period);
    await repository.createScalarPeriod(tx, "COST_CENTER", input.employeeId, input.costCenterId, period);
    await repository.createScalarPeriod(tx, "LEGACY_SECTOR", input.employeeId, null, period);
    await repository.createEmployerPeriod(tx, input.employeeId, [...new Set(input.companyIds)].sort(), period);
  },

  /**
   * Cambio de puesto, centro de costo y/o empresas empleadoras de un legajo
   * desde `effectiveFrom`. Sólo recibe las dimensiones que cambiaron en la
   * columna vigente. Valida todas las fechas y los cierres ANTES de escribir.
   */
  async recordEmployeeChangesWithin(tx: Tx, input: { employeeId: string; effectiveFrom: DateKey; reason: string; createdByUserId: string | null; changes: EmployeeLaborChanges; todayKey?: DateKey }): Promise<RecordedHistoryChange[]> {
    const todayKey = input.todayKey ?? todayArgentinaDateKey();
    const { changes, employeeId, effectiveFrom } = input;
    const scalarPlans: Array<{ dimension: "POSITION" | "COST_CENTER"; value: string | null; plan: ChangePlan<string | null> }> = [];
    for (const [dimension, value] of [["POSITION", changes.positionId], ["COST_CENTER", changes.costCenterId]] as const) {
      if (value === undefined) continue;
      const periods = await repository.findScalarPeriods(tx, dimension, employeeId);
      scalarPlans.push({ dimension, value, plan: planChangeFrom(periods, effectiveFrom, todayKey, (current) => current === value, employeeLaborDimensionLabels[dimension]) });
    }
    let employerPlan: { value: string[]; plan: ChangePlan<string[]> } | null = null;
    if (changes.companyIds !== undefined) {
      const value = [...new Set(changes.companyIds)].sort();
      const periods = await repository.findEmployerPeriods(tx, employeeId);
      employerPlan = { value, plan: planChangeFrom(periods, effectiveFrom, todayKey, (current) => sameIdSet(current, value), employeeLaborDimensionLabels.EMPLOYER) };
    }
    const effective = [...scalarPlans.filter((item) => item.plan.kind !== "NONE"), ...(employerPlan && employerPlan.plan.kind !== "NONE" ? [employerPlan] : [])];
    if (!effective.length) return [];
    await assertAffectedClosuresWritable(tx, [{ employeeId, fromKey: effectiveFrom, toKey: null }], effectiveFrom, todayKey);

    const result: RecordedHistoryChange[] = [];
    for (const item of scalarPlans) {
      if (item.plan.kind === "NONE") continue;
      await applyScalarPlan(tx, item.dimension, employeeId, item.value, item.plan, input.reason, input.createdByUserId);
      result.push(recorded(item.dimension, item.plan, item.value));
    }
    if (employerPlan && employerPlan.plan.kind !== "NONE") {
      await applyEmployerPlan(tx, employeeId, employerPlan.value, employerPlan.plan, input.reason, input.createdByUserId);
      result.push(recorded("EMPLOYER", employerPlan.plan, employerPlan.value));
    }
    return result;
  },

  /** Alta de puesto: abre la historia de alcance desde la fecha indicada (por defecto, hoy). */
  async openPositionScopeWithin(tx: Tx, input: { positionId: string; effectiveFrom: DateKey; nodes: ScopeNodeSnapshot[]; reason: string; createdByUserId: string | null; todayKey?: DateKey }) {
    const todayKey = input.todayKey ?? todayArgentinaDateKey();
    if (input.effectiveFrom > todayKey) {
      throw new AppError(`Alcance del puesto: la fecha de vigencia (${formatArgentinaDate(input.effectiveFrom)}) no puede ser futura.`, 409, "LABOR_HISTORY_FUTURE_DATE_NOT_SUPPORTED");
    }
    await repository.createScopePeriod(tx, input.positionId, input.nodes, { effectiveFrom: input.effectiveFrom, effectiveTo: null, reason: input.reason, createdByUserId: input.createdByUserId });
  },

  /**
   * Cambio del alcance compartido de un puesto desde `effectiveFrom`. Protege
   * los cierres de TODAS las personas que tuvieron el puesto en alguna fecha
   * desde D (según su historia de asignaciones).
   */
  async recordPositionScopeChangeWithin(tx: Tx, input: { positionId: string; effectiveFrom: DateKey; nodes: ScopeNodeSnapshot[]; reason: string; createdByUserId: string | null; todayKey?: DateKey }): Promise<RecordedHistoryChange | null> {
    const todayKey = input.todayKey ?? todayArgentinaDateKey();
    const periods = (await repository.findScopePeriods(tx, [input.positionId])).get(input.positionId) ?? [];
    const plan = planChangeFrom(periods, input.effectiveFrom, todayKey, (current) => sameScopeNodes(current, input.nodes), "Alcance del puesto");
    if (plan.kind === "NONE") return null;
    const assignments = await repository.findPositionAssignmentsFrom(tx, input.positionId, input.effectiveFrom);
    const affected = assignments.map((item) => ({ employeeId: item.employeeId, fromKey: item.effectiveFrom > input.effectiveFrom ? item.effectiveFrom : input.effectiveFrom, toKey: item.effectiveTo }));
    await assertAffectedClosuresWritable(tx, affected, input.effectiveFrom, todayKey);
    const period = { reason: input.reason, createdByUserId: input.createdByUserId };
    if (plan.kind === "OPEN") await repository.createScopePeriod(tx, input.positionId, input.nodes, { ...period, effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo });
    if (plan.kind === "SPLIT") {
      await repository.closeScopePeriod(tx, plan.closePeriodId, plan.closeTo);
      await repository.createScopePeriod(tx, input.positionId, input.nodes, { ...period, effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo });
    }
    if (plan.kind === "REPLACE") await repository.replaceScopePeriodNodes(tx, plan.periodId, input.nodes, input.reason);
    return recorded("POSITION_SCOPE", plan, input.nodes);
  },

  /** Historia que necesita el motor para un legajo en [fromKey, toKey]. */
  async loadEngineScopeHistory(db: HistoryReader, employeeId: string, range: { fromKey: DateKey; toKey: DateKey }): Promise<EngineScopeHistory> {
    const [position, costCenter, legacySector, employer] = await Promise.all([
      repository.findScalarPeriods(db, "POSITION", employeeId, range),
      repository.findScalarPeriods(db, "COST_CENTER", employeeId, range),
      repository.findScalarPeriods(db, "LEGACY_SECTOR", employeeId, range),
      repository.findEmployerPeriods(db, employeeId, range),
    ]);
    const positionIds = [...new Set(position.map((period) => period.value).filter((value): value is string => Boolean(value)))];
    const scopes = await repository.findScopePeriods(db, positionIds, range);
    return { position, costCenter, legacySector, employer, scopes };
  },
};
