import { describe, expect, it } from "vitest";
import { treeCatalog } from "./orgStructureTree.fixtures";
import { buildLocationTree, buildOrganizationTree, collectParentKeys, filterOrgTree, flattenVisible, knownMoveBlockers, LEGACY_LOCATION_KEY, LEGACY_ORGANIZATION_KEY, ZONES_WITHOUT_PROVINCE_KEY, type OrgTreeNode } from "./orgStructureTree";

const names = (nodes: OrgTreeNode[]) => nodes.map((node) => node.name);

describe("buildOrganizationTree", () => {
  const tree = buildOrganizationTree(treeCatalog);
  const company = tree[0]!;
  const unit = company.children[0]!;

  it("arma Empresa → Unidad de negocio → Sector → Área con los padres del modelo nuevo", () => {
    expect(company).toMatchObject({ type: "COMPANY", name: "Los O'Dwyer" });
    expect(unit).toMatchObject({ type: "BUSINESS_UNIT", name: "Producción", path: ["Los O'Dwyer"] });
    expect(names(unit.children)).toEqual(["Compras", "Recursos Humanos"]);
    const rrhh = unit.children.find((node) => node.name === "Recursos Humanos")!;
    expect(rrhh.children[0]).toMatchObject({ type: "AREA", name: "Liquidaciones", path: ["Los O'Dwyer", "Producción", "Recursos Humanos"] });
  });

  it("no cuelga centros de costo del árbol: informa cuántos vinculan cada nodo", () => {
    const rrhh = unit.children.find((node) => node.name === "Recursos Humanos")!;
    expect(rrhh.costCenterCount).toBe(1);
    expect(rrhh.children.every((node) => node.type !== "COST_CENTER")).toBe(true);
  });

  it("agrupa los registros anteriores como pendientes de recarga, sin ubicarlos en la estructura nueva", () => {
    const legacy = tree.find((node) => node.key === LEGACY_ORGANIZATION_KEY)!;
    expect(legacy).toMatchObject({ type: "GROUP", name: "Estructura anterior · pendiente de recarga" });
    expect(names(legacy.children)).toEqual(["Sectores anteriores (1)", "Áreas anteriores (1)"]);
    expect(legacy.children[0]!.children[0]).toMatchObject({ type: "SECTOR", name: "Depósito anterior", pendingReload: true, children: [] });
  });
});

describe("buildLocationTree", () => {
  const tree = buildLocationTree(treeCatalog);

  it("arma Provincia → Zona → Establecimiento → Unidad, independiente de la organización", () => {
    expect(tree[0]).toMatchObject({ type: "PROVINCE", name: "Santa Fe" });
    const zone = tree[0]!.children[0]!;
    expect(zone).toMatchObject({ type: "ZONE", name: "Litoral", path: ["Santa Fe"] });
    const establishment = zone.children[0]!;
    expect(establishment).toMatchObject({ type: "ESTABLISHMENT", name: "Planta 1", path: ["Santa Fe", "Litoral"], costCenterCount: 1 });
    expect(establishment.children.map((node) => [node.type, node.name])).toEqual([["ESTABLISHMENT_UNIT", "Lote Norte"], ["ESTABLISHMENT_UNIT", "Lote Sur"]]);
    expect(establishment.children[0]!.path).toEqual(["Santa Fe", "Litoral", "Planta 1"]);
  });

  it("un establecimiento sin unidades es una hoja; la zona sin provincia queda pendiente de recarga y conserva sus establecimientos", () => {
    const pending = tree.find((node) => node.key === ZONES_WITHOUT_PROVINCE_KEY)!;
    expect(pending).toMatchObject({ type: "GROUP", name: "Zonas sin provincia · pendiente de recarga (1)" });
    expect(pending.children[0]).toMatchObject({ type: "ZONE", name: "Zona previa" });
    expect(pending.children[0]!.children[0]).toMatchObject({ type: "ESTABLISHMENT", name: "Oficina Central", children: [] });
  });

  it("los establecimientos sin zona quedan pendientes de recarga", () => {
    const legacy = tree.find((node) => node.key === LEGACY_LOCATION_KEY)!;
    expect(legacy.name).toBe("Establecimientos anteriores · pendientes de recarga (1)");
    expect(legacy.children[0]).toMatchObject({ name: "Casa central anterior", pendingReload: true });
  });
});

describe("knownMoveBlockers (D-9)", () => {
  it("cuenta hijos del modelo nuevo y centros de costo vinculados", () => {
    expect(knownMoveBlockers("SECTOR", "s1", treeCatalog)).toEqual(["1 área", "1 centro de costo"]);
    expect(knownMoveBlockers("BUSINESS_UNIT", "bu1", treeCatalog)).toEqual(["2 sectores"]);
    expect(knownMoveBlockers("ZONE", "z1", treeCatalog)).toEqual(["1 establecimiento"]);
    expect(knownMoveBlockers("PROVINCE", "p1", treeCatalog)).toEqual(["1 zona"]);
    expect(knownMoveBlockers("ESTABLISHMENT", "e1", treeCatalog)).toEqual(["2 unidades", "1 centro de costo"]);
    expect(knownMoveBlockers("ESTABLISHMENT_UNIT", "u1", treeCatalog)).toEqual([]);
    expect(knownMoveBlockers("AREA", "a1", treeCatalog)).toEqual([]);
  });
});

describe("filterOrgTree / flattenVisible", () => {
  const tree = buildOrganizationTree(treeCatalog);

  it("busca sin distinguir tildes ni mayúsculas, conserva los ancestros y los marca para abrir", () => {
    const result = filterOrgTree(tree, "liquidacion");
    expect(result.matches).toBe(1);
    expect(names(result.nodes)).toEqual(["Los O'Dwyer"]);
    const openRows = flattenVisible(result.nodes, new Set(result.expandKeys));
    expect(openRows.map((row) => row.node.name)).toEqual(["Los O'Dwyer", "Producción", "Recursos Humanos", "Liquidaciones"]);
  });

  it("busca también por código y encuentra registros pendientes de recarga sin contar los grupos", () => {
    expect(filterOrgTree(tree, "sec-90").matches).toBe(1);
    expect(filterOrgTree(tree, "anteriores").matches).toBe(0);
  });

  it("flattenVisible respeta nodos abiertos/cerrados y calcula aria-level/posinset", () => {
    expect(flattenVisible(tree, new Set()).map((row) => row.level)).toEqual([1, 1]);
    const all = flattenVisible(tree, new Set(collectParentKeys(tree)));
    expect(all.find((row) => row.node.name === "Liquidaciones")).toMatchObject({ level: 4 });
    expect(all[0]).toMatchObject({ position: 1, setSize: 2 });
  });
});
