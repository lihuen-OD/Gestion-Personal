import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HoursPage } from "./HoursPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import type { EmployeePeriodDay } from "../services/api/timeEntryApiService";
import type { DayAccounting } from "../types/workedTimeAccounting.types";
import { dayAccounting, periodAccounting } from "../test/workedTimeAccountingFixtures";
import type { Employee, TimeEntry } from "../types";

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

vi.mock("../services/api/pendingApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/pendingApiService")>();
  return { ...actual, pendingApiService: { ...actual.pendingApiService, getAll: vi.fn() } };
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
      approve: vi.fn(),
      reject: vi.fn(),
      returnForCorrection: vi.fn(),
    },
  };
});

vi.mock("../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, approve: vi.fn(), reject: vi.fn() } };
});

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return {
    ...actual,
    employeeApiService: {
      ...actual.employeeApiService,
      approveManualHourConceptBreakdown: vi.fn(),
      rejectManualHourConceptBreakdown: vi.fn(),
      returnManualHourConceptBreakdown: vi.fn(),
    },
  };
});

function buildReviewEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    employeeId: "employee-1",
    period: "2026-08",
    day: 10,
    type: "Hora normal",
    hours: 8,
    notes: "",
    status: "En revisión",
    employeeLegajo: "100",
    employeeName: "Gomez, Ana",
    ...overrides,
  };
}

function buildPendingBreakdownItem(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    kind: "hourConceptBreakdown",
    sourceId: "breakdown-1",
    status: "En revisión",
    date: "2026-08-12",
    employeeId: "employee-2",
    employeeLabel: "200 - Perez, Luis",
    title: "Colectivo",
    subtitle: "Desglose manual",
    quantity: "2.00",
    createdAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

function renderPending() {
  return render(
    <MemoryRouter initialEntries={["/pendientes?period=2026-08"]}>
      <HoursPage pendingOnly />
    </MemoryRouter>,
  );
}

function renderGrid() {
  return render(
    <MemoryRouter initialEntries={["/horas?period=2026-08"]}>
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

// /pending se consulta por fuente (kind=novelties / kind=hourConceptBreakdowns),
// cada una paginada con su meta real: el mock responde según `kind`.
function mockPending(items: PendingItem[]) {
  vi.mocked(pendingApiService.getAll).mockImplementation(async (filters = {}) => {
    const kind = filters.kind === "novelties" ? "novelty" : "hourConceptBreakdown";
    const data = items.filter((item) => item.kind === kind);
    return {
      summary: { total: data.length, novelties: kind === "novelty" ? data.length : 0, timeEntries: 0, hourConceptBreakdowns: kind === "hourConceptBreakdown" ? data.length : 0 },
      data,
      meta: { total: data.length, page: 1, pageSize: 25, hasMore: false },
    };
  });
}

beforeEach(() => {
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ costCenters: [] } as never);
  mockPending([]);
  vi.mocked(timeEntryApiService.getSummary).mockResolvedValue({
    activeEmployees: 0, employeesWithEntries: 0, pendingEmployees: 0, reviewEmployees: 0, countableHours: 0, coverage: 0,
  } as never);
  vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
  vi.mocked(timeEntryApiService.list).mockResolvedValue({
    items: [buildReviewEntry()],
    meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
  });
  vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } } as never);
  vi.mocked(timeEntryApiService.approve).mockReset();
  vi.mocked(timeEntryApiService.reject).mockReset();
  vi.mocked(timeEntryApiService.returnForCorrection).mockReset();
  vi.mocked(employeeApiService.approveManualHourConceptBreakdown).mockReset();
  vi.mocked(employeeApiService.rejectManualHourConceptBreakdown).mockReset();
  vi.mocked(employeeApiService.returnManualHourConceptBreakdown).mockReset();
});

