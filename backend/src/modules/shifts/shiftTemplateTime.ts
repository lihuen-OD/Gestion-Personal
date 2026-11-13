// Duración de un turno a partir de su horario "HH:MM". Única fórmula del
// backend: la usan el alta/edición de ShiftTemplate (workforce.service.ts, que
// persiste ShiftTemplate.expectedMinutes) y la jornada esperada de Novedades
// (expectedWorkday.ts). Movida sin cambios desde workforce.service.ts: no
// descuenta descansos y `crossesMidnight` (endTime <= startTime al guardar)
// hace que un turno con la misma hora de inicio y fin dure 24 h.

export function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function computeExpectedMinutes(startTime: string, endTime: string, crossesMidnight: boolean) {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  return crossesMidnight ? 24 * 60 - start + end : end - start;
}

/**
 * Minutos desde la medianoche de un horario "HH:MM" válido (00:00..23:59), o
 * null. `minutesOfDay` es tolerante (lo que ya guardaron los turnos); acá se
 * valida porque la convocatoria a feriado acepta cualquier "dd:dd"
 * (holidayWorkAssignment.schemas.ts) y un horario inválido nunca debe
 * convertirse en minutos inventados.
 */
export function parseShiftTime(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
