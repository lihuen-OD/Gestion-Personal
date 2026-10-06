// Copia de frontend/src/utils/argentinaDateKey.ts (sólo lo que usa el fichador).
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
