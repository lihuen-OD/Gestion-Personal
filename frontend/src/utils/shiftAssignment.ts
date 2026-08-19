import { formatVigencyDate, vigencyLabel, vigencyTone } from "../components/shared/AssociatedEmployeesPanel.helpers";
import type { AssociatedEmployeeVigencyStatus } from "../types/associatedEmployee.types";

// weekdays sigue la misma convención ya usada en el proyecto para arrays de
// días (DoubleHourRule.weekdays, backend workforce.schemas.ts, y
// TimeSegment.date.getDay()): 0 = domingo, 1 = lunes, ..., 6 = sábado — NO
// 1=lunes..7=domingo. weekdays vacío significa "todos los días" (mismo
// criterio documentado en schema.prisma para ShiftAssignment.weekdays).
export const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
// Orden de exhibición (lunes primero) pedido para la UI, aunque el valor
// almacenado use domingo=0 como en el resto del proyecto.
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day] ?? "?";
}

export function isValidWeekday(day: number): boolean {
  return Number.isInteger(day) && day >= 0 && day <= 6;
}

export function toggleWeekday(weekdays: number[], day: number): number[] {
  return weekdays.includes(day) ? weekdays.filter((value) => value !== day) : [...weekdays, day].sort((a, b) => a - b);
}

export function formatWeekdays(weekdays: number[]): string {
  if (!weekdays.length) return "Todos los días";
  return WEEKDAY_DISPLAY_ORDER.filter((day) => weekdays.includes(day)).map(weekdayLabel).join(", ");
}

// Reutiliza las mismas etiquetas/tonos de vigencia que AssociatedEmployeesPanel
// (Etapa 8G) — el estado vigente/histórico/futuro es el mismo concepto en
// ambos casos, solo cambia de qué fechas se calcula.
export const assignmentVigencyLabel = vigencyLabel;
export const assignmentVigencyTone = vigencyTone;
export const formatAssignmentDate = formatVigencyDate;

export function assignmentVigencyStatus(
  effectiveFrom: string,
  effectiveTo: string | null,
  referenceDate: Date = new Date(),
): AssociatedEmployeeVigencyStatus {
  const from = effectiveFrom.slice(0, 10);
  const to = effectiveTo ? effectiveTo.slice(0, 10) : null;
  const ref = referenceDate.toISOString().slice(0, 10);
  if (from > ref) return "future";
  if (to && to < ref) return "historical";
  return "current";
}

export function isAssignmentCurrent(effectiveFrom: string, effectiveTo: string | null, referenceDate?: Date): boolean {
  return assignmentVigencyStatus(effectiveFrom, effectiveTo, referenceDate) === "current";
}

export type ShiftAssignmentVigencyDraft = { effectiveFrom: string; effectiveTo: string; weekdays: number[] };

// Payload builder compartido entre el formulario de asignación desde legajo
// (EmployeeShiftsPanel) y desde turno (ShiftEmployeesPanel) — un solo lugar
// que traduce el estado del formulario (effectiveTo como string vacío
// cuando no se elige) a lo que espera la API (effectiveTo: null).
export function buildShiftAssignmentVigencyPayload(draft: ShiftAssignmentVigencyDraft) {
  return {
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null,
    weekdays: draft.weekdays,
  };
}
