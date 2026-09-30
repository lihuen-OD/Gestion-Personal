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

  return (
    <th aria-sort={ariaSort}>
      <button type="button" className={`sortable-header${direction ? " active" : ""}`} onClick={() => onSort(sortKey)}>
        {label}
        <Icon size={12} aria-hidden="true" />
      </button>
    </th>
  );
}
