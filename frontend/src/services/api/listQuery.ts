// Contrato común de listados (docs/FRONTEND_STANDARDS.md §Tablas).
// Request: page/take + filtros del módulo + sortBy/sortOrder (whitelist en el
// backend). Response: { data, meta: { total, page, pageSize, hasMore } }.

import type { SortState } from "../../utils/sort";

export type ListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };

/** Agrega sortBy/sortOrder sólo cuando el usuario eligió un orden: sin sort, el backend usa su orden de negocio default. */
export function appendSortParams(params: URLSearchParams, sort?: SortState<string>) {
  if (!sort) return;
  params.set("sortBy", sort.key);
  params.set("sortOrder", sort.direction);
}

function withPage(path: string, page: number) {
  const [base, queryString = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  params.set("page", String(page));
  return `${base}?${params.toString()}`;
}

// Tope de seguridad de `collectAllPages`: 50 páginas × take (≤300) cubre de
// sobra cualquier catálogo administrado a mano. Superarlo es una señal de que
// el listado dejó de ser un catálogo chico y necesita paginación real en la UI.
export const MAX_COLLECTED_PAGES = 50;

export class ListTooLargeError extends Error {
  constructor(path: string) {
    super(`El listado ${path.split("?")[0]} supera ${MAX_COLLECTED_PAGES} páginas: requiere paginación server-side en la pantalla.`);
    this.name = "ListTooLargeError";
  }
}

/**
 * Listado completo explícito para catálogos chicos cuya pantalla necesita
 * todas las filas (búsqueda/filtros/orden locales, selects, "siguiente
 * código"): sigue `meta.hasMore` página por página en vez de confiar en que
 * un único `take` alcance. Nunca trunca en silencio: si el catálogo excede
 * MAX_COLLECTED_PAGES falla de forma visible.
 */
export async function collectAllPages<T>(path: string, fetchPage: (pagedPath: string) => Promise<{ data: T[]; meta?: { hasMore?: boolean } }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_COLLECTED_PAGES; page += 1) {
    const response = await fetchPage(withPage(path, page));
    rows.push(...response.data);
    if (!response.meta?.hasMore) return rows;
  }
  throw new ListTooLargeError(path);
}
