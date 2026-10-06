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
