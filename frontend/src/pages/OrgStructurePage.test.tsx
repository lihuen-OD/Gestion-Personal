import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { OrgArea, OrgCompany, OrgSector } from "../types/orgStructure.types";

const companies: OrgCompany[] = [
  { id: "1", code: "EMP-10", name: "beta", legalName: "", cuit: "", status: "ACTIVO" },
  { id: "2", code: "EMP-2", name: "Álamo", legalName: "", cuit: "30-2", status: "INACTIVO" },
  { id: "3", code: "EMP-1", name: "Cedro", legalName: "", cuit: "30-1", status: "ACTIVO" },
];

const areas: OrgArea[] = [
  { id: "a1", code: "AREA-1", name: "Operaciones", status: "ACTIVO" },
  { id: "a2", code: "AREA-2", name: "Administración", status: "ACTIVO" },
];
const sectors: OrgSector[] = [
  { id: "s1", code: "SEC-1", name: "Sin área", areaId: undefined, status: "ACTIVO" },
  { id: "s2", code: "SEC-2", name: "Depósito", areaId: "a1", status: "ACTIVO" },
  { id: "s3", code: "SEC-3", name: "Tesorería", areaId: "a2", status: "ACTIVO" },
];

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { role: "Nivel 1 - RRHH" } }) }));
const { updateCompany } = vi.hoisted(() => ({ updateCompany: vi.fn(async (item: unknown) => item) }));
vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    getCatalog: () => Promise.resolve({ companies, businessUnits: [], establishments: [], areas, sectors, costCenters: [] }),
    updateCompany,
  },
}));
vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn(async () => true) }));

const { OrgStructurePage } = await import("./OrgStructurePage");

// La vista árbol es la principal; estos tests cubren la vista tabla.
async function renderPage() {
  render(<MemoryRouter><OrgStructurePage /></MemoryRouter>);
  await screen.findByRole("tree");
  await userEvent.click(screen.getByRole("button", { name: "Vista tabla" }));
  await screen.findByRole("table");
}

const column = (index: number) => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[index].textContent);
const header = (name: string) => screen.getByRole("columnheader", { name });

describe("OrgStructurePage — ordenamiento de Empresas", () => {
  it("mantiene el orden original hasta que el usuario interactúa", async () => {
    await renderPage();
    expect(column(0)).toEqual(["EMP-10", "EMP-2", "EMP-1"]);
    expect(header("Nombre")).toHaveAttribute("aria-sort", "none");
  });

  it("Nombre: primer click A-Z, segundo click Z-A, con aria-sort", async () => {
    await renderPage();
    const button = screen.getByRole("button", { name: "Nombre" });
    await userEvent.click(button);
    expect(column(1)).toEqual(["Álamo", "beta", "Cedro"]);
    expect(header("Nombre")).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(button);
    expect(column(1)).toEqual(["Cedro", "beta", "Álamo"]);
    expect(header("Nombre")).toHaveAttribute("aria-sort", "descending");
    expect(header("Codigo")).toHaveAttribute("aria-sort", "none");
  });

  it("Código usa orden natural", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Codigo" }));
    expect(column(0)).toEqual(["EMP-1", "EMP-2", "EMP-10"]);
  });

  it("CUIT vacío queda al final en ambas direcciones", async () => {
    await renderPage();
    const button = screen.getByRole("button", { name: "Relacion principal" });
    await userEvent.click(button);
    expect(column(2)).toEqual(["30-1", "30-2", "-"]);
    await userEvent.click(button);
    expect(column(2)).toEqual(["30-2", "30-1", "-"]);
  });

  it("Acción y Relación secundaria no son interactivas", async () => {
    await renderPage();
    expect(within(header("Accion")).queryByRole("button")).toBeNull();
    expect(header("Accion")).not.toHaveAttribute("aria-sort");
    expect(within(header("Relacion secundaria")).queryByRole("button")).toBeNull();
  });

  it("Sectores: ordena por el nombre del área real, sin relación al final, y el orden se reinicia al cambiar de pestaña", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Nombre" }));
    await userEvent.click(screen.getByRole("button", { name: "Sectores" }));
    await screen.findByText("SEC-1");
    expect(header("Nombre")).toHaveAttribute("aria-sort", "none");
    const button = screen.getByRole("button", { name: "Relacion principal" });
    await userEvent.click(button);
    expect(column(2)).toEqual(["Administración", "Operaciones", "-"]);
    await userEvent.click(button);
    expect(column(2)).toEqual(["Operaciones", "Administración", "-"]);
  });
});

describe("OrgStructurePage — vista árbol (principal) y acciones por nodo", () => {
  async function renderTree() {
    render(<MemoryRouter><OrgStructurePage /></MemoryRouter>);
    return screen.findByRole("tree");
  }
  const treeItem = (name: RegExp) => screen.getByRole("treeitem", { name });

  it("es la vista por defecto; los registros sin padre válido quedan agrupados en 'Sin asignar'", async () => {
    await renderTree();
    expect(treeItem(/^Empresa Álamo/)).toBeInTheDocument();
    expect(treeItem(/^Sin asignar/)).toBeInTheDocument();
    expect(screen.getByText("Seleccioná un elemento")).toBeInTheDocument();
  });

  it("seleccionar un nodo muestra su detalle y acciones; Editar abre el editor de ese tipo", async () => {
    await renderTree();
    await userEvent.click(within(treeItem(/^Empresa Cedro/)).getByText("Cedro"));

    const detail = screen.getByRole("complementary", { name: "Detalle de Cedro" });
    expect(within(detail).getByText("30-1")).toBeInTheDocument();
    await userEvent.click(within(detail).getByRole("button", { name: "Editar" }));

    expect(await screen.findByRole("heading", { name: "Editar empresa" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Cedro");
  });

  it("Agregar unidad de negocio abre un alta nueva con la empresa del nodo ya asociada", async () => {
    await renderTree();
    await userEvent.click(within(treeItem(/^Empresa Cedro/)).getByText("Cedro"));
    await userEvent.click(screen.getByRole("button", { name: "Agregar unidad de negocio" }));

    expect(await screen.findByRole("heading", { name: "Nuevo registro · Unidad de negocio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Empresa asociada")).toHaveValue("3");
  });

  it("Inactivar confirma y persiste el cambio de estado con la API existente", async () => {
    await renderTree();
    await userEvent.click(within(treeItem(/^Empresa beta/)).getByText("beta"));
    await userEvent.click(screen.getByRole("button", { name: "Inactivar" }));

    await waitFor(() => expect(updateCompany).toHaveBeenCalledWith(expect.objectContaining({ id: "1", status: "INACTIVO" })));
  });
});
