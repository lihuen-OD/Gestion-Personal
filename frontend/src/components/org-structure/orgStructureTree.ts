import type {
  OrgArea,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureEntity,
  OrgStructureEntityType,
  OrgStructureStatus,
} from "../../types/orgStructure.types";
import { sortItems } from "../../utils/sort";

// Dos árboles independientes (docs/decisions/ORG_LOCATION_REORGANIZATION.md
// §3.1), armados sólo con los padres del modelo nuevo que trae el catálogo
// (GET /org-structure):
//   Organización: Empresa → Unidad de negocio → Sector → Área
//   Ubicaciones:  Zona → Establecimiento
// Los registros de la estructura anterior (sector sin unidad de negocio, área
// sin sector, establecimiento sin zona) no se ubican en el árbol nuevo: se
// agrupan como "pendientes de recarga" para que sigan visibles hasta la
// limpieza controlada. Los centros de costo no cuelgan del árbol: se
// administran en su propia sección y cada nodo informa cuántos lo vinculan.

export type OrgTreeNodeType = OrgStructureEntityType | "GROUP";
export type OrgTreeKind = "ORGANIZATION" | "LOCATION";

export interface OrgTreeNode {
  key: string;
  type: OrgTreeNodeType;
  id: string;
  name: string;
  code: string;
  status?: OrgStructureStatus;
  entity?: OrgStructureEntity;
  /** Nombres de los ancestros, de la raíz al padre. */
  path: string[];
  children: OrgTreeNode[];
  /** Registro de la estructura anterior, pendiente de recarga. */
  pendingReload?: boolean;
  /** Centros de costo vinculados a este nodo. */
  costCenterCount?: number;
  /** Explicación de un nodo agrupador. */
  note?: string;
}

export const orgNodeTypeLabels: Record<OrgTreeNodeType, string> = {
  COMPANY: "Empresa",
  BUSINESS_UNIT: "Unidad de negocio",
  SECTOR: "Sector",
  AREA: "Área",
  ZONE: "Zona",
  ESTABLISHMENT: "Establecimiento",
  COST_CENTER: "Centro de costo",
  GROUP: "Grupo",
};

export const orgNodeTypePlurals: Record<OrgTreeNodeType, string> = {
  COMPANY: "empresas",
  BUSINESS_UNIT: "unidades de negocio",
  SECTOR: "sectores",
  AREA: "áreas",
  ZONE: "zonas",
  ESTABLISHMENT: "establecimientos",
  COST_CENTER: "centros de costo",
  GROUP: "grupos",
};

/** Hijo directo que se crea desde cada nivel ("Agregar ..."). Un registro anterior no recibe hijos. */
export const orgChildType: Partial<Record<OrgStructureEntityType, OrgStructureEntityType>> = {
  COMPANY: "BUSINESS_UNIT",
  BUSINESS_UNIT: "SECTOR",
  SECTOR: "AREA",
  ZONE: "ESTABLISHMENT",
};

/** Padre del modelo nuevo de cada tipo. */
export const orgParentType: Partial<Record<OrgStructureEntityType, OrgStructureEntityType>> = {
  BUSINESS_UNIT: "COMPANY",
  SECTOR: "BUSINESS_UNIT",
  AREA: "SECTOR",
  ESTABLISHMENT: "ZONE",
};

export const LEGACY_ORGANIZATION_KEY = "LEGACY_ORGANIZATION";
export const LEGACY_LOCATION_KEY = "LEGACY_LOCATION";
export const PENDING_RELOAD_LABEL = "Pendiente de recarga";

function groupBy<T>(items: readonly T[], parentId: (item: T) => string | undefined) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = parentId(item);
    if (!id) continue;
    map.set(id, [...(map.get(id) ?? []), item]);
  }
  return map;
}

const byName = <T extends { name: string }>(items: readonly T[]) => sortItems(items, (item) => item.name, "asc");

