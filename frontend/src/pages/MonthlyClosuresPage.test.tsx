import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlyClosuresPage } from "./MonthlyClosuresPage";
import { employeeApiService } from "../services/api/employeeApiService";
import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../services/api/employeeApiService";
import { workforceApiService, type MonthlyClosure } from "../services/api/workforceApiService";
import type { Employee } from "../types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAsRrhh() {
  authAs("Nivel 1 - RRHH");
}

function authAs(role: string) {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "Usuario de prueba", email: "user@test.com", password: "", role, status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn(), getTimeGrid: vi.fn() } };
});

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return {
    ...actual,
    workforceApiService: {
      ...actual.workforceApiService,
      closures: vi.fn(),
      corrections: vi.fn(),
      approveClosures: vi.fn(),
      submitClosures: vi.fn(),
      returnClosure: vi.fn(),
    },
  };
});

// Etapa 15K: el botón "Devolver" dispara un diálogo basado en eventos
// (services/appDialog.ts) que ninguna de estas pruebas monta — se mockea
// para que resuelva directo con un motivo fijo, igual que cualquier otro
// servicio externo a la pantalla bajo prueba.
vi.mock("../services/appDialog", () => ({
  requestText: vi.fn().mockResolvedValue("Motivo de prueba"),
}));

function buildClosure(overrides: Partial<MonthlyClosure> = {}): MonthlyClosure {
  return {
    id: "closure-1",
    employeeId: "employee-1",
    period: "2026-08",
    status: "ENVIADO",
    employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
    ...overrides,
  };
}

function buildEmployeeOption(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Gomez",
    firstName: "Ana",
    dni: "12345678",
    cuil: "20-12345678-9",
    company: "Odwyer",
    costCenter: "Pañol",
    status: "Activo",
    enabledHours: [],
    ...overrides,
  } as Employee;
}

const GRID_CONCEPT_BASE = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function buildGridRows(): EmployeeTimeGridRow[] {
  return [
    {
      concept: { ...GRID_CONCEPT_BASE, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" },
      role: "NORMAL_BASE",
      minutesByDay: { "1": 480 },
      totalMinutes: 480,
    },
  ];
}

function buildGrid(overrides: Partial<EmployeeTimeGrid> = {}): EmployeeTimeGrid {
  return {
    employee: {} as EmployeeTimeGrid["employee"],
    entries: [],
    novelties: [],
    noveltyTypes: [],
    hourConcepts: [],
    rows: buildGridRows(),
    totalWorkedMinutes: 480,
    attendanceIssues: 0,
    specialHoursByDay: {},
    specialHourAdditionalMinutes: 0,
    specialHourLiquidableTotalMinutes: 480,
    ...overrides,
  };
}

const period = new Date().toISOString().slice(0, 7);

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
  vi.mocked(workforceApiService.corrections).mockResolvedValue([]);
  vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
});

describe("MonthlyClosuresPage — Etapa 9B (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay cierres en pantalla", async () => {
    let resolveClosures!: (value: MonthlyClosure[]) => void;
    vi.mocked(workforceApiService.closures).mockReturnValue(new Promise((resolve) => { resolveClosures = resolve; }));

    render(<MonthlyClosuresPage />);

    expect(screen.getByText("Cargando cierres...")).toBeInTheDocument();

    resolveClosures([buildClosure()]);
    await screen.findByText("100");
    expect(screen.queryByText("Cargando cierres...")).not.toBeInTheDocument();
  });

  it("tras aprobar un cierre (load() invocado fuera del efecto de montaje), no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValueOnce([buildClosure({ status: "ENVIADO" })]);
    vi.mocked(workforceApiService.approveClosures).mockResolvedValue({ count: 1 });
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");
    expect(screen.getByText("Esperando a RH")).toBeInTheDocument();

    let resolveReload!: (value: MonthlyClosure[]) => void;
    vi.mocked(workforceApiService.closures).mockReturnValue(new Promise((resolve) => { resolveReload = resolve; }));

    await user.click(screen.getByLabelText("Seleccionar pendientes"));
    await user.click(screen.getByRole("button", { name: "Aprobar seleccionados" }));

    // load() acá se invoca desde execute(), no desde el efecto de montaje —
    // exactamente el camino que exponía el cierre stale (useCallback
    // memoizado por [period], invocado fuera del efecto). Mientras la
    // segunda carga está en vuelo, la fila anterior sigue visible.
    await waitFor(() => expect(workforceApiService.approveClosures).toHaveBeenCalled());
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.queryByText("Cargando cierres...")).not.toBeInTheDocument();

    resolveReload([buildClosure({ status: "APROBADO" })]);

    await waitFor(() => expect(screen.getByText("Aprobado por RH")).toBeInTheDocument());
  });
});

