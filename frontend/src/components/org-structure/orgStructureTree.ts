import type {
  OrgArea,
  OrgBusinessUnit,
  OrgCostCenter,
  OrgEstablishment,
  OrgSector,
  OrgStructureCatalog,
  OrgStructureEntity,
  OrgStructureEntityType,
  OrgStructureStatus,
} from "../../types/orgStructure.types";
import { sortItems } from "../../utils/sort";

// Árbol jerárquico de la estructura organizacional, armado sólo con las
// relaciones que ya existen en el catálogo (GET /org-structure):
// Empresa → Unidad de negocio → Establecimiento → Área → Sector (cadena de FK
// singulares) y Centro de costo, la única relación M:N (docs/DATABASE_STANDARDS.md):
// un centro de costo cuelga de cada sector al que está asociado; si no tiene
// sectores, del nivel más profundo que tenga cargado. Lo que no tiene padre
// válido se agrupa en "Sin asignar" en vez de desaparecer del árbol.

export type OrgTreeNodeType = OrgStructureEntityType | "UNASSIGNED";

export interface OrgTreeNode {
  /** Única por posición: un centro de costo compartido aparece con una key por cada ubicación. */
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
  /** Cantidad de ubicaciones del mismo registro en el árbol (>1 sólo en centros de costo compartidos). */
  placements: number;
}

export const orgNodeTypeLabels: Record<OrgTreeNodeType, string> = {
  COMPANY: "Empresa",
  BUSINESS_UNIT: "Unidad de negocio",
  ESTABLISHMENT: "Establecimiento",
  AREA: "Área / Departamento",
  SECTOR: "Sector",
  COST_CENTER: "Centro de costo",
  UNASSIGNED: "Sin asignar",
};

/** Hijo directo que se crea desde cada nivel ("Agregar ..."). */
export const orgChildType: Partial<Record<OrgStructureEntityType, OrgStructureEntityType>> = {
  COMPANY: "BUSINESS_UNIT",
  BUSINESS_UNIT: "ESTABLISHMENT",
  ESTABLISHMENT: "AREA",
  AREA: "SECTOR",
  SECTOR: "COST_CENTER",
};

export const UNASSIGNED_KEY = "UNASSIGNED";

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

export function buildOrgStructureTree(catalog: OrgStructureCatalog): OrgTreeNode[] {
  const ids = {
    COMPANY: new Set(catalog.companies.map((item) => item.id)),
    BUSINESS_UNIT: new Set(catalog.businessUnits.map((item) => item.id)),
    ESTABLISHMENT: new Set(catalog.establishments.map((item) => item.id)),
    AREA: new Set(catalog.areas.map((item) => item.id)),
    SECTOR: new Set(catalog.sectors.map((item) => item.id)),
  };
  const unitsByCompany = groupBy(catalog.businessUnits, (item) => item.companyId);
  const establishmentsByUnit = groupBy(catalog.establishments, (item) => item.businessUnitId);
  const areasByEstablishment = groupBy(catalog.areas, (item) => item.establishmentId);
  const sectorsByArea = groupBy(catalog.sectors, (item) => item.areaId);

  // Centro de costo → nivel más profundo con relaciones válidas.
  const costCentersAt = new Map<string, OrgCostCenter[]>();
  const placementsOf = new Map<string, number>();
  const unplacedCostCenters: OrgCostCenter[] = [];
  for (const costCenter of catalog.costCenters) {
    const levels: Array<[keyof typeof ids, string[]]> = [
      ["SECTOR", costCenter.sectorIds],
      ["AREA", costCenter.areaIds],
      ["ESTABLISHMENT", costCenter.establishmentIds],
      ["BUSINESS_UNIT", costCenter.businessUnitIds],
      ["COMPANY", costCenter.companyIds],
    ];
    const placement = levels.map(([type, list]) => [type, list.filter((id) => ids[type].has(id))] as const).find(([, list]) => list.length);
    if (!placement) {
      unplacedCostCenters.push(costCenter);
      continue;
    }
    placementsOf.set(costCenter.id, placement[1].length);
    for (const id of placement[1]) {
      const key = `${placement[0]}:${id}`;
      costCentersAt.set(key, [...(costCentersAt.get(key) ?? []), costCenter]);
    }
  }

  function node(type: OrgStructureEntityType, entity: OrgStructureEntity, parentKey: string, path: string[]): OrgTreeNode {
    const key = `${parentKey}/${type}:${entity.id}`;
    const childPath = [...path, entity.name];
    const structural: OrgTreeNode[] =
      type === "COMPANY" ? byName(unitsByCompany.get(entity.id) ?? []).map((item) => node("BUSINESS_UNIT", item, key, childPath))
      : type === "BUSINESS_UNIT" ? byName(establishmentsByUnit.get(entity.id) ?? []).map((item) => node("ESTABLISHMENT", item, key, childPath))
      : type === "ESTABLISHMENT" ? byName(areasByEstablishment.get(entity.id) ?? []).map((item) => node("AREA", item, key, childPath))
      : type === "AREA" ? byName(sectorsByArea.get(entity.id) ?? []).map((item) => node("SECTOR", item, key, childPath))
      : [];
    const costCenters = type === "COST_CENTER" ? [] : sortItems(costCentersAt.get(`${type}:${entity.id}`) ?? [], (item) => item.code, "asc").map((item) => node("COST_CENTER", item, key, childPath));
    return {
      key,
      type,
      id: entity.id,
      name: entity.name,
      code: entity.code,
      status: entity.status,
      entity,
      path,
      children: [...structural, ...costCenters],
      placements: type === "COST_CENTER" ? placementsOf.get(entity.id) ?? 1 : 1,
    };
  }

  const roots = byName(catalog.companies).map((item) => node("COMPANY", item, "", []));

  // Registros sin padre válido: se muestran (con sus propios hijos) bajo "Sin asignar".
  const unassignedPath = [orgNodeTypeLabels.UNASSIGNED];
  const orphans: OrgTreeNode[] = [
    ...byName(catalog.businessUnits.filter((item: OrgBusinessUnit) => !ids.COMPANY.has(item.companyId))).map((item) => node("BUSINESS_UNIT", item, UNASSIGNED_KEY, unassignedPath)),
    ...byName(catalog.establishments.filter((item: OrgEstablishment) => !item.businessUnitId || !ids.BUSINESS_UNIT.has(item.businessUnitId))).map((item) => node("ESTABLISHMENT", item, UNASSIGNED_KEY, unassignedPath)),
    ...byName(catalog.areas.filter((item: OrgArea) => !item.establishmentId || !ids.ESTABLISHMENT.has(item.establishmentId))).map((item) => node("AREA", item, UNASSIGNED_KEY, unassignedPath)),
    ...byName(catalog.sectors.filter((item: OrgSector) => !item.areaId || !ids.AREA.has(item.areaId))).map((item) => node("SECTOR", item, UNASSIGNED_KEY, unassignedPath)),
    ...sortItems(unplacedCostCenters, (item) => item.code, "asc").map((item) => node("COST_CENTER", item, UNASSIGNED_KEY, unassignedPath)),
  ];
  if (!orphans.length) return roots;
  return [...roots, { key: UNASSIGNED_KEY, type: "UNASSIGNED", id: UNASSIGNED_KEY, name: "Sin asignar", code: "", path: [], children: orphans, placements: 1 }];
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
    if (nodeMatches(item, query)) {
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

