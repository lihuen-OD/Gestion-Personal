import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HoursPage } from "./HoursPage";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import { employeeDayOffApiService } from "../services/api/employeeDayOffApiService";
import { holidayWorkAssignmentApiService } from "../services/api/holidayWorkAssignmentApiService";
import { manualHoursConflictApiService, type ManualHoursConflict } from "../services/api/manualHoursConflictApiService";
import type { EmployeePeriodDay } from "../services/api/timeEntryApiService";
import type { DayAccounting, NoveltyCoverageItem } from "../types/workedTimeAccounting.types";
import { dayAccounting, periodAccounting } from "../test/workedTimeAccountingFixtures";
import type { Employee } from "../types";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAs(role: string) {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "Test User", email: "test@test.com", password: "", role, status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

vi.mock("../services/api/timeEntryApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/timeEntryApiService")>();
  return {
    ...actual,
    timeEntryApiService: {
      ...actual.timeEntryApiService,
      list: vi.fn(),
      listByEmployee: vi.fn(),
      getSummary: vi.fn(),
      getPeriodEmployees: vi.fn(),
    },
  };
});

vi.mock("../services/api/employeeDayOffApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeDayOffApiService")>();
  return { ...actual, employeeDayOffApiService: { getByDate: vi.fn(), save: vi.fn() } };
});

vi.mock("../services/api/holidayWorkAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/holidayWorkAssignmentApiService")>();
  return { ...actual, holidayWorkAssignmentApiService: { getHolidayDates: vi.fn().mockResolvedValue([]), getCandidates: vi.fn(), getAssignmentsByDate: vi.fn(), saveAssignments: vi.fn() } };
});
vi.mock("../services/api/manualHoursConflictApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/manualHoursConflictApiService")>();
  return { ...actual, manualHoursConflictApiService: { list: vi.fn(), resolve: vi.fn() } };
});

function renderGrid(path = "/horas?period=2026-08") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HoursPage />
    </MemoryRouter>,
  );
}

// El popover de un día y el badge de "Total liquidable" del período pueden
// mostrar el mismo texto (ej. un único día especial en el período) — se
// escopea explícitamente al popover abierto para no ambigüar la búsqueda.
function currentDayPopover() {
  const popover = document.querySelector(".day-cell-popover");
  if (!popover) throw new Error("No hay ningún popover de día abierto");
  return within(popover as HTMLElement);
}

function buildEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    legajo: "100",
    legajoInterno: "100",
    lastName: "Gomez",
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
    company: "Odwyer",
    businessUnit: "",
    establishment: "",
    costCenter: "Pañol",
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

// Fila de la grilla de período con la contabilidad que calcula el backend
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md). Default: un día con 8 h
// base y sin conceptos.
function buildPeriodRow(overrides: {
  employee?: Partial<Employee>;
  days?: DayAccounting[];
  dailyBreakdown?: EmployeePeriodDay[];
} = {}) {
  const days = overrides.days ?? [dayAccounting(1, { sereno: 0, colectivo: 0 })];
  return {
    employee: buildEmployee(overrides.employee),
    summary: {
      incidents: 0,
      status: "Aprobado",
      accounting: periodAccounting(days),
      dailyBreakdown: overrides.dailyBreakdown
        ?? days.map((day) => ({ day: day.day, novelty: null, specialHourRuleNames: day.multiplier > 1 ? ["Feriado"] : [], specialHourConflict: false })),
    },
  } as never;
}

beforeEach(() => {
  vi.mocked(manualHoursConflictApiService.list).mockResolvedValue([]);
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ costCenters: [] } as never);
  vi.mocked(timeEntryApiService.getSummary).mockResolvedValue({
    activeEmployees: 0, employeesWithEntries: 0, pendingEmployees: 0, countableHours: 0, coverage: 0,
  } as never);
  vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
  vi.mocked(timeEntryApiService.list).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
});

