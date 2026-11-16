/**
 * Carga en lote de la cobertura diaria de novedades para la contabilidad
 * (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §12). Una consulta por período y
 * lote de legajos, nunca por legajo, día ni novedad; usa el índice
 * NoveltyDayCoverage(employeeId, period). Los consumidores pasan el resultado
 * a `workedTimeAccounting` (única implementación de los estados y totales).
 */
import type { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import {
  accountEmployeePeriods,
  accountingBaseEntrySelect,
  accountingBreakdownSelect,
  accountingNoveltyCoverageSelect,
  countedBreakdownStatusWhere,
  toAccountingBaseEntry,
  toAccountingBreakdown,
  toAccountingNoveltyCoverage,
  type AccountingNoveltyCoverage,
  type NoveltyItemAccounting,
  type NoveltyTypeAccounting,
  type PeriodAccounting,
} from "../time-entries/workedTimeAccounting";
import { loadDayOffAccounting } from "../employee-day-offs/employeeDayOffAccounting";

type Db = Pick<PrismaTransactionClient, "noveltyDayCoverage">;

export type CoverageNoveltyType = { id: string; code: string; name: string; uiColor: string };

export type LoadedNoveltyCoverage = {
  coverages: AccountingNoveltyCoverage[];
  types: Map<string, CoverageNoveltyType>;
};

const loadSelect = {
  ...accountingNoveltyCoverageSelect,
  noveltyType: { select: { id: true, code: true, name: true, uiColor: true } },
} satisfies Prisma.NoveltyDayCoverageSelect;

export async function loadNoveltyCoverageForAccounting(
  scope: { period: string; employeeIds?: string[]; employeeWhere?: Prisma.EmployeeWhereInput; countingOnly?: boolean },
  db: Db = prisma,
): Promise<LoadedNoveltyCoverage> {
  if (scope.employeeIds && !scope.employeeIds.length) return { coverages: [], types: new Map() };
  const rows = await db.noveltyDayCoverage.findMany({
    where: {
      period: scope.period,
      ...(scope.employeeIds ? { employeeId: { in: scope.employeeIds } } : {}),
      ...(scope.employeeWhere ? { employee: scope.employeeWhere } : {}),
      ...(scope.countingOnly ? { countsTowardTotal: true, novelty: { status: "APROBADO" } } : { novelty: { status: { not: "RECHAZADO" } } }),
    },
    select: loadSelect,
    orderBy: [{ date: "asc" }, { noveltyTypeId: "asc" }],
  });
  const types = new Map<string, CoverageNoveltyType>();
  for (const row of rows) types.set(row.noveltyType.id, row.noveltyType);
  return { coverages: rows.map(toAccountingNoveltyCoverage), types };
}

/**
 * Minutos cubiertos (COUNTED) del período para un alcance, con el mismo
 * criterio que la grilla (base NORMAL_BASE APROBADO/EN_REVISION, desgloses sin
 * RECHAZADO, francos): la cobertura depende del trabajo real de cada día
 * (incompatibilidad, exceso), así que no se puede sumar en SQL. Sólo lee el
 * trabajo de los legajos que tienen cobertura que puede contar: 1 consulta si
 * no hay ninguna, 4 si hay.
 */
export async function periodNoveltyCoveredMinutes(
  period: string,
  employeeWhere: Prisma.EmployeeWhereInput,
  db: Pick<PrismaTransactionClient, "noveltyDayCoverage" | "timeEntry" | "hourConceptBreakdown" | "employeeDayOff" | "workShift"> = prisma,
) {
  const { coverages } = await loadNoveltyCoverageForAccounting({ period, employeeWhere, countingOnly: true }, db);
  if (!coverages.length) return 0;
  const employeeIds = [...new Set(coverages.map((coverage) => coverage.employeeId))];
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 1));
  const [entries, breakdowns, dayOffs] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId: { in: employeeIds }, period, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } },
      select: accountingBaseEntrySelect,
    }),
    db.hourConceptBreakdown.findMany({ where: { employeeId: { in: employeeIds }, period, status: countedBreakdownStatusWhere }, select: accountingBreakdownSelect }),
    loadDayOffAccounting({ employeeIds, from: start, to: end }, db),
  ]);
  const accounting = accountEmployeePeriods(entries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown), dayOffs, coverages);
  return [...accounting.values()].reduce((sum, item) => sum + item.noveltyCoveredMinutes, 0);
}

export type NoveltyExportCoverageDay = { dateKey: string; state: NoveltyItemAccounting["state"]; baseMinutes: number };

/**
 * Etapa 9 (NOVELTY_COVERAGE_ENGINE.md §16): estado contable de cada día de
 * cobertura del período, por novedad, para la exportación a Finnegans. Misma
 * contabilidad que la grilla y el cierre (trabajo real del día incluido, así
 * que una incompatibilidad o un exceso quedan en REVIEW_REQUIRED). En lote:
 * 1 consulta si no hay cobertura, 4–5 si hay; nunca por día ni por novedad.
 * `baseMinutes` es la base efectiva (resolución manual incluida), sin
 * multiplicador.
 */
