import type { ReactNode } from "react";
import type { OrgChartFilters } from "../../types/organizationChart.types";
import { Button } from "../ui/Button";
import { FilterPanel } from "../ui/FilterPanel";

type Options = Record<Exclude<keyof OrgChartFilters, "search" | "status">, string[]>;

const labels: Record<keyof Options, string> = {
  company: "Empresa empleadora",
  costCenter: "Centro de costo",
  position: "Puesto",
  internalCategory: "Categoría interna",
  receiptCategory: "Categoría de recibo",
  directManager: "Encargado directo",
  timeResponsible: "Responsable de carga",
};

export function OrganigramFilters({ filters, options, onChange, onClear, structure }: { filters: OrgChartFilters; options: Options; onChange: (filters: OrgChartFilters) => void; onClear: () => void; structure?: ReactNode }) {
  const set = (field: keyof OrgChartFilters, value: string) => onChange({ ...filters, [field]: value });
  return <FilterPanel search={{ value: filters.search, onChange: (value) => set("search", value), placeholder: "Buscar por nombre, apellido, legajo, CUIL o DNI" }}>
    {(Object.keys(labels) as (keyof Options)[]).map((field) => <label key={field}>{labels[field]}<select value={filters[field]} onChange={(event) => set(field, event.target.value)}><option value="">Todos</option>{options[field].map((option) => <option key={option}>{option}</option>)}</select></label>)}
    {structure}
    <Button variant="subtle" type="button" onClick={onClear}>Limpiar filtros</Button>
  </FilterPanel>;
}
