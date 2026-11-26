import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ShiftCreatePage } from "./ShiftCreatePage";
import { shiftGroupApiService } from "../services/api/shiftGroupApiService";
import { workforceApiService } from "../services/api/workforceApiService";
import { OFICINA_GROUP, PLANTA_GROUP } from "../test/shiftRotationFixtures";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("../services/api/shiftGroupApiService", () => ({ shiftGroupApiService: { list: vi.fn() } }));
vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, createShiftTemplate: vi.fn() } };
});

function authAs(role: string, groupIds: string[] = []) {
  mockUseAuth.mockReturnValue({ user: { id: "u1", name: "Usuario", email: "u@test.com", password: "", role, status: "Activo", shiftGroupAccess: { all: false, groupIds } }, refreshShiftGroupAccess: vi.fn() });
}

const renderPage = () => render(
  <MemoryRouter initialEntries={["/configuracion/turnos/nuevo"]}>
    <Routes>
      <Route path="/configuracion/turnos/nuevo" element={<ShiftCreatePage />} />
      <Route path="/configuracion/turnos" element={<p>Listado de turnos</p>} />
      <Route path="/configuracion/turnos/:id" element={<p>Detalle creado</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shiftGroupApiService.list).mockResolvedValue([PLANTA_GROUP, OFICINA_GROUP]);
  vi.mocked(workforceApiService.createShiftTemplate).mockResolvedValue({ id: "t-new" } as never);
});

describe("Crear turno — alcance por grupo (R8)", () => {
  it("RRHH puede dejarlo «Sin grupo»", async () => {
    authAs("Nivel 1 - RRHH");
    renderPage();
    const select = await screen.findByLabelText("Grupo (lugar)");
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
    expect(within(select).getByRole("option", { name: "Sin grupo" })).toBeInTheDocument();
  });

  it("Nivel 2: sin «Sin grupo», preselecciona su grupo y lo envía", async () => {
    authAs("Nivel 2 - Supervisión / Gestión", [PLANTA_GROUP.id]);
    vi.mocked(shiftGroupApiService.list).mockResolvedValue([PLANTA_GROUP]);
    const user = userEvent.setup();
    renderPage();
    const select = await screen.findByLabelText("Grupo (lugar)");
    await waitFor(() => expect(select).toHaveValue(PLANTA_GROUP.id));
    expect(within(select).queryByRole("option", { name: "Sin grupo" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Código"), "PL-NUEVO");
    await user.type(screen.getByLabelText("Nombre"), "Planta nuevo");
    await user.click(screen.getByRole("button", { name: "Guardar turno" }));
    await waitFor(() => expect(workforceApiService.createShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ shiftGroupId: PLANTA_GROUP.id })));
  });

  it("Nivel 3 sin grupos vuelve al listado (no puede crear)", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    renderPage();
    expect(await screen.findByText("Listado de turnos")).toBeInTheDocument();
  });
});
