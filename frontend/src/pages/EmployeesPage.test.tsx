import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { EmployeesPage } from "./EmployeesPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { Employee } from "../types";

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

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return {
    ...actual,
    employeeApiService: {
      ...actual.employeeApiService,
      list: vi.fn(),
      peekList: vi.fn(() => undefined),
      getSummary: vi.fn().mockResolvedValue({ total: 0, active: 0, inactive: 0, missingTimeResponsible: 0, pendingTimeLoads: 0 }),
      syncLaborStatuses: vi.fn(),
    },
  };
});

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return {
    ...actual,
    orgStructureApiService: {
      ...actual.orgStructureApiService,
      getCatalog: vi.fn().mockResolvedValue({ companies: [], sectors: [], costCenters: [] }),
    },
  };
});

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Prueba",
    firstName: "Ana",
    dni: "12345678",
    cuil: "20-12345678-9",
    birthDate: "",
    gender: "",
    civilStatus: "",
    nationality: "Argentina",
    phone: "",
    mobile: "",
    email: "",
    address: "",
    addressStreet: "",
    addressNumber: "",
    city: "",
    department: "",
    province: "",
    zip: "",
    domicilio: {
      calle: "",
      numero: "",
      provinciaId: "",
      provinciaNombre: "",
      departamentoId: "",
      departamentoNombre: "",
      localidadId: "",
      localidadNombre: "",
      codigoPostal: "",
      ubicacionMapa: { lat: null, lng: null, source: "API", label: "" },
    },
    emergencyContact: "",
    emergencyRelation: "",
    emergencyPhone: "",
    company: "",
    businessUnit: "",
    establishment: "",
    costCenter: "Costos Centrales",
    sector: "",
    position: "",
    receiptCategory: "",
    internalCategory: "",
    agreement: "",
    healthInsurance: "",
    directManager: "",
    timeResponsible: "",
    startDate: "",
    transport: false,
    transportRoute: "",
    transportNotes: "",
    enabledHours: [],
    status: "Activo",
    directManagerFrom: "",
    directManagerStatus: "",
    directManagerNotes: "",
    timeResponsibleRole: "",
    timeResponsibleFrom: "",
    timeResponsibleStatus: "",
    timeResponsibleNotes: "",
    mapLocation: "",
    locationMap: { lat: null, lng: null, source: "API", label: "" },
    novelties: [],
    documents: [],
    historyEvents: [],
    audit: [],
    routeHistory: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EmployeesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ companies: [], sectors: [], costCenters: [] } as never);
  vi.mocked(employeeApiService.getSummary).mockResolvedValue({ total: 0, active: 0, inactive: 0, missingTimeResponsible: 0, pendingTimeLoads: 0 });
  vi.mocked(employeeApiService.peekList).mockReturnValue(undefined);
  // Respuesta por defecto para cualquier llamada a list() no configurada
  // explícitamente en el test (p. ej. la precarga silenciosa de la página
  // siguiente, que este archivo no siempre necesita controlar a mano).
  vi.mocked(employeeApiService.list).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
});

