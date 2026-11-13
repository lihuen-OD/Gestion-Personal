import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EmployeeCreatePage } from "./EmployeeCreatePage";
import { employeeApiService } from "../services/api/employeeApiService";
import type { Employee, User } from "../types";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", role: "Nivel 1 - RRHH", status: "Activo" } as User }),
}));

vi.mock("../services/api/employeeApiService", () => ({
  employeeApiService: { getOptions: vi.fn().mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } }), create: vi.fn() },
}));

vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: { getCatalog: vi.fn().mockResolvedValue({ companies: [], businessUnits: [], establishments: [], areas: [], sectors: [], costCenters: [] }) },
}));

vi.mock("../services/api/salaryCategoryApiService", () => ({
  salaryCategoryApiService: { getGroups: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../services/api/hourConceptApiService", () => ({
  hourConceptApiService: { getAll: vi.fn().mockResolvedValue([]) },
}));

// El alta de legajo (tab "Responsables / Asignaciones") tenía el mismo select
// redundante "Rol" que el modal de edición — se eliminó ahí también, sin
// mostrar ninguna nota de rol (misma decisión final que en EmployeeDetailBlocks).
describe("EmployeeCreatePage — alta de legajo sin selector de Rol en Responsables / Asignaciones", () => {
  it("la sección de Responsable de carga horaria no muestra ningún selector ni nota de Rol", async () => {
    render(
      <MemoryRouter>
        <EmployeeCreatePage />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Responsables \/ Asignaciones/ }));

    expect(await screen.findByText("Responsables de carga horaria")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rol")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /rol/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Nivel \d/)).not.toBeInTheDocument();
  });
});

// Alta mínima: sólo Legajo Interno, DNI, Nombre y Apellido son obligatorios.
// El resto se completa después; el alta no inventa fecha, motivo, nacionalidad
// ni domicilio.
describe("EmployeeCreatePage — alta mínima de legajo", () => {
  const create = vi.mocked(employeeApiService.create);

  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "emp-new" } as Employee);
  });

  function renderPage() {
    render(
      <MemoryRouter>
        <EmployeeCreatePage />
      </MemoryRouter>,
    );
  }

  async function fillMinimal() {
    await userEvent.type(screen.getByLabelText("Legajo Interno *"), "0001");
    await userEvent.type(screen.getByLabelText("DNI *"), "12345678");
    await userEvent.type(screen.getByLabelText("Nombre *"), "Juan");
    await userEvent.type(screen.getByLabelText("Apellido *"), "Perez");
  }

  it("marca como obligatorios sólo Legajo Interno, DNI, Apellido y Nombre", async () => {
    renderPage();
    for (const label of ["Legajo Interno *", "DNI *", "Apellido *", "Nombre *"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    for (const label of ["CUIL", "Fecha de nacimiento", "Sexo", "Nacionalidad"]) expect(screen.getByLabelText(label)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Datos Laborales/ }));
    for (const label of ["Centro de costo", "Fecha desde / Fecha de alta", "Motivo de alta"]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByText("Empresa empleadora")).toBeInTheDocument();
    expect(screen.queryByText(/\*$/, { selector: "small" })).not.toBeInTheDocument();
  });

  it("sin los cuatro datos obligatorios no guarda y lo explica", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Legajo Interno *"), "0001");
    await userEvent.click(screen.getByRole("button", { name: "Guardar nuevo legajo" }));

    expect(await screen.findByText("Completá Legajo, DNI, Nombre y Apellido.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("guarda con sólo Legajo, DNI, Nombre y Apellido: ACTIVO, sin movimiento laboral, sin nacionalidad ni domicilio inventados", async () => {
    renderPage();
    await fillMinimal();
    await userEvent.click(screen.getByRole("button", { name: "Guardar nuevo legajo" }));

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]![0];
    expect(sent).toMatchObject({ legajoInterno: "0001", dni: "12345678", firstName: "Juan", lastName: "Perez", status: "Activo", laborMovements: [], startDate: "" });
    expect(sent).toMatchObject({ cuil: "", birthDate: "", gender: "", nationality: "", company: "", companies: [], costCenter: "", positionId: "" });
    expect(sent.addressNumber).toBe("");
    expect(sent.domicilio?.numero).toBe("");
  });

  it("con fecha de alta, crea el movimiento ALTA con el motivo elegido; si se quita el motivo, lo pide", async () => {
    renderPage();
    await fillMinimal();
    await userEvent.click(screen.getByRole("button", { name: /Datos Laborales/ }));
    await userEvent.type(screen.getByLabelText("Fecha desde / Fecha de alta"), "2026-11-01");
    await userEvent.selectOptions(screen.getByLabelText("Motivo de alta"), "");
    await userEvent.click(screen.getByRole("button", { name: "Guardar nuevo legajo" }));

    expect(await screen.findByText("Si cargás la fecha de alta, elegí el motivo de alta.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Motivo de alta"), "Reingreso");
    await userEvent.click(screen.getByRole("button", { name: "Guardar nuevo legajo" }));

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]![0];
    expect(sent.startDate).toBe("2026-11-01");
    expect(sent.laborMovements).toEqual([expect.objectContaining({ type: "ALTA", effectiveFrom: "2026-11-01", reason: "Reingreso" })]);
  });
});