// Etapa 9F: el mega-efecto original (10 dependencias en un único Promise.all)
// se separó en 3 efectos por dependencia real — estos tests fijan que la
// separación es real (no sólo cosmética): cambiar un filtro que un endpoint
// no usa ya no lo vuelve a llamar, y una mutación (refresh) sigue
// invalidando todo lo relacionado, sin under-refrescar.
describe("HoursPage — Etapa 9F (separación de efectos: sin refetch innecesario)", () => {
  it("carga inicial en Carga de horas: pide getSummary/getPeriodEmployees una sola vez cada uno, y nunca list", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const before = {
      summary: vi.mocked(timeEntryApiService.getSummary).mock.calls.length,
      periodEmployees: vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length,
      list: vi.mocked(timeEntryApiService.list).mock.calls.length,
    };

    renderGrid();

    await screen.findByText("Gomez, Ana");
    expect(vi.mocked(timeEntryApiService.getSummary).mock.calls.length - before.summary).toBe(1);
    expect(vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length - before.periodEmployees).toBe(1);
    expect(vi.mocked(timeEntryApiService.list).mock.calls.length).toBe(before.list);
  });

  it("cambiar de página en Carga de horas sólo vuelve a pedir getPeriodEmployees — no getSummary", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValueOnce({
      items: [buildPeriodRow()],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");
    const summaryCallsBefore = vi.mocked(timeEntryApiService.getSummary).mock.calls.length;

    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValueOnce({
      items: [buildPeriodRow({ employee: { id: "employee-2", lastName: "Perez", firstName: "Luis", legajo: "200" } })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await screen.findByText("Perez, Luis");
    expect(timeEntryApiService.getSummary).toHaveBeenCalledTimes(summaryCallsBefore);
  });

  it("empty state en Carga de horas sigue funcionando", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    renderGrid();

    await screen.findByText("No hay personas habilitadas para carga con los filtros aplicados.");
  });

  it("error state en Carga de horas sigue funcionando, con retry", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockRejectedValueOnce(new Error("network down"));
    renderGrid();

    await screen.findByText("No pudimos cargar la información horaria. Intentá nuevamente.");

    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValueOnce({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    await user.click(screen.getByRole("button", { name: /reintentar/i }));

    await screen.findByText("Gomez, Ana");
  });

  it("no hay texto técnico visible (TimeEntry, HourConceptBreakdown, schema, backend) en Carga de horas", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const { container } = renderGrid();
    await screen.findByText("Gomez, Ana");

    expect(container.textContent).not.toMatch(/TimeEntry|HourConceptBreakdown|schema|payload/i);
  });
});

// Etapa 14G.4: la grilla/bandeja no deben esperar a que resuelva el catálogo
// de org-structure (GET /org-structure) para pedir period-employees/summary/
// list — antes de esta etapa, un gate innecesario (`costCenterOptionsReady`)
// serializaba ambos pedidos, sumando la latencia de org-structure al camino
// crítico de "Entrar a Carga de horas" sin ninguna razón funcional (el
// centro de costo por default es "Todos", así que `costCenterId` es
// `undefined` de cualquier forma hasta que el usuario elige uno, lo que sólo
// puede pasar después de que el catálogo ya cargó).
describe("HoursPage — Etapa 14G.4 (grilla/bandeja no esperan al catálogo de centros de costo)", () => {
  it("Carga de horas pide getPeriodEmployees/getSummary sin esperar a que resuelva GET /org-structure", async () => {
    authAs("Nivel 1 - RRHH");
    let resolveCatalog!: (value: { costCenters: Array<{ id: string; name: string; status: string }> }) => void;
    vi.mocked(orgStructureApiService.getCatalog).mockReturnValue(
      new Promise((resolve) => { resolveCatalog = resolve; }) as never,
    );
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });

    renderGrid();

    // La grilla ya se resuelve (getPeriodEmployees) mientras el catálogo de
    // centros de costo (org-structure) todavía sigue en vuelo.
    await screen.findByText("Gomez, Ana");
    expect(timeEntryApiService.getPeriodEmployees).toHaveBeenCalled();
    expect(timeEntryApiService.getSummary).toHaveBeenCalled();

    resolveCatalog({ costCenters: [] });
  });

  it("cuando el catálogo de centros de costo resuelve después, no repite el pedido de getPeriodEmployees (sin duplicado)", async () => {
    authAs("Nivel 1 - RRHH");
    let resolveCatalog!: (value: { costCenters: Array<{ id: string; name: string; status: string }> }) => void;
    vi.mocked(orgStructureApiService.getCatalog).mockReturnValue(
      new Promise((resolve) => { resolveCatalog = resolve; }) as never,
    );
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });

    renderGrid();
    await screen.findByText("Gomez, Ana");
    const callsBefore = vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length;

    resolveCatalog({ costCenters: [{ id: "cc-1", name: "Pañol", status: "ACTIVO" }] });
    await waitFor(() => {
      expect(within(screen.getByRole("combobox", { name: "Centro de costo" })).getByText("Pañol")).toBeInTheDocument();
    });

    expect(vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length).toBe(callsBefore);
  });
});

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — reemplaza los casos 11A/11A.1
// (8 + 4 Sereno x2 = 24): cada día muestra el total trabajado real y su
// composición; la equivalencia para liquidación parte de categorías sin duplicar.
describe("HoursPage — grilla de período con el modelo de tiempo trabajado", () => {
  it("domingo x2 — base 8 + Sereno 3 + Colectivo 1: la celda muestra 9 h reales y el detalle 18 h para liquidación (nunca 22 ni 24)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days: [dayAccounting(27, { multiplier: 2 })] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");

    const dayButton = screen.getByLabelText(/ 27$/);
    expect(within(dayButton).getByText("9 h")).toBeInTheDocument();
    await user.click(dayButton);

    await screen.findByText(/Hora especial aplicada.*x2/);
    const popover = currentDayPopover();
    expect(popover.getByText("Horas base: 8 h")).toBeInTheDocument();
    expect(popover.getByText("Horas normales: 5 h")).toBeInTheDocument();
    expect(popover.getByText("Dentro de la jornada: 3 h")).toBeInTheDocument();
    expect(popover.getByText("Horas adicionales: 1 h")).toBeInTheDocument();
    expect(popover.getByText("Total trabajado: 9 h")).toBeInTheDocument();
    expect(popover.getByText(/Feriado/)).toBeInTheDocument();
    // §17: para liquidación por componente, nunca una única equivalencia que mezcle conceptos.
    expect(popover.getByText("Para liquidación")).toBeInTheDocument();
    expect(popover.getByText("Horas normales: 10 h")).toBeInTheDocument();
    expect(popover.getByText("Dentro de la jornada: 6 h")).toBeInTheDocument();
    expect(popover.getByText("Horas adicionales: 2 h")).toBeInTheDocument();
    expect(popover.getByText("Total para liquidación: 18 h")).toBeInTheDocument();
    expect(popover.queryByText(/22 h|24 h|Total liquidable/)).not.toBeInTheDocument();
  });

  it("un día sin regla especial ni conceptos muestra sólo horas base y total trabajado", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days: [dayAccounting(10, { sereno: 0, colectivo: 0 })] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByLabelText(/ 10$/));

    expect(await screen.findByText("Horas base: 8 h")).toBeInTheDocument();
    expect(screen.getByText("Total trabajado: 8 h")).toBeInTheDocument();
    expect(screen.queryByText(/Hora especial aplicada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Equivalencia para liquidación/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dentro de la jornada|Horas adicionales:/)).not.toBeInTheDocument();
  });

  it("conflicto de reglas (empate de prioridad) se indica en el popover sin ocultar lo liquidable ya resuelto", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({
        days: [dayAccounting(16, { sereno: 0, colectivo: 0, multiplier: 2.5 })],
        dailyBreakdown: [{ day: 16, novelty: null, specialHourRuleNames: ["Domingo Odwyer", "Domingo Pañol"], specialHourConflict: true, totalWorkedMinutes: 480, noveltyCoveredMinutes: 0, computableMinutes: 480, novelties: [] }],
      })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByLabelText(/ 16$/));

    expect(await screen.findByText(/conflicto/i)).toBeInTheDocument();
    // 8 h × 2,5 = 20 h, todas Horas normales (sin conceptos ese día).
    expect(screen.getByText("Horas normales: 20 h")).toBeInTheDocument();
  });

  it("columnas del período: Horas base, Horas adicionales y Total trabajado (Sereno no se vuelve a sumar)", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days: [dayAccounting(4), dayAccounting(5, { sereno: 0, colectivo: 0 })] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();

    const row = (await screen.findByText("Gomez, Ana")).closest("tr")!;
    expect(screen.getByRole("columnheader", { name: "Horas base" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Horas adicionales" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total trabajado" })).toBeInTheDocument();
    expect(within(row).getByText("16 h")).toBeInTheDocument();
    expect(within(row).getByText("1 h")).toBeInTheDocument();
    expect(within(row).getAllByText("17 h")).toHaveLength(2);
    expect(within(row).queryByText("20 h")).not.toBeInTheDocument();
  });

  it("el total del período muestra un badge 'Para liquidación' sólo cuando hubo Hora Especial", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days: [dayAccounting(27, { multiplier: 2 })] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");

    expect(await screen.findByText("Para liquidación: 18 h")).toBeInTheDocument();
    const row = (await screen.findByText("Gomez, Ana")).closest("tr")!;
    expect(within(row).getAllByText("9 h").length).toBeGreaterThan(0);
  });

  it("sin Hora Especial en el mes, no se muestra ningún badge de liquidación", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days: [dayAccounting(4)] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();
    await screen.findByText("Gomez, Ana");

    expect(screen.queryByText(/Para liquidación|Total liquidable/)).not.toBeInTheDocument();
  });
});

