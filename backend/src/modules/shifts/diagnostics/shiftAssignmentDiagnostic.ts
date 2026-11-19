/**
 * Diagnóstico de SÓLO LECTURA de asignaciones de turno (Etapa R1,
 * docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §19). Mide con datos reales:
 *   B1. valores actuales de `ShiftTemplate.categoryName`;
 *   B2. empleados ACTIVO con 2+ `ShiftAssignment` HABILITADAS aplicables el
 *       mismo día (vigencia, weekdays, estado del turno y del empleado);
 *   B3. qué hace HOY cada consumidor ese día: obligación de trabajo (falta de
 *       ingreso / inactividad), candidatos y ruteo del matching de entrada,
 *       jornada esperada de Novedades y superposición.
 *
 * No corrige nada ni reinterpreta `categoryName` como lugar. Etapa R2: no
 * replica ninguna regla — usa el resolver central (`resolveExpectedShift`,
 * `pickEarliestFixedCandidate`, `entryReferenceCandidates`,
 * `activeRegimeKindOn`) y las funciones reales de los consumidores
 * (`matchShiftForEmployee`, `evaluateEmployeeWorkday`,
 * `loadEmployeeWorkdayContext`). El test de paridad contra
 * `resolveWorkObligationCandidates` se conserva (shiftAssignmentDiagnostic.test.ts).
 *
 * Este módulo nunca importa el cliente Prisma compartido ni `config/env`: el
 * script le pasa un lector de sólo lectura (readOnlyDiagnostic.ts).
 */
import type { WorkRegimeKind } from "@prisma/client";
import {
  argentinaCalendarDate,
  argentinaDayRange,
  calendarDateKey,
  nextCalendarDateKey,
  todayArgentinaDateKey,
} from "../../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../../shared/prisma/client";
import {
  evaluateEmployeeWorkday,
  expectedMinutesForTemplates,
  loadEmployeeWorkdayContext,
  MAX_WORKDAY_RANGE_DAYS,
  workdayDateKeys,
  type EmployeeWorkdayContext,
  type WorkdayContextReader,
} from "../expectedWorkday";
import {
  activeRegimeKindOn,
  entryReferenceCandidates,
  isShiftAssignmentApplicableOnDate,
  pickEarliestFixedCandidate,
  resolveExpectedShift,
} from "../expectedShiftResolver";
import { matchShiftForEmployee, type ShiftTemplateRef } from "../workShiftEvaluation.service";

export const DEFAULT_DIAGNOSTIC_DAYS = 28;

// ── Entrada ─────────────────────────────────────────────────────────────────

export type DiagnosticTemplate = ShiftTemplateRef & {
  name: string;
  categoryName: string | null;
  expectedMinutes: number | null;
  status: "ACTIVO" | "INACTIVO";
};

export type DiagnosticEmployee = { id: string; legajo: string; firstName: string; lastName: string; status: string };

export type DiagnosticAssignment = {
  id: string;
  employeeId: string;
  shiftTemplateId: string;
  status: "HABILITADO" | "DESHABILITADO";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  weekdays: number[];
  employee: DiagnosticEmployee;
};

export type DiagnosticInput = {
  from: string;
  to: string;
  templates: DiagnosticTemplate[];
  assignments: DiagnosticAssignment[];
  /** Contexto real de `loadEmployeeWorkdayContext`, sólo para los empleados con 2+ HABILITADAS. */
  workdayContexts: ReadonlyMap<string, EmployeeWorkdayContext>;
};

// ── Salida ──────────────────────────────────────────────────────────────────

export type CategoryValueReport = { value: string | null; count: number; templates: Array<{ code: string; name: string; status: string }> };

export type AssignmentReport = {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  status: DiagnosticAssignment["status"];
  templateStatus: DiagnosticTemplate["status"];
  effectiveFrom: string;
  effectiveTo: string | null;
  weekdays: number[];
};

export type PotentialOverlap = { codes: [string, string]; from: string; to: string | null; weekdays: number[] };

