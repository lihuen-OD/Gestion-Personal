import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HolidayWorkAssignmentsPage } from "./HolidayWorkAssignmentsPage";
import {
  holidayWorkAssignmentApiService,
  type HolidayWorkAssignmentCandidate,
} from "../services/api/holidayWorkAssignmentApiService";
import { workforceApiService } from "../services/api/workforceApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAsRrhh() {
  mockUseAuth.mockReturnValue({ user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" }, login: vi.fn(), loginAs: vi.fn(), logout: vi.fn() });
}
function authAsSupervision() {
  mockUseAuth.mockReturnValue({ user: { id: "user-2", name: "Supervisor", email: "sup@test.com", password: "", role: "Nivel 2 - Supervisión / Gestión", status: "Activo" }, login: vi.fn(), loginAs: vi.fn(), logout: vi.fn() });
}

vi.mock("../services/api/holidayWorkAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/holidayWorkAssignmentApiService")>();
  return {
    ...actual,
    holidayWorkAssignmentApiService: {
      getHolidayDates: vi.fn(),
      getCandidates: vi.fn(),
      getAssignmentsByDate: vi.fn(),
      saveAssignments: vi.fn(),
    },
  };
});

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, shiftTemplates: vi.fn() } };
});

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

const catalog = {
  companies: [],
  businessUnits: [],
  establishments: [],
  areas: [],
  sectors: [{ id: "sector-panol", code: "PAN", name: "Pañol", status: "ACTIVO" as const }],
  costCenters: [],
};

const shiftTemplates = [
  { id: "template-manana", code: "MAN", name: "Turno mañana", categoryName: null, startTime: "06:00", endTime: "14:00", crossesMidnight: false, entryToleranceBeforeMinutes: 10, entryToleranceAfterMinutes: 10, exitToleranceBeforeMinutes: 20, exitToleranceAfterMinutes: 20, absoluteOpenShiftLimitMinutes: 1200, status: "ACTIVO" },
];

function candidate(overrides: Partial<HolidayWorkAssignmentCandidate> = {}): HolidayWorkAssignmentCandidate {
  return {
    id: "employee-1",
    legajo: "100",
    firstName: "Juan",
    lastName: "Pérez",
    status: "ACTIVO",
    sector: { id: "sector-panol", name: "Pañol" },
    shiftAssignments: [{ shiftTemplate: { id: "template-manana", code: "MAN", name: "Turno mañana" } }],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HolidayWorkAssignmentsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(catalog as never);
  vi.mocked(workforceApiService.shiftTemplates).mockResolvedValue(shiftTemplates as never);
  vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([]);
  vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 300, hasMore: false } });
  vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({ date: "2026-08-27", assignments: [] });
  vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mockResolvedValue([]);
});

