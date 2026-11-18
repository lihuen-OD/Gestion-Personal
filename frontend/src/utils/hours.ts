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

/** Variante visual compacta para grillas densas; la unidad canónica sigue
 * siendo el minuto y no se introduce ninguna conversión a horas decimales. */
export function formatCompactDurationMinutes(totalMinutes: number | null | undefined): string {
  const parsed = Number(totalMinutes ?? 0);
  const rounded = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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

/**
 * Duración de una jornada escrita como HH:mm (00:01 a 24:00) -> minutos.
 * Devuelve null si el texto no es una duración válida de un día. Es la
 * entrada canónica de cantidades horarias de Novedades (resolución manual
 * de cobertura, cantidad fija de un Tipo de Novedad): nunca pedir minutos
 * crudos ni horas decimales.
 */
export function parseDayDurationInput(value: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total >= 1 && total <= 1440 ? total : null;
}

/** Inversa de `parseDayDurationInput`: 240 -> "04:00", 1440 -> "24:00". */
export function formatDayDurationInput(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || !Number.isFinite(totalMinutes) || totalMinutes < 0) return "";
  const rounded = Math.round(totalMinutes);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
