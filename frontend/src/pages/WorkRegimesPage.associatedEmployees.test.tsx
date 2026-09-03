import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WorkRegimesPage } from "./WorkRegimesPage";
import { workRegimeApiService } from "../services/api/workRegimeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { employeeApiService } from "../services/api/employeeApiService";
import { confirmAction } from "../services/appDialog";
import type { EmployeeWorkRegimeAssignment, WorkRegime } from "../types/workRegime.types";
import type { WorkRegimeEmployeeAssociation } from "../types/associatedEmployee.types";
import type { Employee } from "../types";

// Etapa 13J — el modal "Empleados asociados" de Régimen Laboral: 1) por
// defecto sólo debe mostrar vigentes (el bug reportado: empleados con
// vigencia vencida apareciendo como "asociados" sin aviso), 2) debe poder
// agregar/finalizar asignaciones reusando los mismos endpoints que usa el
// Legajo (fuente de verdad única), sin decir "Eliminar" cuando en realidad
// se conserva historial.
//
// Etapa 13J.1 — pulido de UX: 3) "Agregar empleados" ya no abre un segundo
// <Modal> encimado — el mismo panel cambia a una vista interna (addMode=
// "inline"), 4) copy profesional (sin mayúsculas gritadas, "Finalizar
// vigencia" en vez de un botón rojo sin contexto), 5) CUIL/Estado ya no son
// columnas de esta tabla (demasiadas columnas angostas cortaban texto).

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

vi.mock("../services/api/workRegimeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workRegimeApiService")>();
  return {
    ...actual,
    workRegimeApiService: {
      ...actual.workRegimeApiService,
      getAll: vi.fn(),
      getWorkRegimeEmployees: vi.fn(),
      assign: vi.fn(),
      closeAssignment: vi.fn(),
    },
  };
});

vi.mock("../services/api/orgStructureApiService", () => ({
  orgStructureApiService: {
    getCatalog: vi.fn().mockResolvedValue({ sectors: [], costCenters: [], companies: [], businessUnits: [], establishments: [], areas: [] }),
  },
}));

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn() } };
});

vi.mock("../services/appDialog", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

function buildRegime(overrides: Partial<WorkRegime> = {}): WorkRegime {
  return {
    id: "regime-1",
    code: "01",
    name: "Agricultura",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: false,
    openShiftOverflowAction: "ALERT_ONLY",
    extendedShiftAlertMinutes: null,
    description: null,
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildAssociation(overrides: Partial<WorkRegimeEmployeeAssociation> = {}): WorkRegimeEmployeeAssociation {
  return {
    id: "assignment-1",
    employeeId: "employee-1",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    vigencyStatus: "current",
    employee: {
      id: "employee-1",
      legajo: "09",
      cuil: "20-12345678-9",
      firstName: "Granja",
      lastName: "09",
      status: "ACTIVO",
      sector: null,
      costCenter: null,
      companies: [],
    },
    ...overrides,
  };
}

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-2",
    legajo: "11",
    legajoInterno: "11",
    lastName: "Nueva",
    firstName: "Persona",
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

const emptyMeta = { total: 0, page: 1, pageSize: 20, hasMore: false };

// Etapa 13J.3: la tabla (desktop/tablet) y la lista de cards (mobile) se
// renderizan las DOS en el DOM a la vez — CSS decide cuál se ve según el
// ancho (jsdom no evalúa media queries) — así que un texto/botón que
// aparece en ambas vistas (badge, "Finalizar vigencia", etc.) matchea dos
// veces. Estos helpers escopean la query a una de las dos vistas.
function withinTable() {
  return within(document.querySelector(".associated-employees-table-wrap") as HTMLElement);
}
function withinCards() {
  return within(document.querySelector(".associated-employees-cards") as HTMLElement);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkRegimesPage />
    </MemoryRouter>,
  );
}

async function openAssociatedEmployeesModal() {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("Agricultura");
  await user.click(screen.getByRole("button", { name: "Ver empleados asociados" }));
  await screen.findByRole("heading", { name: "Empleados con régimen 01 - Agricultura" });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [buildRegime()], meta: { total: 1, page: 1, pageSize: 200, hasMore: false } });
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [], meta: emptyMeta });
});

