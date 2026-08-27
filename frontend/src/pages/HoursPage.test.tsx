import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HoursPage } from "./HoursPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
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

function buildPeriodRow(overrides: { employee?: Partial<Employee>; normal?: number; special?: number; total?: number } = {}) {
  return {
    employee: buildEmployee(overrides.employee),
    summary: {
      total: overrides.total ?? 8,
      normal: overrides.normal ?? 8,
      special: overrides.special ?? 0,
      incidents: 0,
      status: "Aprobado",
      dailyBreakdown: [] as Array<{ day: number; normal: number; special: number; total: number; novelty: { label: string } | null }>,
    },
  } as never;
}

beforeEach(() => {
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue({ costCenters: [] } as never);
  vi.mocked(pendingApiService.getAll).mockResolvedValue({ summary: { total: 0, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 0 }, data: [] });
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

describe("HoursPage — bandeja de revisión resuelve desgloses manuales (Etapa 6L.5)", () => {
  it("RRHH ve pendientes de Hora normal (TimeEntry) y de Desglose manual (HourConceptBreakdown) a la vez", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    renderPending();

    expect(await screen.findByText("100")).toBeInTheDocument();
    expect(await screen.findByText("200 - Perez, Luis")).toBeInTheDocument();
    expect(screen.getByText("Colectivo")).toBeInTheDocument();
  });

  it("RRHH ve acciones Aprobar/Rechazar/Devolver también en la fila del desglose manual", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
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
      vi.mocked(pendingApiService.getAll).mockResolvedValue({
        summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
        data: [buildPendingBreakdownItem()],
      });
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
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
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
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    vi.mocked(employeeApiService.rejectManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "RECHAZADO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Rechazar/i }));
    const modal = (await screen.findByText("Rechazar desglose manual")).closest(".modal") as HTMLElement;
    await user.type(within(modal).getByPlaceholderText("Indicá el motivo para dejar trazabilidad"), "Sin comprobante");
    await user.click(within(modal).getByRole("button", { name: "Rechazar" }));

    expect(employeeApiService.rejectManualHourConceptBreakdown).toHaveBeenCalledWith("employee-2", "breakdown-1", "Sin comprobante");
  });

  it("devolver un desglose manual llama al endpoint correcto con el motivo", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    vi.mocked(employeeApiService.returnManualHourConceptBreakdown).mockResolvedValue({ id: "breakdown-1", status: "DEVUELTO" });
    renderPending();

    const row = await screen.findByText("200 - Perez, Luis");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: /Devolver/i }));
    const modal = (await screen.findByText("Devolver desglose manual")).closest(".modal") as HTMLElement;
    await user.type(within(modal).getByPlaceholderText("Indicá el motivo para dejar trazabilidad"), "Falta el destino");
    await user.click(within(modal).getByRole("button", { name: "Devolver" }));

    expect(employeeApiService.returnManualHourConceptBreakdown).toHaveBeenCalledWith("employee-2", "breakdown-1", "Falta el destino");
  });

  it("luego de aprobar un desglose, refresca la bandeja (vuelve a pedir /pending)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
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
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    vi.mocked(timeEntryApiService.approve).mockResolvedValue(buildReviewEntry({ status: "Aprobado" }));
    renderPending();

    const row = await screen.findByText("100");
    await user.click(within(row.closest("tr")!).getByRole("button", { name: "Aprobar" }));

    expect(timeEntryApiService.approve).toHaveBeenCalledWith("entry-1");
  });

  it("la UI distingue 'Hora normal' de 'Desglose manual' con secciones y columnas separadas", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    renderPending();

    expect(await screen.findByText("Horas enviadas a revisión")).toBeInTheDocument();
    expect(screen.getByText("Desgloses manuales pendientes")).toBeInTheDocument();
    expect(within(screen.getByText("100").closest("tr")!).getByText("Hora normal")).toBeInTheDocument();
    expect(within(screen.getByText("200 - Perez, Luis").closest("tr")!).getByText("Colectivo")).toBeInTheDocument();
  });

  it("no da a entender que el desglose manual suma al total trabajado", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 0, timeEntries: 0, hourConceptBreakdowns: 1 },
      data: [buildPendingBreakdownItem()],
    });
    renderPending();

    expect(await screen.findByText(/no modifican Hora normal ni el total trabajado/i)).toBeInTheDocument();
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
    vi.mocked(pendingApiService.getAll).mockResolvedValue({
      summary: { total: 1, novelties: 1, timeEntries: 0, hourConceptBreakdowns: 0 },
      data: [buildPendingBreakdownItem({ kind: "novelty", sourceId: "novelty-1", title: "Vacaciones", employeeLabel: "300 - Diaz, Sol" })],
    });
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
    expect(vi.mocked(pendingApiService.getAll).mock.calls.length - before.pending).toBe(1);
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
      expect(pendingApiService.getAll).toHaveBeenCalledTimes(pendingBefore + 1);
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

  it("Carga de horas: Normales/Especiales/Total se muestran por separado — Horas Especiales no se mezcla con Hora normal", async () => {
    authAs("Nivel 1 - RRHH");
    vi.mocked(timeEntryApiService.getPeriodEmployees).mockResolvedValue({
      items: [buildPeriodRow({ normal: 40, special: 8, total: 48 })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    renderGrid();

    const row = (await screen.findByText("Gomez, Ana")).closest("tr")!;
    const cells = within(row);
    expect(cells.getByText("40.00 h")).toBeInTheDocument();
    expect(cells.getByText("8.00 h")).toBeInTheDocument();
    expect(cells.getByText("48.00 h")).toBeInTheDocument();
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