// docs/decisions/EMPLOYEE_DAY_OFF.md §15: celda "Franco" en la grilla de
// período y "Gestionar francos" (encabezado y detalle del día, mismo modal).
describe("HoursPage — francos", () => {
  beforeEach(() => {
    vi.mocked(employeeDayOffApiService.getByDate).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 50, hasMore: false } });
  });

  it("día con franco y sin horas reconocidas: 'Franco 0 h' (no '-'), con la actividad registrada en el detalle", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    const zero = { ...dayAccounting(5, { base: 0, sereno: 0, colectivo: 0 }), dayOffUncountedMinutes: 480 };
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({
        days: [zero],
        dailyBreakdown: [{ day: 5, novelty: null, dayOff: { notes: "Compensatorio", activityShifts: 1, activityMinutes: 480 }, specialHourRuleNames: [], specialHourConflict: false, totalWorkedMinutes: 0, noveltyCoveredMinutes: 0, computableMinutes: 0, novelties: [] }],
      })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 5: Franco asignado/ });
    expect(trigger).toHaveTextContent("Franco");
    expect(trigger).toHaveTextContent("0 h");
    expect(trigger.closest("td")).toHaveClass("is-day-off");

    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByText("Franco asignado: no debía trabajar.")).toBeInTheDocument();
    expect(popover.getByText(/Actividad registrada por el fichador: 8 h\. No computa hasta que se reconozca\./)).toBeInTheDocument();
    expect(popover.getByText("Observación: Compensatorio")).toBeInTheDocument();
  });

  it("'Gestionar francos' del encabezado abre el modal con la fecha sugerida del período", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    renderGrid();

    (await screen.findByRole("button", { name: "Gestionar francos" })).click();

    expect(await screen.findByRole("heading", { name: "Gestionar francos" })).toBeInTheDocument();
    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledWith(expect.objectContaining({ date: expect.stringMatching(/^2026-08-\d{2}$/) })));
  });

  it("desde el detalle de un día: mismo modal, esa fecha y esa persona", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({ items: [buildPeriodRow()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    renderGrid();

    (await screen.findByRole("button", { name: /Detalle del .* 1$/ })).click();
    (await waitFor(() => currentDayPopover().getByRole("button", { name: "Gestionar franco" }))).click();

    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledWith({ date: "2026-08-01", search: "100", page: 1, take: 50 }));
  });
});