describe("WorkRegimesPage — modal Empleados asociados (Etapa 13J / 13J.1 / 13J.2)", () => {
  it("el modal muestra título y subtítulo claros", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    await openAssociatedEmployeesModal();

    expect(screen.getByRole("heading", { name: "Empleados con régimen 01 - Agricultura" })).toBeInTheDocument();
    expect(screen.getByText("Consultá empleados vigentes o históricos asociados a este régimen.")).toBeInTheDocument();
  });

  it("Etapa 13J.2 — 'Agregar empleados' vive en su propia toolbar (no en .form-actions, la barra sticky de guardar/cancelar) y los filtros siguen visibles junto a él", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    await openAssociatedEmployeesModal();

    const addButton = screen.getByRole("button", { name: "Agregar empleados" });
    const toolbar = addButton.closest(".associated-employees-toolbar");
    expect(toolbar).toBeInTheDocument();
    expect(addButton.closest(".form-actions")).not.toBeInTheDocument();

    // Los filtros (búsqueda, sector, centro de costo, empresa, vigencia)
    // siguen visibles junto al botón, no reemplazados ni ocultos.
    expect(screen.getByPlaceholderText("Buscar por legajo, CUIL, apellido o nombre")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filtrar por vigencia" })).toBeInTheDocument();
  });

  it("por defecto pide sólo vigentes (status=current), no mezcla históricas sin avisar", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [buildAssociation()], meta: { ...emptyMeta, total: 1 } });

    await openAssociatedEmployeesModal();

    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalled());
    const [, filters] = vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mock.calls[0];
    expect(filters).toMatchObject({ status: "current" });
    expect(screen.getByRole("combobox", { name: "Filtrar por vigencia" })).toHaveValue("current");
  });

  it("una asignación vigente muestra el badge 'Vigente', nunca junto con una fila histórica en el mismo filtro", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ vigencyStatus: "current" })],
      meta: { ...emptyMeta, total: 1 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    expect(withinTable().getByText("Vigente")).toBeInTheDocument();
    expect(withinTable().queryByText("Histórica")).not.toBeInTheDocument();
  });

  it("cambiar el filtro a Históricos vuelve a pedir con status=historical y muestra el badge 'Histórica'", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees)
      .mockResolvedValueOnce({ items: [], meta: emptyMeta })
      .mockResolvedValueOnce({
        items: [buildAssociation({ id: "assignment-2", effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: "2026-09-01T00:00:00.000Z", vigencyStatus: "historical" })],
        meta: { ...emptyMeta, total: 1 },
      });

    const user = await openAssociatedEmployeesModal();
    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por vigencia" }), "historical");

    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(2));
    const [, filters] = vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mock.calls[1];
    expect(filters).toMatchObject({ status: "historical" });
    await screen.findAllByText("Histórica");
    expect(withinTable().getByText("Histórica")).toBeInTheDocument();
  });

  it("cambiar el filtro a Todos pide status=all", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por vigencia" }), "all");

    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(2));
    const [, filters] = vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mock.calls[1];
    expect(filters).toMatchObject({ status: "all" });
  });

  it("la fila de vigencia muestra 'Desde'/'Hasta' en dos líneas, no un rango compacto", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: null })],
      meta: { ...emptyMeta, total: 1 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Desde 01/09/2026");

    expect(withinTable().getByText("Desde 01/09/2026")).toBeInTheDocument();
    expect(withinTable().getByText("Hasta -")).toBeInTheDocument();
  });

  it("empty state de vigentes: mensaje específico, no un texto genérico de vigencia", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    await openAssociatedEmployeesModal();

    expect(await screen.findByText("No hay empleados vigentes con este régimen.")).toBeInTheDocument();
  });

  it("empty state por filtros de búsqueda: mensaje distinto al de 'sin vigentes'", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await screen.findByText("No hay empleados vigentes con este régimen.");

    await user.type(screen.getByPlaceholderText("Buscar por legajo, CUIL, apellido o nombre"), "zzz");

    expect(await screen.findByText("No encontramos empleados con esos filtros.")).toBeInTheDocument();
  });

  it("error state: si falla la carga, muestra el mensaje de error (no un listado vacío silencioso)", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockRejectedValue(new Error("network"));

    await openAssociatedEmployeesModal();

    expect(await screen.findByText("No pudimos cargar los empleados asociados.")).toBeInTheDocument();
  });

  it("loading state: muestra el skeleton de carga mientras resuelve la promesa", async () => {
    let resolveFetch: (value: { items: WorkRegimeEmployeeAssociation[]; meta: typeof emptyMeta }) => void = () => {};
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const { container } = renderPage();
    await screen.findByText("Agricultura");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ver empleados asociados" }));

    expect(container.querySelector(".loading-table")).toBeInTheDocument();

    resolveFetch({ items: [], meta: emptyMeta });
  });

  it("una fila vigente ofrece 'Finalizar vigencia' (nunca 'Eliminar'/'Quitar'), una histórica no la ofrece", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [
        buildAssociation({ id: "assignment-current", employeeId: "employee-1", vigencyStatus: "current" }),
        buildAssociation({
          id: "assignment-historical",
          employeeId: "employee-3",
          effectiveTo: "2026-09-01T00:00:00.000Z",
          vigencyStatus: "historical",
          employee: { id: "employee-3", legajo: "10", cuil: "20-99999999-9", firstName: "Granja", lastName: "10", status: "ACTIVO", sector: null, costCenter: null, companies: [] },
        }),
      ],
      meta: { ...emptyMeta, total: 2 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");
    await screen.findAllByText("Histórica");

    // Se renderiza una vez en la tabla (desktop/tablet) y una vez en la
    // lista de cards (mobile) — CSS decide cuál se ve, nunca las dos a la
    // vez para el usuario real — pero cada vista, por separado, sólo debe
    // ofrecer la acción en la fila/card vigente.
    expect(withinTable().getAllByRole("button", { name: "Finalizar vigencia" })).toHaveLength(1);
    expect(withinCards().getAllByRole("button", { name: "Finalizar vigencia" })).toHaveLength(1);
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
  });

  it("'Finalizar vigencia' pide confirmación con copy claro (no destructivo) y cierra la vigencia con la fecha de hoy", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees)
      .mockResolvedValueOnce({ items: [buildAssociation({ id: "assignment-current", employeeId: "employee-1", vigencyStatus: "current" })], meta: { ...emptyMeta, total: 1 } })
      .mockResolvedValueOnce({ items: [], meta: emptyMeta });
    vi.mocked(workRegimeApiService.closeAssignment).mockResolvedValue({} as never);

    const user = await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    await user.click(withinTable().getByRole("button", { name: "Finalizar vigencia" }));

    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining("conserva el historial"),
      expect.objectContaining({ title: "Finalizar asignación de régimen", confirmLabel: "Finalizar vigencia" }),
    );

    await vi.waitFor(() => expect(workRegimeApiService.closeAssignment).toHaveBeenCalled());
    const today = new Date().toISOString().slice(0, 10);
    expect(workRegimeApiService.closeAssignment).toHaveBeenCalledWith("employee-1", "assignment-current", today);
    // El mismo listado se vuelve a pedir tras la baja -> el Legajo, que lee
    // del mismo endpoint (GET /employees/:id/work-regimes/current), ve el
    // cambio de inmediato.
    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(2));
  });

  it("'Agregar empleados' cambia la vista dentro del MISMO modal — nunca hay un segundo overlay encimado", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    expect(document.querySelectorAll(".modal-backdrop")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));

    expect(document.querySelectorAll(".modal-backdrop")).toHaveLength(1);
    expect(document.querySelectorAll(".modal")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Agregar empleados al régimen" })).toBeInTheDocument();
    expect(screen.getByText("Seleccioná los empleados que tendrán este régimen desde la fecha indicada.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Empleados con régimen 01 - Agricultura" })).not.toBeInTheDocument();
  });

  it("la vista de agregar muestra el buscador y el filtro de estado", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));

    expect(screen.getByPlaceholderText("Buscar por nombre, apellido, DNI, CUIL o legajo")).toBeInTheDocument();
    expect(document.querySelector(".people-status-filter")).toBeInTheDocument();
  });

  it("muestra el copy de 'hasta 20 resultados' sin mayúsculas gritadas", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));

    const hint = await screen.findByText("Mostramos hasta 20 resultados. Usá el buscador para encontrar más empleados.");
    expect(hint.textContent).not.toBe(hint.textContent!.toUpperCase());
  });

  it("'Volver a empleados asociados' regresa a la lista sin perder el filtro de vigencia", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));
    await screen.findByRole("heading", { name: "Agregar empleados al régimen" });

    await user.click(screen.getByRole("button", { name: "Volver a empleados asociados" }));

    expect(await screen.findByRole("heading", { name: "Empleados con régimen 01 - Agricultura" })).toBeInTheDocument();
  });

  it("'Agregar seleccionados' está deshabilitado sin selección, con una explicación visible, y se habilita al seleccionar", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [buildEmployee()], meta: { ...emptyMeta, total: 1 } });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));
    await screen.findByText(/Persona/);

    const submitButton = screen.getByRole("button", { name: "Agregar seleccionados" });
    expect(submitButton).toBeDisabled();
    expect(screen.getByText("Seleccioná al menos un empleado para continuar.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Nueva, Persona/ }));

    expect(submitButton).toBeEnabled();
    expect(screen.queryByText("Seleccioná al menos un empleado para continuar.")).not.toBeInTheDocument();
  });

  it("seleccionar empleados incrementa el contador y 'Limpiar selección' lo vacía de nuevo", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({
      items: [buildEmployee(), buildEmployee({ id: "employee-3", firstName: "Otra", lastName: "Persona" })],
      meta: { ...emptyMeta, total: 2 },
    });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));
    await screen.findByText(/Nueva, Persona/);

    expect(screen.getByText("No hay empleados seleccionados.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Nueva, Persona/ }));
    expect(await screen.findByText("1 empleado seleccionado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Persona, Otra/ }));
    expect(await screen.findByText("2 empleados seleccionados")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpiar selección" }));
    expect(await screen.findByText("No hay empleados seleccionados.")).toBeInTheDocument();
  });

  it("la fecha 'Vigencia desde' se ve con su texto de ayuda", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));

    expect(screen.getByLabelText("Vigencia desde *")).toBeInTheDocument();
    expect(screen.getByText("Fecha desde la cual este régimen queda activo para los empleados seleccionados.")).toBeInTheDocument();
  });

  it("agregar un empleado desde Régimen Laboral llama a assign con el mismo endpoint que usa el Legajo, y vuelve a la lista", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [buildEmployee()], meta: { ...emptyMeta, total: 1 } });
    vi.mocked(workRegimeApiService.assign).mockResolvedValue({} as never);

    const user = await openAssociatedEmployeesModal();
    await vi.waitFor(() => expect(workRegimeApiService.getWorkRegimeEmployees).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));
    await screen.findByText(/Persona/);
    const dateField = screen.getByLabelText("Vigencia desde *") as HTMLInputElement;
    const today = new Date().toISOString().slice(0, 10);
    expect(dateField.value).toBe(today);

    await user.click(screen.getByRole("button", { name: /Nueva, Persona/ }));
    await user.click(screen.getByRole("button", { name: "Agregar seleccionados" }));

    await vi.waitFor(() => expect(workRegimeApiService.assign).toHaveBeenCalledWith("employee-2", { workRegimeId: "regime-1", effectiveFrom: today }));
    // Tras agregar, vuelve a la vista de lista (no queda atascado en la vista de alta).
    expect(await screen.findByRole("heading", { name: "Empleados con régimen 01 - Agricultura" })).toBeInTheDocument();
  });
});