export type WorkObligationPick = {
  code: string | null;
  scheduledStart: string | null;
  reason: "EARLIEST_START" | "HOLIDAY_NOT_CONVOKED" | "DAY_OFF" | "REGIME_SIN_TURNO" | "NO_APPLICABLE_ASSIGNMENT";
};

export type ConflictDayGroup = {
  dates: string[];
  applicable: string[];
  workObligation: WorkObligationPick;
  entryCandidates: Array<{ code: string; status: DiagnosticAssignment["status"] }>;
  /** Ruteo real de `matchShiftForEmployee` para una fichada a cada minuto del día calendario. */
  entryRouting: Array<{ from: string; to: string; code: string | null; case: string }>;
  expectedWorkday: { obligation: string; expectedMinutes: number | null; unresolvedReason: string | null; source: string };
  overlap: boolean;
  isHoliday: boolean;
  convoked: boolean;
  dayOff: boolean;
  regimeKind: WorkRegimeKind | null;
};

export type EmployeeConflictReport = {
  employeeId: string;
  legajo: string;
  name: string;
  assignments: AssignmentReport[];
  potentialOverlaps: PotentialOverlap[];
  conflictDays: number;
  groups: ConflictDayGroup[];
};

export type ShiftAssignmentDiagnosticReport = {
  mode: "READ ONLY DIAGNOSTIC";
  range: { from: string; to: string; days: number };
  categories: CategoryValueReport[];
  categoryNormalizationCollisions: Array<{ normalized: string; values: string[] }>;
  conflicts: EmployeeConflictReport[];
  summary: {
    templates: number;
    activeEmployeesWithEnabledAssignments: number;
    employeesWithMultipleEnabledAssignments: number;
    inactiveEmployeesWithMultipleEnabledAssignments: number;
    employeesWithConflict: number;
    conflictingEmployeeDays: number;
    conflictDaysWithObligation: number;
    conflictDaysWithSummedExpectedMinutes: number;
    conflictDaysUnresolved: number;
    conflictDaysWithOverlap: number;
    templatesByCategory: Record<string, number>;
  };
};

const NO_CATEGORY = "(sin categoría)";
const WEEKDAY_LABELS = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"] as const;

// ── Rango ───────────────────────────────────────────────────────────────────

export function resolveDiagnosticRange(from: string | null, to: string | null, today = todayArgentinaDateKey()): { from: string; to: string; days: number } {
  const start = from ?? today;
  let end = to;
  if (!end) {
    end = start;
    for (let index = 1; index < DEFAULT_DIAGNOSTIC_DAYS; index += 1) end = nextCalendarDateKey(end);
  }
  const days = workdayDateKeys(argentinaCalendarDate(start), argentinaCalendarDate(end)).length; // valida orden y máximo
  if (days > MAX_WORKDAY_RANGE_DAYS) throw new Error(`Rango máximo ${MAX_WORKDAY_RANGE_DAYS} días.`);
  return { from: start, to: end, days };
}

// ── B1. categoryName ────────────────────────────────────────────────────────

export function summarizeCategoryNames(templates: DiagnosticTemplate[]): { categories: CategoryValueReport[]; collisions: Array<{ normalized: string; values: string[] }> } {
  const byValue = new Map<string | null, DiagnosticTemplate[]>();
  for (const template of templates) {
    const list = byValue.get(template.categoryName) ?? [];
    list.push(template);
    byValue.set(template.categoryName, list);
  }
  const categories = [...byValue.entries()]
    .map(([value, list]) => ({
      value,
      count: list.length,
      templates: [...list].sort((a, b) => a.code.localeCompare(b.code)).map((item) => ({ code: item.code, name: item.name, status: item.status })),
    }))
    // null al final; el resto, alfabético exacto (sin normalizar).
    .sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value)));

  // Valores que sólo difieren en mayúsculas/espacios: se informan, nunca se fusionan.
  const byNormalized = new Map<string, Set<string>>();
  for (const value of byValue.keys()) {
    if (value === null) continue;
    const normalized = value.trim().toLocaleLowerCase("es");
    byNormalized.set(normalized, (byNormalized.get(normalized) ?? new Set()).add(value));
  }
  const collisions = [...byNormalized.entries()].filter(([, values]) => values.size > 1).map(([normalized, values]) => ({ normalized, values: [...values].sort() }));
  return { categories, collisions };
}

