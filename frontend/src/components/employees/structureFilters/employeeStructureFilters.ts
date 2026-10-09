import type { OrgStructureCatalog } from "../../../types/orgStructure.types";
import type { Employee } from "../../../types";
import type { PositionOrgScopeLevel } from "../../../types/position.types";
import { orgScopePathNames } from "../../org-structure/orgScopePath";

/**
 * A7 (ORG_LOCATION_REORGANIZATION.md §16): filtros de estructura para
 * listados de legajos. Organización (alcance del puesto), ubicación (vigente
 * a una fecha) y empresa empleadora son conceptos separados. El modo de
 * D-7: “Ubicado dentro de” es el modo por defecto; “Abarca” queda como
 * alternativa explícita.
 */
export type ScopeMode = "WITHIN" | "COVERS";

export type EmployeeStructureFilterValue = {
  scopeLevel: "" | PositionOrgScopeLevel;
  scopeNodeId: string;
  scopeMode: "" | ScopeMode;
  locationZoneId: string;
  locationEstablishmentId: string;
  locationDate: string;
  reloadStatus: "" | "PENDING" | "COMPLETE";
};

export const emptyStructureFilters: EmployeeStructureFilterValue = {
  scopeLevel: "", scopeNodeId: "", scopeMode: "WITHIN", locationZoneId: "", locationEstablishmentId: "", locationDate: "", reloadStatus: "",
};

export const scopeModeLabels: Record<ScopeMode, string> = { WITHIN: "Ubicado dentro de", COVERS: "Abarca" };

export const scopeModeHelp: Record<ScopeMode, string> = {
  WITHIN: "Puestos con un alcance en el nodo elegido o por debajo de él.",
  COVERS: "Puestos cuyo alcance incluye al nodo elegido: el mismo nodo o un nivel superior.",
};

/** Parámetros de consulta: el alcance sólo viaja completo (nivel + nodo + modo). */
export function structureFilterParams(value: EmployeeStructureFilterValue): Record<string, string> {
  const params: Record<string, string> = {};
  if (value.scopeLevel && value.scopeNodeId && value.scopeMode) {
    params.scopeLevel = value.scopeLevel;
    params.scopeNodeId = value.scopeNodeId;
    params.scopeMode = value.scopeMode;
  }
  if (value.locationZoneId) params.locationZoneId = value.locationZoneId;
  if (value.locationEstablishmentId) params.locationEstablishmentId = value.locationEstablishmentId;
  if (value.locationDate && (value.locationZoneId || value.locationEstablishmentId)) params.locationDate = value.locationDate;
  if (value.reloadStatus) params.reloadStatus = value.reloadStatus;
  return params;
}

export function scopeFilterPending(value: EmployeeStructureFilterValue) {
  return Boolean(value.scopeNodeId && !value.scopeMode);
}

export function hasStructureFilters(value: EmployeeStructureFilterValue) {
  return Object.keys(structureFilterParams(value)).length > 0;
}

type NodeOption = { id: string; label: string };

/** Nodos activos del árbol NUEVO para un nivel, rotulados con su ruta. */
export function scopeNodeOptions(catalog: OrgStructureCatalog, level: "" | PositionOrgScopeLevel): NodeOption[] {
  if (!level) return [];
  const nodes = level === "COMPANY" ? catalog.companies
    : level === "BUSINESS_UNIT" ? catalog.businessUnits
      : level === "SECTOR" ? catalog.sectors.filter((item) => !item.pendingReload)
        : catalog.areas.filter((item) => item.sectorId);
  return nodes
    .filter((node) => node.status === "ACTIVO")
    .map((node) => ({ id: node.id, label: orgScopePathNames(catalog, { level, nodeId: node.id }).join(" › ") || node.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function zoneFilterOptions(catalog: OrgStructureCatalog): NodeOption[] {
  return catalog.zones.map((zone) => ({ id: zone.id, label: zone.status === "ACTIVO" ? zone.name : `${zone.name} (inactiva)` })).sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function establishmentFilterOptions(catalog: OrgStructureCatalog, zoneId: string): NodeOption[] {
  return catalog.establishments
    .filter((item) => item.zoneId && (!zoneId || item.zoneId === zoneId))
    .map((item) => ({ id: item.id, label: zoneId ? item.name : `${catalog.zones.find((zone) => zone.id === item.zoneId)?.name || "Zona"} › ${item.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/**
 * Mismo criterio que el backend (shared/prisma/employeeStructureWhere.ts):
 * pendiente si no tiene puesto con alcance o no tiene ninguna ubicación
 * vigente o futura. `undefined` cuando la fila no trae el dato (no se adivina).
 */
export function isReloadPending(employee: Pick<Employee, "positionId" | "positionScopeCount" | "openWorkLocationCount">): boolean | undefined {
  if (employee.openWorkLocationCount === undefined) return undefined;
  if (employee.positionId && employee.positionScopeCount === undefined) return undefined;
  return !employee.positionId || !employee.positionScopeCount || employee.openWorkLocationCount === 0;
}
