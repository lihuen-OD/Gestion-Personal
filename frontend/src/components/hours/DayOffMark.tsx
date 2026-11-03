import type { DayOffActivity } from "../../services/api/employeeDayOffApiService";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";

// Franco en una celda de grilla (docs/decisions/EMPLOYEE_DAY_OFF.md §15):
// "Franco" + lo que computa ese día según la contabilidad del backend. Nunca
// "—", que sigue significando "sin horas registradas".
export function DayOffMark({ countedMinutes }: { countedMinutes: number }) {
  return (
    <span className="day-off-mark">
      <span className="day-off-mark-label">Franco</span>
      <span className="day-off-mark-hours">{countedMinutes > 0 ? formatCompactDurationMinutes(countedMinutes) : "0 h"}</span>
    </span>
  );
}

/** Texto de detalle (tooltip/aria) de un día con franco. */
export function dayOffDescription(dayOff: DayOffActivity, countedMinutes: number) {
  const parts = ["Franco asignado: no debía trabajar"];
  if (dayOff.activityShifts > 0) {
    parts.push(dayOff.activityMinutes > 0 ? `Actividad registrada por el fichador: ${formatDurationMinutes(dayOff.activityMinutes)}` : "Actividad registrada por el fichador (jornada abierta)");
  }
  parts.push(countedMinutes > 0 ? `Horas reconocidas: ${formatDurationMinutes(countedMinutes)}` : "Computa 0 h");
  if (dayOff.notes) parts.push(dayOff.notes);
  return parts.join(" · ");
}