// ── Obligación de trabajo (resolver central) ────────────────────────────────

/**
 * Lo que hoy decide `resolveWorkObligationCandidates` para un empleado ACTIVO
 * con estas plantillas HABILITADAS aplicables. Etapa R2: ya no es una réplica
 * — usa la misma precedencia (`resolveExpectedShift`, política
 * WORK_OBLIGATION) y la misma selección legacy (`pickEarliestFixedCandidate`)
 * que el servicio. El feriado de alertas es por calendario, sin alcance (P7).
 */
export function currentWorkObligationPick(input: {
  dateKey: string;
  applicable: Array<Pick<ShiftTemplateRef, "code" | "startTime">>;
  isHolidayByCalendar: boolean;
  convoked: boolean;
  regimeKind: WorkRegimeKind | null;
  dayOff: boolean;
}): WorkObligationPick {
  const resolution = resolveExpectedShift(
    {
      dateKey: input.dateKey,
      // Ya aplicables: sin vigencia ni días que filtrar.
      assignments: input.applicable.map((template) => ({ status: "HABILITADO" as const, template })),
      dayOff: input.dayOff,
      holiday: input.isHolidayByCalendar ? "IN_SCOPE" : null,
      convocation: input.convoked ? { convoked: true } : null,
      regimeKind: input.regimeKind,
    },
    "WORK_OBLIGATION",
  );
  if (resolution.obligation !== "SHIFT") {
    const reason = resolution.reason === "HOLIDAY_NOT_CONVOKED" || resolution.reason === "DAY_OFF" || resolution.reason === "REGIME_SIN_TURNO" ? resolution.reason : "NO_APPLICABLE_ASSIGNMENT";
    return { code: null, scheduledStart: null, reason };
  }
  const earliest = pickEarliestFixedCandidate(input.dateKey, resolution.fixedCandidates);
  return earliest ? { code: earliest.template.code, scheduledStart: earliest.template.startTime, reason: "EARLIEST_START" } : { code: null, scheduledStart: null, reason: "NO_APPLICABLE_ASSIGNMENT" };
}

// ── Ruteo de la entrada (función real, minuto a minuto) ─────────────────────

function hhmm(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function entryRoutingForDate(dateKey: string, assignments: DiagnosticAssignment[], templates: DiagnosticTemplate[]): ConflictDayGroup["entryRouting"] {
  const employeeAssignments = assignments.map((item) => ({ shiftTemplateId: item.shiftTemplateId, status: item.status, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo, weekdays: item.weekdays }));
  const activeTemplates = templates.filter((template) => template.status === "ACTIVO");
  const codeById = new Map(templates.map((template) => [template.id, template.code]));
  const startAt = argentinaDayRange(dateKey).startAt.getTime();
  const ranges: ConflictDayGroup["entryRouting"] = [];
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const match = matchShiftForEmployee({ actualAt: new Date(startAt + minute * 60_000), employeeAssignments, activeTemplates });
    const code = match.template ? (codeById.get(match.template.id) ?? match.template.code) : null;
    const last = ranges[ranges.length - 1];
    if (last && last.code === code && last.case === match.case) last.to = hhmm(minute);
    else ranges.push({ from: hhmm(minute), to: hhmm(minute), code, case: match.case });
  }
  return ranges;
}

// ── B2/B3 ───────────────────────────────────────────────────────────────────

function appliesOn(assignment: Pick<DiagnosticAssignment, "effectiveFrom" | "effectiveTo" | "weekdays">, date: Date) {
  return isShiftAssignmentApplicableOnDate(assignment, date);
}

