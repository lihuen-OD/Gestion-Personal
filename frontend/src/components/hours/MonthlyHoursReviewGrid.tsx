import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { NoveltyCoverageItem } from "../../types/workedTimeAccounting.types";
import { timeGridRowLabel, timeGridRowSubtitle } from "../../utils/employeeHoursGrid";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";
import { getMonthDays, getWeekdayAbbr } from "../../utils/period";
import { EmptyState } from "../ui/EmptyState";
import { MonthlyHoursTableSections } from "./MonthlyHoursTableSections";
import { conceptDayAmount, conceptPeriodAmount } from "../../utils/workedTimeAccounting";
import { amountDescription, amountMinutes, SettlementTotalCell, SpecialHourDot } from "./SettlementAmount";
import { DayOffMark, dayOffDescription } from "./DayOffMark";

// Etapa 15K: presentacional puro — recibe la grilla ya cargada (misma fuente
// que EmployeeHoursPage, GET /employees/:id/time-grid) y sólo la muestra.
// No llama APIs, no edita horas, no abre modales, no conoce roles. Las
// secciones (Horas base / Distribución de la jornada / Horas adicionales /
// totales) son las mismas que el detalle por legajo
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
export function MonthlyHoursReviewGrid({ grid, period, onReviewNovelty }: { grid: EmployeeTimeGrid; period: string; onReviewNovelty?: (item: NoveltyCoverageItem, day: number) => void }) {
  if (!grid.rows.length && !grid.noveltyCoverageRows.length) {
    return <EmptyState text="No hay horas registradas para este período." size="compact" />;
  }

  const monthDays = getMonthDays(period);
  const renderRow = (row: EmployeeTimeGridRow) => {
    const label = timeGridRowLabel(row);
    const isBase = row.role === "NORMAL_BASE";
    return (
      <tr key={row.concept.id} className={isBase ? "hours-base-row" : undefined}>
        <td>
          <b>{label}</b>
          <span className="table-sub" title={timeGridRowSubtitle(row)}>{timeGridRowSubtitle(row)}</span>
        </td>
        {monthDays.map((day) => {
          const realMinutes = row.minutesByDay[String(day)] ?? 0;
          const daySpecialHour = grid.specialHoursByDay[String(day)];
          // Horas base: siempre tiempo real registrado, sin indicador de Hora
          // Especial. Cada concepto: lo que se liquida ese día (calculado por
          // el backend), con el real en el indicador. La cobertura se muestra
          // en filas propias, alimentadas por noveltyCoverageRows.
          const amount = isBase ? null : conceptDayAmount(grid.accounting, day, row.concept.id, realMinutes);
          const minutes = amount ? amountMinutes(amount) : realMinutes;
          // Franco (EMPLOYEE_DAY_OFF.md §15): "Franco" + lo que computa, nunca "—".
          const dayOff = isBase ? grid.dayOffsByDay[String(day)] : undefined;
          const cellClass = ["hour-cell", dayOff ? "day-off" : minutes ? "filled" : "", amount?.pending ? "is-syncing" : ""].filter(Boolean).join(" ");
          const description = dayOff ? dayOffDescription(dayOff, minutes) : amount ? amountDescription(amount, daySpecialHour?.ruleNames) : formatDurationMinutes(minutes);
          const titleParts = minutes || dayOff ? [description] : [];
          return (
            <td key={`${row.concept.id}-${day}`}>
              <span className={cellClass} title={titleParts.join(" · ") || undefined} aria-label={`${label}, día ${day}: ${minutes || dayOff ? description : "sin horas"}`}>
                {dayOff ? <DayOffMark countedMinutes={minutes} /> : <span>{minutes ? formatCompactDurationMinutes(minutes) : "—"}</span>}
                {amount && minutes ? <SpecialHourDot amount={amount} ruleNames={daySpecialHour?.ruleNames} /> : null}
              </span>
            </td>
          );
        })}
        {isBase ? (
          <td>
            <b title={formatDurationMinutes(row.totalMinutes)}>{formatCompactDurationMinutes(row.totalMinutes)}</b>
          </td>
        ) : (
          <SettlementTotalCell amount={conceptPeriodAmount(grid.accounting, row.concept.id, row.totalMinutes)} />
        )}
      </tr>
    );
  };

  return (
    <div className="hours-grid monthly-concept-grid readonly-hours-grid" tabIndex={0} aria-label="Grilla mensual por concepto; desplazamiento horizontal disponible">
      <table className="monthly-concept-table">
        <thead>
          <tr>
            <th>Concepto</th>
            {monthDays.map((day) => (
              <th key={day}>
                {getWeekdayAbbr(period, day)} {day}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <MonthlyHoursTableSections rows={grid.rows} accounting={grid.accounting} monthDays={monthDays} renderRow={renderRow} specialHoursByDay={grid.specialHoursByDay} noveltyCoverageRows={grid.noveltyCoverageRows} noveltiesByDay={grid.noveltiesByDay} onReviewNovelty={onReviewNovelty} />
      </table>
    </div>
  );
}
