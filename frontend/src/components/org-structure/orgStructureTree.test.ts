import { describe, expect, it } from "vitest";
import { treeCatalog } from "./orgStructureTree.fixtures";
import { buildOrgStructureTree, collectParentKeys, filterOrgTree, flattenVisible, UNASSIGNED_KEY, type OrgTreeNode } from "./orgStructureTree";


const names = (nodes: OrgTreeNode[]) => nodes.map((node) => node.name);

describe("buildOrgStructureTree", () => {
  const tree = buildOrgStructureTree(treeCatalog);
  const company = tree[0]!;
  const unit = company.children[0]!;
  const establishment = unit.children[0]!;
  const area = establishment.children[0]!;

  it("arma Empresa → Unidad → Establecimiento → Área → Sector → Centro de costo con las relaciones reales", () => {
    expect(company).toMatchObject({ type: "COMPANY", name: "Los O'Dwyer" });
    expect(unit).toMatchObject({ type: "BUSINESS_UNIT", name: "Producción", path: ["Los O'Dwyer"] });
    expect(establishment).toMatchObject({ type: "ESTABLISHMENT", name: "Planta 1" });
    expect(area).toMatchObject({ type: "AREA", name: "Administración", path: ["Los O'Dwyer", "Producción", "Planta 1"] });
    const rrhh = area.children.find((node) => node.name === "Recursos Humanos")!;
    expect(rrhh.type).toBe("SECTOR");
    expect(names(rrhh.children)).toEqual(["Compartido", "Centro RRHH"]); // CC ordenados por código
  });

  it("un centro de costo compartido aparece en cada sector, con key propia y cantidad de ubicaciones", () => {
    const sectors = area.children.filter((node) => node.type === "SECTOR");
    const shared = sectors.flatMap((sector) => sector.children.filter((node) => node.id === "cc2"));
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((node) => node.key)).size).toBe(2);
    expect(shared.every((node) => node.placements === 2)).toBe(true);
  });

  it("un centro de costo sin sectores cuelga del nivel más profundo que tenga (acá, el área), después de los sectores", () => {
    expect(names(area.children)).toEqual(["Compras", "Recursos Humanos", "Del área"]);
  });

  it("lo que no tiene padre válido va a 'Sin asignar' en vez de desaparecer", () => {
    const unassigned = tree.find((node) => node.key === UNASSIGNED_KEY)!;
    expect(unassigned.type).toBe("UNASSIGNED");
    expect(names(unassigned.children)).toEqual(["Unidad huérfana", "Sin relaciones"]);
  });
});

describe("filterOrgTree / flattenVisible", () => {
  const tree = buildOrgStructureTree(treeCatalog);

  it("busca sin distinguir tildes ni mayúsculas, conserva los ancestros y los marca para abrir", () => {
    const result = filterOrgTree(tree, "administracion");
    expect(result.matches).toBe(1);
    expect(names(result.nodes)).toEqual(["Los O'Dwyer"]);
    const openRows = flattenVisible(result.nodes, new Set(result.expandKeys));
    expect(openRows.map((row) => row.node.name)).toEqual(["Los O'Dwyer", "Producción", "Planta 1", "Administración"]);
  });

  it("busca también por código", () => {
    expect(filterOrgTree(tree, "rh-001").matches).toBe(1);
  });

  it("flattenVisible respeta nodos abiertos/cerrados y calcula aria-level/posinset", () => {
    expect(flattenVisible(tree, new Set()).map((row) => row.level)).toEqual([1, 1]);
    const all = flattenVisible(tree, new Set(collectParentKeys(tree)));
    expect(all.find((row) => row.node.name === "Centro RRHH")).toMatchObject({ level: 6 });
    expect(all[0]).toMatchObject({ position: 1, setSize: 2 });
  });
});

describe("filterOrgTree — coincidencias anidadas", () => {
  it("si un nodo coincide y tiene coincidencias adentro, también se abre para mostrarlas todas", () => {
    const tree = buildOrgStructureTree(treeCatalog);
    const result = filterOrgTree(tree, "planta"); // "Planta 1" (establecimiento); ninguna coincidencia interna
    expect(result.expandKeys).not.toContain(tree[0]!.children[0]!.children[0]!.key);
    const nested = filterOrgTree(tree, "o"); // coincide la empresa y varios descendientes
    expect(nested.expandKeys).toContain(tree[0]!.key);
  });
});