function weekdaySet(weekdays: number[]) {
  return weekdays.length ? new Set(weekdays) : new Set([0, 1, 2, 3, 4, 5, 6]);
}

/** Pares HABILITADOS con vigencia y días en común, sin depender del rango analizado. */
export function potentialOverlaps(enabled: Array<DiagnosticAssignment & { template: DiagnosticTemplate }>): PotentialOverlap[] {
  const result: PotentialOverlap[] = [];
  for (let i = 0; i < enabled.length; i += 1) {
    for (let j = i + 1; j < enabled.length; j += 1) {
      const a = enabled[i]!;
      const b = enabled[j]!;
      const from = a.effectiveFrom > b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom;
      const to = a.effectiveTo && b.effectiveTo ? (a.effectiveTo < b.effectiveTo ? a.effectiveTo : b.effectiveTo) : (a.effectiveTo ?? b.effectiveTo);
      if (to && to < from) continue;
      const bDays = weekdaySet(b.weekdays);
      const weekdays = [...weekdaySet(a.weekdays)].filter((day) => bDays.has(day)).sort();
      if (!weekdays.length) continue;
      result.push({ codes: [a.template.code, b.template.code], from: calendarDateKey(from), to: to ? calendarDateKey(to) : null, weekdays });
    }
  }
  return result;
}