// Etapa 13J.3 — mobile roto: la tabla (7 columnas, min-width 720/880px) no
// entra en un modal de ancho celular sin scroll horizontal ni columnas
// cortadas. En vez de forzar la tabla a un ancho angosto, se agrega una
// lista de cards (enableMobileCards) que WorkRegimesPage activa y CSS
// muestra por debajo de 620px (la tabla, con .has-mobile-cards, se oculta
// en ese mismo breakpoint — ver styles.css). jsdom no evalúa media queries,
// así que ambas vistas están siempre en el DOM en estos tests; lo que se
// verifica acá es que la vista de cards existe con el contenido correcto,
// no en qué ancho se ve (eso lo prueba la regla CSS en sí, revisada a mano
// y validada en navegador real).
describe("WorkRegimesPage — cards de mobile en Empleados asociados (Etapa 13J.3)", () => {
  it("la tabla queda marcada para ocultarse en mobile (.has-mobile-cards) y existe una lista de cards separada", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ vigencyStatus: "current" })],
      meta: { ...emptyMeta, total: 1 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    expect(document.querySelector(".associated-employees-table-wrap.has-mobile-cards")).toBeInTheDocument();
    expect(document.querySelector(".associated-employees-cards")).toBeInTheDocument();
  });

  it("cada card muestra nombre, legajo, sector, centro de costo, empresa y vigencia — no una tabla de una sola columna", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [
        buildAssociation({
          vigencyStatus: "current",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
          employee: {
            id: "employee-1",
            legajo: "27",
            cuil: "20-12345678-9",
            firstName: "27 Agricultura",
            lastName: "27 Agricultura",
            status: "ACTIVO",
            sector: { id: "s1", name: "Taller" },
            costCenter: { id: "c1", name: "Administracion Central" },
            companies: [{ id: "co1", name: "Los O'Dwyer" }],
          },
        }),
      ],
      meta: { ...emptyMeta, total: 1 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    const card = withinCards();
    expect(card.getByText("27 Agricultura, 27 Agricultura")).toBeInTheDocument();
    expect(card.getByText("Legajo 27")).toBeInTheDocument();
    expect(card.getByText("Taller")).toBeInTheDocument();
    expect(card.getByText("Administracion Central")).toBeInTheDocument();
    expect(card.getByText("Los O'Dwyer")).toBeInTheDocument();
    expect(card.getByText("Vigente")).toBeInTheDocument();
    expect(card.getByText("Desde 01/09/2026")).toBeInTheDocument();
    expect(card.getByText("Hasta -")).toBeInTheDocument();
    // Ni CUIL ni Estado (Etapa 13J.1: no son columnas de esta pantalla).
    expect(card.queryByText("20-12345678-9")).not.toBeInTheDocument();
  });

  it("cada card ofrece 'Ver legajo' y, si está vigente, 'Finalizar vigencia' — con texto visible, no sólo un ícono", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ vigencyStatus: "current" })],
      meta: { ...emptyMeta, total: 1 },
    });

    await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    const card = withinCards();
    expect(card.getByRole("link", { name: "Ver legajo" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Finalizar vigencia" })).toBeInTheDocument();
  });

  it("'Agregar empleados' funciona igual (misma vista inline) independientemente de la tabla/cards", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({ items: [], meta: emptyMeta });

    const user = await openAssociatedEmployeesModal();
    await user.click(screen.getByRole("button", { name: "Agregar empleados" }));

    expect(document.querySelectorAll(".modal-backdrop")).toHaveLength(1);
    expect(await screen.findByRole("heading", { name: "Agregar empleados al régimen" })).toBeInTheDocument();
  });
});

