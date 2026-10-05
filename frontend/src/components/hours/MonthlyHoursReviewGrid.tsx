import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { Novelty } from "../../types";
import { timeGridRowLabel, timeGridRowSubtitle } from "../../utils/employeeHoursGrid";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";
import { getMonthDays, getWeekdayAbbr } from "../../utils/period";
import { EmptyState } from "../ui/EmptyState";
import { MonthlyHoursTableSections } from "./MonthlyHoursTableSections";
import { conceptDayAmount, conceptPeriodAmount } from "../../utils/workedTimeAccounting";
import { amountDescription, amountMinutes, baseSpecialHourTitle, SettlementTotalCell, SpecialHourDot } from "./SettlementAmount";

// Mismo criterio de asociación día↔novedad que EmployeeHoursPage.tsx
// (dayNovelties, no exportado ahí) — se repite acá en vez de tocar esa
// pantalla (Etapa 15K, fuera de alcance) o de mover la lógica a un util
// compartido para un solo consumidor nuevo.
function noveltiesForDay(novelties: Novelty[], day: number): Novelty[] {
  return novelties.filter((novelty) => {
    const fromDay = Number(novelty.from.slice(8, 10));
    const toDay = Number((novelty.to || novelty.from).slice(8, 10));
    return day >= fromDay && day <= toDay;
  });
}

// Etapa 15K: presentacional puro — recibe la grilla ya cargada (misma fuente
// que EmployeeHoursPage, GET /employees/:id/time-grid) y sólo la muestra.
// No llama APIs, no edita horas, no abre modales, no conoce roles. Las
// secciones (Horas base / Distribución de la jornada / Horas adicionales /
// totales) son las mismas que el detalle por legajo
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
export function MonthlyHoursReviewGrid({ grid, period }: { grid: EmployeeTimeGrid; period: string }) {
  if (!grid.rows.length) {
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
          // Horas base: tiempo registrado. Cada concepto: lo que se liquida
          // ese día (real × Hora Especial, calculado por el backend), con el
          // real en el indicador. La novedad sólo se asocia a las Horas base,
          // mismo criterio que EmployeeHoursPage.
          const amount = isBase ? null : conceptDayAmount(grid.accounting, day, row.concept.id, realMinutes);
          const minutes = amount ? amountMinutes(amount) : realMinutes;
          const dayNovelties = isBase ? noveltiesForDay(grid.novelties, day) : [];
          const cellClass = ["hour-cell", minutes ? "filled" : "", amount?.pending ? "is-syncing" : ""].filter(Boolean).join(" ");
          const description = amount ? amountDescription(amount, daySpecialHour?.ruleNames) : formatDurationMinutes(minutes);
          const titleParts = minutes ? [description] : [];
          if (dayNovelties.length) titleParts.push(dayNovelties.map((novelty) => `${novelty.type} · ${novelty.quantity}`).join(", "));
          return (
            <td key={`${row.concept.id}-${day}`}>
              <span className={cellClass} title={titleParts.join(" · ") || undefined} aria-label={`${label}, día ${day}: ${minutes ? description : "sin horas"}`}>
                <span>{minutes ? formatCompactDurationMinutes(minutes) : "—"}</span>
                {dayNovelties.length ? <span className="alert-dot purple" /> : null}
                {isBase && daySpecialHour ? <span className="alert-dot orange" title={baseSpecialHourTitle(daySpecialHour.multiplier, daySpecialHour.ruleNames)} /> : null}
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
        <MonthlyHoursTableSections rows={grid.rows} accounting={grid.accounting} monthDays={monthDays} renderRow={renderRow} specialHoursByDay={grid.specialHoursByDay} />
      </table>
    </div>
  );
}
