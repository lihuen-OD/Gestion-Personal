import type { AttendanceInactivityIncident, AttendanceShift } from "../services/api/attendanceApiService";
import type { SystemNotification } from "../services/api/workforceApiService";
import { argentinaDateKey, calendarDateKey } from "./argentinaDateKey";

/**
 * Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): datos con los
 * que se precarga NoveltyModal al crear una novedad a partir de una
 * notificación/observación del fichador. No existe (ni se crea acá) ningún
 * vínculo en base de datos entre el origen y la Novelty resultante — la
 * única trazabilidad es textual, dentro de `observation`, y (ajuste UX
 * previo al commit) es puramente humana: nunca incluye el id/UUID técnico
 * de la notificación/incidente/jornada de origen ni nombres técnicos de
 * `entityType`. Si en el futuro se necesita trazabilidad técnica
 * estructurada, debe resolverse con una relación real en base de datos,
 * no con un id pegado en un texto visible para el usuario.
 *
 * `employee` trae sólo lo que la propia notificación/incidente/jornada ya
 * incluye en su sub-objeto `employee` (id/legajo/nombre/apellido) — nada
 * de esto viene de un fetch adicional. Es intencionalmente el subconjunto
 * mínimo, no un `Employee` completo.
 */
export type NoveltyPrefillEmployee = {
  id: string;
  legajo: string;
  firstName: string;
  lastName: string;
};

export type NoveltyPrefillContext = {
  employee: NoveltyPrefillEmployee;
  fromDate: string;
  quantityHours?: number;
  observation: string;
  suggestedNoveltyTypeCode?: string;
};

export function buildNoveltyPrefillFromInactivityIncident(incident: AttendanceInactivityIncident): NoveltyPrefillContext {
  // operationalDate es @db.Date (fecha calendario, no un instante real) —
  // se lee tal cual, sin conversión a hora Argentina (ver calendarDateKey).
  return {
    employee: { id: incident.employee.id, legajo: incident.employee.legajo, firstName: incident.employee.firstName, lastName: incident.employee.lastName },
    fromDate: calendarDateKey(incident.operationalDate),
    observation: `Origen: alerta del fichador (no asistió). Detalle detectado: ${incident.observation} Las horas reales se mantienen según fichador/carga horaria.`,
  };
}

export function buildNoveltyPrefillFromAttendanceShiftProblem(shift: AttendanceShift, problemLabel: string): NoveltyPrefillContext {
  const detail = shift.observation ? ` ${shift.observation}` : "";
  return {
    employee: { id: shift.employee.id, legajo: shift.employee.legajo, firstName: shift.employee.firstName, lastName: shift.employee.lastName },
    fromDate: argentinaDateKey(shift.startAt),
    observation: `Origen: alerta del fichador (${problemLabel}).${detail} Las horas reales se mantienen según fichador/carga horaria.`,
  };
}

/**
 * Ajuste de alcance (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md, sección
 * "Notificaciones como flujo principal"): Notificaciones (`SystemNotification`)
 * es el punto de entrada PRINCIPAL para crear una novedad desde una
 * anomalía del fichador — agrupa llegada tarde/salida temprana
 * (`ALERTA_FICHADA`), falta de fichada/olvido de salida (`FALTA_SALIDA`) y
 * "no asistió" (`SIN_ACTIVIDAD_REGISTRADA`). El backend resuelve
 * `employee` (id/legajo/nombre/apellido, sin fetch adicional en el
 * frontend) para los 4 `entityType` que hoy lo soportan: `ShiftAlert`,
 * `WorkShift`, `Employee` y `AttendanceInactivityIncident`
 * (`workforce.service.ts::notifications`).
 *
 * Este builder, a diferencia de los de arriba (que sí conocen el objeto
 * completo de origen):
 * - NO sugiere `quantityHours` (el minuto de diferencia de la alerta no
 *   viaja en la notificación, sólo texto).
 * - NO sugiere `suggestedNoveltyTypeCode` (el `type` de la notificación es
 *   genérico — p. ej. "ALERTA_FICHADA" cubre llegada tarde, salida
 *   anticipada, etc. por igual; "SIN_ACTIVIDAD_REGISTRADA" tampoco tiene un
 *   NoveltyType de "Ausencia" garantizado en todos los entornos — no se
 *   crea un tipo nuevo para esto, el usuario elige en el modal).
 * - `fromDate` usa `createdAt` de la notificación como aproximación (se
 *   genera en el mismo momento que el evento que la origina, pero no es el
 *   instante exacto del evento como si tenía la alerta/incidente original).
 *
 * Sólo se debe llamar cuando `notification.employee` existe — si no, no
 * hay datos suficientes para precargar nada.
 */
export function buildNoveltyPrefillFromNotification(notification: SystemNotification & { employee: NoveltyPrefillEmployee }): NoveltyPrefillContext {
  return {
    employee: { id: notification.employee.id, legajo: notification.employee.legajo, firstName: notification.employee.firstName, lastName: notification.employee.lastName },
    fromDate: argentinaDateKey(notification.createdAt),
    observation: `Origen: alerta del fichador. Detalle detectado: ${notification.message} Las horas reales se mantienen según fichador/carga horaria.`,
  };
}
