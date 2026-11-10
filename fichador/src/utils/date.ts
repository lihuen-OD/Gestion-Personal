import { argentinaDateKey, ARGENTINA_TIME_ZONE } from "./argentinaDateKey";

// Copia de las funciones de frontend/src/utils/date.ts que usa el fichador
// (formatDateTime y sus dependencias). Mismo formato: "DD/MM/AAAA · HH:mm"
// en hora Argentina para un instante real.
function formatCalendarDate(value: string) {
  return value.slice(0, 10).split("-").reverse().join("/");
}

// `hour12: false`: el locale "es-AR" usa 12 horas por default en ICU.
const instantTimeFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: ARGENTINA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function toValidDate(value: string | Date): Date | null {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | Date): string {
  const date = toValidDate(value);
  if (!date) return "-";
  return `${formatCalendarDate(argentinaDateKey(date))} · ${instantTimeFormatter.format(date)}`;
}

/** F8: "HH:mm" en hora Argentina de un instante devuelto por el backend. */
export function formatTime(value: string | Date): string {
  const date = toValidDate(value);
  return date ? instantTimeFormatter.format(date) : "-";
}

// Etapa 2 del rediseño (P1): el reloj del kiosco muestra la hora Argentina,
// la misma zona que la confirmación de la fichada, aunque el equipo esté
// configurado en otra. Formato de 24 h ("hourCycle: h23", sin el "24:00" que
// algunas versiones de ICU dan con "hour12: false").
const clockFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: ARGENTINA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const longDateFormatter = new Intl.DateTimeFormat("es-AR", {
  timeZone: ARGENTINA_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Reloj del kiosco en hora Argentina: { time: "HH:mm", seconds: "ss" }. */
export function formatClock(value: Date): { time: string; seconds: string } {
  const parts = Object.fromEntries(clockFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  const pad = (part: string | undefined) => (part ?? "00").padStart(2, "0");
  return { time: `${pad(parts.hour)}:${pad(parts.minute)}`, seconds: pad(parts.second) };
}

/** Fecha larga en hora Argentina: "Jueves 6 de noviembre". */
export function formatLongDate(value: string | Date): string {
  const date = toValidDate(value);
  if (!date) return "-";
  const text = longDateFormatter.format(date).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "DD/MM" en hora Argentina de un instante. */
export function formatDayMonth(value: string | Date): string {
  const date = toValidDate(value);
  return date ? formatCalendarDate(argentinaDateKey(date)).slice(0, 5) : "-";
}

/** true si el instante cae en el mismo día calendario Argentina que `reference`. */
export function isSameArgentinaDay(value: string | Date, reference: Date): boolean {
  const date = toValidDate(value);
  return Boolean(date) && argentinaDateKey(date as Date) === argentinaDateKey(reference);
}