describe("HolidayWorkAssignmentsPage — Etapa 12D", () => {
  it("1 — empty state cuando no hay feriados clasificados como FERIADO", async () => {
    renderPage();
    expect(await screen.findByText('No hay feriados disponibles. Primero clasificá una regla de Horas Especiales como Feriado.')).toBeInTheDocument();
  });

  it("2 — lista los feriados disponibles del mes", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([
      { date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] },
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: /jue.*27 ago/i })).toBeInTheDocument();
  });

  it("3 — seleccionar una fecha abre el panel de convocatoria", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /jue.*27 ago/i }));

    expect(await screen.findByText(/Seleccioná quiénes estaban convocados a trabajar ese feriado\./i)).toBeInTheDocument();
    expect(holidayWorkAssignmentApiService.getAssignmentsByDate).toHaveBeenCalledWith("2026-08-27");
  });

  async function openFirstDate(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: /jue.*27 ago/i }));
    await screen.findByText(/Seleccioná quiénes estaban convocados/i);
  }

  it("4 — ve a los empleados candidatos de la fecha elegida", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);

    expect(await screen.findByText("Pérez, Juan")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Turno mañana", { selector: "td" })).toBeInTheDocument();
  });

  it("5 — filtrar por turno pide candidatos con shiftTemplateId", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.selectOptions(screen.getByLabelText("Turno"), "template-manana");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ shiftTemplateId: "template-manana" })));
  });

  it("6 — filtrar por sector pide candidatos con sectorId", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.selectOptions(screen.getByLabelText("Sector"), "sector-panol");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ sectorId: "sector-panol" })));
  });

  it("7 — activar 'Mostrar empleados sin turno' pide candidatos con withoutShift", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate({ id: "employee-2", shiftAssignments: [] })], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.click(screen.getByLabelText("Mostrar empleados sin turno"));

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ withoutShift: true })));
  });

  it("8 — buscar empleado pide candidatos con el término de búsqueda (debounced)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.type(screen.getByPlaceholderText("Buscar por nombre o legajo"), "Pedro");

    await waitFor(() => expect(holidayWorkAssignmentApiService.getCandidates).toHaveBeenCalledWith(expect.objectContaining({ search: "Pedro" })), { timeout: 2000 });
  });

  it("9 — seleccionar un empleado lo marca como convocado", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    const checkbox = screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    await user.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(screen.getByText("1 seleccionado")).toBeInTheDocument();
  });

  it("10 — seleccionar todos los visibles marca a todos los candidatos cargados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate(), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez" })],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    await user.click(screen.getByRole("button", { name: "Seleccionar todos los visibles" }));

    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Trabaja este feriado — Gómez, Ana/i) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("2 seleccionados")).toBeInTheDocument();
  });

  it("11 — deseleccionar visibles desmarca a los candidatos actualmente filtrados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");
    await user.click(screen.getByRole("button", { name: "Seleccionar todos los visibles" }));
    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Deseleccionar visibles" }));

    expect((screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement).checked).toBe(false);
  });

  it("12 — guardar cambios manda el payload correcto (altas ACTIVA + bajas CANCELADA)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({
      items: [candidate(), candidate({ id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez", shiftAssignments: [] })],
      meta: { total: 2, page: 1, pageSize: 300, hasMore: false },
    });
    // employee-2 ya estaba convocado antes — al desmarcarlo debe viajar como CANCELADA.
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-2", status: "ACTIVA", shiftTemplateId: null, expectedStartTime: null, expectedEndTime: null, notes: null, createdAt: "", updatedAt: "", employee: { id: "employee-2", legajo: "200", firstName: "Ana", lastName: "Gómez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);
    await screen.findByText("Pérez, Juan");

    // employee-2 arranca marcado (ya convocado) — lo desmarco. employee-1 lo marco de nuevo.
    await user.click(screen.getByLabelText(/Trabaja este feriado — Gómez, Ana/i));
    await user.click(screen.getByLabelText(/Trabaja este feriado — Pérez, Juan/i));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(holidayWorkAssignmentApiService.saveAssignments).toHaveBeenCalled());
    const [date, payload] = vi.mocked(holidayWorkAssignmentApiService.saveAssignments).mock.calls[0]!;
    expect(date).toBe("2026-08-27");
    expect(payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: "employee-1", status: "ACTIVA" }),
      expect.objectContaining({ employeeId: "employee-2", status: "CANCELADA" }),
    ]));
  });

  it("13 — al recargar, muestra como marcados a los empleados ya convocados guardados para esa fecha", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    vi.mocked(holidayWorkAssignmentApiService.getAssignmentsByDate).mockResolvedValue({
      date: "2026-08-27",
      assignments: [{ id: "hwa-1", date: "2026-08-27", employeeId: "employee-1", status: "ACTIVA", shiftTemplateId: "template-manana", expectedStartTime: "08:00", expectedEndTime: "16:00", notes: "Convocado", createdAt: "", updatedAt: "", employee: { id: "employee-1", legajo: "100", firstName: "Juan", lastName: "Pérez", status: "ACTIVO" } }],
    });
    const user = userEvent.setup();
    await openFirstDate(user);

    const checkbox = await screen.findByLabelText(/Trabaja este feriado — Pérez, Juan/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("14 — el copy no usa lenguaje técnico (sin DoubleHourRule/kind/enum/schema/backend/API)", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    renderPage();
    await screen.findByRole("button", { name: /jue.*27 ago/i });

    expect(screen.getByText(/Estas fechas vienen de Horas Especiales clasificadas como Feriado\./i)).toBeInTheDocument();
    expect(screen.queryByText(/DoubleHourRule|kind|enum|schema|backend|\bAPI\b/i)).not.toBeInTheDocument();
  });

  it("15a — loading state mientras cargan los feriados", async () => {
    let resolveDates!: (value: never[]) => void;
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockReturnValue(new Promise((resolve) => { resolveDates = resolve; }));
    renderPage();

    expect(screen.getByText("Cargando feriados...")).toBeInTheDocument();
    resolveDates([]);
    await screen.findByText(/No hay feriados disponibles/i);
  });

  it("15b — error state con reintento si falla la carga de feriados", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("No pudimos cargar los feriados de este mes.")).toBeInTheDocument();

    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([{ date: "2026-08-27", rules: [{ id: "rule-1", name: "Feriados" }] }]);
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: /jue.*27 ago/i })).toBeInTheDocument();
  });

  it("15c — error state con reintento si falla la carga de candidatos", async () => {
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    await openFirstDate(user);

    expect(await screen.findByText("No pudimos cargar los empleados candidatos.")).toBeInTheDocument();

    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Pérez, Juan")).toBeInTheDocument();
  });

  it("un usuario de Supervisión ve la pantalla en modo sólo lectura (sin checkboxes ni acciones de guardado)", async () => {
    authAsSupervision();
    vi.mocked(holidayWorkAssignmentApiService.getCandidates).mockResolvedValue({ items: [candidate()], meta: { total: 1, page: 1, pageSize: 300, hasMore: false } });
    const user = userEvent.setup();
    await openFirstDate(user);

    await screen.findByText("Pérez, Juan");
    expect(screen.queryByLabelText(/Trabaja este feriado/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
  });
});
