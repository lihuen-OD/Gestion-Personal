/**
 * Diagnóstico de SÓLO LECTURA de convocatorias a feriado ACTIVAS
 * (WORKED_TIME_ACCOUNTING_MODEL.md §20, F2.4). Detecta convocatorias que, con
 * las reglas vigentes, no producen el horario esperado que se pretendía:
 *   - SIN_HORARIO: sin plantilla y sin turno ese día (descanso de rotación, día
 *     sin configurar, conflicto o sin turno): no hay falta ni alertas.
 *   - PLANTILLA_INVALIDA: plantilla inactiva o sin horario válido.
 *   - HORARIO_LIBRE: tiene inicio/fin propios y ninguna plantilla; el horario
 *     libre ya no define la jornada (rige el turno del día o "Revisar").
 *   - PLANTILLA_DISTINTA_DEL_TURNO: la plantilla reemplaza un turno distinto del
 *     real del día (p. ej. la autocompletada con un fijo cerrado al entrar a una
 *     rotación). Puede ser intencional: revisar.
 *   - FECHA_NO_FERIADO: la fecha ya no es feriado del calendario (sin efecto).
 * No corrige nada: la corrección en una base real requiere autorización.
 * Núcleo sin cliente compartido ni config/env: el script le pasa un lector de
 * sólo lectura (readOnlyDiagnostic.ts).
 */
import { argentinaCalendarDate, calendarDateKey, formatArgentinaDate } from "../../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../../shared/prisma/client";
import { formatEmployeeReference } from "../../../shared/audit/employeeReference";
import { resolveCalendarHolidayDates, workdayDateKeys } from "../expectedWorkday";
import { resolveConvocationSchedules, scheduleRequiresTemplate, type ConvocationScheduleReader } from "../holidayConvocationSchedule";
import { isTemplateUsable } from "../rotationPlan";

export type HolidayConvocationIssue = "SIN_HORARIO" | "PLANTILLA_INVALIDA" | "HORARIO_LIBRE" | "PLANTILLA_DISTINTA_DEL_TURNO" | "FECHA_NO_FERIADO";

export type HolidayConvocationFinding = { dateKey: string; employee: string; issue: HolidayConvocationIssue; detail: string };

export type HolidayConvocationDiagnosticReport = {
  range: { from: string; to: string };
  convocations: number;
  findings: HolidayConvocationFinding[];
  summary: Record<HolidayConvocationIssue, number>;
};

export type HolidayConvocationDiagnosticReader = ConvocationScheduleReader & Pick<PrismaTransactionClient, "holidayWorkAssignment" | "doubleHourRule">;

const SCHEDULE_TEXT: Record<string, string> = {
  ROTATION_REST: "descanso de su rotación",
  ROTATION_MISSING: "día sin configurar en su rotación",
  ROTATION_CONFLICT: "conflicto en su rotación",
  NONE: "sin turno aplicable",
};

export async function runHolidayConvocationDiagnostic(reader: HolidayConvocationDiagnosticReader, range: { from: string; to: string }): Promise<HolidayConvocationDiagnosticReport> {
  const from = argentinaCalendarDate(range.from);
  const to = argentinaCalendarDate(range.to);
  const [rules, convocations] = await Promise.all([
    reader.doubleHourRule.findMany({
      where: { kind: "FERIADO", status: "ACTIVO", fromDate: { lte: to }, OR: [{ toDate: null }, { toDate: { gte: from } }] },
      select: { id: true, recurrenceType: true, fromDate: true, toDate: true, weekdays: true, dates: { select: { date: true, isActive: true } } },
    }),
    reader.holidayWorkAssignment.findMany({
      where: { status: "ACTIVA", date: { gte: from, lte: to } },
      select: {
        employeeId: true,
        date: true,
        expectedStartTime: true,
        expectedEndTime: true,
        employee: { select: { legajo: true, firstName: true, lastName: true } },
        shiftTemplate: { select: { id: true, code: true, startTime: true, endTime: true, crossesMidnight: true, status: true } },
      },
      orderBy: [{ date: "asc" }, { employeeId: "asc" }],
    }),
  ]);
  const holidays = resolveCalendarHolidayDates(workdayDateKeys(from, to), rules);
  const findings: HolidayConvocationFinding[] = [];
  const byDate = new Map<string, typeof convocations>();
  for (const row of convocations) {
    const key = calendarDateKey(row.date);
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
  }
  for (const [dateKey, rows] of byDate) {
    const schedules = await resolveConvocationSchedules(reader, rows.map((row) => row.employeeId), dateKey);
    for (const row of rows) {
      const employee = formatEmployeeReference(row.employee);
      const add = (issue: HolidayConvocationIssue, detail: string) => findings.push({ dateKey, employee, issue, detail });
      if (!holidays.has(dateKey)) {
        add("FECHA_NO_FERIADO", `El ${formatArgentinaDate(dateKey)} ya no es feriado del calendario: la convocatoria no tiene efecto.`);
        continue;
      }
      const schedule = schedules.get(row.employeeId)!;
      const template = row.shiftTemplate;
      if (template && !isTemplateUsable(template)) add("PLANTILLA_INVALIDA", `El turno ${template.code} está inactivo o no tiene un horario válido.`);
      if (!template && scheduleRequiresTemplate(schedule.kind)) add("SIN_HORARIO", `Sin turno de convocatoria y ${SCHEDULE_TEXT[schedule.kind]}: no hay falta de ingreso ni alertas.`);
      if (!template && (row.expectedStartTime || row.expectedEndTime)) {
        add("HORARIO_LIBRE", `Horario libre ${row.expectedStartTime ?? "?"}–${row.expectedEndTime ?? "?"} sin turno: ya no define la jornada.`);
      }
      if (template && schedule.blocks.length && !schedule.blocks.some((block) => block.templateId === template.id)) {
        add("PLANTILLA_DISTINTA_DEL_TURNO", `El turno de la convocatoria ${template.code} reemplaza a ${schedule.blocks.map((block) => block.code).join(" + ")} ese día. Confirmar que sea intencional.`);
      }
    }
  }
  const summary = { SIN_HORARIO: 0, PLANTILLA_INVALIDA: 0, HORARIO_LIBRE: 0, PLANTILLA_DISTINTA_DEL_TURNO: 0, FECHA_NO_FERIADO: 0 } satisfies Record<HolidayConvocationIssue, number>;
  for (const finding of findings) summary[finding.issue] += 1;
  return { range: { from: range.from, to: range.to }, convocations: convocations.length, findings, summary };
}

export function formatHolidayConvocationDiagnostic(report: HolidayConvocationDiagnosticReport): string {
  const lines = [
    `Convocatorias ACTIVAS del ${formatArgentinaDate(report.range.from)} al ${formatArgentinaDate(report.range.to)}: ${report.convocations}`,
    ...Object.entries(report.summary).map(([issue, count]) => `  ${issue}: ${count}`),
  ];
  if (report.findings.length) {
    lines.push("", "Detalle:");
    for (const finding of report.findings) lines.push(`  ${formatArgentinaDate(finding.dateKey)} · ${finding.employee} · ${finding.issue} · ${finding.detail}`);
  } else {
    lines.push("", "Sin hallazgos.");
  }
  return lines.join("\n");
}
