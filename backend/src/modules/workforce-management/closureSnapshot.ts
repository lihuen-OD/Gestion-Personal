import type { Prisma } from "@prisma/client";
import { loadNoveltyCoverageForAccounting } from "../novelties/noveltyCoverageAccounting";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import {
  accountEmployeePeriods,
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  countedBreakdownStatusWhere,
  emptyPeriodAccounting,
  toAccountingBaseEntry,
  toAccountingBreakdown,
} from "../time-entries/workedTimeAccounting";
import { dayOffsWithin, loadDayOffAccounting } from "../employee-day-offs/employeeDayOffAccounting";

/**
 * Snapshot de auditoría de `MonthlyTimeClosure` (docs/decisions/
 * WORKED_TIME_ACCOUNTING_MODEL.md §9/§14). Única implementación: la usan el
 * envío de cierres (`workforceService.submitClosures`) y la recalculación
 * controlada cuando RRHH corrige o elimina un concepto horario
 * (`hourConceptsRepository`). Recibe el cliente para poder correr dentro de
 * la transacción de quien la llama.
 */
type Db = PrismaTransactionClient;

export type ClosureSnapshotRecalculation =
  | { reason: "HOUR_CONCEPT_WORK_TREATMENT_CHANGED" | "HOUR_CONCEPT_DELETED"; hourConceptId: string; hourConceptCode: string }
  // Una regla de Hora Especial (feriado, domingo...) se creó, cambió o se
  // quitó: la equivalencia de las horas ya cargadas se reinterpreta
  // (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15).
  | { reason: "SPECIAL_HOUR_RULE_CHANGED"; doubleHourRuleId: string; doubleHourRuleName: string }
  // Se asignó, canceló o reactivó un franco (docs/decisions/EMPLOYEE_DAY_OFF.md
  // §8): las horas automáticas de esa fecha operativa dejan o vuelven a computar.
  | { reason: "EMPLOYEE_DAY_OFF_CHANGED"; date: string }
  // Se resolvió una fichada sobre horas cargadas a mano usando las horas
  // fichadas (docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md).
  | { reason: "MANUAL_HOURS_CONFLICT_RESOLVED"; date: string }
  // Reconciliación de cargas existentes con el estado vigente de las reglas.
  | { reason: "SPECIAL_HOUR_RECONCILIATION" }
  // Cambió una fuente de la cobertura de novedades (turno, franco, regla,
  // relación laboral, configuración del tipo...): docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.
  | { reason: "NOVELTY_COVERAGE_CHANGED"; source: string; label: string };

export type ClosureSnapshotTarget = { id: string; employeeId: string; period: string; snapshot: Prisma.JsonValue | null };

export type RebuiltClosureSnapshot = {
  id: string;
  employeeId: string;
  period: string;
  before: Prisma.JsonValue | null;
  after: Prisma.InputJsonObject;
};

/**
 * Representación estable de un cierre reconstruido para confirmar planes.
 * Conserva íntegros el snapshot anterior y el resultado contable; excluye
 * únicamente el instante generado por cada reconstrucción simulada.
 */
export function confirmedClosureResult(closure: RebuiltClosureSnapshot) {
  const after = closure.after as Record<string, unknown>;
  const recalculation = after.recalculation && typeof after.recalculation === "object"
    ? after.recalculation as Record<string, unknown>
    : undefined;
  return {
    ...closure,
    after: recalculation ? { ...after, recalculation: { ...recalculation, at: undefined } } : after,
  };
}

function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(year!, month! - 1, 1)), end: new Date(Date.UTC(year!, month!, 1)) };
}

/**
 * `entries` conserva el formato previo (Horas base NORMAL_BASE agrupadas por
 * estado). `accounting` congela la composición real del período con el
 * modelo único — mismo criterio de estado que la grilla por legajo (base
 * APROBADO/EN_REVISION, conceptos sin RECHAZADO), así cierre y grilla nunca
 * calculan distinto. Consultas batch para todos los legajos del período.
 *
 * Modelo WORKED_TIME_ACCOUNTING_V2 (NOVELTY_COVERAGE_ENGINE.md §12): agrega la
 * cobertura de novedades (`noveltyCoveredMinutes`, `computableMinutes`,
 * `settlement.noveltyMinutes`, `novelty` con estados y tipos). Los snapshots
 * V1 ya guardados siguen siendo legibles: V2 sólo agrega campos y conserva los
 * de V1 con el mismo significado.
 */
