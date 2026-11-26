import { clearDashboardMetricsCache } from "../dashboard/dashboard.cache";
import { clearDocumentsReadCaches } from "../documents/documents.cache";
import { clearNoveltiesReadCaches } from "../novelties/novelties.cache";
import { clearShiftAlertReadCaches } from "../shifts/shiftAlert.cache";
import { clearShiftAssignmentSummaryCache } from "../shifts/shiftAssignment.cache";
import { clearTimeEntriesReadCaches } from "../time-entries/timeEntries.cache";
import { clearMonthlyClosuresReadCaches } from "../workforce-management/workforce.cache";
import { clearEmployeeReadCaches } from "./employees.controller";

/**
 * Única invalidación para un cambio de ALCANCE de legajos: lo que altera el
 * resultado de `employeeAccessWhere` para algún usuario.
 *
 * Quién la llama (después del commit, nunca dentro de la transacción):
 * - Legajos → responsables/asignaciones (`replaceAssignments`): agrega o quita
 *   un TIME_RESPONSIBLE, que cambia el alcance del Nivel 2 responsable y el
 *   de todo Nivel 3 que él supervise.
 * - Usuarios → alta/edición: rol, estado y supervisión Nivel 2 → Nivel 3.
 *
 * Limpia, completas, las cachés de lectura con clave por usuario cuya
 * respuesta sale de `employeeAccessWhere` (las claves no permiten ubicar a
 * "todos los Nivel 3 que supervisa X", y estos cambios son operaciones de
 * administración poco frecuentes):
 * - Legajos: detalle, grilla horaria, listado, resumen, organigrama, opciones;
 * - Horas/asistencia: listado, resumen, período por persona, asistencia,
 *   inicio y observaciones;
 * - Novedades, Documentos, Alertas de turnos, resumen de Turnos;
 * - Cierres mensuales y correcciones;
 * - Dashboard.
 * Pendientes, Francos y Feriados no tienen caché backend. Las cachés globales
 * (catálogos, plantillas, reglas, auditoría, usuarios) y las de notificaciones
 * (por destinatario, no por alcance) no se tocan.
 */
export function invalidateEmployeeScopeCaches() {
  clearEmployeeReadCaches();
  clearTimeEntriesReadCaches();
  clearNoveltiesReadCaches();
  clearDocumentsReadCaches();
  clearShiftAlertReadCaches();
  clearShiftAssignmentSummaryCache();
  clearMonthlyClosuresReadCaches();
  clearDashboardMetricsCache();
}
