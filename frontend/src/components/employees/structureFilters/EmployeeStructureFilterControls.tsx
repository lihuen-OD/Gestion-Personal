import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { PositionOrgScopeLevel } from "../../../types/position.types";
import { orgNodeTypeLabels } from "../../org-structure/orgStructureTree";
import {
  establishmentFilterOptions,
  scopeFilterPending,
  scopeModeHelp,
  scopeModeLabels,
  scopeNodeOptions,
  zoneFilterOptions,
  type EmployeeStructureFilterValue,
  type ScopeMode,
} from "./employeeStructureFilters";

const levels: PositionOrgScopeLevel[] = ["COMPANY", "BUSINESS_UNIT", "SECTOR", "AREA"];

type Props = {
  value: EmployeeStructureFilterValue;
  catalog: OrgStructureCatalog | null;
  onChange: (value: EmployeeStructureFilterValue) => void;
};

/**
 * A7: controles de filtro de estructura (alcance del puesto, ubicación con
 * vigencia, estado de recarga y sector anterior) compartidos por Legajos,
 * Organigramas y paneles de empleados asociados. Se renderizan dentro de un
 * FilterPanel existente.
 */
export function EmployeeStructureFilterControls({ value, catalog, onChange }: Props) {
  const set = (patch: Partial<EmployeeStructureFilterValue>) => onChange({ ...value, ...patch });
  const nodes = catalog ? scopeNodeOptions(catalog, value.scopeLevel) : [];
  const zones = catalog ? zoneFilterOptions(catalog) : [];
  const establishments = catalog ? establishmentFilterOptions(catalog, value.locationZoneId) : [];
  const hasLocation = Boolean(value.locationZoneId || value.locationEstablishmentId);

  return (
    <>
      <label>
        Alcance del puesto
        <select value={value.scopeLevel} onChange={(event) => set({ scopeLevel: event.target.value as EmployeeStructureFilterValue["scopeLevel"], scopeNodeId: "" })}>
          <option value="">Todos los niveles</option>
          {levels.map((level) => <option key={level} value={level}>{orgNodeTypeLabels[level]}</option>)}
        </select>
      </label>
      <label>
        Nodo organizacional
        <select value={value.scopeNodeId} disabled={!value.scopeLevel} onChange={(event) => set({ scopeNodeId: event.target.value })}>
          <option value="">{value.scopeLevel ? "Seleccionar nodo" : "Elegí un nivel"}</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
      </label>
      <label>
        Modo de alcance
        <select value={value.scopeMode} disabled={!value.scopeNodeId} onChange={(event) => set({ scopeMode: event.target.value as "" | ScopeMode })} aria-describedby="structure-scope-mode-help">
          <option value="">Elegí cómo filtrar</option>
          {(Object.keys(scopeModeLabels) as ScopeMode[]).map((mode) => <option key={mode} value={mode}>{scopeModeLabels[mode]}</option>)}
        </select>
      </label>
      <label>
        Zona
        <select value={value.locationZoneId} onChange={(event) => set({ locationZoneId: event.target.value, locationEstablishmentId: "" })}>
          <option value="">Todas las zonas</option>
          {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
        </select>
      </label>
      <label>
        Establecimiento
        <select value={value.locationEstablishmentId} onChange={(event) => set({ locationEstablishmentId: event.target.value })}>
          <option value="">Todos los establecimientos</option>
          {establishments.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>
        Ubicación vigente al
        <input type="date" value={value.locationDate} disabled={!hasLocation} onChange={(event) => set({ locationDate: event.target.value })} />
      </label>
      <label>
        Recarga
        <select value={value.reloadStatus} onChange={(event) => set({ reloadStatus: event.target.value as EmployeeStructureFilterValue["reloadStatus"] })}>
          <option value="">Todos</option>
          <option value="PENDING">Pendiente de recarga</option>
          <option value="COMPLETE">Recarga completa</option>
        </select>
      </label>
      <p className="structure-filter-hint" id="structure-scope-mode-help" role={scopeFilterPending(value) ? "status" : undefined}>
        {scopeFilterPending(value)
          ? "Elegí el modo de alcance para aplicar el filtro: “Ubicado dentro de” y “Abarca” devuelven personas distintas."
          : value.scopeMode
            ? scopeModeHelp[value.scopeMode]
            : `Ubicación: ${hasLocation ? (value.locationDate ? "vigente a la fecha elegida" : "vigente hoy") : "sin filtro"}. Una persona con varios alcances o ubicaciones aparece una sola vez.`}
      </p>
    </>
  );
}
