import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { Employee } from "../../types";
import { EmployeeRemoteSelector } from "./EmployeeRemoteSelector";

// Etapa — selector de empleados paginado: antes `take: 20` fijo limitaba
// permanentemente el modal "Asignar empleados a este turno" (y todo otro
// consumidor de EmployeeRemoteSelector) a los primeros 20 resultados, sin
// forma de acceder al resto. Estos tests cubren la paginación progresiva
// ("Cargar más"), preservando selección/excludeIds entre páginas y sin
// mezclar resultados de búsquedas/filtros distintos.
vi.mock("../../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn() } };
});

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "1",
    legajoInterno: "1",
    lastName: "Uno",
    firstName: "Empleado",
    dni: "30111222",
    cuil: "20-30111222-3",
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
    company: "Odwyer",
    businessUnit: "",
    establishment: "",
    costCenter: "",
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
    ...overrides,
  } as Employee;
}

const PAGE1 = [buildEmployee({ id: "employee-1", firstName: "Uno", lastName: "Empleado" })];
const PAGE2 = [buildEmployee({ id: "employee-2", firstName: "Dos", lastName: "Empleado" })];

function metaFor(page: number, hasMore: boolean, total = 45) {
  return { total, page, pageSize: 20, hasMore };
}

function Harness({ excludeIds }: { excludeIds?: Set<string> }) {
  const [selected, setSelected] = useState<Employee[]>([]);
  return <EmployeeRemoteSelector selected={selected} multiple showStatusFilter excludeIds={excludeIds} onChange={setSelected} />;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmployeeRemoteSelector — paginación progresiva", () => {
  it("A) primera carga pide page 1", async () => {
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: PAGE1, meta: metaFor(1, false) });

    render(<Harness />);

    await screen.findByText(/Empleado, Uno/);
    expect(employeeApiService.getOptions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, take: 20 }));
  });

  it("B) hasMore=true muestra 'Cargar más empleados'", async () => {
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: PAGE1, meta: metaFor(1, true) });

    render(<Harness />);

    expect(await screen.findByRole("button", { name: "Cargar más empleados" })).toBeInTheDocument();
  });

  it("H) hasMore=false NO muestra 'Cargar más empleados'", async () => {
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: PAGE1, meta: metaFor(1, false) });

    render(<Harness />);

    await screen.findByText(/Empleado, Uno/);
    expect(screen.queryByRole("button", { name: "Cargar más empleados" })).not.toBeInTheDocument();
  });

  it("C) y D) click en 'Cargar más' pide page 2 y CONCATENA (no reemplaza) los resultados de page 1", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.page === 2) return { items: PAGE2, meta: metaFor(2, false) };
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness />);
    await screen.findByText(/Empleado, Uno/);

    await user.click(screen.getByRole("button", { name: "Cargar más empleados" }));

    expect(await screen.findByText(/Empleado, Dos/)).toBeInTheDocument();
    expect(screen.getByText(/Empleado, Uno/)).toBeInTheDocument();
    expect(employeeApiService.getOptions).toHaveBeenCalledWith(expect.objectContaining({ page: 2, take: 20 }));
    // page 2 sin hasMore: el botón desaparece tras cargarla.
    expect(screen.queryByRole("button", { name: "Cargar más empleados" })).not.toBeInTheDocument();
  });

  it("E) la selección de page 1 se mantiene después de cargar page 2", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.page === 2) return { items: PAGE2, meta: metaFor(2, false) };
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness />);
    await screen.findByText(/Empleado, Uno/);
    await user.click(screen.getByRole("button", { name: /Empleado, Uno/ }));
    expect(await screen.findByText("1 empleado seleccionado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cargar más empleados" }));
    await screen.findByText(/Empleado, Dos/);

    expect(screen.getByText("1 empleado seleccionado")).toBeInTheDocument();
    const resultsList = within(document.querySelector(".people-search-results") as HTMLElement);
    expect(resultsList.getByRole("button", { name: /Empleado, Uno/ })).toHaveClass("is-selected");
  });

  it("F) cambiar la búsqueda resetea a page 1 y reemplaza los resultados (no mezcla con la búsqueda anterior)", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.search?.trim() === "Sereno") return { items: [buildEmployee({ id: "employee-sereno", firstName: "Sereno", lastName: "Nocturno" })], meta: metaFor(1, false) };
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness />);
    await screen.findByText(/Empleado, Uno/);

    await user.type(screen.getByPlaceholderText("Buscar por nombre, apellido, DNI, CUIL o legajo"), "Sereno");

    await waitFor(() => expect(screen.getByText(/Nocturno, Sereno/)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.queryByText(/Empleado, Uno/)).not.toBeInTheDocument();
    expect(employeeApiService.getOptions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: "Sereno" }));
  });

  it("G) cambiar el filtro de Estado resetea a page 1 y reemplaza los resultados", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.status === "INACTIVO") return { items: [buildEmployee({ id: "employee-inactivo", firstName: "Ex", lastName: "Empleado", status: "Inactivo" })], meta: metaFor(1, false) };
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness />);
    await screen.findByText(/Empleado, Uno/);

    await user.selectOptions(screen.getByLabelText("Estado"), "INACTIVO");

    expect(await screen.findByText(/Empleado, Ex/)).toBeInTheDocument();
    expect(screen.queryByText(/Empleado, Uno/)).not.toBeInTheDocument();
    expect(employeeApiService.getOptions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: "INACTIVO" }));
  });

  it("I) si page 2 falla, page 1 permanece visible y se muestra un error local con Reintentar", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.page === 2) {
        callCount += 1;
        if (callCount === 1) throw new Error("network down");
        return { items: PAGE2, meta: metaFor(2, false) };
      }
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness />);
    await screen.findByText(/Empleado, Uno/);

    await user.click(screen.getByRole("button", { name: "Cargar más empleados" }));

    expect(await screen.findByText("No pudimos cargar más empleados.")).toBeInTheDocument();
    expect(screen.getByText(/Empleado, Uno/)).toBeInTheDocument(); // page 1 sigue ahí

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText(/Empleado, Dos/)).toBeInTheDocument();
    expect(screen.getByText(/Empleado, Uno/)).toBeInTheDocument();
  });

  it("J) excludeIds oculta empleados también en páginas cargadas después de 'Cargar más'", async () => {
    const user = userEvent.setup();
    vi.mocked(employeeApiService.getOptions).mockImplementation(async (filters) => {
      if (filters?.page === 2) return { items: PAGE2, meta: metaFor(2, false) };
      return { items: PAGE1, meta: metaFor(1, true) };
    });

    render(<Harness excludeIds={new Set(["employee-2"])} />);
    await screen.findByText(/Empleado, Uno/);

    await user.click(screen.getByRole("button", { name: "Cargar más empleados" }));
    await waitFor(() => expect(employeeApiService.getOptions).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));

    expect(screen.queryByText(/Empleado, Dos/)).not.toBeInTheDocument();
  });
});
