import type { DayOffActivity } from "../../services/api/employeeDayOffApiService";
import { formatCompactDurationMinutes, formatDurationMinutes } from "../../utils/hours";

// Franco en una celda de grilla (docs/decisions/EMPLOYEE_DAY_OFF.md §15):
// "Franco" + lo que computa ese día según la contabilidad del backend. Nunca
// "—", que sigue significando "sin horas registradas".
// `noveltyTone`: clase de color de una novedad del mismo día. El franco sigue
// siendo el estado principal; la novedad queda como marca secundaria en la
// línea de horas, sin sumar alto a la celda.
export function DayOffMark({ countedMinutes, noveltyTone }: { countedMinutes: number; noveltyTone?: string }) {
  const hours = <span className="day-off-mark-hours">{countedMinutes > 0 ? formatCompactDurationMinutes(countedMinutes) : "0 h"}</span>;
  return (
    <span className="day-off-mark">
      <span className="day-off-mark-label">Franco</span>
      {noveltyTone ? (
        <span className="day-off-mark-row">
          {hours}
          {/* El detalle ("Novedad: …") ya está en el aria-label/title de la celda. */}
          <span className={`day-off-novelty-tag cell-novelty-pill ${noveltyTone}`} aria-hidden="true">Nov.</span>
        </span>
      ) : hours}
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