export const CLOSURE_ACCOUNTING_MODEL = "WORKED_TIME_ACCOUNTING_V2";

/**
 * Configuración de Finnegans congelada al generar el snapshot
 * (NOVELTY_COVERAGE_ENGINE.md §16.2): por cada tipo con novedades del legajo
 * en el período, sólo los campos que consume la exportación. Un snapshot
 * anterior no la tiene y la exportación usa el tipo vigente.
 */
export const CLOSURE_FINNEGANS_CONFIG_MODEL = "FINNEGANS_CONFIG_V1";

export type FrozenFinnegansNoveltyType = {
  noveltyTypeId: string;
  name: string;
  status: "ACTIVO" | "INACTIVO";
  exportsToFinnegans: boolean;
  finnegansCode: string | null;
  finnegansValueUnit: "HOURS" | "DAYS" | "UNIT" | null;
  finnegansRequiresValidity: boolean;
  coverageMode: "NONE" | "FIXED_MINUTES" | "MANUAL_MINUTES" | "EXPECTED_SCHEDULE";
};

/** Configuración congelada de un snapshot, o null si es un snapshot anterior a §16.2. */
export function frozenFinnegansConfigOf(snapshot: Prisma.JsonValue | Prisma.InputJsonObject | null | undefined): Map<string, FrozenFinnegansNoveltyType> | null {
  const finnegans = (snapshot as { finnegans?: { model?: string; types?: FrozenFinnegansNoveltyType[] } } | null)?.finnegans;
  if (finnegans?.model !== CLOSURE_FINNEGANS_CONFIG_MODEL || !Array.isArray(finnegans.types)) return null;
  return new Map(finnegans.types.map((type) => [type.noveltyTypeId, type]));
}

/** Días con cobertura de novedades en revisión según un snapshot (V2; un V1 no tiene). */
export function pendingNoveltyReviewOf(snapshot: Prisma.JsonValue | Prisma.InputJsonObject | null | undefined): { reviewDays: number; reviewDates: string[] } {
  const novelty = (snapshot as { accounting?: { novelty?: { reviewDays?: number; reviewDates?: string[] } } } | null)?.accounting?.novelty;
  return { reviewDays: novelty?.reviewDays ?? 0, reviewDates: novelty?.reviewDates ?? [] };
}
export async function buildClosureSnapshots(db: Db, employeeIds: string[], period: string): Promise<Map<string, Prisma.InputJsonObject>> {
  const range = periodRange(period);
  const [rows, baseEntries, breakdowns, dayOffs, coverage] = await Promise.all([
    db.timeEntry.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, period, hourConcept: { systemRole: "NORMAL_BASE" } },
      _sum: { hours: true },
      _count: true,
    }),
    db.timeEntry.findMany({
      where: { employeeId: { in: employeeIds }, period, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } },
      select: accountingBaseEntrySelect,
    }),
    db.hourConceptBreakdown.findMany({
      where: { employeeId: { in: employeeIds }, period, status: countedBreakdownStatusWhere },
      select: { ...accountingBreakdownSelect, hourConcept: { select: { workTreatment: true, code: true, name: true } } },
    }),
    // Francos: mismo criterio que la grilla (docs/decisions/EMPLOYEE_DAY_OFF.md §7).
    loadDayOffAccounting({ employeeIds, from: range.start, to: range.end }, db),
    // Cobertura de novedades: mismo criterio que la grilla (1 consulta).
    loadNoveltyCoverageForAccounting({ period, employeeIds }, db),
  ]);
  const finnegansTypes = await loadFinnegansConfigForClosures(db, employeeIds, range);
  const accountingByEmployee = accountEmployeePeriods(baseEntries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown), dayOffs, coverage.coverages);
  const dayOffDatesByEmployee = new Map<string, string[]>();
  for (const item of dayOffsWithin(dayOffs, range.start, range.end)) dayOffDatesByEmployee.set(item.employeeId, [...(dayOffDatesByEmployee.get(item.employeeId) ?? []), item.dateKey].sort());
  const conceptNames = new Map(breakdowns.map((breakdown) => [breakdown.hourConceptId, { code: breakdown.hourConcept.code, name: breakdown.hourConcept.name }]));
  return new Map(employeeIds.map((employeeId) => {
    const accounting = accountingByEmployee.get(employeeId) ?? emptyPeriodAccounting();
    const snapshot = {
      range,
      entries: rows.filter((row) => row.employeeId === employeeId).map((row) => ({ status: row.status, hours: Number(row._sum.hours || 0), records: row._count })),
      accounting: {
        model: CLOSURE_ACCOUNTING_MODEL,
        ...accounting,
        concepts: accounting.concepts.map((concept) => ({ ...concept, ...conceptNames.get(concept.hourConceptId) })),
        novelty: {
          ...accounting.novelty,
          types: accounting.novelty.types.map((type) => {
            const noveltyType = coverage.types.get(type.noveltyTypeId);
            return { ...type, code: noveltyType?.code ?? "", name: noveltyType?.name ?? "" };
          }),
        },
      },
      // Fechas con franco activo al congelar: traza de "tenía franco" junto a
      // lo que efectivamente computó.
      dayOffs: dayOffDatesByEmployee.get(employeeId) ?? [],
      finnegans: { model: CLOSURE_FINNEGANS_CONFIG_MODEL, types: finnegansTypes.get(employeeId) ?? [] },
    };
    return [employeeId, snapshot as unknown as Prisma.InputJsonObject];
  }));
}