export async function periodNoveltyCoverageDaysForExport(
  period: string,
  employeeIds: string[],
  db: Pick<PrismaTransactionClient, "noveltyDayCoverage" | "timeEntry" | "hourConceptBreakdown" | "employeeDayOff" | "workShift"> = prisma,
): Promise<Map<string, NoveltyExportCoverageDay[]>> {
  const result = new Map<string, NoveltyExportCoverageDay[]>();
  const { coverages } = await loadNoveltyCoverageForAccounting({ period, employeeIds }, db);
  if (!coverages.length) return result;
  const coveredEmployeeIds = [...new Set(coverages.map((coverage) => coverage.employeeId))];
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 1));
  const [entries, breakdowns, dayOffs] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId: { in: coveredEmployeeIds }, period, status: { in: ["APROBADO", "EN_REVISION"] }, hourConcept: { systemRole: "NORMAL_BASE" } },
      select: accountingBaseEntrySelect,
    }),
    db.hourConceptBreakdown.findMany({ where: { employeeId: { in: coveredEmployeeIds }, period, status: countedBreakdownStatusWhere }, select: accountingBreakdownSelect }),
    loadDayOffAccounting({ employeeIds: coveredEmployeeIds, from: start, to: end }, db),
  ]);
  const accounting = accountEmployeePeriods(entries.map(toAccountingBaseEntry), breakdowns.map(toAccountingBreakdown), dayOffs, coverages);
  for (const periodAccounting of accounting.values()) {
    for (const [day, dayAccounting] of Object.entries(periodAccounting.days)) {
      const dateKey = `${period}-${day.padStart(2, "0")}`;
      for (const item of dayAccounting.novelty.items) {
        const days = result.get(item.noveltyId) ?? [];
        days.push({ dateKey, state: item.state, baseMinutes: item.baseMinutes });
        result.set(item.noveltyId, days);
      }
    }
  }
  for (const days of result.values()) days.sort((left, right) => left.dateKey.localeCompare(right.dateKey));
  return result;
}

// ── Vistas para la grilla (etapa 6 las muestra; acá sólo se arman) ─────────

export type NoveltyDayItemView = {
  noveltyId: string;
  noveltyTypeId: string;
  code: string;
  label: string;
  uiColor: string | null;
  // Minutos base efectivos de la novedad ese día (lo que muestra el chip).
  minutes: number;
  // minutes × multiplicador (lo que aportaría a liquidación si cuenta).
  settlementMinutes: number;
  state: NoveltyItemAccounting["state"];
  countsTowardTotal: boolean;
  reviewRequired: boolean;
  reviewReasons: NoveltyItemAccounting["reviewReasons"];
};

export function noveltyDayItemsView(items: NoveltyItemAccounting[], types: ReadonlyMap<string, CoverageNoveltyType>): NoveltyDayItemView[] {
  return items.map((item) => {
    const type = types.get(item.noveltyTypeId);
    return {
      noveltyId: item.noveltyId,
      noveltyTypeId: item.noveltyTypeId,
      code: type?.code ?? "",
      label: type?.name ?? "",
      uiColor: type?.uiColor ?? null,
      minutes: item.baseMinutes,
      settlementMinutes: item.settlementMinutes,
      state: item.state,
      countsTowardTotal: item.countsTowardTotal,
      reviewRequired: item.state === "REVIEW_REQUIRED",
      reviewReasons: item.reviewReasons,
    };
  });
}

export type NoveltyCoverageRowView = {
  noveltyType: CoverageNoveltyType;
  countsTowardTotal: boolean;
  // Por día del mes: minutos base efectivos, minutos para liquidación (sólo
  // los que cuentan) y el estado del día (el más restrictivo si hay varias
  // novedades del mismo tipo).
  minutesByDay: Record<string, number>;
  settlementMinutesByDay: Record<string, number>;
  stateByDay: Record<string, NoveltyItemAccounting["state"]>;
  // Totales del período por estado (de PeriodAccounting.novelty.types).
  totals: NoveltyTypeAccounting;
};

const STATE_PRIORITY: Record<NoveltyItemAccounting["state"], number> = { REVIEW_REQUIRED: 3, PENDING_APPROVAL: 2, INFORMATIVE: 1, COUNTED: 0 };

/** Una fila por tipo de novedad con cobertura o información en el período. */
export function noveltyCoverageRowsView(accounting: PeriodAccounting, types: ReadonlyMap<string, CoverageNoveltyType>): NoveltyCoverageRowView[] {
  const rows = new Map<string, NoveltyCoverageRowView>();
  for (const totals of accounting.novelty.types) {
    const noveltyType = types.get(totals.noveltyTypeId) ?? { id: totals.noveltyTypeId, code: "", name: "", uiColor: "" };
    rows.set(totals.noveltyTypeId, { noveltyType, countsTowardTotal: false, minutesByDay: {}, settlementMinutesByDay: {}, stateByDay: {}, totals });
  }
  for (const [day, dayAccounting] of Object.entries(accounting.days)) {
    for (const item of dayAccounting.novelty.items) {
      const row = rows.get(item.noveltyTypeId);
      if (!row) continue;
      row.countsTowardTotal ||= item.countsTowardTotal;
      row.minutesByDay[day] = (row.minutesByDay[day] ?? 0) + item.baseMinutes;
      if (item.state === "COUNTED") row.settlementMinutesByDay[day] = (row.settlementMinutesByDay[day] ?? 0) + item.settlementMinutes;
      const current = row.stateByDay[day];
      if (!current || STATE_PRIORITY[item.state] > STATE_PRIORITY[current]) row.stateByDay[day] = item.state;
    }
  }
  return [...rows.values()].sort((left, right) => left.noveltyType.name.localeCompare(right.noveltyType.name, "es"));
}
