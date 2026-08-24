import type { PositionFilters } from "../../types/position.types";
import { FilterPanel } from "../ui/FilterPanel";

type IdOption = { id: string; name: string };

type Options = {
  businessUnitId: IdOption[];
  establishmentId: IdOption[];
  areaId: IdOption[];
  sectorId: IdOption[];
  salaryRangeCategory: string[];
};

/** Filtra por id real del catalogo de Estructura Organizacional (sectorId/areaId/etc), no por nombre suelto. */
function SelectFilterById({ label, value, options, onChange }: { label: string; value: string; options: IdOption[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Todos</option>
    {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></label>;
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function PuestoFilters({ filters, options, onChange }: { filters: PositionFilters; options: Options; onChange: (filters: PositionFilters) => void }) {
  const set = (field: keyof PositionFilters, value: string) => onChange({ ...filters, [field]: value });
  return <FilterPanel
    title="Filtros"
    onClear={() => onChange({ search: "", businessUnitId: "", establishmentId: "", areaId: "", sectorId: "", salaryRangeCategory: "", status: "" })}
    search={{ value: filters.search, onChange: (value) => set("search", value), placeholder: "Buscar por nombre o codigo de puesto" }}
  >
    <SelectFilterById label="Unidad de negocio" value={filters.businessUnitId} options={options.businessUnitId} onChange={(value) => set("businessUnitId", value)} />
    <SelectFilterById label="Establecimiento" value={filters.establishmentId} options={options.establishmentId} onChange={(value) => set("establishmentId", value)} />
    <SelectFilterById label="Area / Departamento" value={filters.areaId} options={options.areaId} onChange={(value) => set("areaId", value)} />
    <SelectFilterById label="Sector" value={filters.sectorId} options={options.sectorId} onChange={(value) => set("sectorId", value)} />
    <SelectFilter label="Rango salarial" value={filters.salaryRangeCategory} options={options.salaryRangeCategory} onChange={(value) => set("salaryRangeCategory", value)} />
    <label>Estado<select value={filters.status} onChange={(event) => set("status", event.target.value)}><option value="">Todos</option><option value="ACTIVO">ACTIVO</option><option value="INACTIVO">INACTIVO</option></select></label>
  </FilterPanel>;
}