/**
 * Tipos de las novedades no rechazadas de cada legajo que tocan el período
 * (mismo alcance que la exportación: las que empiezan en el mes y las que lo
 * alcanzan por rango). 1 consulta.
 */
async function loadFinnegansConfigForClosures(db: Db, employeeIds: string[], range: { start: Date; end: Date }) {
  const lastDay = new Date(range.end.getTime() - 86_400_000);
  const novelties = await db.novelty.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { not: "RECHAZADO" },
      fromDate: { lte: lastDay },
      OR: [{ fromDate: { gte: range.start } }, { toDate: { gte: range.start } }],
    },
    select: {
      employeeId: true,
      noveltyType: { select: { id: true, name: true, status: true, exportsToFinnegans: true, finnegansCode: true, finnegansValueUnit: true, finnegansRequiresValidity: true, coverageMode: true } },
    },
  });
  const byEmployee = new Map<string, Map<string, FrozenFinnegansNoveltyType>>();
  for (const { employeeId, noveltyType: type } of novelties) {
    const types = byEmployee.get(employeeId) ?? new Map<string, FrozenFinnegansNoveltyType>();
    byEmployee.set(employeeId, types);
    types.set(type.id, {
      noveltyTypeId: type.id,
      name: type.name,
      status: type.status,
      exportsToFinnegans: type.exportsToFinnegans,
      finnegansCode: type.finnegansCode,
      finnegansValueUnit: type.finnegansValueUnit,
      finnegansRequiresValidity: type.finnegansRequiresValidity,
      coverageMode: type.coverageMode,
    });
  }
  return new Map([...byEmployee].map(([employeeId, types]) => [employeeId, [...types.values()].sort((left, right) => left.noveltyTypeId.localeCompare(right.noveltyTypeId))]));
}

function snapshotMentionsConcept(snapshot: Prisma.JsonValue | null, hourConceptId: string) {
  const concepts = (snapshot as { accounting?: { concepts?: Array<{ hourConceptId?: string }> } } | null)?.accounting?.concepts;
  return Array.isArray(concepts) && concepts.some((concept) => concept?.hourConceptId === hourConceptId);
}

