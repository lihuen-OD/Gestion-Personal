// Etapa 15M.5 (docs/decisions/HUMAN_DURATION_FORMAT_15M5.md): el minuto es la
// unidad canónica para mostrar cualquier duración en Gestión Horaria /
// Asistencia. Antes de esta etapa, `formatHours()` era el único formatter de
// duración en Carga Horaria y sólo hacía `decimalHours.toFixed(2)` — para una
// jornada real de 141 minutos mostraba "2.35", que se lee naturalmente como
// "2 horas con 35" pero matemáticamente son 2h 21min (0.35 * 60 = 21, no 35).
// Se eliminó por completo (cero importadores reales confirmados por grep):
// formatDurationMinutes es la única función que debe usarse para mostrar una
// duración operativa a partir de acá.

/**
 * Convierte horas decimales (la forma en que persiste `TimeEntry.hours`,
 * `Decimal(8,2)`) a minutos enteros. Sólo debe usarse cuando NO hay ya un
 * campo de minutos disponible (`totalMinutes`/`actualMinutes`/cualquier
 * `*Minutes`) — preferí siempre ese campo real antes que esta conversión
 * (ver docs/decisions/HUMAN_DURATION_FORMAT_15M5.md).
 */
export function hoursDecimalToMinutes(hours: number | string | null | undefined): number {
  const parsed = Number(hours ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 60);
}

/**
 * Formato humano canónico de una duración en minutos, para toda la UI
 * operacional de Gestión Horaria/Asistencia:
 *   0    -> "0 h"
 *   21   -> "21 min"
 *   60   -> "1 h"
 *   61   -> "1 h 1 min"
 *   141  -> "2 h 21 min"
 *   250  -> "4 h 10 min"
 *   601  -> "10 h 1 min"
 * Nunca reemplazar por `decimalHours.toFixed(2)` — "2.35" se lee como
 * "2 horas con 35" pero matemáticamente son 2h 21min.
 */
export function formatDurationMinutes(totalMinutes: number | null | undefined): string {
  const parsed = Number(totalMinutes ?? 0);
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 0;
  if (rounded <= 0) return "0 h";
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/**
 * Composición conveniente para los DTO que sólo exponen horas decimales, sin
 * ningún campo de minutos en paralelo (ej. `findPeriodEmployees` — la grilla
 * de período de `HoursPage.tsx`). No repetir manualmente
 * `formatDurationMinutes(hoursDecimalToMinutes(x))` en cada componente.
 */
export function formatDecimalHoursDuration(hours: number | string | null | undefined): string {
  return formatDurationMinutes(hoursDecimalToMinutes(hours));
}
