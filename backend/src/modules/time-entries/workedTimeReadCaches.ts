import { clearDashboardMetricsCache } from "../dashboard/dashboard.cache";
import { clearEmployeeTimeGridCache } from "../employees/employees.controller";
import { clearMonthlyClosuresReadCaches } from "../workforce-management/workforce.cache";
import { clearTimeEntriesReadCaches } from "./timeEntries.cache";

/**
 * Cachés backend que exponen la contabilidad de horas (total trabajado,
 * equivalencia para liquidación, snapshots de cierre). Se limpian en el
 * momento, sin esperar TTL, cuando cambia algo que reinterpreta horas ya
 * cargadas: un concepto horario (tratamiento/eliminación), una regla de Hora
 * Especial o la convocatoria de un feriado (docs/decisions/
 * WORKED_TIME_ACCOUNTING_MODEL.md §12, §15 y §16).
 * - grilla por legajo y panel de cierre (`time-grid`);
 * - grilla de período, "Por persona", resumen y asistencia;
 * - dashboard;
 * - cierres mensuales (el payload incluye el snapshot).
 * El export y /pending no tienen caché backend.
 */
export function clearWorkedTimeDerivedReadCaches() {
  clearEmployeeTimeGridCache();
  clearTimeEntriesReadCaches();
  clearDashboardMetricsCache();
  clearMonthlyClosuresReadCaches();
}
