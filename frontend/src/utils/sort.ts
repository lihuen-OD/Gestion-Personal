import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";
export type SortValue = string | number | Date | null | undefined;
export type SortState<K extends string> = { key: K; direction: SortDirection } | null;
export type SortAccessors<T, K extends string> = Record<K, (item: T) => SortValue>;

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function isEmpty(value: SortValue): value is null | undefined | "" {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function toComparable(value: string | number | Date) {
  return value instanceof Date ? value.getTime() : value;
}

// Vacíos (null/undefined/"") siempre al final, en ASC y en DESC: la dirección
// sólo invierte la comparación entre valores reales.
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection) {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const left = toComparable(a);
  const right = toComparable(b);
  const result = typeof left === "string" || typeof right === "string"
    ? collator.compare(String(left), String(right))
    : left - right;
  return direction === "asc" ? result : -result;
}

// Devuelve una copia ordenada (sort estable); nunca muta `items`.
export function sortItems<T>(items: readonly T[], accessor: (item: T) => SortValue, direction: SortDirection) {
  return [...items].sort((a, b) => compareSortValues(accessor(a), accessor(b), direction));
}

// Ordenamiento en memoria para tablas que tienen TODOS sus registros cargados.
// No usar en tablas paginadas desde backend: ordenaría sólo la página visible.
// Sin interacción (`sort === null`) devuelve `items` tal cual, preservando el orden original.
export function useSort<T, K extends string>(items: readonly T[], accessors: SortAccessors<T, K>) {
  const [sort, setSort] = useState<SortState<K>>(null);
  const toggleSort = useCallback((key: K) => {
    setSort((current) => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }, []);
  const sorted = useMemo(
    () => (sort ? sortItems(items, accessors[sort.key], sort.direction) : items),
    [items, accessors, sort],
  );
  return { sorted, sort, toggleSort };
}
