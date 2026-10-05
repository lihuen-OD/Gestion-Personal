import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlyClosureReviewPanel } from "./MonthlyClosureReviewPanel";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { EmployeeTimeGrid } from "../../services/api/employeeApiService";
import { dayAccounting, timeGridFixture } from "../../test/workedTimeAccountingFixtures";
import type { MonthlyClosure } from "../../services/api/workforceApiService";

vi.mock("../../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getTimeGrid: vi.fn() } };
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
});

describe("MonthlyClosureReviewPanel — Etapa 15K", () => {
  it("muestra un estado de carga mientras llega la grilla", async () => {
    let resolveGrid!: (value: EmployeeTimeGrid) => void;
    vi.mocked(employeeApiService.getTimeGrid).mockReturnValue(new Promise((resolve) => { resolveGrid = resolve; }));

    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);

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
    expect(kpis).toHaveTextContent("Para liquidación18 hEquivalencia con Hora especial");
    const composition = document.querySelector(".hours-composition")!;
    expect(composition).toHaveTextContent("Horas normales5 h10 h");
    expect(composition).toHaveTextContent("Sereno3 h6 h");
    expect(composition).toHaveTextContent("Colectivo1 h2 h");
    expect(composition).toHaveTextContent("Total trabajado · Equivalencia9 h18 h");
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
});
