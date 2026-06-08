import { Search } from "lucide-react";
import type { NoveltyTypeFilters as Filters } from "../../types/noveltyType.types";

export function NoveltyTypeFilters({ filters, options, onChange }: { filters: Filters; options: { kinds: string[]; statuses: string[] }; onChange: (filters: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return <div className="position-filters catalog-filters">
    <div className="position-filter-title"><Search size={16} /><b>Filtros</b></div>
    <label>Buscar<input value={filters.search} placeholder="Nombre, código interno o Finnegans" onChange={(event) => set({ search: event.target.value })} /></label>
    <label>Tipo<select value={filters.kind} onChange={(event) => set({ kind: event.target.value })}><option value="">Todos</option>{options.kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
    <label>Liquidación<select value={filters.affectsSettlement} onChange={(event) => set({ affectsSettlement: event.target.value })}><option value="">Todos</option><option value="true">Afecta</option><option value="false">No afecta</option></select></label>
    <label>Aprobación<select value={filters.requiresApproval} onChange={(event) => set({ requiresApproval: event.target.value })}><option value="">Todos</option><option value="true">Requiere</option><option value="false">No requiere</option></select></label>
    <label>Estado<select value={filters.status} onChange={(event) => set({ status: event.target.value })}><option value="">Todos</option>{options.statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
  </div>;
}
