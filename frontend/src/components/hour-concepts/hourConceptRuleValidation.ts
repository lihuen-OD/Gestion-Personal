// Mismo formato que exige el backend (hourConceptRules.schemas.ts):
// HH:MM, 00:00 a 23:59, dos dígitos obligatorios — 24:00 no es válido.
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeOfDay(value: string) {
  return TIME_OF_DAY_PATTERN.test(value);
}

export type HourConceptRuleDraftInput = {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  priority: string;
};

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

// Validación de campo requerido/formato en el cliente — el backend sigue
// siendo la única fuente de verdad para el solapamiento ambiguo (409), que
// nunca se intenta resolver acá.
export function validateHourConceptRuleDraft(draft: HourConceptRuleDraftInput): string | null {
  if (!draft.startTime.trim()) return "La hora desde es obligatoria.";
  if (!draft.endTime.trim()) return "La hora hasta es obligatoria.";
  if (!isValidTimeOfDay(draft.startTime)) return "La hora desde debe tener formato HH:MM (00:00 a 23:59).";
  if (!isValidTimeOfDay(draft.endTime)) return "La hora hasta debe tener formato HH:MM (00:00 a 23:59).";
  if (draft.startTime === draft.endTime) return "La hora desde y la hora hasta no pueden ser iguales.";
  // Consistencia entre el rango y el checkbox "cruza medianoche": el backend
  // (hourConceptRules.service.ts::ruleTimeIntervals) confía en este valor tal
  // cual para el cálculo de solapamiento — si no coincide con el rango real,
  // el cálculo queda mal armado en silencio, no como un 409 legible.
  if (!draft.crossesMidnight && timeToMinutes(draft.startTime) > timeToMinutes(draft.endTime)) {
    return "La hora hasta es anterior a la hora desde — si el turno cruza medianoche, tildá esa opción.";
  }
  if (draft.crossesMidnight && timeToMinutes(draft.startTime) < timeToMinutes(draft.endTime)) {
    return "Este rango no cruza medianoche (la hora hasta ya es posterior a la hora desde) — destildá esa opción.";
  }
  if (draft.priority.trim() === "") return "La prioridad es obligatoria.";
  if (!/^\d+$/.test(draft.priority.trim())) return "La prioridad debe ser un número entero.";
  return null;
}
