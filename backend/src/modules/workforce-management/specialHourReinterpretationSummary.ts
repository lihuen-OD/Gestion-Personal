import type { SpecialHourReinterpretation } from "./specialHourReinterpretation";

// Resumen en lenguaje de negocio (y metadata técnica) para la auditoría del
// cambio que disparó la reinterpretación: regla de Hora Especial, convocatoria
// de feriado o reconciliación. Puro, sin dependencias de runtime.
export function describeReinterpretation(result: SpecialHourReinterpretation) {
  const loads = result.timeEntries + result.breakdowns;
  if (!loads) return "No había horas cargadas alcanzadas por el cambio.";
  const closures = result.rebuiltClosures.length;
  return `Se recalcularon ${loads} carga(s) de ${result.employees} legajo(s)${closures ? ` y ${closures} cierre(s) mensual(es)` : ""}.`;
}

export function reinterpretationMetadata(result: SpecialHourReinterpretation) {
  const { rebuiltClosures, changes: _changes, ...summary } = result;
  return { ...summary, recalculatedClosureIds: rebuiltClosures.map((closure) => closure.id) };
}
