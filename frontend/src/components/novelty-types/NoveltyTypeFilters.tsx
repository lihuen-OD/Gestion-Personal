import type { NoveltyTypeFilters as Filters, NoveltyTypeKind } from "../../types/noveltyType.types";
import { FilterPanel } from "../ui/FilterPanel";
import { noveltyKindLabels } from "./NoveltyTypeFields";
import { activoInactivoLabel } from "../../utils/status";

export function NoveltyTypeFilters({ filters, options, onChange }: { filters: Filters; options: { kinds: string[]; statuses: string[] }; onChange: (filters: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return <FilterPanel title="Filtros" search={{ value: filters.search, onChange: (value) => set({ search: value }), placeholder: "Nombre, codigo interno o Finnegans" }}>
    <label>Categoria<select value={filters.kind} onChange={(event) => set({ kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind} value={kind}>{noveltyKindLabels[kind as NoveltyTypeKind] ?? kind}</option>)}</select></label>
    <label>Finnegans<select value={filters.exportsToFinnegans} onChange={(event) => set({ exportsToFinnegans: event.target.value })}><option value="">Todos</option><option value="true">Exporta</option><option value="false">No exporta</option></select></label>
    <label>Aprobacion<select value={filters.requiresApproval} onChange={(event) => set({ requiresApproval: event.target.value })}><option value="">Todos</option><option value="true">Requiere</option><option value="false">No requiere</option></select></label>
    <label>Estado<select value={filters.status} onChange={(event) => set({ status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status} value={status}>{activoInactivoLabel(status)}</option>)}</select></label>
  </FilterPanel>;
}
