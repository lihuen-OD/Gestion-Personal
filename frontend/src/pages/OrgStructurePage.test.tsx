import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { OrgArea, OrgBusinessUnit, OrgCompany, OrgCostCenter, OrgEstablishment, OrgSector, OrgZone } from "../types/orgStructure.types";

const companies: OrgCompany[] = [
  { id: "1", code: "EMP-10", name: "beta", legalName: "", cuit: "", status: "ACTIVO" },
  { id: "2", code: "EMP-2", name: "Álamo", legalName: "", cuit: "30-2", status: "INACTIVO" },
  { id: "3", code: "EMP-1", name: "Cedro", legalName: "", cuit: "30-1", status: "ACTIVO" },
];
const businessUnits: OrgBusinessUnit[] = [
  { id: "bu1", code: "UN-1", name: "Restaurantes", companyId: "3", status: "ACTIVO" },
];
const sectors: OrgSector[] = [
  { id: "s1", code: "SEC-1", name: "Cocina", businessUnitId: "bu1", status: "ACTIVO" },
  { id: "s2", code: "SEC-2", name: "Salón", businessUnitId: "bu1", status: "ACTIVO" },
  { id: "s-old", code: "SEC-90", name: "Depósito anterior", areaId: "a-old", pendingReload: true, status: "ACTIVO" },
];
const areas: OrgArea[] = [
  { id: "a1", code: "AREA-1", name: "Parrilla", sectorId: "s1", status: "ACTIVO" },
  { id: "a-old", code: "AREA-90", name: "Administración anterior", pendingReload: true, status: "ACTIVO" },
];
const zones: OrgZone[] = [{ id: "z1", code: "ZN-1", name: "Litoral", status: "ACTIVO" }];
const establishments: OrgEstablishment[] = [
  { id: "e1", code: "EST-1", name: "Local Centro", zoneId: "z1", province: "Santa Fe", department: "Rosario", locality: "Rosario", address: "", status: "ACTIVO" },
  { id: "e-old", code: "EST-90", name: "Casa central anterior", companyId: "3", pendingReload: true, province: "", department: "", locality: "", address: "", status: "ACTIVO" },
];
const costCenters: OrgCostCenter[] = [
  { id: "cc1", code: "CC-1", name: "Cocina central", companyIds: [], businessUnitIds: [], establishmentIds: [], areaIds: [], sectorIds: ["s1", "s-old"], status: "ACTIVO" },
];

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { role: "Nivel 1 - RRHH" } }) }));
const api = vi.hoisted(() => ({
  updateCompany: vi.fn(async (item: unknown) => item),
  createArea: vi.fn(async (item: unknown) => item),
  updateSector: vi.fn(async (item: unknown) => item),
  deleteEntity: vi.fn(async (_type: string, _id: string) => ({})),
  removedIds: new Set<string>(),
}));
vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    // Lo eliminado deja de venir en el catálogo refrescado (como el backend real).
    getCatalog: () => Promise.resolve({ companies: companies.filter((item) => !api.removedIds.has(item.id)), businessUnits, sectors, areas, zones, establishments, costCenters }),
    updateCompany: api.updateCompany,
    createArea: api.createArea,
    updateSector: api.updateSector,
    deleteEntity: api.deleteEntity,
  },
}));
vi.mock("../services/appDialog", () => ({ confirmAction: vi.fn(async () => true) }));

const { OrgStructurePage } = await import("./OrgStructurePage");
const { confirmAction } = await import("../services/appDialog");
const { ApiError } = await import("../services/api/apiClient");

async function renderTree() {
  render(<MemoryRouter><OrgStructurePage /></MemoryRouter>);
  return screen.findByRole("tree");
}

async function renderTable() {
  await renderTree();
  await userEvent.click(screen.getByRole("button", { name: "Vista tabla" }));
  await screen.findByRole("table");
}

const treeItem = (name: RegExp) => screen.getByRole("treeitem", { name });
const column = (index: number) => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[index]!.textContent);
const header = (name: string) => screen.getByRole("columnheader", { name });

async function select(name: RegExp, text: string) {
  await userEvent.click(within(treeItem(name)).getByText(text));
  return screen.getByRole("complementary", { name: `Detalle de ${text}` });
}

beforeEach(() => {
  api.removedIds.clear();
  api.deleteEntity.mockReset();
  api.deleteEntity.mockImplementation(async (_type: string, id: string) => { api.removedIds.add(id); return {}; });
  api.createArea.mockClear();
  api.updateSector.mockClear();
  vi.mocked(confirmAction).mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
});

