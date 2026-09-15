import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EmployeeCreatePage } from "./EmployeeCreatePage";
import type { User } from "../types";

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
