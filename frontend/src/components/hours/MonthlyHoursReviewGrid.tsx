import type { EmployeeTimeGrid } from "../../services/api/employeeApiService";
import type { Novelty } from "../../types";
import { formatMultiplier } from "../attendance/segmentDisplay";
import { hourConceptLoadModeLabel } from "../../utils/employeeHoursGrid";
import { formatDurationMinutes } from "../../utils/hours";
import { getMonthDays, getWeekdayAbbr } from "../../utils/period";
import { EmptyState } from "../ui/EmptyState";

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
// No llama APIs, no edita horas, no abre modales, no conoce roles.
export function MonthlyHoursReviewGrid({ grid, period }: { grid: EmployeeTimeGrid; period: string }) {
  if (!grid.rows.length) {
    return <EmptyState text="No hay horas registradas para este período." size="compact" />;
  }

  const monthDays = getMonthDays(period);

  return (
    <div className="hours-grid readonly-hours-grid">
      <table>
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
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.concept.id}>
              <td>
                <b>{row.concept.name}</b>
                <span className="table-sub">
                  {row.role === "NORMAL_BASE" ? "Total trabajado · Base del sistema" : `Desglose · ${hourConceptLoadModeLabel(row.concept.loadMode)}`}
                </span>
              </td>
              {monthDays.map((day) => {
                const minutes = row.minutesByDay[String(day)] ?? 0;
                const daySpecialHour = grid.specialHoursByDay[String(day)];
                // El multiplicador de Hora Especial alcanza a cualquier fila ese
                // día (11A.1); la novedad sólo se asocia visualmente a Hora
                // normal, mismo criterio que EmployeeHoursPage.
                const dayNovelties = row.role === "NORMAL_BASE" ? noveltiesForDay(grid.novelties, day) : [];
                const cellClass = ["hour-cell", minutes ? "filled" : ""].filter(Boolean).join(" ");
                const title = dayNovelties.length ? dayNovelties.map((novelty) => `${novelty.type} · ${novelty.quantity}`).join(", ") : undefined;
                return (
                  <td key={`${row.concept.id}-${day}`}>
                    <span className={cellClass} title={title}>
                      <span>{minutes ? formatDurationMinutes(minutes) : "—"}</span>
                      {dayNovelties.length ? <span className="alert-dot purple" /> : null}
                      {daySpecialHour ? (
                        <span className="alert-dot orange" title={`Hora especial aplicada (${formatMultiplier(daySpecialHour.multiplier)})`} />
                      ) : null}
                    </span>
                  </td>
                );
              })}
              <td>
                <b>{formatDurationMinutes(row.totalMinutes)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
