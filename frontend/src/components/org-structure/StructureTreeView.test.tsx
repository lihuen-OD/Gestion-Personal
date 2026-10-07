import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StructureTreeView } from "./StructureTreeView";
import { buildOrganizationTree } from "./orgStructureTree";
import { treeCatalog } from "./orgStructureTree.fixtures";

const tree = buildOrganizationTree(treeCatalog);
const item = (name: RegExp) => screen.getByRole("treeitem", { name });
const queryItem = (name: RegExp) => screen.queryByRole("treeitem", { name });

function renderTree(onSelect = vi.fn()) {
  render(<StructureTreeView nodes={tree} selectedKey={null} onSelect={onSelect} />);
  return onSelect;
}

describe("StructureTreeView", () => {
  it("renderiza la jerarquía con Empresa y Unidad abiertas; el grupo de la estructura anterior queda cerrado", () => {
    renderTree();
    expect(screen.getByRole("tree", { name: "Estructura organizacional" })).toBeInTheDocument();
    expect(item(/^Empresa Los O'Dwyer/)).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Empresa Los O'Dwyer/)).toHaveAttribute("aria-level", "1");
    expect(item(/^Unidad de negocio Producción/)).toHaveAttribute("aria-level", "2");
    expect(item(/^Sector Recursos Humanos/)).toHaveAttribute("aria-expanded", "false");
    expect(queryItem(/^Área Liquidaciones/)).toBeNull();
    expect(item(/^Estructura anterior · pendiente de recarga/)).toHaveAttribute("aria-expanded", "false");
  });

  it("abre y cierra un nodo con click en el indicador y con las flechas del teclado", async () => {
    renderTree();
    const user = userEvent.setup();
    const rrhh = item(/^Sector Recursos Humanos/);

    await user.click(rrhh.querySelector(".org-tree-toggle")!);
    expect(rrhh).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Área Liquidaciones/)).toBeInTheDocument();

    rrhh.focus();
    await user.keyboard("{ArrowLeft}");
    expect(rrhh).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowRight}");
    expect(rrhh).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(item(/^Área Liquidaciones/)).toHaveFocus();
  });

  it("Expandir todo muestra los registros pendientes de recarga marcados; Contraer todo deja sólo las raíces", async () => {
    renderTree();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Expandir todo" }));
    expect(item(/^Sector Depósito anterior, código SEC-90, pendiente de recarga/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Contraer todo" }));
    expect(screen.getAllByRole("treeitem").map((row) => row.getAttribute("aria-level"))).toEqual(["1", "1"]);
  });

  it("seleccionar un nodo (click o Enter) lo informa con el nodo completo", async () => {
    const onSelect = renderTree();
    const user = userEvent.setup();

    await user.click(within(item(/^Unidad de negocio Producción/)).getByText("Producción"));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: "BUSINESS_UNIT", id: "bu1" }));

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: "SECTOR", id: "s2" }));
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