describe("OrgStructurePage — secciones separadas", () => {
  it("Organización es la sección por defecto y avisa la cantidad de registros pendientes de recarga", async () => {
    await renderTree();
    expect(screen.getByRole("tree", { name: "Organización" })).toBeInTheDocument();
    expect(screen.getByText("Empresa → Unidad de negocio → Sector → Área. Define el alcance organizativo de los puestos.")).toBeInTheDocument();
    expect(screen.getByText(/3 registros de la estructura anterior/)).toBeInTheDocument();
    expect(treeItem(/^Estructura anterior · pendiente de recarga/)).toBeInTheDocument();
  });

  it("Ubicaciones muestra Zona → Establecimiento, con los establecimientos anteriores aparte", async () => {
    await renderTree();
    await userEvent.click(screen.getByRole("button", { name: "Ubicaciones" }));
    expect(await screen.findByRole("tree", { name: "Ubicaciones" })).toBeInTheDocument();
    expect(treeItem(/^Zona Litoral/)).toBeInTheDocument();
    expect(treeItem(/^Establecimiento Local Centro/)).toHaveAttribute("aria-level", "2");
    expect(treeItem(/^Establecimientos anteriores · pendientes de recarga \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva zona" })).toBeInTheDocument();
  });

  it("Centros de costo se administra en su propia sección, en tabla", async () => {
    await renderTree();
    await userEvent.click(screen.getByRole("button", { name: "Centros de costo" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByText("Cocina central")).toBeInTheDocument();
  });
});

describe("OrgStructurePage — padres del modelo nuevo y restricciones de transición", () => {
  it("Agregar sector desde una unidad de negocio precarga ese padre", async () => {
    await renderTree();
    await select(/^Unidad de negocio Restaurantes/, "Restaurantes");
    await userEvent.click(screen.getByRole("button", { name: "Agregar sector" }));
    expect(await screen.findByRole("heading", { name: "Nuevo registro · Sector" })).toBeInTheDocument();
    expect(screen.getByLabelText("Unidad de negocio *")).toHaveValue("bu1");
  });

  it("un área nueva sin sector no se guarda y se explica qué falta", async () => {
    await renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Áreas" }));
    await userEvent.click(screen.getByRole("button", { name: "Nueva área" }));
    await userEvent.type(await screen.findByLabelText("Nombre *"), "Barra");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Elegí un sector antes de guardar.")).toBeInTheDocument();
    expect(api.createArea).not.toHaveBeenCalled();
  });

  it("el selector de sector sólo ofrece sectores de la estructura nueva", async () => {
    await renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Áreas" }));
    await userEvent.click(screen.getByRole("button", { name: "Nueva área" }));
    const options = within(await screen.findByLabelText("Sector *")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Seleccioná un sector", "Restaurantes · Cocina", "Restaurantes · Salón"]);
  });

  it("D-9: un sector con áreas o centros de costo no se puede mover y se explica el motivo", async () => {
    await renderTree();
    const detail = await select(/^Sector Cocina/, "Cocina");
    await userEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    expect(await screen.findByLabelText("Unidad de negocio *")).toBeDisabled();
    expect(screen.getByText(/No se puede mover porque tiene 1 área y 1 centro de costo/)).toBeInTheDocument();
  });

  it("un sector sin elementos asociados sí se puede mover", async () => {
    await renderTree();
    const detail = await select(/^Sector Salón/, "Salón");
    await userEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    expect(await screen.findByLabelText("Unidad de negocio *")).toBeEnabled();
  });

  it("un registro anterior se marca pendiente de recarga: no recibe hijos ni se reubica, pero corrige su nombre", async () => {
    await renderTree();
    await userEvent.click(screen.getByRole("button", { name: "Expandir todo" }));
    const detail = await select(/^Sector Depósito anterior/, "Depósito anterior");
    expect(within(detail).getByText("Pendiente de recarga")).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "Agregar área" })).toBeNull();

    await userEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    expect(screen.queryByLabelText("Unidad de negocio *")).toBeNull();
    expect(screen.getByText(/no se ubica en la estructura nueva/)).toBeInTheDocument();
    const name = screen.getByLabelText("Nombre *");
    await userEvent.clear(name);
    await userEvent.type(name, "Depósito");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateSector).toHaveBeenCalledWith(expect.objectContaining({ id: "s-old", name: "Depósito" })));
    expect(api.updateSector.mock.calls[0]![0]).not.toHaveProperty("businessUnitId");
  });

  it("un rechazo del backend (409) lo muestra el aviso global, sin duplicarlo en la página", async () => {
    api.updateSector.mockRejectedValueOnce(new ApiError("No se puede cambiar la ubicación en la estructura del sector “Salón” porque tiene elementos asociados: 1 alcance de puesto.", "ORG_STRUCTURE_PARENT_IN_USE", 409));
    await renderTree();
    const detail = await select(/^Sector Salón/, "Salón");
    await userEvent.click(within(detail).getByRole("button", { name: "Editar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(api.updateSector).toHaveBeenCalled());
    expect(screen.queryByText(/No se puede cambiar la ubicación/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Editar sector" })).toBeInTheDocument();
  });

  it("centros de costo: los registros anteriores sólo aparecen si ya estaban vinculados, marcados", async () => {
    await renderTree();
    await userEvent.click(screen.getByRole("button", { name: "Centros de costo" }));
    await userEvent.click(await screen.findByRole("button", { name: "Editar Cocina central" }));
    const sectorsBlock = (await screen.findByText("Sectores")).closest(".catalog-check-block") as HTMLElement;
    expect(within(sectorsBlock).getByLabelText("Depósito anterior (estructura anterior)")).toBeChecked();
    expect(screen.getByText(/Se conservan hasta la limpieza controlada/)).toBeInTheDocument();
    const areasBlock = screen.getByText("Áreas", { selector: "small" }).closest(".catalog-check-block") as HTMLElement;
    expect(within(areasBlock).queryByLabelText(/Administración anterior/)).toBeNull();
  });
});

describe("OrgStructurePage — tabla y ordenamiento", () => {
  it("mantiene el orden original hasta que el usuario interactúa y ordena por nombre y código", async () => {
    await renderTable();
    expect(column(0)).toEqual(["EMP-10", "EMP-2", "EMP-1"]);
    expect(header("Nombre")).toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: "Nombre" }));
    expect(column(1)).toEqual(["Álamo", "beta", "Cedro"]);
    await userEvent.click(screen.getByRole("button", { name: "Código" }));
    expect(column(0)).toEqual(["EMP-1", "EMP-2", "EMP-10"]);
  });

  it("Sectores: relación con la unidad de negocio; los anteriores llevan la marca y quedan sin padre al final", async () => {
    await renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Sectores" }));
    await screen.findByText("SEC-1");
    await userEvent.click(screen.getByRole("button", { name: "Unidad de negocio" }));
    expect(column(2)).toEqual(["Restaurantes", "Restaurantes", "-"]);
    const legacyRow = screen.getByText("SEC-90").closest("tr") as HTMLElement;
    expect(within(legacyRow).getByText("Pendiente de recarga")).toBeInTheDocument();
  });
});

describe("OrgStructurePage — eliminación segura (árbol y tabla)", () => {
  it("árbol: Eliminar pide confirmación explícita; cancelar no elimina", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    await renderTree();
    const detail = await select(/^Empresa Cedro/, "Cedro");
    await userEvent.click(within(detail).getByRole("button", { name: "Eliminar" }));
    expect(confirmAction).toHaveBeenCalledWith(
      "Esta acción elimina el registro de forma permanente y no se puede deshacer. Si sólo ya no debe utilizarse, inactivalo.",
      expect.objectContaining({ title: "¿Eliminar definitivamente “Cedro”?", confirmLabel: "Eliminar definitivamente", tone: "danger" }),
    );
    expect(api.deleteEntity).not.toHaveBeenCalled();
  });

  it("árbol: confirmar llama al endpoint, cierra el panel, saca el nodo y avisa", async () => {
    await renderTree();
    const detail = await select(/^Empresa beta/, "beta");
    await userEvent.click(within(detail).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(api.deleteEntity).toHaveBeenCalledWith("COMPANY", "1"));
    expect(await screen.findByText("Empresa eliminada correctamente.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /^Empresa beta/ })).toBeNull());
    expect(screen.getByText("Seleccioná un elemento")).toBeInTheDocument();
  });

  it("con dependencias no se elimina; el motivo lo muestra el aviso global (sin duplicarlo)", async () => {
    api.deleteEntity.mockRejectedValue(new ApiError("No se puede eliminar la empresa “Cedro” porque tiene elementos asociados: 1 unidad de negocio. Podés inactivarla si ya no debe utilizarse.", "ORG_STRUCTURE_HAS_DEPENDENCIES", 409));
    await renderTree();
    const detail = await select(/^Empresa Cedro/, "Cedro");
    await userEvent.click(within(detail).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(api.deleteEntity).toHaveBeenCalled());
    expect(treeItem(/^Empresa Cedro/)).toBeInTheDocument();
    expect(screen.queryByText(/No se puede eliminar/)).toBeNull();
  });

  it("un error no cubierto por el aviso global (p. ej. 404) se muestra en la página", async () => {
    api.deleteEntity.mockRejectedValue(new ApiError("No encontramos el registro solicitado.", "RECORD_NOT_FOUND", 404));
    await renderTree();
    const detail = await select(/^Empresa Cedro/, "Cedro");
    await userEvent.click(within(detail).getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("No encontramos el registro solicitado.")).toBeInTheDocument();
  });

  it("Inactivar confirma y persiste el cambio de estado", async () => {
    await renderTree();
    const detail = await select(/^Empresa beta/, "beta");
    await userEvent.click(within(detail).getByRole("button", { name: "Inactivar" }));
    await waitFor(() => expect(api.updateCompany).toHaveBeenCalledWith(expect.objectContaining({ id: "1", status: "INACTIVO" })));
  });
});