describe("MonthlyClosuresPage — Etapa 15K (panel de revisión de horas)", () => {
  it("expone la acción 'Revisar horas' en cada fila del listado", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([buildClosure()]);
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");
    expect(screen.getByRole("button", { name: "Revisar horas de 100" })).toBeInTheDocument();
  });

  it("al abrir la revisión carga la grilla horaria sólo para el empleado seleccionado (sin N+1)", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([
      buildClosure({ id: "closure-1", employeeId: "employee-1", employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } }),
      buildClosure({ id: "closure-2", employeeId: "employee-2", employee: { id: "employee-2", legajo: "200", firstName: "Luis", lastName: "Diaz" } }),
    ]);
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");
    await screen.findByText("200");

    // Cargar el listado no debe disparar ninguna carga de time-grid —
    // recién al seleccionar un empleado puntual (carga lazy, Etapa 15K §7).
    expect(employeeApiService.getTimeGrid).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revisar horas de 100" }));
    await screen.findByText("Hora normal");

    expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(1);
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledWith("employee-1", period, { includeDetails: true });
  });

  it("cerrar el panel de revisión no dispara ninguna acción de cierre", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([buildClosure()]);
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");

    await user.click(screen.getByRole("button", { name: "Revisar horas de 100" }));
    await screen.findByText("Hora normal");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByText("Hora normal")).not.toBeInTheDocument();
    expect(workforceApiService.approveClosures).not.toHaveBeenCalled();
    expect(workforceApiService.submitClosures).not.toHaveBeenCalled();
    expect(workforceApiService.returnClosure).not.toHaveBeenCalled();
  });

  it.each([
    ["Nivel 1 - RRHH"],
    ["Nivel 2 - Supervisión / Gestión"],
    ["Nivel 3 - Administrativo de Carga Horaria"],
  ])("%s ve el mismo detalle horario al revisar un empleado", async (role) => {
    authAs(role);
    vi.mocked(workforceApiService.closures).mockResolvedValue([buildClosure()]);
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [buildEmployeeOption()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } });
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");

    await user.click(screen.getByRole("button", { name: "Revisar horas de 100" }));
    await screen.findByText("Hora normal");

    expect(screen.getByText("Horas reales trabajadas")).toBeInTheDocument();
    expect(screen.getByText("Conceptos horarios adicionales")).toBeInTheDocument();
    expect(screen.getByText("Incidencias del período")).toBeInTheDocument();
    expect(screen.getByText("Novedades del período")).toBeInTheDocument();
  });
});

describe("MonthlyClosuresPage — Etapa 15K (performance: cero N+1)", () => {
  it("con 20 filas de cierre, abrir la página no dispara ningún request de time-grid", async () => {
    const closures = Array.from({ length: 20 }, (_, index) => buildClosure({
      id: `closure-${index}`,
      employeeId: `employee-${index}`,
      employee: { id: `employee-${index}`, legajo: String(100 + index), firstName: "Ana", lastName: "Gomez" },
    }));
    vi.mocked(workforceApiService.closures).mockResolvedValue(closures);
    render(<MonthlyClosuresPage />);
    await screen.findByText("119");
    expect(employeeApiService.getTimeGrid).not.toHaveBeenCalled();
  });

  it("cambiar de empleado revisado sólo dispara la carga del nuevo seleccionado", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([
      buildClosure({ id: "closure-1", employeeId: "employee-1", employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" } }),
      buildClosure({ id: "closure-2", employeeId: "employee-2", employee: { id: "employee-2", legajo: "200", firstName: "Luis", lastName: "Diaz" } }),
    ]);
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");

    await user.click(screen.getByRole("button", { name: "Revisar horas de 100" }));
    await screen.findByText("Hora normal");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await user.click(screen.getByRole("button", { name: "Revisar horas de 200" }));
    await screen.findByText("Hora normal");

    expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2);
    expect(employeeApiService.getTimeGrid).toHaveBeenNthCalledWith(1, "employee-1", period, { includeDetails: true });
    expect(employeeApiService.getTimeGrid).toHaveBeenNthCalledWith(2, "employee-2", period, { includeDetails: true });
  });
});

describe("MonthlyClosuresPage — Etapa 15K (regresión: acciones existentes intactas)", () => {
  it("seleccionar una fila individualmente sigue funcionando", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([buildClosure()]);
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");
    const checkbox = screen.getByLabelText("Seleccionar 100") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("Nivel 2 puede seguir enviando el cierre a RH (acción masiva existente)", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    vi.mocked(workforceApiService.closures).mockResolvedValue([]);
    vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [buildEmployeeOption()], meta: { total: 1, page: 1, pageSize: 20, hasMore: false } });
    vi.mocked(workforceApiService.submitClosures).mockResolvedValue([buildClosure({ status: "ENVIADO" })]);
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");

    await user.click(screen.getByLabelText("Seleccionar pendientes"));
    await user.click(screen.getByRole("button", { name: "Enviar cierre a RH" }));

    await waitFor(() => expect(workforceApiService.submitClosures).toHaveBeenCalledWith(period, ["employee-1"]));
  });

  it("RRHH puede seguir devolviendo un cierre enviado (acción existente)", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([buildClosure({ status: "ENVIADO" })]);
    vi.mocked(workforceApiService.returnClosure).mockResolvedValue(buildClosure({ status: "DEVUELTO" }));
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");

    await user.click(screen.getByRole("button", { name: "Devolver cierre de 100" }));

    await waitFor(() => expect(workforceApiService.returnClosure).toHaveBeenCalledWith("closure-1", "Motivo de prueba"));
  });

  it("las correcciones posteriores al cierre siguen listadas para RRHH", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([]);
    vi.mocked(workforceApiService.corrections).mockResolvedValue([{
      id: "correction-1",
      status: "PENDIENTE",
      previousHours: 8,
      proposedHours: 6,
      reason: "Ajuste de horario",
      createdAt: `${period}-05T00:00:00.000Z`,
      employee: { legajo: "100", firstName: "Ana", lastName: "Gomez" },
      timeEntry: { date: `${period}-05`, hourConcept: { name: "Hora normal" } },
      createdBy: { name: "Ana" },
    }]);
    render(<MonthlyClosuresPage />);
    await screen.findByText("Ajuste de horario");
    expect(screen.getByRole("button", { name: "Aprobar corrección" })).toBeInTheDocument();
  });
});