// "Gestionar feriados" (convocatorias, WORKED_TIME_ACCOUNTING_MODEL.md §20):
// junto a "Gestionar francos", para Nivel 1, 2 y 3; la dirección anterior de
// Configuración redirige con ?gestionar=feriados.
describe("HoursPage — gestionar feriados", () => {
  beforeEach(() => {
    vi.mocked(holidayWorkAssignmentApiService.getHolidayDates).mockResolvedValue([]);
  });

  it.each(["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"] as const)("%s: el botón del encabezado abre el diálogo en el mes de la grilla", async (role) => {
    authAs(role);
    renderGrid();

    (await screen.findByRole("button", { name: "Gestionar feriados" })).click();

    expect(await screen.findByRole("dialog", { name: "Gestionar feriados" })).toBeInTheDocument();
    await waitFor(() => expect(holidayWorkAssignmentApiService.getHolidayDates).toHaveBeenCalledWith("2026-08-01", "2026-08-31"));
  });

  it("se abre directo con ?gestionar=feriados y se cierra sin perder el período", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    renderGrid("/horas?period=2026-08&gestionar=feriados");

    const dialog = await screen.findByRole("dialog", { name: "Gestionar feriados" });
    within(dialog).getByRole("button", { name: "Cerrar" }).click();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Gestionar feriados" })).not.toBeInTheDocument());
    expect(holidayWorkAssignmentApiService.getHolidayDates).toHaveBeenCalledWith("2026-08-01", "2026-08-31");
  });

});

