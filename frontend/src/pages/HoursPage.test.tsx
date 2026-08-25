import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HoursPage } from "./HoursPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import { pendingApiService, type PendingItem } from "../services/api/pendingApiService";
import { timeEntryApiService } from "../services/api/timeEntryApiService";
import type { TimeEntry } from "../types";

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