export function buildShiftAssignmentDiagnostic(input: DiagnosticInput): ShiftAssignmentDiagnosticReport {
  const range = { from: input.from, to: input.to, days: workdayDateKeys(argentinaCalendarDate(input.from), argentinaCalendarDate(input.to)).length };
  const dateKeys = workdayDateKeys(argentinaCalendarDate(input.from), argentinaCalendarDate(input.to));
  const templatesById = new Map(input.templates.map((template) => [template.id, template]));
  const { categories, collisions } = summarizeCategoryNames(input.templates);

  const byEmployee = new Map<string, DiagnosticAssignment[]>();
  for (const assignment of input.assignments) {
    const list = byEmployee.get(assignment.employeeId) ?? [];
    list.push(assignment);
    byEmployee.set(assignment.employeeId, list);
  }

  let activeWithEnabled = 0;
  let withMultiple = 0;
  let inactiveWithMultiple = 0;
  const conflicts: EmployeeConflictReport[] = [];

  for (const [employeeId, rows] of byEmployee) {
    const employee = rows[0]!.employee;
    const enabled = rows
      .filter((row) => row.status === "HABILITADO")
      .map((row) => ({ ...row, template: templatesById.get(row.shiftTemplateId)! }))
      .filter((row) => row.template?.status === "ACTIVO");
    if (employee.status !== "ACTIVO") {
      if (enabled.length > 1) inactiveWithMultiple += 1;
      continue;
    }
    if (!enabled.length) continue;
    activeWithEnabled += 1;
    if (enabled.length < 2) continue;
    withMultiple += 1;

    const context = input.workdayContexts.get(employeeId);
    const groups = new Map<string, ConflictDayGroup>();
    let conflictDays = 0;
    for (const dateKey of dateKeys) {
      const date = argentinaCalendarDate(dateKey);
      const applicable = enabled.filter((row) => appliesOn(row, date));
      if (applicable.length < 2) continue;
      conflictDays += 1;

      const holidayStatus = context?.holidays.get(dateKey) ?? null;
      const convoked = Boolean(context?.convocations.get(dateKey));
      const dayOff = Boolean(context?.dayOffDates.has(dateKey));
      const regimeKind = context ? activeRegimeKindOn(context.regimes, date) : null;
      const applicableTemplates = applicable.map((row) => row.template);
      const workObligation = currentWorkObligationPick({ dateKey, applicable: applicableTemplates, isHolidayByCalendar: holidayStatus !== null, convoked, regimeKind, dayOff });
      // Mismos candidatos y mismo orden que el matching real (habilitadas primero).
      const entryCandidates = entryReferenceCandidates({ referenceDate: date, assignments: rows, activeTemplates: input.templates.filter((template) => template.status === "ACTIVO") }).map(
        (candidate) => ({ code: candidate.template.code, status: candidate.enabled ? ("HABILITADO" as const) : ("DESHABILITADO" as const) }),
      );
      const workday = context ? evaluateEmployeeWorkday(context, dateKey) : null;
      const minutes = expectedMinutesForTemplates(applicableTemplates);
      const overlap = "unresolved" in minutes && minutes.unresolved === "SHIFT_ASSIGNMENTS_OVERLAP";
      const expectedWorkday = workday
        ? { obligation: workday.obligation, expectedMinutes: workday.expectedMinutes, unresolvedReason: workday.unresolvedReason, source: workday.source }
        : { obligation: "NOT_LOADED", expectedMinutes: null, unresolvedReason: null, source: "NONE" };

      const signature = JSON.stringify([applicableTemplates.map((t) => t.id), workObligation, entryCandidates, expectedWorkday, overlap, holidayStatus, convoked, dayOff, regimeKind, date.getUTCDay()]);
      const existing = groups.get(signature);
      if (existing) {
        existing.dates.push(dateKey);
        continue;
      }
      groups.set(signature, {
        dates: [dateKey],
        applicable: applicableTemplates.map((template) => `${template.code} ${template.startTime}–${template.endTime}`),
        workObligation,
        entryCandidates,
        entryRouting: entryRoutingForDate(dateKey, rows, input.templates),
        expectedWorkday,
        overlap,
        isHoliday: holidayStatus !== null,
        convoked,
        dayOff,
        regimeKind,
      });
    }
    if (!conflictDays) continue;
    conflicts.push({
      employeeId,
      legajo: employee.legajo,
      name: `${employee.lastName}, ${employee.firstName}`,
      assignments: rows
        .map((row) => {
          const template = templatesById.get(row.shiftTemplateId)!;
          return {
            code: template.code,
            name: template.name,
            startTime: template.startTime,
            endTime: template.endTime,
            crossesMidnight: template.crossesMidnight,
            status: row.status,
            templateStatus: template.status,
            effectiveFrom: calendarDateKey(row.effectiveFrom),
            effectiveTo: row.effectiveTo ? calendarDateKey(row.effectiveTo) : null,
            weekdays: [...row.weekdays].sort(),
          };
        })
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code)),
      potentialOverlaps: potentialOverlaps(enabled),
      conflictDays,
      groups: [...groups.values()],
    });
  }

  conflicts.sort((a, b) => a.legajo.localeCompare(b.legajo));
  const allGroups = conflicts.flatMap((conflict) => conflict.groups);
  const daysWhere = (predicate: (group: ConflictDayGroup) => boolean) => allGroups.filter(predicate).reduce((sum, group) => sum + group.dates.length, 0);

  return {
    mode: "READ ONLY DIAGNOSTIC",
    range,
    categories,
    categoryNormalizationCollisions: collisions,
    conflicts,
    summary: {
      templates: input.templates.length,
      activeEmployeesWithEnabledAssignments: activeWithEnabled,
      employeesWithMultipleEnabledAssignments: withMultiple,
      inactiveEmployeesWithMultipleEnabledAssignments: inactiveWithMultiple,
      employeesWithConflict: conflicts.length,
      conflictingEmployeeDays: conflicts.reduce((sum, conflict) => sum + conflict.conflictDays, 0),
      conflictDaysWithObligation: daysWhere((group) => group.workObligation.code !== null),
      conflictDaysWithSummedExpectedMinutes: daysWhere((group) => group.expectedWorkday.obligation === "WORKDAY" && group.applicable.length > 1 && group.expectedWorkday.source === "SHIFT_PLAN"),
      conflictDaysUnresolved: daysWhere((group) => group.expectedWorkday.obligation === "UNRESOLVED"),
      conflictDaysWithOverlap: daysWhere((group) => group.overlap),
      templatesByCategory: Object.fromEntries(categories.map((category) => [category.value ?? NO_CATEGORY, category.count])),
    },
  };
}