// Chip de novedad en la grilla de período: color del tipo (ver
// dayNoveltyColorClass); con franco, el franco manda y la novedad no se oculta.
describe("HoursPage — cobertura de novedades en la grilla de período", () => {
  const coverageItem = (overrides: Partial<NoveltyCoverageItem> = {}): NoveltyCoverageItem => ({ noveltyId: "novelty-1", noveltyTypeId: "nt-vacaciones", code: "VAC", label: "Vacaciones", uiColor: "teal", minutes: 480, settlementMinutes: 480, state: "COUNTED", countsTowardTotal: true, reviewRequired: false, reviewReasons: [], ...overrides });
  function mockDay(entry: Pick<EmployeePeriodDay, "day" | "novelty"> & Partial<EmployeePeriodDay>, days: DayAccounting[] = []) {
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ days, dailyBreakdown: [{ dayOff: null, specialHourRuleNames: [], specialHourConflict: false, totalWorkedMinutes: 0, noveltyCoveredMinutes: 0, computableMinutes: 0, novelties: [], ...entry }] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
  }

  it("muestra el total computable como número principal y el chip configurado en el detalle", async () => {
    authAs("Nivel 1 - RRHH");
    mockDay({ day: 3, novelty: null, noveltyCoveredMinutes: 480, computableMinutes: 480, novelties: [coverageItem()] });
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 3\. 1 novedad.*Vacaciones, 8 h, Computa.*8 h cubiertas/ });
    expect(trigger.closest("td")).toHaveClass("is-novelty");
    expect(trigger).toHaveTextContent("8 h");
    expect(trigger.querySelector(".day-cell-novelty-chip")).toHaveClass("novelty-color-teal", "is-counted");
    expect(trigger).toHaveTextContent("Vacaciones8hComputa");
    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByLabelText(/Vacaciones: 8 h.*Suma al total computable/)).toHaveClass("novelty-color-teal");
  });

  it("varias novedades conservan su color y estado por chip", async () => {
    authAs("Nivel 1 - RRHH");
    mockDay({ day: 4, novelty: null, novelties: [coverageItem(), coverageItem({ noveltyId: "novelty-2", noveltyTypeId: "nt-enfermedad", code: "ENF", label: "Enfermedad", uiColor: "rose", minutes: 240, settlementMinutes: 0, state: "PENDING_APPROVAL", countsTowardTotal: true })] });
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 4\. 2 novedad/ });
    expect(trigger.querySelector(".day-cell-novelty-chip")).toHaveClass("novelty-color-teal");
    expect(trigger.querySelector(".day-cell-novelty-more")).toHaveTextContent("+1");
    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByLabelText(/Vacaciones/)).toHaveClass("novelty-color-teal");
    expect(popover.getByLabelText(/Enfermedad/)).toHaveClass("novelty-color-rose", "is-pending-approval");
  });

  it.each([
    ["PENDING_APPROVAL", "Pendiente", "is-pending-approval"],
    ["INFORMATIVE", "Informativa", "is-informative"],
    ["REVIEW_REQUIRED", "Revisar", "is-review-required"],
  ] as const)("el chip inline representa %s con texto, no sólo color", async (state, label, className) => {
    authAs("Nivel 1 - RRHH");
    mockDay({ day: 6, novelty: null, novelties: [coverageItem({ state, reviewRequired: state === "REVIEW_REQUIRED", reviewReasons: state === "REVIEW_REQUIRED" ? ["REAL_WORK_EXCEEDS_EXPECTED"] : [] })] });
    renderGrid();
    const trigger = await screen.findByRole("button", { name: /Detalle del .* 6\. 1 novedad/ });
    expect(trigger.querySelector(".day-cell-novelty-chip")).toHaveClass(className);
    expect(trigger).toHaveTextContent(label);
  });

  it("Vacaciones en domingo x2 mantiene 8 h computables y 0 h trabajadas; 16 h sólo para liquidación", async () => {
    authAs("Nivel 1 - RRHH");
    const sunday = dayAccounting(2, { base: 0, sereno: 0, colectivo: 0, multiplier: 2 });
    sunday.noveltyCoveredMinutes = 480;
    sunday.computableMinutes = 480;
    sunday.settlement = { ...sunday.settlement, noveltyMinutes: 960, totalMinutes: 960 };
    sunday.novelty = { coveredMinutes: 480, settlementMinutes: 960, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 0, reviewRequired: false, items: [] };
    mockDay({ day: 2, novelty: null, totalWorkedMinutes: 0, noveltyCoveredMinutes: 480, computableMinutes: 480, novelties: [coverageItem({ settlementMinutes: 960 })] }, [sunday]);
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 2\. 1 novedad.*8 h cubiertas/ });
    expect(trigger).toHaveTextContent("8 h");
    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByText("Total trabajado: 0 h")).toBeInTheDocument();
    expect(popover.getByText("Total computable: 8 h")).toBeInTheDocument();
    expect(popover.getByText("Total para liquidación: 16 h")).toBeInTheDocument();
  });

  it("franco + novedad: FRANCO sigue siendo el estado principal y la novedad aparece en el detalle", async () => {
    authAs("Nivel 1 - RRHH");
    mockDay(
      { day: 5, novelty: null, novelties: [coverageItem({ state: "INFORMATIVE", countsTowardTotal: false, settlementMinutes: 0 })], dayOff: { notes: null, activityShifts: 0, activityMinutes: 0 } },
      [dayAccounting(5, { base: 0, sereno: 0, colectivo: 0 })],
    );
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 5: Franco asignado.*\. 1 novedad/ });
    expect(trigger.closest("td")).toHaveClass("is-day-off");
    expect(trigger.closest("td")).not.toHaveClass("is-novelty");
    expect(trigger).toHaveTextContent("Franco");
    expect(trigger).toHaveTextContent("0 h");
    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByText("Franco asignado: no debía trabajar.")).toBeInTheDocument();
    expect(popover.getByLabelText(/Vacaciones.*Visible, no suma/)).toBeInTheDocument();
  });
});