/**
 * Cierres cuyo snapshot quedaría desactualizado si cambia la lectura de un
 * concepto: los de cada empleado+período con desgloses que cuentan
 * (`pairs`, ya calculados por quien llama) y los que ya mencionan el
 * concepto en su snapshot (p. ej. un desglose rechazado después del envío).
 * 1 consulta.
 */
export async function findClosuresForHourConcept(db: Db, hourConceptId: string, pairs: Array<{ employeeId: string; period: string }>): Promise<ClosureSnapshotTarget[]> {
  const pairKeys = new Set(pairs.map((pair) => `${pair.employeeId}:${pair.period}`));
  const closures = await db.monthlyTimeClosure.findMany({
    where: {
      OR: [
        ...(pairs.length
          ? [{ employeeId: { in: [...new Set(pairs.map((pair) => pair.employeeId))] }, period: { in: [...new Set(pairs.map((pair) => pair.period))] } }]
          : []),
        { snapshot: { path: ["accounting", "concepts"], array_contains: [{ hourConceptId }] } },
      ],
    },
    select: { id: true, employeeId: true, period: true, snapshot: true },
  });
  return closures.filter((closure) =>
    closure.snapshot !== null && (pairKeys.has(`${closure.employeeId}:${closure.period}`) || snapshotMentionsConcept(closure.snapshot, hourConceptId)),
  );
}

/** Cierres (con snapshot) de los pares empleado + período indicados, en 1 consulta. */
export async function findClosuresForEmployeePeriods(db: Db, pairs: Array<{ employeeId: string; period: string }>): Promise<ClosureSnapshotTarget[]> {
  if (!pairs.length) return [];
  const pairKeys = new Set(pairs.map((pair) => `${pair.employeeId}:${pair.period}`));
  const closures = await db.monthlyTimeClosure.findMany({
    where: { employeeId: { in: [...new Set(pairs.map((pair) => pair.employeeId))] }, period: { in: [...new Set(pairs.map((pair) => pair.period))] } },
    select: { id: true, employeeId: true, period: true, snapshot: true },
  });
  return closures.filter((closure) => closure.snapshot !== null && pairKeys.has(`${closure.employeeId}:${closure.period}`));
}

/**
 * Reconstruye el snapshot con el mismo builder del envío y los datos
 * vigentes. No toca estado, autoría ni fechas del cierre (un APROBADO sigue
 * APROBADO, igual que una corrección directa de RRHH en un período cerrado).
 * Devuelve before/after para que quien llama los audite.
 */
export async function rebuildClosureSnapshots(db: Db, closures: ClosureSnapshotTarget[], recalculation: ClosureSnapshotRecalculation): Promise<RebuiltClosureSnapshot[]> {
  const byPeriod = new Map<string, ClosureSnapshotTarget[]>();
  for (const closure of closures) byPeriod.set(closure.period, [...(byPeriod.get(closure.period) ?? []), closure]);

  const recalculatedAt = new Date().toISOString();
  const rebuilt: RebuiltClosureSnapshot[] = [];
  for (const [period, items] of byPeriod) {
    const snapshots = await buildClosureSnapshots(db, items.map((item) => item.employeeId), period);
    for (const closure of items) {
      // La configuración de Finnegans queda la que se congeló al generar el
      // snapshot original: una reconstrucción no la vuelve a leer del tipo, y
      // a un snapshot anterior a §16.2 no se le inventa una retroactiva.
      const { finnegans: _current, ...rebuiltSnapshot } = snapshots.get(closure.employeeId)! as Prisma.InputJsonObject & { finnegans?: unknown };
      const frozen = (closure.snapshot as { finnegans?: Prisma.InputJsonValue } | null)?.finnegans;
      const after = { ...rebuiltSnapshot, ...(frozen !== undefined ? { finnegans: frozen } : {}), recalculation: { ...recalculation, at: recalculatedAt } };
      await db.monthlyTimeClosure.update({ where: { id: closure.id }, data: { snapshot: after } });
      rebuilt.push({ id: closure.id, employeeId: closure.employeeId, period, before: closure.snapshot, after });
    }
  }
  return rebuilt;
}