// Etapa 14C.3: la paginación de Legajos ya no debía blanquear la tabla al
// pasar de página (esto ya funcionaba, ver EmployeesPage.tsx: `if
// (!all.length) setListStatus("loading")`) — este test lo confirma
// explícitamente porque ahora es una regla verificada, no un efecto
// secundario. Además confirma la precarga silenciosa agregada en esta etapa.
describe("EmployeesPage — paginación (Etapa 14C.3)", () => {
  it("al pasar a la página siguiente con legajos ya cargados, no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(employeeApiService.list).mockResolvedValueOnce({
      items: [buildEmployee({ id: "employee-1", legajo: "100", lastName: "Gomez", firstName: "Ana" })],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez");

    // La precarga silenciosa de la página 2 ya consumió el mock de una sola
    // respuesta (mockResolvedValueOnce); a partir de acá, cualquier llamada a
    // list() (la precarga o el click real) queda pendiente hasta resolverla
    // a mano — así se puede confirmar que la fila anterior sigue visible
    // mientras la respuesta real todavía no llegó.
    let resolveNextPage!: (value: { items: Employee[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(employeeApiService.list).mockImplementation(
      () => new Promise((resolve) => { resolveNextPage = resolve; }),
    );

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Gomez")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPage({
      items: [buildEmployee({ id: "employee-2", legajo: "101", lastName: "Perez", firstName: "Luis" })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });

    await waitFor(() => expect(screen.getByText("Perez")).toBeInTheDocument());
    expect(screen.queryByText("Gomez")).not.toBeInTheDocument();
  });

  it("precarga en segundo plano la página siguiente apenas la página actual carga con hasMore=true", async () => {
    vi.mocked(employeeApiService.list).mockResolvedValue({
      items: [buildEmployee()],
      meta: { total: 60, page: 1, pageSize: 25, hasMore: true },
    });

    renderPage();
    await screen.findByText("Prueba");

    await waitFor(() => {
      const prefetchCall = vi.mocked(employeeApiService.list).mock.calls.find(([filters]) => filters?.page === 2);
      expect(prefetchCall).toBeDefined();
    });
  });

  it("no precarga la página siguiente cuando hasMore es false (última página)", async () => {
    vi.mocked(employeeApiService.list).mockResolvedValue({
      items: [buildEmployee()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });

    renderPage();
    await screen.findByText("Prueba");

    const pageTwoCall = vi.mocked(employeeApiService.list).mock.calls.find(([filters]) => filters?.page === 2);
    expect(pageTwoCall).toBeUndefined();
  });
});

// Orden server-side: el header no ordena la página visible — cambia
// sortBy/sortOrder del request y vuelve a la página 1; el backend ordena el
// dataset filtrado completo antes de paginar.
describe("EmployeesPage — orden server-side", () => {
  function mockPagedList() {
    vi.mocked(employeeApiService.list).mockImplementation(async (filters = {}) => ({
      items: [buildEmployee({ id: `employee-p${filters.page}`, lastName: `Pagina${filters.page}` })],
      meta: { total: 60, page: filters.page || 1, pageSize: 25, hasMore: (filters.page || 1) < 3 },
    }));
  }
  const expectListCall = (filters: Record<string, unknown>) => expect(vi.mocked(employeeApiService.list)).toHaveBeenCalledWith(expect.objectContaining(filters));
  const header = (name: string) => screen.getByRole("columnheader", { name });

  it("click en Apellido pide sortBy/sortOrder al backend (ASC, luego DESC) y actualiza aria-sort", async () => {
    mockPagedList();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Pagina1");
    expect(header("Apellido")).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: "Apellido" }));
    await waitFor(() => expectListCall({ page: 1, sort: { key: "lastName", direction: "asc" } }));
    expect(header("Apellido")).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: "Apellido" }));
    await waitFor(() => expectListCall({ page: 1, sort: { key: "lastName", direction: "desc" } }));
    expect(header("Apellido")).toHaveAttribute("aria-sort", "descending");
  });

  it("cambiar el orden estando en la página 2 vuelve a la página 1; paginar después conserva el orden", async () => {
    mockPagedList();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Pagina1");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Pagina2");

    await user.click(screen.getByRole("button", { name: "Legajo" }));
    await screen.findByText("Pagina1");
    expectListCall({ page: 1, sort: { key: "legajo", direction: "asc" } });
    expect(screen.getByText(/Página 1 de 3/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Pagina2");
    expect(vi.mocked(employeeApiService.list)).toHaveBeenCalledWith(expect.objectContaining({ page: 2, sort: { key: "legajo", direction: "asc" } }));
  });

  it("buscar vuelve a la página 1 y mantiene el orden elegido", async () => {
    mockPagedList();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Pagina1");
    await user.click(screen.getByRole("button", { name: "Estado" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Pagina2");

    await user.type(screen.getByPlaceholderText(/Buscar/i), "gomez");

    await waitFor(() => expect(vi.mocked(employeeApiService.list)).toHaveBeenCalledWith(expect.objectContaining({ page: 1, search: "gomez", sort: { key: "status", direction: "asc" } })));
  });

  it("Accion y Centro de costo no son ordenables", async () => {
    mockPagedList();
    renderPage();
    await screen.findByText("Pagina1");
    for (const name of ["Accion", "Centro de costo"]) {
      expect(header(name)).not.toHaveAttribute("aria-sort");
      expect(header(name).querySelector("button")).toBeNull();
    }
  });
});