// Etapa 13J.3 — "finalizar vigencia no funciona" + "confirmación detrás del
// modal": diagnosticado como UN solo bug (AppDialogHost sin portal, ver
// AppDialogHost.test.tsx y WorkRegimesPage.finalizeVigencyRealDialog.test.tsx
// para el flujo end-to-end con el diálogo REAL) más la falta de guard contra
// doble-click, cubierta acá con confirmAction mockeado como en el resto del
// archivo.
describe("WorkRegimesPage — Finalizar vigencia: loading/doble-click/error (Etapa 13J.3)", () => {
  it("un doble click sobre 'Finalizar vigencia' llama a la API una sola vez (guard, no permite doble submit)", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ id: "assignment-current", employeeId: "employee-1", vigencyStatus: "current" })],
      meta: { ...emptyMeta, total: 1 },
    });
    let resolveClose: (value: EmployeeWorkRegimeAssignment) => void = () => {};
    vi.mocked(workRegimeApiService.closeAssignment).mockReturnValue(new Promise((resolve) => { resolveClose = resolve; }));

    const user = await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    const button = withinTable().getByRole("button", { name: "Finalizar vigencia" });
    await user.click(button);
    await vi.waitFor(() => expect(workRegimeApiService.closeAssignment).toHaveBeenCalledTimes(1));
    // El botón queda deshabilitado mientras la baja está en curso.
    expect(withinTable().getByRole("button", { name: "Finalizando..." })).toBeDisabled();

    resolveClose({} as EmployeeWorkRegimeAssignment);
    await vi.waitFor(() => expect(workRegimeApiService.closeAssignment).toHaveBeenCalledTimes(1));
  });

  it("si finalizar vigencia falla, muestra un mensaje de error y no deja la fila en un estado inconsistente", async () => {
    vi.mocked(workRegimeApiService.getWorkRegimeEmployees).mockResolvedValue({
      items: [buildAssociation({ id: "assignment-current", employeeId: "employee-1", vigencyStatus: "current" })],
      meta: { ...emptyMeta, total: 1 },
    });
    vi.mocked(workRegimeApiService.closeAssignment).mockRejectedValue(new Error("network"));

    const user = await openAssociatedEmployeesModal();
    await screen.findAllByText("Vigente");

    await user.click(withinTable().getByRole("button", { name: "Finalizar vigencia" }));

    expect(await screen.findByText("No pudimos quitar al empleado. Intentá nuevamente.")).toBeInTheDocument();
    // Sigue vigente — no se le borró el historial ni se dejó a mitad de camino.
    expect(withinTable().getByText("Vigente")).toBeInTheDocument();
    expect(withinTable().getByRole("button", { name: "Finalizar vigencia" })).toBeEnabled();
  });
});