// ── Carga (sólo lecturas) ───────────────────────────────────────────────────

export type ShiftDiagnosticReader = Pick<PrismaTransactionClient, "shiftTemplate" | "shiftAssignment"> & WorkdayContextReader;

export async function runShiftAssignmentDiagnostic(reader: ShiftDiagnosticReader, range: { from: string; to: string }): Promise<ShiftAssignmentDiagnosticReport> {
  const [templates, assignments] = await Promise.all([
    reader.shiftTemplate.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        categoryName: true,
        startTime: true,
        endTime: true,
        crossesMidnight: true,
        expectedMinutes: true,
        status: true,
        entryToleranceBeforeMinutes: true,
        entryToleranceAfterMinutes: true,
        exitToleranceBeforeMinutes: true,
        exitToleranceAfterMinutes: true,
        minimumMinutesForCompliance: true,
        maximumInformativeMinutes: true,
        missingOutAlertAfterMinutes: true,
        absoluteOpenShiftLimitMinutes: true,
      },
      orderBy: { code: "asc" },
    }),
    reader.shiftAssignment.findMany({
      select: {
        id: true,
        employeeId: true,
        shiftTemplateId: true,
        status: true,
        effectiveFrom: true,
        effectiveTo: true,
        weekdays: true,
        employee: { select: { id: true, legajo: true, firstName: true, lastName: true, status: true } },
      },
      orderBy: [{ employeeId: "asc" }, { assignedAt: "asc" }],
    }),
  ]);

  // Contexto real de Novedades sólo para quien puede tener conflicto.
  const templateStatus = new Map(templates.map((template) => [template.id, template.status]));
  const enabledCount = new Map<string, number>();
  for (const row of assignments) {
    if (row.status !== "HABILITADO" || row.employee.status !== "ACTIVO" || templateStatus.get(row.shiftTemplateId) !== "ACTIVO") continue;
    enabledCount.set(row.employeeId, (enabledCount.get(row.employeeId) ?? 0) + 1);
  }
  const candidateIds = [...enabledCount].filter(([, count]) => count > 1).map(([employeeId]) => employeeId);
  const workdayContexts = await loadEmployeeWorkdayContext(candidateIds, argentinaCalendarDate(range.from), argentinaCalendarDate(range.to), reader);

  return buildShiftAssignmentDiagnostic({ from: range.from, to: range.to, templates, assignments, workdayContexts });
}

// ── Formato humano ──────────────────────────────────────────────────────────

const weekdaysLabel = (weekdays: number[]) => (weekdays.length ? weekdays.map((day) => WEEKDAY_LABELS[day]).join(" ") : "todos");

function compactDates(dates: string[]) {
  return dates.length <= 8 ? dates.join(", ") : `${dates.slice(0, 6).join(", ")} … ${dates[dates.length - 1]} (${dates.length} fechas)`;
}

