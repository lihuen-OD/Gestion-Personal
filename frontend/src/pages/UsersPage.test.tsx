import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { userApiService } from "../services/api/userApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import type { Employee, User } from "../types";
import { ApiError } from "../services/api/apiClient";

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
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getAllOptions: vi.fn() } };
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
  vi.mocked(employeeApiService.getAllOptions).mockResolvedValue([]);
});

describe("UsersPage — Etapa 9E (catálogo diferido al abrir el modal)", () => {
  it("la carga inicial sólo pide la lista de usuarios — no el catálogo de organización ni las opciones de empleados", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([buildUser()]);

    renderPage();

    await screen.findByText("Ana Gomez");
    expect(userApiService.getAll).toHaveBeenCalledTimes(1);
    expect(orgStructureApiService.getCatalog).not.toHaveBeenCalled();
    expect(employeeApiService.getAllOptions).not.toHaveBeenCalled();
  });

  it("al abrir 'Crear usuario' recién ahí se piden el catálogo y las opciones de empleados", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(userApiService.getAll).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => {
      expect(orgStructureApiService.getCatalog).toHaveBeenCalledTimes(1);
      expect(employeeApiService.getAllOptions).toHaveBeenCalledTimes(1);
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

    expect(screen.getByLabelText("Empresa administrativa")).toBeDisabled();
    resolveCatalog(emptyCatalog);
    await waitFor(() => expect(screen.getByLabelText("Empresa administrativa")).not.toBeDisabled());
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

const N2 = "Nivel 2 - Supervisión / Gestión" as const;
const N3 = "Nivel 3 - Administrativo de Carga Horaria" as const;
const cargaPlanta = buildUser({ id: "n3-a", name: "CARGA PLANTA", email: "planta@test.com", role: N3 });
const cargaPanol = buildUser({ id: "n3-b", name: "CARGA PAÑOL", email: "panol@test.com", role: N3 });
const cargaInactiva = buildUser({ id: "n3-c", name: "CARGA VIEJA", email: "vieja@test.com", role: N3, status: "Inactivo" });
const otroEncargado = buildUser({ id: "n2-b", name: "OTRO ENCARGADO", email: "otro@test.com", role: N2 });
const encargado = buildUser({
  id: "n2-a", name: "ENCARGADO PLANTA", email: "jefe@test.com", role: N2,
  supervisedUserIds: ["n3-a"], supervisedUsers: [{ id: "n3-a", name: "CARGA PLANTA", email: "planta@test.com", status: "Activo" }], supervisorUsers: [],
});
const supervisorGroup = () => screen.getByRole("region", { name: "Responsables de carga supervisados" });

async function openEditFor(name: string) {
  const user = userEvent.setup();
  renderPage();
  const row = (await screen.findByText(name)).closest("tr")!;
  await user.click(within(row).getByTitle("Editar usuario"));
  await waitFor(() => expect(employeeApiService.getAllOptions).toHaveBeenCalled());
  return user;
}

describe("UsersPage — responsables de carga supervisados (Nivel 2)", () => {
  beforeEach(() => {
    vi.mocked(userApiService.getAll).mockResolvedValue([buildUser(), encargado, otroEncargado, cargaPlanta, cargaPanol, cargaInactiva]);
    vi.mocked(userApiService.update).mockResolvedValue(encargado);
  });

  it("sólo aparece para Nivel 2 y sólo lista usuarios Nivel 3 activos, con nombre y email", async () => {
    const user = await openEditFor("ENCARGADO PLANTA");
    const options = within(supervisorGroup()).getByRole("group", { name: "Responsables de carga disponibles" });
    expect(within(options).getAllByRole("button").map((button) => button.textContent)).toEqual(["CARGA PAÑOLpanol@test.com", "CARGA PLANTAplanta@test.com"]);
    expect(within(options).queryByText("OTRO ENCARGADO")).not.toBeInTheDocument();
    expect(within(options).queryByText("CARGA VIEJA")).not.toBeInTheDocument();
    expect(screen.getByText(/podrá acceder a los legajos asignados a los responsables de carga seleccionados/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Rol *"), "Nivel 1 - RRHH");
    expect(screen.queryByRole("region", { name: "Responsables de carga supervisados" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Rol *"), N3);
    expect(screen.queryByRole("region", { name: "Responsables de carga supervisados" })).not.toBeInTheDocument();
  });

  it("al editar carga las selecciones actuales; permite agregar varios, quitar uno y guarda la lista completa", async () => {
    const user = await openEditFor("ENCARGADO PLANTA");
    expect(within(supervisorGroup()).getByRole("button", { name: /CARGA PLANTA/, pressed: true })).toBeInTheDocument();

    await user.click(within(supervisorGroup()).getByRole("button", { name: /CARGA PAÑOL/ }));
    expect(screen.getByText("2 responsables seleccionados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar CARGA PLANTA" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(userApiService.update).toHaveBeenCalledWith(expect.objectContaining({ id: "n2-a", supervisedUserIds: ["n3-b"] })));
  });

  it("permite dejarlo sin responsables y filtra por nombre o email", async () => {
    const user = await openEditFor("ENCARGADO PLANTA");
    await user.type(within(supervisorGroup()).getByLabelText("Buscar responsable de carga"), "panol@");
    expect(within(supervisorGroup()).getAllByRole("button", { name: /CARGA/ }).filter((button) => button.getAttribute("aria-pressed") !== null)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Quitar todos" }));
    expect(screen.getByText("Sin responsables de carga supervisados.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(userApiService.update).toHaveBeenCalledWith(expect.objectContaining({ supervisedUserIds: [] })));
  });

  it("avisa que al cambiar de rol deja de supervisar a sus responsables", async () => {
    const user = await openEditFor("ENCARGADO PLANTA");
    await user.selectOptions(screen.getByLabelText("Rol *"), N3);
    const note = screen.getByText("Al guardar, dejará de supervisar responsables de carga").closest("[role='note']") as HTMLElement;
    expect(note).toHaveTextContent("CARGA PLANTA");
  });

  it("avisa que un Nivel 3 supervisado que cambia de rol deja sin ese alcance a su Nivel 2", async () => {
    vi.mocked(userApiService.getAll).mockResolvedValue([encargado, { ...cargaPlanta, supervisorUsers: [{ id: "n2-a", name: "ENCARGADO PLANTA", email: "jefe@test.com", status: "Activo" }] }]);
    const user = await openEditFor("CARGA PLANTA");
    await user.selectOptions(screen.getByLabelText("Rol *"), "Nivel 1 - RRHH");
    expect(screen.getByText("Al guardar, dejará de ser responsable de carga supervisado")).toBeInTheDocument();
  });
});

describe("UsersPage — empleado vinculado y errores de guardado", () => {
  const employees = [
    { id: "emp-1", firstName: "Juan", lastName: "Pérez", legajo: "100" },
    { id: "emp-2", firstName: "Ana", lastName: "Gómez", legajo: "200" },
  ] as Employee[];

  beforeEach(() => {
    vi.mocked(employeeApiService.getAllOptions).mockResolvedValue(employees);
    vi.mocked(userApiService.getAll).mockResolvedValue([
      buildUser({ id: "u-1", name: "Cuenta Juan", email: "juan@test.com", employeeId: "emp-1", employeeName: "Juan Pérez" }),
      buildUser({ id: "u-2", name: "Cuenta Ana", email: "ana2@test.com", employeeId: "emp-2", employeeName: "Ana Gómez" }),
    ]);
  });

  it("un empleado vinculado a otra cuenta no es seleccionable y lo dice; el propio sigue disponible", async () => {
    await openEditFor("Cuenta Juan");
    await waitFor(() => expect(screen.getByRole("option", { name: /Pérez, Juan/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Pérez, Juan/ })).not.toBeDisabled();
    const taken = screen.getByRole("option", { name: /Gómez, Ana/ });
    expect(taken).toBeDisabled();
    expect(taken).toHaveTextContent("ya vinculado a Cuenta Ana");
  });

  it("muestra el error concreto del backend (409) en vez del genérico", async () => {
    vi.mocked(userApiService.update).mockRejectedValue(new ApiError("Este empleado ya está vinculado a otro usuario.", "EMPLOYEE_ALREADY_LINKED_TO_USER", 409));
    const user = await openEditFor("Cuenta Juan");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Este empleado ya está vinculado a otro usuario.")).toBeInTheDocument();
    expect(screen.queryByText(/Revisa email, contrasena y alcance/)).not.toBeInTheDocument();
  });

  it("editar sin contraseña guarda sin resetearla", async () => {
    vi.mocked(userApiService.update).mockResolvedValue(buildUser());
    const user = await openEditFor("Cuenta Juan");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(userApiService.update).toHaveBeenCalled());
    expect(userApiService.resetPassword).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Editar usuario" })).not.toBeInTheDocument());
  });

  it("si los datos se guardan pero falla el cambio de contraseña, lo informa sin cerrar el modal", async () => {
    vi.mocked(userApiService.update).mockResolvedValue(buildUser());
    vi.mocked(userApiService.resetPassword).mockRejectedValue(new ApiError("No pudimos completar la operación. Intentá nuevamente.", "INTERNAL_ERROR", 500));
    const user = await openEditFor("Cuenta Juan");
    await user.type(screen.getByLabelText("Nueva contrasena (opcional)"), "clave-nueva-1");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Los datos del usuario se guardaron, pero no se pudo cambiar la contraseña/)).toBeInTheDocument();
  });
});
