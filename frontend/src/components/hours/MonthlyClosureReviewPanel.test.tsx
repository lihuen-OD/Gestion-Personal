import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MonthlyClosureReviewPanel } from "./MonthlyClosureReviewPanel";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { EmployeeTimeGrid } from "../../services/api/employeeApiService";
import { dayAccounting, timeGridFixture } from "../../test/workedTimeAccountingFixtures";
import type { MonthlyClosure } from "../../services/api/workforceApiService";
import { noveltyApiService } from "../../services/api/noveltyApiService";

vi.mock("../../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getTimeGrid: vi.fn() } };
});

vi.mock("../../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, getCoverage: vi.fn(), resolveCoverageDay: vi.fn() } };
});

function buildGrid(overrides: Partial<EmployeeTimeGrid> = {}, days = [dayAccounting(4)]): EmployeeTimeGrid {
  return timeGridFixture(days, { attendanceIssues: 2, ...overrides });
}

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

beforeEach(() => {
  vi.mocked(employeeApiService.getTimeGrid).mockReset();
  vi.mocked(noveltyApiService.getCoverage).mockReset();
  vi.mocked(noveltyApiService.resolveCoverageDay).mockReset();
});

describe("MonthlyClosureReviewPanel — Etapa 15K", () => {
  it("muestra un estado de carga mientras llega la grilla", async () => {
    let resolveGrid!: (value: EmployeeTimeGrid) => void;
    vi.mocked(employeeApiService.getTimeGrid).mockReturnValue(new Promise((resolve) => { resolveGrid = resolve; }));

    render(<MemoryRouter><MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} /></MemoryRouter>);

    expect(screen.getByText("Cargando horas del período...")).toBeInTheDocument();
    resolveGrid(buildGrid());
    await screen.findByText("Composición");
  });

  it("pide la grilla una sola vez, sólo para el empleado del cierre seleccionado", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    render(<MonthlyClosureReviewPanel closure={buildClosure({ employeeId: "employee-1" })} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Composición");
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(1);
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledWith("employee-1", "2026-08", { includeDetails: true });
  });

  it("muestra un mensaje profesional (sin detalle técnico) si falla la carga", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockRejectedValue(new Error("network down"));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    expect(await screen.findByText(/No pudimos cargar las horas/)).toBeInTheDocument();
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  it("muestra los KPIs con los valores ya calculados por el backend: total trabajado = base + adicionales", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid({ attendanceIssues: 3, novelties: [] }));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Composición");
    const kpis = document.querySelector(".stat-grid") as HTMLElement;
    expect(kpis).toHaveTextContent("Total trabajado9 hBase 8 h + adicionales 1 h");
    expect(screen.getByText("Incidencias del período")).toBeInTheDocument();
    expect(screen.getByText("Novedades del período")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("sin Horas Especiales no muestra la equivalencia para liquidación", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Composición");
    expect(screen.queryByText("Equivalencia para liquidación")).not.toBeInTheDocument();
    expect(screen.queryByText("Para liquidación")).not.toBeInTheDocument();
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — ejemplo obligatorio.
  it("domingo x2 — base 8 + Sereno 3 + Colectivo 1: horas reales 9 y equivalencia 18 (el KPI usa la proyección nueva)", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid({}, [dayAccounting(2, { multiplier: 2 })]));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Composición");
    const kpis = document.querySelector(".stat-grid")!;
    expect(kpis).toHaveTextContent("Total trabajado9 h");
    expect(kpis).toHaveTextContent("Para liquidación18 hTrabajo y novedades con multiplicadores");
    const composition = document.querySelector(".hours-composition")!;
    expect(composition).toHaveTextContent("Horas normales5 h10 h");
    expect(composition).toHaveTextContent("Sereno3 h6 h");
    expect(composition).toHaveTextContent("Colectivo1 h2 h");
    expect(composition).toHaveTextContent("Total computableTrabajo real + cobertura válida9 h18 h");
    expect(document.body.textContent).not.toMatch(/22 h|24 h/);
  });

  it("cerrar el panel no ejecuta ninguna acción de cierre", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    const close = vi.fn();
    const user = userEvent.setup();
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={close} />);
    await screen.findByText("Composición");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("resolver una cobertura refresca la revisión y los totales sin cerrar el panel", async () => {
    const reviewItem = { noveltyId: "novelty-1", noveltyTypeId: "type-vac", code: "VAC", label: "Vacaciones", uiColor: "teal", minutes: 0, settlementMinutes: 0, state: "REVIEW_REQUIRED" as const, countsTowardTotal: true, reviewRequired: true, reviewReasons: ["SCHEDULE_UNRESOLVED" as const] };
    const pending = buildGrid({
      noveltiesByDay: { "4": [reviewItem] },
      noveltyCoverageRows: [{ noveltyType: { id: "type-vac", code: "VAC", name: "Vacaciones", uiColor: "teal" }, countsTowardTotal: true, minutesByDay: { "4": 0 }, settlementMinutesByDay: {}, stateByDay: { "4": "REVIEW_REQUIRED" }, totals: { noveltyTypeId: "type-vac", coveredMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, pendingApprovalMinutes: 0, heldMinutes: 480 } }],
    });
    pending.accounting.novelty = { ...pending.accounting.novelty, heldMinutes: 480, reviewDays: 1, reviewDates: ["2026-08-04"] };
    pending.accounting.days["4"]!.novelty = { ...pending.accounting.days["4"]!.novelty, heldMinutes: 480, reviewRequired: true };
    const resolved = buildGrid();
    resolved.accounting.noveltyCoveredMinutes = 480;
    resolved.accounting.computableMinutes = 1020;
    resolved.accounting.novelty = { ...resolved.accounting.novelty, coveredMinutes: 480 };
    resolved.noveltyCoveredMinutes = 480;
    resolved.computableMinutes = 1020;
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValueOnce(pending).mockResolvedValueOnce(resolved);
    vi.mocked(noveltyApiService.getCoverage).mockResolvedValue({ canAdjust: true, novelty: { id: "novelty-1", status: "APROBADO", fromDate: "2026-08-04", noveltyType: { code: "VAC", name: "Vacaciones", coverageMode: "EXPECTED_SCHEDULE", coverageFixedMinutes: null } }, days: [{ date: "2026-08-04", outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", reviewStatus: "PENDING", label: "Jornada sin resolver", expectedMinutes: null, baseMinutes: 0, resolution: null, resolvedBaseMinutes: null, effectiveBaseMinutes: 0, multiplier: 1, computedMinutes: 0, countsTowardTotal: true }], totals: { days: 1, coveredDays: 0, pendingReviewDays: 1, baseMinutes: 0, computedMinutes: 0 } });
    vi.mocked(noveltyApiService.resolveCoverageDay).mockResolvedValue({ date: "2026-08-04", outcome: "SCHEDULE_UNRESOLVED", scheduleReviewReason: "SCHEDULE_MISSING", reviewStatus: "RESOLVED", label: "Jornada sin resolver", expectedMinutes: null, baseMinutes: 0, resolution: "CONFIRMED_ZERO", resolvedBaseMinutes: 0, effectiveBaseMinutes: 0, multiplier: 1, computedMinutes: 0, countsTowardTotal: true });
    const user = userEvent.setup();

    render(<MemoryRouter><MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Revisar primer día" }));
    await screen.findByText("Confirmar 0 h de cobertura");
    await user.type(screen.getByLabelText("Nota obligatoria"), "Jornada confirmada");
    await user.click(screen.getByRole("button", { name: "Guardar resolución" }));

    await waitFor(() => expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/bloquean el cierre/)).not.toBeInTheDocument());
    expect(screen.getAllByText("17 h").length).toBeGreaterThan(0);
    expect(screen.getByText("Cobertura que computa").closest("tr")).toHaveTextContent("8 h");
    expect(screen.getByText("Composición")).toBeInTheDocument();
  });
});
