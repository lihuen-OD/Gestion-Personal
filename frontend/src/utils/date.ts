import { argentinaDateKey, ARGENTINA_TIME_ZONE } from "./argentinaDateKey";

// Recibe una fecha calendario ("YYYY-MM-DD...") y la formatea como DD/MM/YYYY
// sin re-parsearla como instante, para evitar corrimientos de huso horario.
export function formatCalendarDate(value: string) {
  return value.slice(0, 10).split("-").reverse().join("/");
}

// `hour12: false` es necesario: el locale "es-AR" por default usa formato
// 12 horas con sufijo "a. m."/"p. m." en el motor ICU de Node — el estándar
// argentino y el formato pedido por esta etapa es 24 horas ("14:35").
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

// Etapa 15M.21: punto único para formatear un INSTANTE real (`@db.Timestamptz`
// — createdAt, updatedAt, startAt, actualAt, uploadedAt, etc.) como fecha
// calendario Argentina "DD/MM/AAAA". A diferencia de `formatCalendarDate`
// (que asume que el string YA es un día calendario, sin hora), esto primero
// resuelve a qué día calendario Argentina corresponde el instante — evitar
// esto es lo que corre la fecha un día en instantes cercanos a medianoche.
export function formatInstantDate(value: string | Date): string {
  const date = toValidDate(value);
  return date ? formatCalendarDate(argentinaDateKey(date)) : "-";
}

// Hora Argentina "HH:mm" de un INSTANTE real.
export function formatInstantTime(value: string | Date): string {
  const date = toValidDate(value);
  return date ? instantTimeFormatter.format(date) : "-";
}

// Formato canónico para un INSTANTE real con fecha y hora: "DD/MM/AAAA · HH:mm".
export function formatDateTime(value: string | Date): string {
  const date = toValidDate(value);
  if (!date) return "-";
  return `${formatInstantDate(date)} · ${formatInstantTime(date)}`;
}