// docs/decisions/MANUAL_HOURS_VS_CLOCK_PUNCH.md: fichada sobre horas cargadas a
// mano — revisión visible en la grilla y en el listado del período.
describe("HoursPage — fichada sobre horas cargadas manualmente", () => {
  const pending: ManualHoursConflict = {
    id: "alert-1",
    employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
    operationalDate: "2026-08-01",
    status: "PENDIENTE",
    decision: null,
    resolvedAt: null,
    resolvedByName: null,
    shift: { id: "shift-1", startAt: "2026-08-01T11:00:00.000Z", endAt: "2026-08-01T17:42:00.000Z", totalMinutes: 402 },
    days: [{ date: "2026-08-01", manualMinutes: 480, manualStatus: "EN_REVISION", clockMinutes: 402, countedMinutes: 480 }],
    manualMinutes: 480,
    clockMinutes: 402,
    differenceMinutes: -78,
  };

  beforeEach(() => {
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({ items: [buildPeriodRow()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    vi.mocked(manualHoursConflictApiService.list).mockResolvedValue([pending]);
  });

  it("la celda de su fecha operativa avisa la revisión pendiente y el detalle explica qué computa, sin lenguaje de falta", async () => {
    authAs("Nivel 3 - Administrativo de Carga Horaria");
    renderGrid();

    const trigger = await screen.findByRole("button", { name: /Detalle del .* 1\. Revisión pendiente: fichada sobre horas cargadas manualmente/ });
    expect(trigger.querySelector(".alert-dot.review")).not.toBeNull();
    trigger.click();
    const popover = await waitFor(() => currentDayPopover());
    expect(popover.getByText(/Revisión pendiente: se registró una fichada \(6 h 42 min\) en una jornada que ya tenía horas cargadas manualmente \(8 h\)/)).toBeInTheDocument();
    expect(popover.getByRole("button", { name: "Revisar" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/incumpl|falta de/i);
  });

  it("listado del período + revisión: usar horas fichadas actualiza la revisión en el acto y vuelve a pedir la grilla sin recargar la página", async () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    const resolved: ManualHoursConflict = { ...pending, status: "RESUELTA", decision: "USE_CLOCK", resolvedByName: "Supervisión", resolvedAt: "2026-08-02T12:00:00.000Z" };
    vi.mocked(manualHoursConflictApiService.resolve).mockImplementation(async () => {
      // Como el backend: desde ahora el listado devuelve la revisión resuelta.
      vi.mocked(manualHoursConflictApiService.list).mockResolvedValue([resolved]);
      return resolved;
    });
    renderGrid();

    const section = (await screen.findByRole("heading", { name: "Fichadas sobre horas cargadas manualmente" })).closest(".panel") as HTMLElement;
    expect(within(section).getByText("1 revisión pendiente: mientras tanto computan las horas cargadas.")).toBeInTheDocument();
    expect(within(section).getByText("−1 h 18 min")).toBeInTheDocument();
    const gridCalls = vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length;

    within(section).getByRole("button", { name: "Revisar la fichada de Gomez, Ana del 01/08/2026" }).click();
    (await screen.findByRole("button", { name: "Usar horas fichadas" })).click();

    await waitFor(() => expect(manualHoursConflictApiService.resolve).toHaveBeenCalledWith("alert-1", "USE_CLOCK"));
    expect(await screen.findByRole("heading", { name: "Revisión resuelta" })).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByText("Se usaron las horas fichadas.")).toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length).toBeGreaterThan(gridCalls));
    // La grilla nunca se blanqueó mientras se refrescaba.
    expect(screen.getByText("Gomez, Ana")).toBeInTheDocument();
  });

  it("si no se pueden cargar las revisiones, el error queda dentro de su sección con reintento y el resto de la pantalla sigue", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(manualHoursConflictApiService.list).mockRejectedValueOnce(new Error("network")).mockResolvedValue([]);
    renderGrid();

    expect(await screen.findByText("No pudimos cargar las revisiones de fichadas sobre horas cargadas. Intentá nuevamente.")).toBeInTheDocument();
    expect(await screen.findByText("Gomez, Ana")).toBeInTheDocument();
    screen.getByRole("button", { name: /Reintentar/ }).click();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Fichadas sobre horas cargadas manualmente" })).toBeNull());
  });

  it("sin revisiones en el período no aparece la sección", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(manualHoursConflictApiService.list).mockResolvedValue([]);
    renderGrid();

    await screen.findByText("Gomez, Ana");
    expect(screen.queryByRole("heading", { name: "Fichadas sobre horas cargadas manualmente" })).toBeNull();
  });
});
