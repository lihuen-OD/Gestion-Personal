export const ARGENTINA_TIME_ZONE = "America/Argentina/Cordoba";

/**
 * Convierte un instante (ISO string o Date) a su fecha calendario Argentina
 * "YYYY-MM-DD". Mismo criterio que `todayKey()` en AttendancePage.tsx
 * (locale "sv-SE" da formato ISO de fecha de forma nativa) — se extrae acá
 * para reusarlo donde haga falta la fecha calendario de un instante que no
 * es "ahora" (p. ej. la fecha real de una alerta de fichador), evitando
 * slicing naive de un ISO string que puede correrse un día en instantes
 * cercanos a medianoche.
 */
export function argentinaDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("sv-SE", { timeZone: ARGENTINA_TIME_ZONE });
}

/**
 * Lee la fecha calendario UTC de un valor `@db.Date` (fecha-only, ya
 * normalizada a medianoche UTC por el backend — mismo criterio que
 * `dayOfMonthFromCalendarDate`/`periodFromCalendarDate` en el
 * `argentinaTime.ts` del backend: esos valores NO vuelven a pasar por
 * conversión de timezone, porque ya representan el día calendario correcto
 * — convertirlos a hora Argentina los correría un día para atrás). Usar
 * esta función para un campo calendario (p. ej. `operationalDate`); usar
 * `argentinaDateKey` para un INSTANTE real (`@db.Timestamptz`, p. ej. una
 * fichada).
 */
export function calendarDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("sv-SE", { timeZone: "UTC" });
}