/** Cantidad de centros de costo vinculados a cada id de la estructura. */
export function costCenterLinkCounts(catalog: OrgStructureCatalog) {
  const counts = new Map<string, number>();
  for (const costCenter of catalog.costCenters) {
    for (const id of new Set([...costCenter.companyIds, ...costCenter.businessUnitIds, ...costCenter.sectorIds, ...costCenter.areaIds, ...costCenter.establishmentIds])) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function makeNode(type: OrgStructureEntityType, entity: OrgStructureEntity, parentKey: string, path: string[], children: (key: string, path: string[]) => OrgTreeNode[], costCenters: Map<string, number>): OrgTreeNode {
  const key = `${parentKey}/${type}:${entity.id}`;
  const pendingReload = "pendingReload" in entity && entity.pendingReload;
  return {
    key,
    type,
    id: entity.id,
    name: entity.name,
    code: entity.code,
    status: entity.status,
    entity,
    path,
    children: children(key, [...path, entity.name]),
    ...(pendingReload ? { pendingReload: true } : {}),
    costCenterCount: costCenters.get(entity.id) ?? 0,
  };
}

function groupNode(key: string, name: string, note: string, path: string[], children: OrgTreeNode[]): OrgTreeNode {
  return { key, type: "GROUP", id: key, name, code: "", path, children, note };
}

const LEGACY_NOTE = "Registros de la estructura anterior. Quedan visibles hasta la limpieza controlada y se vuelven a cargar en la estructura nueva: no reciben elementos nuevos ni se reubican. Se puede corregir su código, nombre o estado.";

export function buildOrganizationTree(catalog: OrgStructureCatalog): OrgTreeNode[] {
  const costCenters = costCenterLinkCounts(catalog);
  const unitsByCompany = groupBy(catalog.businessUnits, (item) => item.companyId);
  const sectorsByUnit = groupBy(catalog.sectors.filter((item) => !item.pendingReload), (item) => item.businessUnitId);
  const areasBySector = groupBy(catalog.areas.filter((item) => !item.pendingReload), (item) => item.sectorId);

  const areaNodes = (sectorId: string) => (key: string, path: string[]) => byName(areasBySector.get(sectorId) ?? []).map((area) => makeNode("AREA", area, key, path, () => [], costCenters));
  const sectorNodes = (unitId: string) => (key: string, path: string[]) => byName(sectorsByUnit.get(unitId) ?? []).map((sector) => makeNode("SECTOR", sector, key, path, areaNodes(sector.id), costCenters));
  const unitNodes = (companyId: string) => (key: string, path: string[]) => byName(unitsByCompany.get(companyId) ?? []).map((unit) => makeNode("BUSINESS_UNIT", unit, key, path, sectorNodes(unit.id), costCenters));
  const roots = byName(catalog.companies).map((company) => makeNode("COMPANY", company, "", [], unitNodes(company.id), costCenters));

  const legacySectors: OrgSector[] = catalog.sectors.filter((item) => item.pendingReload);
  const legacyAreas: OrgArea[] = catalog.areas.filter((item) => item.pendingReload);
  if (!legacySectors.length && !legacyAreas.length) return roots;
  const legacyName = "Estructura anterior · pendiente de recarga";
  const legacyPath = [legacyName];
  const subgroups = [
    legacySectors.length ? groupNode(`${LEGACY_ORGANIZATION_KEY}/SECTOR`, `Sectores anteriores (${legacySectors.length})`, LEGACY_NOTE, legacyPath, byName(legacySectors).map((item) => makeNode("SECTOR", item, `${LEGACY_ORGANIZATION_KEY}/SECTOR`, [...legacyPath, "Sectores anteriores"], () => [], costCenters))) : null,
    legacyAreas.length ? groupNode(`${LEGACY_ORGANIZATION_KEY}/AREA`, `Áreas anteriores (${legacyAreas.length})`, LEGACY_NOTE, legacyPath, byName(legacyAreas).map((item) => makeNode("AREA", item, `${LEGACY_ORGANIZATION_KEY}/AREA`, [...legacyPath, "Áreas anteriores"], () => [], costCenters))) : null,
  ].filter((item): item is OrgTreeNode => Boolean(item));
  return [...roots, groupNode(LEGACY_ORGANIZATION_KEY, legacyName, LEGACY_NOTE, [], subgroups)];
}

export function buildLocationTree(catalog: OrgStructureCatalog): OrgTreeNode[] {
  const costCenters = costCenterLinkCounts(catalog);
  const establishmentsByZone = groupBy(catalog.establishments.filter((item) => !item.pendingReload), (item) => item.zoneId);
  const roots = byName(catalog.zones).map((zone) => makeNode("ZONE", zone, "", [], (key, path) => byName(establishmentsByZone.get(zone.id) ?? []).map((item) => makeNode("ESTABLISHMENT", item, key, path, () => [], costCenters)), costCenters));
  const legacy: OrgEstablishment[] = catalog.establishments.filter((item) => item.pendingReload);
  if (!legacy.length) return roots;
  const legacyName = `Establecimientos anteriores · pendientes de recarga (${legacy.length})`;
  return [...roots, groupNode(LEGACY_LOCATION_KEY, legacyName, LEGACY_NOTE, [], byName(legacy).map((item) => makeNode("ESTABLISHMENT", item, LEGACY_LOCATION_KEY, [legacyName], () => [], costCenters)))];
}

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function nodeMatches(node: OrgTreeNode, query: string) {
  return normalizeSearch(`${node.name} ${node.code}`).includes(query);
}

/**
 * Poda el árbol a los nodos que coinciden con la búsqueda y sus ancestros. Un
 * nodo que coincide conserva todo su subárbol (contexto). `expandKeys` son los
 * ancestros que hay que abrir para que cada coincidencia quede visible.
 */
export function filterOrgTree(nodes: OrgTreeNode[], rawQuery: string): { nodes: OrgTreeNode[]; expandKeys: string[]; matches: number } {
  const query = normalizeSearch(rawQuery);
  if (!query) return { nodes, expandKeys: [], matches: 0 };
  const expandKeys: string[] = [];
  let matches = 0;
  const visit = (items: OrgTreeNode[]): OrgTreeNode[] => items.flatMap((item) => {
    if (item.type !== "GROUP" && nodeMatches(item, query)) {
      matches += 1;
      // Conserva el subárbol completo; si adentro hay más coincidencias, se abre
      // también este nodo para que todas las contadas queden visibles.
      if (visit(item.children).length) expandKeys.push(item.key);
      return [item];
    }
    const children = visit(item.children);
    if (!children.length) return [];
    expandKeys.push(item.key);
    return [{ ...item, children }];
  });
  return { nodes: visit(nodes), expandKeys, matches };
}

export function collectParentKeys(nodes: OrgTreeNode[]): string[] {
  return nodes.flatMap((item) => (item.children.length ? [item.key, ...collectParentKeys(item.children)] : []));
}

export function findNode(nodes: OrgTreeNode[], key: string | null): OrgTreeNode | undefined {
  if (!key) return undefined;
  for (const item of nodes) {
    if (item.key === key) return item;
    const found = findNode(item.children, key);
    if (found) return found;
  }
  return undefined;
}

export type VisibleTreeRow = { node: OrgTreeNode; level: number; parentKey: string | null; setSize: number; position: number };

/** Filas visibles en orden de lectura según los nodos abiertos (base de la navegación por teclado). */
export function flattenVisible(nodes: OrgTreeNode[], expanded: ReadonlySet<string>, level = 1, parentKey: string | null = null): VisibleTreeRow[] {
  return nodes.flatMap((item, index) => [
    { node: item, level, parentKey, setSize: nodes.length, position: index + 1 },
    ...(expanded.has(item.key) ? flattenVisible(item.children, expanded, level + 1, item.key) : []),
  ]);
}

/** Cantidad de descendientes directos por tipo, para el panel de detalle. */
export function childSummary(node: OrgTreeNode) {
  const counts = new Map<OrgTreeNodeType, number>();
  for (const child of node.children) counts.set(child.type, (counts.get(child.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

function countLabel(count: number, type: OrgTreeNodeType) {
  return `${count} ${count === 1 ? orgNodeTypeLabels[type].toLowerCase() : orgNodeTypePlurals[type]}`;
}

/**
 * Elementos asociados que el catálogo conoce y que impiden mover un nodo
 * (D-9, ratificada): sus hijos del modelo nuevo y los centros de costo que lo
 * vinculan. El backend además cuenta alcances de puestos y reglas de horas
 * especiales; si alguno existe, responde 409 con el detalle.
 */
export function knownMoveBlockers(type: OrgStructureEntityType, id: string, catalog: OrgStructureCatalog): string[] {
  const children =
    type === "COMPANY" ? catalog.businessUnits.filter((item) => item.companyId === id).length
    : type === "BUSINESS_UNIT" ? catalog.sectors.filter((item) => item.businessUnitId === id).length
    : type === "SECTOR" ? catalog.areas.filter((item) => item.sectorId === id).length
    : type === "ZONE" ? catalog.establishments.filter((item) => item.zoneId === id).length
    : 0;
  const child = orgChildType[type];
  const costCenters = costCenterLinkCounts(catalog).get(id) ?? 0;
  return [
    children && child ? countLabel(children, child) : null,
    costCenters ? countLabel(costCenters, "COST_CENTER") : null,
  ].filter((item): item is string => Boolean(item));
}
