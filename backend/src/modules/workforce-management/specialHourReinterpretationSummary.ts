import type { SpecialHourReinterpretation } from "./specialHourReinterpretation";

// Resumen en lenguaje de negocio (y metadata técnica) para la auditoría del
// cambio que disparó la reinterpretación: regla de Hora Especial, convocatoria
// de feriado o reconciliación. Puro, sin dependencias de runtime.
export function describeReinterpretation(result: SpecialHourReinterpretation) {
  const loads = result.timeEntries + result.breakdowns;
  const closures = result.rebuiltClosures.length;
  const changed = loads
    ? `Se recalcularon ${loads} carga(s) de ${result.employees} legajo(s)${closures ? ` y ${closures} cierre(s) mensual(es)` : ""}.`
    : "No había horas cargadas alcanzadas por el cambio.";
  // D-5: los períodos enviados/aprobados no se tocan; se informa qué quedó sin aplicar.
  const pending = result.protectedPeriods.filter((item) => item.timeEntries + item.breakdowns + item.segments > 0);
  if (!pending.length) return changed;
  const pendingLoads = pending.reduce((sum, item) => sum + item.timeEntries + item.breakdowns, 0);
  return `${loads ? changed : "No se recalcularon cargas en períodos abiertos."} ${pending.length} período(s) enviado(s) o aprobado(s) quedaron protegidos sin cambios (${pendingLoads} carga(s) diferirían); corregirlos requiere el procedimiento explícito de RRHH.`;
}

export function reinterpretationMetadata(result: SpecialHourReinterpretation) {
  const { rebuiltClosures, changes: _changes, ...summary } = result;
  return { ...summary, recalculatedClosureIds: rebuiltClosures.map((closure) => closure.id) };
}
