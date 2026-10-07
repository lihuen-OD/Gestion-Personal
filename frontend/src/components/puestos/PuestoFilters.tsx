import type { PositionFilters, PositionOrgScopeLevel } from "../../types/position.types";
import { FilterPanel } from "../ui/FilterPanel";
import { activoInactivoLabel } from "../../utils/status";

type IdOption = { id: string; name: string };

type Options = {
  scopeNodes: Record<PositionOrgScopeLevel, IdOption[]>;
  salaryRangeCategory: string[];
};

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function PuestoFilters({ filters, options, onChange }: { filters: PositionFilters; options: Options; onChange: (filters: PositionFilters) => void }) {
  const set = (field: keyof PositionFilters, value: string) => onChange({ ...filters, [field]: value });
  return <FilterPanel
    title="Filtros"
    onClear={() => onChange({ search: "", scopeLevel: "", scopeNodeId: "", scopeMode: "WITHIN", salaryRangeCategory: "", status: "" })}
    search={{ value: filters.search, onChange: (value) => set("search", value), placeholder: "Buscar por nombre o codigo de puesto" }}
  >
    <label>Relación<select value={filters.scopeMode} onChange={(event) => set("scopeMode", event.target.value)}><option value="WITHIN">Ubicado dentro de</option><option value="COVERS">Abarca</option></select><small className="field-help">“Dentro de” mira hacia descendientes; “abarca” hacia ancestros.</small></label>
    <label>Nivel<select value={filters.scopeLevel} onChange={(event) => onChange({ ...filters, scopeLevel: event.target.value as PositionFilters["scopeLevel"], scopeNodeId: "" })}><option value="">Seleccionar</option><option value="COMPANY">Empresa</option><option value="BUSINESS_UNIT">Unidad de negocio</option><option value="SECTOR">Sector</option><option value="AREA">Área</option></select></label>
    <label>Nodo<select disabled={!filters.scopeLevel} value={filters.scopeNodeId} onChange={(event) => set("scopeNodeId", event.target.value)}><option value="">Todos</option>{filters.scopeLevel ? options.scopeNodes[filters.scopeLevel].map((option) => <option key={option.id} value={option.id}>{option.name}</option>) : null}</select></label>
    <SelectFilter label="Rango salarial" value={filters.salaryRangeCategory} options={options.salaryRangeCategory} onChange={(value) => set("salaryRangeCategory", value)} />
    <label>Estado<select value={filters.status} onChange={(event) => set("status", event.target.value)}><option value="">Todos</option><option value="ACTIVO">{activoInactivoLabel("ACTIVO")}</option><option value="INACTIVO">{activoInactivoLabel("INACTIVO")}</option></select></label>
  </FilterPanel>;
}
