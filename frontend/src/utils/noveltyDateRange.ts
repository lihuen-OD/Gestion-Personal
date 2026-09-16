// Etapa 15L.5 (docs/decisions/NOVELTY_QUANTITY_SEMANTICS_15L5.md): el
// backend (`calendarDaysInclusive`, backend/src/shared/datetime/argentinaTime.ts)
// es la única autoridad real de `quantityDays` — recalcula/ignora lo que
// mande el cliente al crear la novedad (ver novelties.service.ts::resolveQuantities).
// Este helper existe SÓLO para mostrarle a RRHH una previsualización antes
// de guardar ("Cantidad de días: 4") — nunca se envía como el valor
// definitivo. Mismo algoritmo que el backend (días calendario inclusivos,
// normalizado a medianoche UTC en ambos extremos) para que la previsualización
// coincida con lo que el backend va a calcular — pero sin duplicar la
// fuente de verdad: si el cálculo cambiara en el backend, esta función
// podría desalinearse, y eso es aceptable porque es sólo una ayuda visual,
// no un dato que se persista.
//
// Antes de esta etapa, `NoveltyModal.tsx` y `EmployeeHoursPage.tsx` tenían
// cada uno su propia copia de este cálculo, y ambas contaban sólo los días
// del MES de `fromDate` (`current.getMonth() === start.getMonth()`) — un
// rango `30/07 → 02/08` daba "2" en vez de "4". Ese bug ya no importa para
// el dato persistido (el backend nunca lo usa), pero tampoco se repite acá:
// esta función cuenta el rango real completo, sin recortar ningún mes.
export function calendarDaysInclusive(fromDate: string, toDate: string | null): number | null {
  if (!fromDate) return null;
  if (!toDate) return 1;

  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((to.getTime() - from.getTime()) / msPerDay);
  // Rango invertido (toDate < fromDate): estado transitorio mientras el
  // usuario todavía está completando el formulario — no hay nada válido
  // que previsualizar todavía, no se inventa un número.
  if (diffDays < 0) return null;
  return diffDays + 1;
}
