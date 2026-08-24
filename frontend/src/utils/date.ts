// Recibe una fecha calendario ("YYYY-MM-DD...") y la formatea como DD/MM/YYYY
// sin re-parsearla como instante, para evitar corrimientos de huso horario.
export function formatCalendarDate(value: string) {
  return value.slice(0, 10).split("-").reverse().join("/");
}