describe("HoursPage — bandeja de revisión: aprobar/rechazar/devolver es exclusivo de RRHH (Etapa 6L.3, ajuste)", () => {
  it("RRHH ve las acciones Aprobar/Rechazar/Devolver sobre una carga en revisión", async () => {
    authAs("Nivel 1 - RRHH");
    renderPending();

    const row = await screen.findByText("100");
    const cells = within(row.closest("tr")!);
    expect(cells.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(cells.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(cells.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
    expect(cells.queryByText("Solo lectura")).not.toBeInTheDocument();
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])(
    "%s NO ve acciones de aprobación sobre una carga en revisión (queda 'Solo lectura')",
    async (role) => {
      authAs(role);
      renderPending();

      const row = await screen.findByText("100");
      const cells = within(row.closest("tr")!);
      expect(cells.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
      expect(cells.queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument();
      expect(cells.queryByRole("button", { name: "Devolver" })).not.toBeInTheDocument();
      expect(cells.getByText("Solo lectura")).toBeInTheDocument();
    },
  );

  it("RRHH aprueba una carga en revisión llamando al endpoint correcto", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Aprobar" }));

    expect(timeEntryApiService.approve).toHaveBeenCalledWith("entry-1");
  });
});

describe("HoursPage — indicador de Hora Especial en la Bandeja de revisión (Etapa 11B)", () => {
  // Bug encontrado en la auditoría 11B: appliedMultiplier ya viajaba en la
  // respuesta cruda del backend para este endpoint (GET /time-entries, vista
  // "Por registro"), pero se perdía en mapTimeEntryFromApi — la bandeja
  // nunca mostraba ningún indicador de Hora Especial.
  it("una carga en revisión con Hora Especial aplicada muestra el multiplicador con detalle en el tooltip", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.list).mockResolvedValue({
      items: [buildReviewEntry({
        specialHourMultiplier: 2, specialHourRuleNames: ["Feriado"], specialHourConflict: false,
      })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();

    const row = (await screen.findByText("100")).closest("tr")!;
    const badge = within(row).getByText("x2");
    expect(badge).toBeInTheDocument();
    expect(badge.title).toMatch(/Hora especial aplicada/);
    expect(badge.title).toMatch(/Feriado/);
    // Un registro aislado de Horas base no tiene "valor liquidable" propio:
    // depende de los conceptos del día (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md).
    expect(badge.title).not.toMatch(/liquidable/i);
  });

  it("una carga en revisión sin Hora Especial no muestra ningún indicador adicional junto a las horas", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.list).mockResolvedValue({
      items: [buildReviewEntry()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();

    const row = (await screen.findByText("100")).closest("tr")!;
    expect(within(row).queryByText(/^x\d/)).not.toBeInTheDocument();
  });

  it("conflicto de reglas: el indicador usa tono de aviso más fuerte y lo menciona en el tooltip", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.list).mockResolvedValue({
      items: [buildReviewEntry({
        specialHourMultiplier: 2.5, specialHourRuleNames: ["Domingo Odwyer", "Domingo Pañol"], specialHourConflict: true,
      })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();

    const row = (await screen.findByText("100")).closest("tr")!;
    const badge = within(row).getByText("x2.5");
    expect(badge.closest(".badge")).toHaveClass("danger");
    expect(badge.title).toMatch(/Conflicto de reglas/);
  });
});

describe("HoursPage — bandeja de revisión resuelve desgloses manuales (Etapa 6L.5)", () => {
  it("RRHH ve pendientes de Hora normal (TimeEntry) y de Desglose manual (HourConceptBreakdown) a la vez", async () => {
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    renderPending();

    expect(await screen.findByText("100")).toBeInTheDocument();
    expect(await screen.findByText("200 - Perez, Luis")).toBeInTheDocument();
    expect(screen.getByText("Colectivo")).toBeInTheDocument();
  });

  it("RRHH ve acciones Aprobar/Rechazar/Devolver también en la fila del desglose manual", async () => {
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    const cells = within(row.closest("tr")!);
    expect(cells.getByRole("button", { name: /Aprobar/i })).toBeInTheDocument();
    expect(cells.getByRole("button", { name: /Rechazar/i })).toBeInTheDocument();
    expect(cells.getByRole("button", { name: /Devolver/i })).toBeInTheDocument();
  });

  it.each(["Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"])(
    "%s NO ve acciones de aprobación sobre un desglose manual pendiente (queda 'Solo lectura')",
    async (role) => {
      authAs(role);
      mockPending([buildPendingBreakdownItem()]);
      renderPending();

      const row = await screen.findByText("200 - Perez, Luis");
      const cells = within(row.closest("tr")!);
      expect(cells.queryByRole("button", { name: /Aprobar/i })).not.toBeInTheDocument();
      expect(cells.queryByRole("button", { name: /Rechazar/i })).not.toBeInTheDocument();
      expect(cells.queryByRole("button", { name: /Devolver/i })).not.toBeInTheDocument();
      expect(cells.getByText("Solo lectura")).toBeInTheDocument();
    },
  );

  it("aprobar un desglose manual llama al endpoint correcto (employeeId + breakdownId)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    vi.mocked(employeeApiService.approveManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "APROBADO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Aprobar/i }));

    expect(employeeApiService.approveManualHourConceptBreakdown).toHaveBeenCalledWith("employee-2", "breakdown-1");
  });

  it("rechazar un desglose manual llama al endpoint correcto con el motivo", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    vi.mocked(employeeApiService.rejectManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "RECHAZADO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Rechazar/i }));
    const modal = (await screen.findByText("Rechazar carga del concepto")).closest(".modal") as HTMLElement;
    await user.type(within(modal).getByPlaceholderText("Indicá el motivo para dejar trazabilidad"), "Sin comprobante");
    await user.click(within(modal).getByRole("button", { name: "Rechazar" }));

    expect(employeeApiService.rejectManualHourConceptBreakdown).toHaveBeenCalledWith("employee-2", "breakdown-1", "Sin comprobante");
  });

  it("devolver un desglose manual llama al endpoint correcto con el motivo", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    vi.mocked(employeeApiService.returnManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "DEVUELTO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Devolver/i }));
    const modal = (await screen.findByText("Devolver carga del concepto")).closest(".modal") as HTMLElement;
    await user.type(within(modal).getByPlaceholderText("Indicá el motivo para dejar trazabilidad"), "Falta el destino");
    await user.click(within(modal).getByRole("button", { name: "Devolver" }));

    expect(employeeApiService.returnManualHourConceptBreakdown).toHaveBeenCalledWith("employee-2", "breakdown-1", "Falta el destino");
  });

  it("luego de aprobar un desglose, refresca la bandeja (vuelve a pedir /pending)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    vi.mocked(employeeApiService.approveManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "APROBADO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    const callsBefore = vi.mocked(pendingApiService.getAll).mock.calls.length;
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Aprobar/i }));

    await screen.findByText("200 - Perez, Luis");
    expect(vi.mocked(pendingApiService.getAll).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("la bandeja de Hora normal sigue funcionando igual que antes junto a la de desgloses", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Aprobar" }));

    expect(timeEntryApiService.approve).toHaveBeenCalledWith("entry-1");
  });

  it("la UI distingue las cargas de Horas base de las de conceptos horarios con secciones y columnas separadas", async () => {
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    renderPending();

    expect(await screen.findByText("Horas enviadas a revisión")).toBeInTheDocument();
    expect(screen.getByText("Conceptos horarios pendientes")).toBeInTheDocument();
    expect(within(screen.getByText("100").closest("tr")!).getByText("Hora normal")).toBeInTheDocument();
    expect(within(screen.getByText("200 - Perez, Luis").closest("tr")!).getByText("Colectivo")).toBeInTheDocument();
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: reemplaza "no da a entender
  // que el desglose suma al total" — ahora depende del tratamiento del concepto.
  it("explica qué cargas de conceptos suman al total trabajado al aprobarse y cuáles no", async () => {
    authAs("Nivel 1 - RRHH");
    mockPending([buildPendingBreakdownItem()]);
    renderPending();

    expect(await screen.findByText(/las de horas adicionales suman al total trabajado al aprobarse; las de dentro de la jornada no/i)).toBeInTheDocument();
    expect(screen.queryByText(/no modifican Hora normal ni el total trabajado/i)).not.toBeInTheDocument();
  });
});

// Etapa 7A: aprobar/rechazar/devolver una carga horaria o una novedad no tenía
// try/catch — si el endpoint fallaba, la promesa quedaba rechazada sin
// capturar, no se mostraba ningún mensaje y el modal se cerraba igual, con lo
// que la acción parecía haber funcionado. Los desgloses manuales ya tenían
// este tratamiento desde 6L.5; estos tests fijan la simetría.
describe("HoursPage — las acciones de revisión no fallan en silencio (Etapa 7A)", () => {
  it("si aprobar una carga horaria falla, muestra el error y no lo traga", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.approve).mockRejectedValue(new Error("network down"));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByText("No pudimos completar la acción. Intentá nuevamente.")).toBeInTheDocument();
  });

  it("si rechazar una carga horaria falla, muestra el error y deja el modal abierto para reintentar", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.reject).mockRejectedValue(new Error("network down"));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Rechazar" }));
    const modal = (await screen.findByText("Rechazar carga horaria")).closest(".modal") as HTMLElement;
    const reason = within(modal).getByPlaceholderText("Indicá el motivo para dejar trazabilidad");
    await user.type(reason, "No corresponde");
    await user.click(within(modal).getByRole("button", { name: "Rechazar" }));

    expect(await within(modal).findByText("No pudimos completar la acción. Intentá nuevamente.")).toBeInTheDocument();
    // el motivo tipeado sigue ahí: el modal no se cerró, se puede reintentar
    expect(reason).toHaveValue("No corresponde");
  });

  it("si aprobar una novedad falla, muestra el error", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const { noveltyApiService } = await import("../services/api/noveltyApiService");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(noveltyApiService.approve).mockRejectedValue(new Error("network down"));
    mockPending([buildPendingBreakdownItem({ kind: "novelty", sourceId: "novelty-1", title: "Vacaciones", employeeLabel: "300 - Diaz, Sol" })]);
    renderPending();

    const row = await screen.findByText("300 - Diaz, Sol");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Aprobar/i }));

    expect(await screen.findByText("No pudimos completar la acción. Intentá nuevamente.")).toBeInTheDocument();
  });

  it("una acción que sale bien no deja ningún mensaje de error colgado", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Aprobar" }));

    expect(screen.queryByText("No pudimos completar la acción. Intentá nuevamente.")).not.toBeInTheDocument();
  });
});

