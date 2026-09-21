import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { dashboardMetricsApiService, type DashboardMetrics } from "../services/api/dashboardMetricsApiService";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../services/api/dashboardMetricsApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/dashboardMetricsApiService")>();
  return {
    ...actual,
    dashboardMetricsApiService: {
      ...actual.dashboardMetricsApiService,
      getMetrics: vi.fn(),
      getAudit: vi.fn(),
    },
  };
});

function authAsRrhh() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "Ana Pérez", email: "ana@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo", sector: "Ventas" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

function authAsSupervisor() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-2", name: "Luis Gómez", email: "luis@test.com", password: "", role: "Nivel 2 - Supervisión / Gestión", status: "Activo", sector: "Ventas" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

const baseMetrics: DashboardMetrics = {
  active: 42,
  inactive: 3,
  total: 45,
  absenceRate: "2.5",
  absenceDays: 10,
  turnoverRate: "1.1",
  exits: 2,
  averageAge: "35",
  averageTenure: "4",
  transported: 5,
  loadedHours: 800,
  loadCoverage: 90,
  pendingLoads: 4,
  reviewLoads: 1,
  expiredDocuments: 2,
  expiringDocuments: 3,
  missingResponsible: 1,
  pendingNovelties: 2,
  headcountByCompany: [],
  headcountBySector: [],
  transportByCity: [],
  transportRoutes: [],
  upcomingBirthdays: [],
  period: "2026-09",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Etapa 15M.5 (docs/decisions/HUMAN_DURATION_FORMAT_15M5.md): el KPI "Horas
// cargadas" interpolaba `metrics.loadedHours` crudo (`${metrics.loadedHours} h`)
// — un decimal técnico sin formatear, nunca una duración humana. 2.35 horas
// decimales NO son "2h 35min", son 2h 21min (0.35 * 60 = 21).
describe("DashboardPage — KPI 'Horas cargadas' muestra duración humana (Etapa 15M.5)", () => {
  it("2.35 horas decimales se muestran como '2 h 21 min', nunca como '2.35 h'", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue({ ...baseMetrics, loadedHours: 2.35 });
    vi.mocked(dashboardMetricsApiService.getAudit).mockResolvedValue([]);

    renderPage();

    // Aparece dos veces (la tarjeta KPI y el resumen compacto de "Control de
    // carga horaria") — ambas deben coincidir en el mismo formato humano.
    await screen.findByText("42");
    expect(screen.getAllByText("2 h 21 min").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2\.35/)).not.toBeInTheDocument();
  });
});

// Etapa 14F.2: antes, metrics y audit compartían un único estado `status` —
// si /audit tardaba o fallaba, las KPI cards (que no dependen de audit)
// quedaban esperando o se rompían junto con él. Ver docs/decisions/
// INITIAL_APP_LANDING_OPTIMIZATION_14F2.md.
describe("DashboardPage — metrics y audit desacoplados (Etapa 14F.2)", () => {
  it("muestra las KPI cards apenas metrics resuelve, aunque audit siga pendiente", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue(baseMetrics);
    let resolveAudit!: (value: Awaited<ReturnType<typeof dashboardMetricsApiService.getAudit>>) => void;
    vi.mocked(dashboardMetricsApiService.getAudit).mockReturnValue(new Promise((resolve) => { resolveAudit = resolve; }));

    renderPage();

    await screen.findByText("42");
    // El widget de actividad reciente sigue con su propio loading, sin
    // bloquear las KPI cards ya visibles.
    expect(document.querySelector(".loading-table")).not.toBeNull();

    resolveAudit([]);
  });

  it("si audit falla, las KPI cards siguen visibles — el error queda localizado en el widget", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue(baseMetrics);
    vi.mocked(dashboardMetricsApiService.getAudit).mockRejectedValue(new Error("network error"));

    renderPage();

    await screen.findByText("42");
    await screen.findByText("No se pudo cargar la información");
    // Confirma que el error es del widget de auditoría, no del dashboard entero.
    expect(screen.queryByText("No se pudieron cargar los indicadores.")).not.toBeInTheDocument();
  });

  it("si metrics falla, muestra error localizado en KPIs (aunque audit haya resuelto)", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockRejectedValue(new Error("network error"));
    vi.mocked(dashboardMetricsApiService.getAudit).mockResolvedValue([]);

    renderPage();

    await screen.findByText("No se pudieron cargar los indicadores.");
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("para roles sin auditoría (Nivel 2), no llama a getAudit", async () => {
    authAsSupervisor();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue(baseMetrics);

    renderPage();

    await screen.findByText("42");
    expect(dashboardMetricsApiService.getAudit).not.toHaveBeenCalled();
    expect(screen.queryByText("Actividad reciente")).not.toBeInTheDocument();
  });

  it("mantiene el retry de metrics tras un error", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce(baseMetrics);
    vi.mocked(dashboardMetricsApiService.getAudit).mockResolvedValue([]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("No se pudieron cargar los indicadores.");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    await screen.findByText("42");
  });

  it("permite reintentar audit sin volver a pedir metrics", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue(baseMetrics);
    vi.mocked(dashboardMetricsApiService.getAudit).mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce([]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("42");
    await screen.findByText("No se pudo cargar la información");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    await screen.findByText("Todavía no hay actividad registrada.");
    expect(dashboardMetricsApiService.getMetrics).toHaveBeenCalledTimes(1);
    expect(dashboardMetricsApiService.getAudit).toHaveBeenCalledTimes(2);
  });
});

// Etapa 15M.20: "Actividad reciente" mostraba nombres de modelo del backend
// crudos (WorkShift, ShiftAlert, HourConceptBreakdown) cuando la entidad no
// estaba en el mapa local de la página — ver utils/auditLabels.ts.
describe("DashboardPage — Actividad reciente sin fugas de nombres técnicos (Etapa 15M.20)", () => {
  it("traduce WorkShift, ShiftAlert y HourConceptBreakdown a lenguaje de negocio", async () => {
    authAsRrhh();
    vi.mocked(dashboardMetricsApiService.getMetrics).mockResolvedValue(baseMetrics);
    vi.mocked(dashboardMetricsApiService.getAudit).mockResolvedValue([
      { id: "a1", date: "18/09/2026", time: "10:00", user: "Ana Gómez", role: "Nivel 1 - RRHH", action: "UPDATE", entity: "WorkShift", previous: "-", next: "-", reason: "-" },
      { id: "a2", date: "18/09/2026", time: "10:05", user: "Ana Gómez", role: "Nivel 1 - RRHH", action: "UPDATE", entity: "ShiftAlert", previous: "-", next: "-", reason: "-" },
      { id: "a3", date: "18/09/2026", time: "10:10", user: "Ana Gómez", role: "Nivel 1 - RRHH", action: "UPDATE", entity: "HourConceptBreakdown", previous: "-", next: "-", reason: "-" },
    ]);

    renderPage();

    await screen.findByText("Jornada laboral");
    expect(screen.getByText("Alerta de turno")).toBeInTheDocument();
    expect(screen.getByText("Desglose de conceptos horarios")).toBeInTheDocument();

    expect(screen.queryByText("WorkShift")).not.toBeInTheDocument();
    expect(screen.queryByText("ShiftAlert")).not.toBeInTheDocument();
    expect(screen.queryByText("HourConceptBreakdown")).not.toBeInTheDocument();
  });
});
