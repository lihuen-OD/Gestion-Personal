import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    getCatalog: () => Promise.resolve({ companies, businessUnits: [], establishments: [], areas, sectors, costCenters: [] }),
  },
}));

const { OrgStructurePage } = await import("./OrgStructurePage");

async function renderPage() {
  render(<MemoryRouter><OrgStructurePage /></MemoryRouter>);
  await screen.findByText("EMP-10");
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
