import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortState } from "../../utils/sort";

export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
}) {
  const direction = sort?.key === sortKey ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";
  // La última palabra viaja pegada al icono: un header largo puede partirse en
  // dos líneas, pero el icono nunca queda solo en un renglón.
  const splitAt = label.lastIndexOf(" ") + 1;

  return (
    <th aria-sort={ariaSort}>
      <button type="button" className={`sortable-header${direction ? " active" : ""}`} onClick={() => onSort(sortKey)}>
        {label.slice(0, splitAt)}
        <span className="sortable-header-tail">{label.slice(splitAt)}<Icon size={12} aria-hidden="true" /></span>
      </button>
    </th>
  );
}
