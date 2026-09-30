import { z } from "zod";

// Contrato de ordenamiento server-side para listados paginados
// (docs/FRONTEND_STANDARDS.md §Tablas, docs/PERFORMANCE_STANDARDS.md §6).
//
// `sortBy` es una whitelist explícita por endpoint (z.enum): cualquier valor
// fuera de la lista falla en `validateQuery` con el 400 VALIDATION_ERROR
// estándar del proyecto — nunca llega a Prisma un nombre de campo arbitrario.
// El mapa de cada endpoint traduce la key pública a un `orderBy` de Prisma.

export const sortOrderSchema = z.enum(["asc", "desc"]);
export type SortOrder = z.infer<typeof sortOrderSchema>;

export function sortQueryShape<const K extends readonly [string, ...string[]]>(keys: K) {
  return {
    sortBy: z.enum(keys).optional(),
    // Opcional (no `.default`): el orden es "asc" cuando falta, resuelto en
    // resolveOrderBy — así los callers internos que arman la query a mano no
    // necesitan conocer este parámetro.
    sortOrder: sortOrderSchema.optional(),
  };
}

export type SortOrderByMap<K extends string, O> = Record<K, (order: SortOrder) => O[]>;

/**
 * Sin `sortBy` devuelve el orden de negocio default del endpoint (sin cambios
 * respecto del comportamiento previo). Siempre agrega `tiebreaker` (una
 * columna única) al final: sin desempate estable, filas con el mismo valor
 * pueden repetirse o saltearse entre páginas, porque Postgres no garantiza
 * el orden de empates entre dos consultas OFFSET/LIMIT distintas.
 */
export function resolveOrderBy<K extends string, O>(
  query: { sortBy?: K; sortOrder?: SortOrder },
  map: SortOrderByMap<K, O>,
  fallback: O[],
  tiebreaker: O,
): O[] {
  const primary = query.sortBy ? map[query.sortBy](query.sortOrder ?? "asc") : fallback;
  return [...primary, tiebreaker];
}
