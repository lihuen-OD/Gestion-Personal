import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SearchInput } from "./SearchInput";

type FilterPanelProps = {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  title?: string;
  onClear?: () => void;
  children?: ReactNode;
};

export function FilterPanel({ search, title, onClear, children }: FilterPanelProps) {
  if (!title && !children && search) {
    return (
      <SearchInput
        value={search.value}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={search.placeholder}
      />
    );
  }

  return (
    <div className="filter-panel">
      {title ? (
        <div className="filter-panel-title">
          <SlidersHorizontal size={16} />
          <b>{title}</b>
          {onClear && (
            <button type="button" className="table-link" onClick={onClear}>
              Limpiar
            </button>
          )}
        </div>
      ) : null}
      {search ? (
        <SearchInput
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          placeholder={search.placeholder}
        />
      ) : null}
      {children}
    </div>
  );
}
