import type { OrgStructureCatalog } from "../../types/orgStructure.types";
import type { PositionOrgScope } from "../../types/position.types";

type ScopeRef = Pick<PositionOrgScope, "level" | "nodeId">;

/**
 * Ancestros de un alcance organizacional en el árbol nuevo
 * (Empresa → Unidad de negocio → Sector → Área). Compartido por el
 * formulario de Puestos (redundancias) y Datos Laborales (rutas de consulta).
 */
export function orgScopeLineage(catalog: OrgStructureCatalog, scope: ScopeRef) {
  if (scope.level === "COMPANY") return { companyId: scope.nodeId };
  if (scope.level === "BUSINESS_UNIT") {
    const node = catalog.businessUnits.find((item) => item.id === scope.nodeId);
    return { companyId: node?.companyId, businessUnitId: node?.id };
  }
  if (scope.level === "SECTOR") {
    const node = catalog.sectors.find((item) => item.id === scope.nodeId);
    const unit = catalog.businessUnits.find((item) => item.id === node?.businessUnitId);
    return { companyId: unit?.companyId, businessUnitId: node?.businessUnitId, sectorId: node?.id };
  }
  const node = catalog.areas.find((item) => item.id === scope.nodeId);
  const sector = catalog.sectors.find((item) => item.id === node?.sectorId);
  const unit = catalog.businessUnits.find((item) => item.id === sector?.businessUnitId);
  return { companyId: unit?.companyId, businessUnitId: sector?.businessUnitId, sectorId: node?.sectorId, areaId: node?.id };
}

/** Nombres de la ruta desde la empresa hasta el nodo del alcance, inclusive. */
export function orgScopePathNames(catalog: OrgStructureCatalog, scope: ScopeRef): string[] {
  const lineage = orgScopeLineage(catalog, scope);
  return [
    catalog.companies.find((item) => item.id === lineage.companyId)?.name,
    catalog.businessUnits.find((item) => item.id === lineage.businessUnitId)?.name,
    catalog.sectors.find((item) => item.id === lineage.sectorId)?.name,
    catalog.areas.find((item) => item.id === lineage.areaId)?.name,
  ].filter((name): name is string => Boolean(name));
}
