import { Search, SlidersHorizontal } from "lucide-react";
import type { PositionFilters } from "../../types/position.types";

type Options = {
  businessUnitName: string[];
  establishmentName: string[];
  areaDepartment: string[];
  sector: string[];
  salaryRangeCategory: string[];
};

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function PuestoFilters({ filters, options, onChange }: { filters: PositionFilters; options: Options; onChange: (filters: PositionFilters) => void }) {
  const set = (field: keyof PositionFilters, value: string) => onChange({ ...filters, [field]: value });
  return <div className="position-filters">
    <div className="position-filter-title"><SlidersHorizontal size={16} /><b>Filtros</b><button type="button" className="table-link" onClick={() => onChange({ search: "", businessUnitName: "", establishmentName: "", areaDepartment: "", sector: "", salaryRangeCategory: "", status: "" })}>Limpiar</button></div>
    <label className="search-field"><Search size={17} /><input placeholder="Buscar por nombre o codigo de puesto" value={filters.search} onChange={(event) => set("search", event.target.value)} /></label>
    <SelectFilter label="Unidad de negocio" value={filters.businessUnitName} options={options.businessUnitName} onChange={(value) => set("businessUnitName", value)} />
    <SelectFilter label="Establecimiento" value={filters.establishmentName} options={options.establishmentName} onChange={(value) => set("establishmentName", value)} />
    <SelectFilter label="Area / Departamento" value={filters.areaDepartment} options={options.areaDepartment} onChange={(value) => set("areaDepartment", value)} />
    <SelectFilter label="Sector" value={filters.sector} options={options.sector} onChange={(value) => set("sector", value)} />
    <SelectFilter label="Rango salarial" value={filters.salaryRangeCategory} options={options.salaryRangeCategory} onChange={(value) => set("salaryRangeCategory", value)} />
    <label>Estado<select value={filters.status} onChange={(event) => set("status", event.target.value)}><option value="">Todos</option><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
  </div>;
}
