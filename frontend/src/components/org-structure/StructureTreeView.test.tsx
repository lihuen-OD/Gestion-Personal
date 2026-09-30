import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StructureTreeView } from "./StructureTreeView";
import { buildOrgStructureTree } from "./orgStructureTree";
import { treeCatalog } from "./orgStructureTree.fixtures";

const tree = buildOrgStructureTree(treeCatalog);
const item = (name: RegExp) => screen.getByRole("treeitem", { name });
const queryItem = (name: RegExp) => screen.queryByRole("treeitem", { name });

function renderTree(onSelect = vi.fn()) {
  render(<StructureTreeView nodes={tree} selectedKey={null} onSelect={onSelect} />);
  return onSelect;
}

describe("StructureTreeView", () => {
  it("renderiza la jerarquía con Empresa y Unidad abiertas por defecto", () => {
    renderTree();
    expect(screen.getByRole("tree", { name: "Estructura organizacional" })).toBeInTheDocument();
    expect(item(/^Empresa Los O'Dwyer/)).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Empresa Los O'Dwyer/)).toHaveAttribute("aria-level", "1");
    expect(item(/^Unidad de negocio Producción/)).toHaveAttribute("aria-level", "2");
    expect(item(/^Establecimiento Planta 1/)).toHaveAttribute("aria-expanded", "false");
    expect(queryItem(/^Área \/ Departamento Administración/)).toBeNull();
  });

  it("abre y cierra un nodo con click en el indicador y con las flechas del teclado", async () => {
    renderTree();
    const user = userEvent.setup();
    const planta = item(/^Establecimiento Planta 1/);

    await user.click(planta.querySelector(".org-tree-toggle")!);
    expect(planta).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Área \/ Departamento Administración/)).toBeInTheDocument();

    planta.focus();
    await user.keyboard("{ArrowLeft}");
    expect(planta).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowRight}");
    expect(planta).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(item(/^Área \/ Departamento Administración/)).toHaveFocus();
  });

  it("Expandir todo muestra hasta los centros de costo; Contraer todo deja sólo las raíces", async () => {
    renderTree();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Expandir todo" }));
    expect(screen.getAllByRole("treeitem", { name: /^Centro de costo Compartido/ })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Contraer todo" }));
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-level"))).toEqual(["1", "1"]);
  });

  it("seleccionar un nodo (click o Enter) lo informa con el nodo completo", async () => {
    const onSelect = renderTree();
    const user = userEvent.setup();

    await user.click(within(item(/^Unidad de negocio Producción/)).getByText("Producción"));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: "BUSINESS_UNIT", id: "bu1" }));

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ESTABLISHMENT", id: "e1" }));
  });

  it("la búsqueda filtra, abre los ancestros y resalta la coincidencia", async () => {
    renderTree();
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox", { name: "Buscar en la estructura" }), "compras");

    expect(screen.getByText("1 coincidencia para “compras”")).toBeInTheDocument();
    const compras = item(/^Sector Compras/);
    expect(compras.querySelector("mark")?.textContent).toBe("Compras");
    expect(queryItem(/^Sector Recursos Humanos/)).toBeNull();
  });
});