export function formatShiftAssignmentDiagnostic(report: ShiftAssignmentDiagnosticReport): string {
  const lines: string[] = [];
  lines.push("SHIFT ASSIGNMENT DIAGNOSTIC", `Mode: ${report.mode}`, `Range: ${report.range.from} → ${report.range.to} (${report.range.days} días)`, "");

  lines.push("Category values (ShiftTemplate.categoryName, sin reinterpretar):");
  for (const category of report.categories) {
    lines.push(`- ${category.value === null ? NO_CATEGORY : JSON.stringify(category.value)}: ${category.count} plantilla(s)`);
    for (const template of category.templates) lines.push(`    ${template.code} · ${template.name}${template.status === "ACTIVO" ? "" : ` [${template.status}]`}`);
  }
  if (report.categoryNormalizationCollisions.length) {
    lines.push("  Valores que sólo difieren en mayúsculas/espacios:");
    for (const collision of report.categoryNormalizationCollisions) lines.push(`    ${collision.values.map((value) => JSON.stringify(value)).join(" / ")}`);
  }
  lines.push("");

  lines.push("Employees with multiple applicable enabled assignments:");
  if (!report.conflicts.length) lines.push("- ninguno en el rango analizado");
  for (const conflict of report.conflicts) {
    lines.push("", `Employee ${conflict.legajo} - ${conflict.name} (${conflict.conflictDays} día(s) en conflicto)`, "  Assignments:");
    for (const item of conflict.assignments) {
      lines.push(
        `  - ${item.code} ${item.startTime}–${item.endTime}${item.crossesMidnight ? " (cruza medianoche)" : ""} · ${item.status}` +
          `${item.templateStatus === "ACTIVO" ? "" : ` · turno ${item.templateStatus}`} · vigencia ${item.effectiveFrom} → ${item.effectiveTo ?? "sin fin"} · días ${weekdaysLabel(item.weekdays)}`,
      );
    }
    if (conflict.potentialOverlaps.length) {
      lines.push("  Potential conflict (independiente del rango):");
      for (const overlap of conflict.potentialOverlaps) lines.push(`  - ${overlap.codes.join(" + ")} desde ${overlap.from} hasta ${overlap.to ?? "sin fin"} · días ${weekdaysLabel(overlap.weekdays)}`);
    }
    for (const group of conflict.groups) {
      lines.push(`  Dates: ${compactDates(group.dates)}`, "  Applicable:");
      for (const item of group.applicable) lines.push(`  - ${item}`);
      const flags = [group.isHoliday ? (group.convoked ? "feriado convocado" : "feriado sin convocatoria") : null, group.dayOff ? "franco" : null, group.regimeKind ? `régimen ${group.regimeKind}` : null].filter(Boolean);
      lines.push("  Current behavior:");
      if (flags.length) lines.push(`  - Context: ${flags.join(", ")}`);
      lines.push(
        `  - Work obligation (falta de ingreso / inactividad): ${group.workObligation.code ? `${group.workObligation.code} ${group.workObligation.scheduledStart}` : `ninguna (${group.workObligation.reason})`}`,
        `  - Entry candidates: ${group.entryCandidates.map((item) => `${item.code}${item.status === "HABILITADO" ? "" : ` (${item.status})`}`).join(" / ")}`,
        `  - Entry routing: ${group.entryRouting.map((range) => `${range.from}–${range.to} → ${range.code ?? "sin turno"}`).join(" · ")}`,
        `  - Expected schedule (Novedades): ${group.expectedWorkday.obligation}${group.expectedWorkday.expectedMinutes !== null ? ` ${group.expectedWorkday.expectedMinutes} min` : ""}${group.expectedWorkday.unresolvedReason ? ` (${group.expectedWorkday.unresolvedReason})` : ""}`,
        `  - Overlap: ${group.overlap ? "YES" : "NO"}`,
      );
    }
  }

  const summary = report.summary;
  lines.push(
    "",
    "Summary:",
    `- templates: ${summary.templates}`,
    `- active employees with enabled assignments (analyzed): ${summary.activeEmployeesWithEnabledAssignments}`,
    `- active employees with 2+ enabled assignments: ${summary.employeesWithMultipleEnabledAssignments}`,
    `- inactive employees with 2+ enabled assignments (no analizados): ${summary.inactiveEmployeesWithMultipleEnabledAssignments}`,
    `- employees with conflict in range: ${summary.employeesWithConflict}`,
    `- conflicting employee-days: ${summary.conflictingEmployeeDays}`,
    `  · con obligación de trabajo (alertas eligen un turno): ${summary.conflictDaysWithObligation}`,
    `  · Novedades suma turnos: ${summary.conflictDaysWithSummedExpectedMinutes}`,
    `  · Novedades UNRESOLVED: ${summary.conflictDaysUnresolved}`,
    `  · turnos superpuestos: ${summary.conflictDaysWithOverlap}`,
    `- templates by categoryName: ${Object.entries(summary.templatesByCategory).map(([value, count]) => `${value}=${count}`).join(", ") || "-"}`,
  );
  return lines.join("\n");
}
