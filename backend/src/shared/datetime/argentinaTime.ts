/**
 * Punto único de cálculo de fecha/hora Argentina para todo el backend.
 *
 * Argentina no tiene horario de verano: el offset respecto de UTC es
 * constante (-180 minutos) todo el año. Por eso este módulo puede resolver
 * "qué día es esto en Argentina" con aritmética simple, sin depender de la
 * zona horaria del proceso Node (`setHours`/`getDate`/`Date` local) ni de
 * ninguna variable de entorno — el resultado es el mismo sin importar en qué
 * host/contenedor corra el proceso.
 *
 * Reemplaza las implementaciones equivalentes que existían por separado en
 * timeEntries.service.ts, timeEntries.repository.ts,
 * workShiftEvaluation.service.ts, attendanceInactivity.service.ts y
 * novelties.repository.ts.
 */

export const ARGENTINA_TIME_ZONE = "America/Argentina/Cordoba";

/** Argentina = UTC - 3, constante todo el año (sin horario de verano). */
export const ARGENTINA_OFFSET_MINUTES = -180;

function offsetMs(): number {
  return ARGENTINA_OFFSET_MINUTES * 60_000;
}

export interface ArgentinaDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** "YYYY-MM-DD" */
  key: string;
}

/**
 * Descompone un instante real en año/mes/día/hora/minuto calendario de Argentina.
 * Úsese SOLO con instantes reales (ej. una fichada, `WorkShift.startAt`).
 * No usar sobre valores que ya son una fecha-calendario normalizada (ver
 * `periodFromCalendarDate`/`dayOfMonthFromCalendarDate` para esos casos):
 * aplicar este corrimiento a un valor ya normalizado a medianoche UTC lo
 * corre un día para atrás.
 */
export function argentinaDateParts(instant: Date): ArgentinaDateParts {
  const shifted = new Date(instant.getTime() + offsetMs());
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    key: shifted.toISOString().slice(0, 10),
  };
}

/** "YYYY-MM-DD" del día calendario Argentina en el que cae `instant`. */
export function argentinaDateKey(instant: Date): string {
  return argentinaDateParts(instant).key;
}

export function todayArgentinaDateKey(reference: Date = new Date()): string {
  return argentinaDateKey(reference);
}

/** Convierte una clave "YYYY-MM-DD" a un `Date` a medianoche UTC, para columnas de fecha calendario. */
export function argentinaCalendarDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Próxima medianoche Argentina (como instante UTC real) posterior a `instant`. Para partir turnos por día. */
export function nextArgentinaMidnightUtc(instant: Date): Date {
  const parts = argentinaDateParts(instant);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offsetMs());
}

/** Rango [00:00, 24:00) Argentina del día `dateKey`, como instantes UTC reales — para filtrar por rango en Prisma. */
export function argentinaDayRange(dateKey: string): { startAt: Date; endAt: Date } {
  const startAt = new Date(`${dateKey}T00:00:00.000-03:00`);
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
  return { startAt, endAt };
}

export function isSameArgentinaDay(a: Date, b: Date): boolean {
  return argentinaDateKey(a) === argentinaDateKey(b);
}

/**
 * "YYYY-MM" del período Argentina de un INSTANTE real (ej. `WorkShift.startAt`).
 * Reemplaza al `periodFromDate` que existía duplicado en timeEntries.repository.ts
 * y novelties.repository.ts, que no corregía por huso horario.
 */
export function periodFromInstant(instant: Date): string {
  const { year, month } = argentinaDateParts(instant);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Día del mes (hora Argentina) de un INSTANTE real. Reemplaza al `dayFromDate` duplicado. */
export function dayOfMonthFromInstant(instant: Date): number {
  return argentinaDateParts(instant).day;
}

/**
 * "YYYY-MM" de una FECHA CALENDARIO ya normalizada (ej. `TimeEntry.date` cargado
 * a mano, o un `segment.date` ya resuelto por `nextArgentinaMidnightUtc`).
 * A propósito NO aplica corrimiento de huso horario: el valor ya representa
 * un día sin hora asociada, y corregirlo lo movería un día para atrás.
 */
export function periodFromCalendarDate(dateOnly: Date): string {
  const year = dateOnly.getUTCFullYear();
  const month = String(dateOnly.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Día del mes de una FECHA CALENDARIO ya normalizada. Ver nota de `periodFromCalendarDate`. */
export function dayOfMonthFromCalendarDate(dateOnly: Date): number {
  return dateOnly.getUTCDate();
}

/** Formatea un instante como hora local Argentina "HH:MM". */
export function formatArgentinaTime(instant: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ARGENTINA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

/**
 * Instante real (UTC) correspondiente a "el día calendario Argentina de
 * `reference`, a las `time` (HH:MM) hora Argentina", opcionalmente +1 día.
 *
 * Reemplaza a `scheduledDateFor`, que usaba `Date.setHours()`/`getDate()` —
 * es decir, dependía de la zona horaria del PROCESO Node, no de Argentina
 * explícitamente. Esta versión da el mismo resultado sin importar en qué
 * huso horario corra el proceso.
 */
export function scheduledInstantForShiftTime(reference: Date, time: string, addDay = false): Date {
  const [rawHours, rawMinutes] = time.split(":").map(Number);
  const hours = rawHours || 0;
  const minutes = rawMinutes || 0;
  const parts = argentinaDateParts(reference);
  const day = parts.day + (addDay ? 1 : 0);
  return new Date(Date.UTC(parts.year, parts.month - 1, day, hours, minutes, 0, 0) - offsetMs());
}
