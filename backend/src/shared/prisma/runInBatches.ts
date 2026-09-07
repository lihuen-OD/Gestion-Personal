/**
 * Etapa 14E.1: ejecuta un array de tareas async con concurrencia acotada —
 * nunca más de `batchSize` promesas en vuelo al mismo tiempo. Preserva el
 * orden de los resultados (mismo orden que `tasks`), independientemente del
 * orden real de resolución. Pensado para reemplazar un `Promise.all` masivo
 * de queries Prisma independientes cuando el fan-out puede saturar el pool
 * de conexiones (ver docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md) —
 * genérico, sin dependencia de Prisma en sí, reusable por cualquier otro
 * caso similar.
 */
// Tipado con tupla variádica (igual que `Promise.all`) — cada posición del
// array de tareas puede devolver un tipo distinto y el resultado sale
// tipado por posición, sin perder tipado ni necesitar `as` en el caller.
export async function runInBatches<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: () => Promise<T[K]> },
  batchSize: number,
): Promise<T> {
  // `batchSize <= 0` haría que `start += batchSize` nunca avance (o
  // retroceda) — un loop infinito, no un error visible. Falla rápido y
  // explícito en vez de colgar el proceso silenciosamente.
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`runInBatches: batchSize debe ser un entero positivo, recibido ${batchSize}`);
  }
  const results: unknown[] = new Array(tasks.length);
  for (let start = 0; start < tasks.length; start += batchSize) {
    const batch = tasks.slice(start, start + batchSize);
    const batchResults = await Promise.all(batch.map((task) => task()));
    batchResults.forEach((result, index) => {
      results[start + index] = result;
    });
  }
  return results as unknown as T;
}