// Etapa 9F: el mega-efecto original (10 dependencias en un único Promise.all)
// se separó en 3 efectos por dependencia real — estos tests fijan que la
// separación es real (no sólo cosmética): cambiar un filtro que un endpoint
// no usa ya no lo vuelve a llamar, y una mutación (refresh) sigue
// invalidando todo lo relacionado, sin under-refrescar.
describe("HoursPage — Etapa 9F (separación de efectos: sin refetch innecesario)", () => {
  it("carga inicial en Bandeja: pide getSummary/list/pendingApiService.getAll una sola vez cada uno, y nunca getPeriodEmployees", async () => {
    authAs("Nivel 1 - RRHH");
    // El archivo no resetea el historial de llamadas entre tests (no hay
    // clearMocks global) — se miden deltas contra el estado previo en vez de
    // contadores absolutos, para no depender del orden de ejecución.
    const before = {
      summary: vi.mocked(timeEntryApiService.getSummary).mock.calls.length,
      list: vi.mocked(timeEntryApiService.list).mock.calls.length,
      pending: vi.mocked(pendingApiService.getAll).mock.calls.length,
      periodEmployees: vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length,
    };

    renderPending();

    await screen.findByText("100");
    expect(vi.mocked(timeEntryApiService.getSummary).mock.calls.length - before.summary).toBe(1);
    expect(vi.mocked(timeEntryApiService.list).mock.calls.length - before.list).toBe(1);
    // 2 = una por fuente paginada (novedades + desgloses), no una carga kind=all.
    expect(vi.mocked(pendingApiService.getAll).mock.calls.length - before.pending).toBe(2);
    expect(vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length).toBe(before.periodEmployees);
  });

  it("carga inicial en Carga de horas: pide getSummary/getPeriodEmployees una sola vez cada uno, y nunca list/listByEmployee/pendingApiService.getAll", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const before = {
      summary: vi.mocked(timeEntryApiService.getSummary).mock.calls.length,
      periodEmployees: vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length,
      list: vi.mocked(timeEntryApiService.list).mock.calls.length,
      listByEmployee: vi.mocked(timeEntryApiService.listByEmployee).mock.calls.length,
      pending: vi.mocked(pendingApiService.getAll).mock.calls.length,
    };

    renderGrid();

    await screen.findByText("Gomez, Ana");
    expect(vi.mocked(timeEntryApiService.getSummary).mock.calls.length - before.summary).toBe(1);
    expect(vi.mocked(timeEntryApiService.getPeriodEmployees).mock.calls.length - before.periodEmployees).toBe(1);
    expect(vi.mocked(timeEntryApiService.list).mock.calls.length).toBe(before.list);
    expect(vi.mocked(timeEntryApiService.listByEmployee).mock.calls.length).toBe(before.listByEmployee);
    expect(vi.mocked(pendingApiService.getAll).mock.calls.length).toBe(before.pending);
  });

  it("cambiar de página de revisión sólo vuelve a pedir list — no getSummary ni pendingApiService.getAll", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.list).mockResolvedValueOnce({
      items: [buildReviewEntry()],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    renderPending();
    await screen.findByText("100");
    const summaryCallsBefore = vi.mocked(timeEntryApiService.getSummary).mock.calls.length;
    const pendingCallsBefore = vi.mocked(pendingApiService.getAll).mock.calls.length;

    vi.mocked(timeEntryApiService.list).mockResolvedValueOnce({
      items: [buildReviewEntry({ id: "entry-2", employeeLegajo: "200" })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await screen.findByText("200");
    expect(timeEntryApiService.getSummary).toHaveBeenCalledTimes(summaryCallsBefore);
    expect(pendingApiService.getAll).toHaveBeenCalledTimes(pendingCallsBefore);
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

  it("una mutación (aprobar) sí vuelve a pedir list, pendingApiService.getAll y getSummary — refresh sigue invalidando todo lo relacionado", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();
    await screen.findByText("100");
    const listBefore = vi.mocked(timeEntryApiService.list).mock.calls.length;
    const pendingBefore = vi.mocked(pendingApiService.getAll).mock.calls.length;
    const summaryBefore = vi.mocked(timeEntryApiService.getSummary).mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() => {
      expect(timeEntryApiService.list).toHaveBeenCalledTimes(listBefore + 1);
      expect(pendingApiService.getAll).toHaveBeenCalledTimes(pendingBefore + 2);
      expect(timeEntryApiService.getSummary).toHaveBeenCalledTimes(summaryBefore + 1);
    });
  });

  it("cambiar de página de revisión con datos ya cargados no blanquea la tabla mientras llega la respuesta nueva", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.list).mockResolvedValueOnce({
      items: [buildReviewEntry()],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    renderPending();
    await screen.findByText("100");

    let resolveNextPage!: (value: { items: TimeEntry[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(timeEntryApiService.list).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // Mientras la página 2 sigue en vuelo, la fila anterior sigue visible y
    // no aparece el skeleton de carga completo de la sección.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(document.querySelector(".loading-table")).toBeNull();

    resolveNextPage({ items: [buildReviewEntry({ id: "entry-2", employeeLegajo: "200" })], meta: { total: 30, page: 2, pageSize: 25, hasMore: false } });
    await screen.findByText("200");
  });

  it("no se pierde el período ni el centro de costo seleccionados durante un refresh", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ costCenters: [{ id: "cc-1", name: "Pañol", status: "ACTIVO" }] } as never);
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();
    await screen.findByText("100");

    const periodInput = screen.getByDisplayValue("2026-08") as HTMLInputElement;
    await user.selectOptions(screen.getByRole("combobox", { name: "Centro de costo" }), "Pañol");

    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() => expect(timeEntryApiService.list).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-08", costCenterId: "cc-1" })));
    expect(periodInput.value).toBe("2026-08");
    expect((screen.getByRole("combobox", { name: "Centro de costo" }) as HTMLSelectElement).value).toBe("Pañol");
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

  it("no hay texto técnico visible (TimeEntry, HourConceptBreakdown, schema, backend) en ninguna de las 2 pantallas", async () => {
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

  it("Bandeja de revisión pide list/getSummary/pendingApiService.getAll sin esperar a que resuelva GET /org-structure", async () => {
    authAs("Nivel 1 - RRHH");
    let resolveCatalog!: (value: { costCenters: Array<{ id: string; name: string; status: string }> }) => void;
    vi.mocked(orgStructureApiService.getCatalog).mockReturnValue(
      new Promise((resolve) => { resolveCatalog = resolve; }) as never,
    );

    renderPending();

    await screen.findByText("100");
    expect(timeEntryApiService.list).toHaveBeenCalled();
    expect(timeEntryApiService.getSummary).toHaveBeenCalled();
    expect(pendingApiService.getAll).toHaveBeenCalled();

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
    expect(popover.queryByText(/Equivalencia para liquidación|18 h|22 h|24 h|Total liquidable/)).not.toBeInTheDocument();
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
        dailyBreakdown: [{ day: 16, novelty: null, specialHourRuleNames: ["Domingo Odwyer", "Domingo Pañol"], specialHourConflict: true }],
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
    expect(within(row).getByText("17 h")).toBeInTheDocument();
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

describe("HoursPage — Bandeja 'Por persona' con el modelo de tiempo trabajado", () => {
  function buildPersonRow(overrides: {
    employee?: Partial<Employee>;
    days?: DayAccounting[];
    specialHourRuleNames?: string[];
    specialHourConflict?: boolean;
  } = {}) {
    const { days: _days, ...accounting } = periodAccounting(overrides.days ?? [dayAccounting(1, { sereno: 0, colectivo: 0 })]);
    return {
      employee: buildEmployee(overrides.employee),
      summary: {
        status: "Aprobado",
        accounting,
        specialHourRuleNames: overrides.specialHourRuleNames ?? [],
        specialHourConflict: overrides.specialHourConflict ?? false,
      },
    } as never;
  }

  async function switchToPersonTab() {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Por persona" }));
  }

  it("domingo x2 — base 8 + Sereno 3 + Colectivo 1: total trabajado 9 h (base + adicionales) y 'Para liquidación: 18 h'", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({
      items: [buildPersonRow({ days: [dayAccounting(27, { multiplier: 2 })], specialHourRuleNames: ["Domingo"] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();
    await switchToPersonTab();

    const row = (await screen.findByText("100")).closest("tr")!;
    expect(within(row).getByText("9 h")).toBeInTheDocument();
    const badge = within(row).getByText("Para liquidación: 18 h");
    expect(badge.title).toMatch(/Domingo/);
  });

  it("persona sin Horas Especiales: muestra sólo el total trabajado, sin indicador de liquidación", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({
      items: [buildPersonRow()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();
    await switchToPersonTab();

    const row = (await screen.findByText("100")).closest("tr")!;
    expect(within(row).getByText("8 h")).toBeInTheDocument();
    expect(within(row).queryByText(/Para liquidación|Total liquidable/)).not.toBeInTheDocument();
  });

  it("conflicto de reglas: el indicador usa tono de aviso más fuerte y lo menciona en el tooltip", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({
      items: [buildPersonRow({
        days: [dayAccounting(16, { sereno: 0, colectivo: 0, multiplier: 2.5 })],
        specialHourRuleNames: ["Domingo Odwyer", "Domingo Pañol"], specialHourConflict: true,
      })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();
    await switchToPersonTab();

    const row = (await screen.findByText("100")).closest("tr")!;
    const badge = within(row).getByText("Para liquidación: 20 h");
    expect(badge.closest(".badge")).toHaveClass("danger");
    expect(badge.title).toMatch(/Conflicto de reglas/);
  });

  it("las acciones de 'Ver detalle' existentes siguen disponibles sin cambios", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({
      items: [buildPersonRow({ days: [dayAccounting(27, { multiplier: 2 })] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderPending();
    await switchToPersonTab();

    const row = (await screen.findByText("100")).closest("tr")!;
    expect(within(row).getByRole("link", { name: "Ver detalle" })).toBeInTheDocument();
  });

  it("no hay texto técnico visible en la vista 'Por persona' con Hora Especial aplicada", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.listByEmployee).mockResolvedValue({
      items: [buildPersonRow({ days: [dayAccounting(27, { multiplier: 2 })], specialHourRuleNames: ["Domingo"] })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const { container } = renderPending();
    await switchToPersonTab();
    await screen.findByText("100");

    expect(container.textContent).not.toMatch(/TimeEntry|HourConceptBreakdown|DoubleHourRule|SpecialHourRuleApplication|WITHIN_BASE|ADDITIVE_TO_WORKED_TOTAL|schema|payload/i);
  });
});

// Etapa audit-human-identity: las observaciones legadas de TimeEntry pueden
// traer ids técnicos (reconciliación 15M.4, motor de fichadas viejo). La UI de
// horas nunca debe mostrarlos.
describe("HoursPage — la observación de una carga nunca muestra ids técnicos", () => {
  it("las variantes legadas con UUID se ven como texto de negocio", async () => {
    const mergedInto = "e92bb60e-cf14-47ba-a79b-ae0814163741";
    const workShift = "5867bcd8-5e31-4cb7-89a9-ff27c2bd27a8";
    vi.mocked(timeEntryApiService.list).mockResolvedValue({
      items: [
        buildReviewEntry({ id: "entry-merged", notes: `Generado por fichada de ingreso/salida.\nRetirada de cómputo por reconciliación 15M.4 -- fusionada en TimeEntry ${mergedInto}.` }),
        buildReviewEntry({ id: "entry-shift", employeeLegajo: "101", notes: `Fichada ${workShift}: generado por ingreso/salida. Reglas aplicadas: Feriados.` }),
      ],
      meta: { total: 2, page: 1, pageSize: 25, hasMore: false },
    });
    authAs("Nivel 1 - RRHH");
    const { container } = renderPending();

    await screen.findByText("101");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toContain("TimeEntry");
    expect(text).toContain("fusionada en la carga de Horas normales del mismo día.");
  });
});
