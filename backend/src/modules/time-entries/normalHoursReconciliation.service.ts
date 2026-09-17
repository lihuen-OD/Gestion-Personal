import { Prisma } from "@prisma/client";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { auditService } from "../audit/audit.service";
import { automaticHourConceptBreakdownsService } from "../employees/automaticHourConceptBreakdowns.service";
import { clearEmployeeReadCaches } from "../employees/employees.controller";
import { clearTimeEntriesReadCaches } from "./timeEntries.cache";
import { normalHoursReconciliationRepository as repository } from "./normalHoursReconciliation.repository";
import {
  classifyNormalHoursDiscrepancy,
  pickCanonicalEntry,
  requiresRepair,
  type NormalEntryRow,
  type NormalHoursDiscrepancy,
  type NormalHoursDiscrepancyKind,
} from "./normalHoursReconciliation";
import { argentinaCalendarDate, dayOfMonthFromCalendarDate, periodCalendarBounds, periodFromCalendarDate } from "../../shared/datetime/argentinaTime";

export interface ReconciliationScope {
  legajo?: string;
  period?: string;
  /** "YYYY-MM-DD" — si se da, acota a un único día calendario y `period` pasa a ser sólo informativo. */
  date?: string;
}

export interface EmployeeDateReport {
  employeeId: string;
  legajo: string;
  date: string;
  period: string;
  day: number;
  discrepancy: NormalHoursDiscrepancy;
  rows: Array<{
    id: string;
    totalMinutes: number;
    actualMinutes: number | null;
    status: ApprovalStatus;
    workShiftId: string | null;
    timeSegmentId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface DryRunReport {
  generatedAt: string;
  scope: ReconciliationScope;
  employees: Array<{ employeeId: string; legajo: string; dates: EmployeeDateReport[] }>;
  summary: Record<NormalHoursDiscrepancyKind, number> & {
    totalEmployees: number;
    totalDatesChecked: number;
    totalDatesNeedingRepair: number;
  };
}

export type RepairAction =
  | "CREATED"
  | "UPDATED_CANONICAL"
  | "RETIRED_DUPLICATES"
  | "SKIPPED_ALREADY_OK"
  | "SKIPPED_CONCURRENT_MODIFICATION"
  | "SKIPPED_UNLINKED_ENTRY_EXISTS"
  | "ERROR";

export interface RepairOutcome {
  employeeId: string;
  legajo: string;
  date: string;
  action: RepairAction;
  before: unknown;
  after: unknown;
  error?: string;
}

export interface RepairReport {
  generatedAt: string;
  scope: ReconciliationScope;
  snapshot?: unknown;
  outcomes: RepairOutcome[];
  summary: Partial<Record<RepairAction, number>>;
  breakdownRecalculated: Array<{ employeeId: string; period: string; ok: boolean; error?: string }>;
}

const DISCREPANCY_KINDS: NormalHoursDiscrepancyKind[] = [
  "OK",
  "MISSING_TIME_ENTRY",
  "UNDERCOUNT",
  "OVERCOUNT",
  "DUPLICATE",
  "MIXED_STATUS",
  "LEGACY_INCONSISTENT",
];

async function resolveBounds(scope: ReconciliationScope): Promise<{ start: Date; end: Date }> {
  if (scope.date) {
    const start = argentinaCalendarDate(scope.date);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }
  if (!scope.period) {
    throw new AppError("Se requiere --period o --date para acotar la reconciliación", 400, "RECONCILIATION_SCOPE_REQUIRED");
  }
  return periodCalendarBounds(scope.period);
}

async function resolveEmployees(scope: ReconciliationScope, bounds: { start: Date; end: Date }) {
  if (scope.legajo) {
    const employee = await repository.findEmployeeByLegajo(scope.legajo);
    if (!employee) throw new AppError(`No se encontró un legajo ${scope.legajo}`, 404, "EMPLOYEE_NOT_FOUND");
    return [employee];
  }
  const ids = await repository.findEmployeeIdsWithSegmentActivity(bounds);
  if (!ids.length) return [];
  return repository.findEmployeesByIds(ids);
}

async function analyzeEmployee(
  employee: { id: string; legajo: string },
  bounds: { start: Date; end: Date },
  normalConceptId: string,
): Promise<EmployeeDateReport[]> {
  const [segments, entries] = await Promise.all([
    repository.findSegmentsForEmployee(employee.id, bounds),
    repository.findNormalEntriesForEmployee(employee.id, normalConceptId, bounds),
  ]);

  const expectedMinutesByDate = new Map<number, number>();
  for (const segment of segments) {
    const key = segment.date.getTime();
    expectedMinutesByDate.set(key, (expectedMinutesByDate.get(key) ?? 0) + segment.minutes);
  }

  const entriesByDate = new Map<number, NormalEntryRow[]>();
  for (const entry of entries) {
    const key = entry.date.getTime();
    const rows = entriesByDate.get(key) ?? [];
    rows.push({
      id: entry.id,
      totalMinutes: entry.totalMinutes,
      actualMinutes: entry.actualMinutes,
      hours: Number(entry.hours),
      status: entry.status,
      workShiftId: entry.workShiftId,
      timeSegmentId: entry.timeSegmentId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
    entriesByDate.set(key, rows);
  }

  const dateKeys = new Set<number>([...expectedMinutesByDate.keys(), ...entriesByDate.keys()]);
  const reports: EmployeeDateReport[] = [];
  for (const key of dateKeys) {
    const expectedMinutes = expectedMinutesByDate.get(key) ?? 0;
    const rows = entriesByDate.get(key) ?? [];
    const discrepancy = classifyNormalHoursDiscrepancy(expectedMinutes, rows);
    const date = new Date(key);
    reports.push({
      employeeId: employee.id,
      legajo: employee.legajo,
      date: date.toISOString().slice(0, 10),
      period: periodFromCalendarDate(date),
      day: dayOfMonthFromCalendarDate(date),
      discrepancy,
      rows: rows.map((row) => ({
        id: row.id,
        totalMinutes: row.totalMinutes,
        actualMinutes: row.actualMinutes,
        status: row.status,
        workShiftId: row.workShiftId,
        timeSegmentId: row.timeSegmentId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  }
  return reports.sort((a, b) => a.date.localeCompare(b.date));
}

async function dryRun(scope: ReconciliationScope): Promise<DryRunReport> {
  const bounds = await resolveBounds(scope);
  const normalConcept = await repository.findNormalConcept();
  if (!normalConcept) {
    throw new AppError("No existe el concepto canónico Hora normal (systemRole=NORMAL_BASE)", 500, "NORMAL_HOUR_CONCEPT_NOT_FOUND");
  }
  const employees = await resolveEmployees(scope, bounds);

  const summary = DISCREPANCY_KINDS.reduce((acc, kind) => ({ ...acc, [kind]: 0 }), {} as Record<NormalHoursDiscrepancyKind, number>);
  const employeeReports: DryRunReport["employees"] = [];
  let totalDatesChecked = 0;
  let totalDatesNeedingRepair = 0;

  for (const employee of employees) {
    const dates = await analyzeEmployee(employee, bounds, normalConcept.id);
    for (const dateReport of dates) {
      summary[dateReport.discrepancy.kind] += 1;
      totalDatesChecked += 1;
      if (requiresRepair(dateReport.discrepancy.kind)) totalDatesNeedingRepair += 1;
    }
    employeeReports.push({ employeeId: employee.id, legajo: employee.legajo, dates });
  }

  return {
    generatedAt: new Date().toISOString(),
    scope,
    employees: employeeReports,
    summary: { ...summary, totalEmployees: employees.length, totalDatesChecked, totalDatesNeedingRepair },
  };
}

/**
 * Repara un único employee+fecha dentro de su propia transacción — nunca el
 * mes completo en una sola transacción gigante (Etapa 15M.4 §15). Relee
 * TimeSegment/TimeEntry FRESCOS dentro de la transacción (nunca confía en el
 * snapshot del dry-run para el valor final, sólo para detectar concurrencia).
 */
async function repairEmployeeDate(
  employee: { id: string; legajo: string },
  dateReport: EmployeeDateReport,
  normalConceptId: string,
): Promise<RepairOutcome> {
  const date = argentinaCalendarDate(dateReport.date);
  const snapshotRows = dateReport.rows;

  try {
    return await prisma.$transaction(async (tx) => {
      const [freshSegments, freshRows] = await Promise.all([
        tx.timeSegment.findMany({
          where: { employeeId: employee.id, date, workShift: { status: "PROCESADO" } },
          select: { minutes: true },
        }),
        tx.timeEntry.findMany({
          where: { employeeId: employee.id, hourConceptId: normalConceptId, workShiftId: { not: null }, date },
          select: {
            id: true, hours: true, totalMinutes: true, actualMinutes: true, status: true,
            workShiftId: true, timeSegmentId: true, observation: true, createdAt: true, updatedAt: true,
          },
        }),
      ]);

      const expectedMinutes = freshSegments.reduce((sum, segment) => sum + segment.minutes, 0);
      const freshEntryRows: NormalEntryRow[] = freshRows.map((row) => ({
        id: row.id,
        totalMinutes: row.totalMinutes,
        actualMinutes: row.actualMinutes,
        hours: Number(row.hours),
        status: row.status,
        workShiftId: row.workShiftId,
        timeSegmentId: row.timeSegmentId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      // Concurrencia optimista: si el conjunto de filas o su updatedAt
      // cambiaron desde el snapshot del dry-run, no reparamos a ciegas --
      // alguien más tocó esta fecha en el medio.
      const snapshotIds = new Set(snapshotRows.map((row) => row.id));
      const freshIds = new Set(freshEntryRows.map((row) => row.id));
      const idsChanged = snapshotIds.size !== freshIds.size || [...snapshotIds].some((id) => !freshIds.has(id));
      const updatedAtChanged = freshEntryRows.some((row) => {
        const snapshotRow = snapshotRows.find((entry) => entry.id === row.id);
        return snapshotRow && snapshotRow.updatedAt !== row.updatedAt.toISOString();
      });
      if (idsChanged || updatedAtChanged) {
        return {
          employeeId: employee.id, legajo: employee.legajo, date: dateReport.date,
          action: "SKIPPED_CONCURRENT_MODIFICATION", before: snapshotRows, after: freshEntryRows,
        } satisfies RepairOutcome;
      }

      const discrepancy = classifyNormalHoursDiscrepancy(expectedMinutes, freshEntryRows);
      if (!requiresRepair(discrepancy.kind)) {
        return {
          employeeId: employee.id, legajo: employee.legajo, date: dateReport.date,
          action: "SKIPPED_ALREADY_OK", before: freshEntryRows, after: freshEntryRows,
        } satisfies RepairOutcome;
      }

      const period = periodFromCalendarDate(date);
      const day = dayOfMonthFromCalendarDate(date);
      const reconciliationNote = `Reconciliación histórica 15M.4 (${new Date().toISOString()}): total ajustado a ${expectedMinutes} min reales desde WorkShift/TimeSegment.`;

      if (freshEntryRows.length === 0) {
        // Guard defensivo (Etapa 15M.4 §12): confirma que no exista NINGÚN
        // TimeEntry NORMAL_BASE ese día (ni siquiera uno manual sin
        // workShiftId, invisible para el filtro de arriba) antes de crear
        // uno nuevo -- evita generar un duplicado nuevo al lado de una carga
        // manual legítima.
        const anyEntry = await tx.timeEntry.findFirst({
          where: { employeeId: employee.id, hourConceptId: normalConceptId, date },
          select: { id: true },
        });
        if (anyEntry) {
          return {
            employeeId: employee.id, legajo: employee.legajo, date: dateReport.date,
            action: "SKIPPED_UNLINKED_ENTRY_EXISTS", before: null, after: { existingId: anyEntry.id },
          } satisfies RepairOutcome;
        }

        const lastSegment = await tx.timeSegment.findFirst({
          where: { employeeId: employee.id, date, workShift: { status: "PROCESADO" } },
          orderBy: { toDateTime: "desc" },
          select: { id: true, workShiftId: true, fromDateTime: true, toDateTime: true, workShift: { select: { source: true } } },
        });
        const created = await tx.timeEntry.create({
          data: {
            employeeId: employee.id,
            hourConceptId: normalConceptId,
            workShiftId: lastSegment?.workShiftId ?? null,
            timeSegmentId: lastSegment?.id ?? null,
            date,
            period,
            day,
            hours: expectedMinutes / 60,
            totalMinutes: expectedMinutes,
            actualMinutes: expectedMinutes,
            status: "APROBADO",
            source: lastSegment?.workShift.source ?? null,
            segmentStartAt: lastSegment?.fromDateTime ?? null,
            segmentEndAt: lastSegment?.toDateTime ?? null,
            observation: reconciliationNote,
          },
        });
        await auditService.register({
          action: "CREATE",
          entity: "TimeEntry",
          entityId: created.id,
          description: "Reconciliación histórica 15M.4 desde WorkShift/TimeSegment",
          after: created as unknown as Prisma.InputJsonValue,
        });
        return {
          employeeId: employee.id, legajo: employee.legajo, date: dateReport.date,
          action: "CREATED", before: null, after: created,
        } satisfies RepairOutcome;
      }

      const { canonical, duplicates } = pickCanonicalEntry(freshEntryRows);
      const canonicalBefore = freshRows.find((row) => row.id === canonical.id)!;
      const updatedCanonical = await tx.timeEntry.update({
        where: { id: canonical.id },
        data: {
          hours: expectedMinutes / 60,
          totalMinutes: expectedMinutes,
          actualMinutes: expectedMinutes,
          period,
          day,
          observation: canonicalBefore.observation ? `${canonicalBefore.observation}\n${reconciliationNote}` : reconciliationNote,
        },
      });
      await auditService.register({
        action: "UPDATE",
        entity: "TimeEntry",
        entityId: canonical.id,
        description: "Reconciliación histórica 15M.4 desde WorkShift/TimeSegment",
        before: canonicalBefore as unknown as Prisma.InputJsonValue,
        after: updatedCanonical as unknown as Prisma.InputJsonValue,
      });

      let retiredAny = false;
      for (const duplicate of duplicates) {
        if (duplicate.totalMinutes === 0) continue; // ya retirada por un repair anterior -- idempotencia.
        retiredAny = true;
        const duplicateBefore = freshRows.find((row) => row.id === duplicate.id)!;
        const retireNote = `Retirada de cómputo por reconciliación 15M.4 -- fusionada en TimeEntry ${canonical.id}.`;
        const retired = await tx.timeEntry.update({
          where: { id: duplicate.id },
          data: {
            hours: 0,
            totalMinutes: 0,
            actualMinutes: 0,
            observation: duplicateBefore.observation ? `${duplicateBefore.observation}\n${retireNote}` : retireNote,
          },
        });
        await auditService.register({
          action: "UPDATE",
          entity: "TimeEntry",
          entityId: duplicate.id,
          description: `Reconciliación histórica 15M.4: retirada de cómputo (duplicado de ${canonical.id})`,
          before: duplicateBefore as unknown as Prisma.InputJsonValue,
          after: retired as unknown as Prisma.InputJsonValue,
        });
      }

      return {
        employeeId: employee.id, legajo: employee.legajo, date: dateReport.date,
        action: retiredAny ? "RETIRED_DUPLICATES" : "UPDATED_CANONICAL",
        before: freshRows, after: updatedCanonical,
      } satisfies RepairOutcome;
    }, { timeout: 15_000 });
  } catch (error) {
    return {
      employeeId: employee.id,
      legajo: employee.legajo,
      date: dateReport.date,
      action: "ERROR",
      before: snapshotRows,
      after: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function repair(
  scope: ReconciliationScope,
  options: { snapshot?: (payload: unknown) => Promise<unknown> } = {},
): Promise<RepairReport> {
  const dry = await dryRun(scope);
  const needsRepair = dry.employees.flatMap((employee) =>
    employee.dates
      .filter((dateReport) => requiresRepair(dateReport.discrepancy.kind))
      .map((dateReport) => ({ employee: { id: employee.employeeId, legajo: employee.legajo }, dateReport })),
  );

  let snapshot: unknown;
  if (needsRepair.length) {
    const snapshotPayload = {
      generatedAt: new Date().toISOString(),
      scope,
      entries: needsRepair.map((item) => ({
        employeeId: item.employee.id,
        legajo: item.employee.legajo,
        date: item.dateReport.date,
        discrepancy: item.dateReport.discrepancy,
        rows: item.dateReport.rows,
      })),
    };
    snapshot = options.snapshot ? await options.snapshot(snapshotPayload) : snapshotPayload;
  }

  const normalConcept = await repository.findNormalConcept();
  if (!normalConcept) {
    throw new AppError("No existe el concepto canónico Hora normal (systemRole=NORMAL_BASE)", 500, "NORMAL_HOUR_CONCEPT_NOT_FOUND");
  }

  const outcomes: RepairOutcome[] = [];
  for (const item of needsRepair) {
    outcomes.push(await repairEmployeeDate(item.employee, item.dateReport, normalConcept.id));
  }

  // Etapa 15M.4 §19: Motor B se recalcula una vez por employee+período
  // distinto realmente tocado por una reparación (nunca por MANUAL, nunca
  // por fecha) -- reutiliza el mismo núcleo interno de la Etapa 15M.2, sin
  // duplicar su lógica de elegibilidad/idempotencia.
  const touchedWrites = outcomes.filter((outcome) => outcome.action === "CREATED" || outcome.action === "UPDATED_CANONICAL" || outcome.action === "RETIRED_DUPLICATES");
  const touchedPeriods = new Set(touchedWrites.map((outcome) => `${outcome.employeeId}::${periodFromCalendarDate(argentinaCalendarDate(outcome.date))}`));
  const breakdownRecalculated: RepairReport["breakdownRecalculated"] = [];
  for (const key of touchedPeriods) {
    const [employeeId, period] = key.split("::") as [string, string];
    try {
      await automaticHourConceptBreakdownsService.recalculateForEmployeePeriod({ employeeId, period });
      breakdownRecalculated.push({ employeeId, period, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("NORMAL_HOURS_REPAIR_BREAKDOWN_SYNC_FAILED", { employeeId, period, error: message });
      breakdownRecalculated.push({ employeeId, period, ok: false, error: message });
    }
  }

  // Etapa 15M.4 §20: invalidar caché siempre que hubo al menos una
  // escritura real -- ver limitación documentada en el decision doc: si este
  // proceso corre como script standalone (proceso Node separado del server
  // real en ejecución), esto sólo limpia la memoria de ESTE proceso; el TTL
  // (60s grilla / 20s período) sigue siendo la única garantía real contra un
  // servidor vivo aparte.
  if (touchedWrites.length) {
    try {
      clearEmployeeReadCaches();
      clearTimeEntriesReadCaches();
    } catch (error) {
      console.error("NORMAL_HOURS_REPAIR_CACHE_CLEAR_FAILED", error);
    }
  }

  const summary = outcomes.reduce((acc, outcome) => {
    acc[outcome.action] = (acc[outcome.action] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<RepairAction, number>>);

  return {
    generatedAt: new Date().toISOString(),
    scope,
    snapshot,
    outcomes,
    summary,
    breakdownRecalculated,
  };
}

export const normalHoursReconciliationService = {
  dryRun,
  repair,
};
