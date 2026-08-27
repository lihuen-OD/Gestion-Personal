import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { userApiService } from "../services/api/userApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import type { User } from "../types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAsRrhh() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/userApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/userApiService")>();
  return { ...actual, userApiService: { ...actual.userApiService, getAll: vi.fn(), create: vi.fn(), update: vi.fn(), resetPassword: vi.fn() } };
});

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn() } };
});

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Ana Gomez",
    email: "ana@test.com",
    password: "",
    role: "Nivel 1 - RRHH",
    status: "Activo",
    ...overrides,
  };
}

const emptyCatalog = { companies: [{ id: "c1", name: "Odwyer" }], establishments: [], businessUnits: [], areas: [], sectors: [{ id: "s1", name: "Ventas" }], costCenters: [] };

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(emptyCatalog as never);
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 1000, hasMore: false } });
});

describe("UsersPage — Etapa 9E (catálogo diferido al abrir el modal)", () => {
  it("la carga inicial sólo pide la lista de usuarios — no el catálogo de organización ni las opciones de empleados", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([buildUser()]);

    renderPage();

    await screen.findByText("Ana Gomez");
    expect(userApiService.getAll).toHaveBeenCalledTimes(1);
    expect(orgStructureApiService.getCatalog).not.toHaveBeenCalled();
    expect(employeeApiService.getOptions).not.toHaveBeenCalled();
  });

  it("al abrir 'Crear usuario' recién ahí se piden el catálogo y las opciones de empleados", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(userApiService.getAll).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => {
      expect(orgStructureApiService.getCatalog).toHaveBeenCalledTimes(1);
      expect(employeeApiService.getOptions).toHaveBeenCalledWith({ take: 1000 });
    });
  });

  it("al abrir 'Editar usuario' también se difieren y se piden recién ahí", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([buildUser()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ana Gomez");
    expect(orgStructureApiService.getCatalog).not.toHaveBeenCalled();

    await user.click(screen.getByTitle("Editar usuario"));

    await waitFor(() => expect(orgStructureApiService.getCatalog).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Editar usuario" })).toBeInTheDocument();
  });

  it("mientras el catálogo carga, los selects dependientes quedan deshabilitados y se habilitan al terminar", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([]);
    let resolveCatalog!: (value: typeof emptyCatalog) => void;
    vi.mocked(orgStructureApiService.getCatalog).mockReturnValue(new Promise((resolve) => { resolveCatalog = resolve; }) as never);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(userApiService.getAll).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(screen.getByLabelText("Empresa / alcance")).toBeDisabled();
    resolveCatalog(emptyCatalog);
    await waitFor(() => expect(screen.getByLabelText("Empresa / alcance")).not.toBeDisabled());
  });

  it("crear un usuario sigue funcionando (acción existente intacta)", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValueOnce([]).mockResolvedValueOnce([buildUser({ name: "Nuevo Usuario" })]);
    vi.mocked(userApiService.create).mockResolvedValue(buildUser({ id: "user-2", name: "Nuevo Usuario" }));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(userApiService.getAll).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    await user.type(screen.getByLabelText("Nombre y apellido *"), "Nuevo Usuario");
    await user.type(screen.getByLabelText("Email de acceso *"), "nuevo@test.com");
    await user.type(screen.getByLabelText("Contrasena inicial *"), "password123");
    await user.click(screen.getByRole("button", { name: "Guardar usuario" }));

    await waitFor(() => expect(userApiService.create).toHaveBeenCalled());
    await screen.findByText("Nuevo Usuario");
  });

  it("empty state: sin usuarios configurados, muestra el mensaje correspondiente", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([]);
    renderPage();

    await screen.findByText("Todavía no hay usuarios configurados.");
  });
});
