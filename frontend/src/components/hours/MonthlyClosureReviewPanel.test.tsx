import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlyClosureReviewPanel } from "./MonthlyClosureReviewPanel";
import { employeeApiService } from "../../services/api/employeeApiService";
import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { MonthlyClosure } from "../../services/api/workforceApiService";

vi.mock("../../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getTimeGrid: vi.fn() } };
});

const CONCEPT_BASE = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function buildRows(): EmployeeTimeGridRow[] {
  return [
    {
      concept: { ...CONCEPT_BASE, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" },
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
    rows: buildRows(),
    totalWorkedMinutes: 480,
    attendanceIssues: 2,
    specialHoursByDay: {},
    specialHourAdditionalMinutes: 0,
    specialHourLiquidableTotalMinutes: 480,
    ...overrides,
  };
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
    await screen.findByText("Hora normal");
  });

  it("pide la grilla una sola vez, sólo para el empleado del cierre seleccionado", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    render(<MonthlyClosureReviewPanel closure={buildClosure({ employeeId: "employee-1" })} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Hora normal");
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledTimes(1);
    expect(employeeApiService.getTimeGrid).toHaveBeenCalledWith("employee-1", "2026-08", { includeDetails: true });
  });

  it("muestra un mensaje profesional (sin detalle técnico) si falla la carga", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockRejectedValue(new Error("network down"));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    expect(await screen.findByText(/No pudimos cargar las horas/)).toBeInTheDocument();
    expect(screen.queryByText("network down")).not.toBeInTheDocument();
  });

  it("muestra los KPIs mínimos con los valores ya calculados por la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid({ attendanceIssues: 3, novelties: [] }));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Hora normal");
    expect(screen.getByText("Horas reales trabajadas")).toBeInTheDocument();
    expect(screen.getByText("Conceptos horarios adicionales")).toBeInTheDocument();
    expect(screen.getByText("Incidencias del período")).toBeInTheDocument();
    expect(screen.getByText("Novedades del período")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("no muestra el KPI de valor liquidable cuando no hay Horas Especiales en la grilla", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid({ specialHourAdditionalMinutes: 0 }));
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={vi.fn()} />);
    await screen.findByText("Hora normal");
    expect(screen.queryByText("Valor liquidable")).not.toBeInTheDocument();
  });

  it("cerrar el panel no ejecuta ninguna acción de cierre", async () => {
    vi.mocked(employeeApiService.getTimeGrid).mockResolvedValue(buildGrid());
    const close = vi.fn();
    const user = userEvent.setup();
    render(<MonthlyClosureReviewPanel closure={buildClosure()} period="2026-08" close={close} />);
    await screen.findByText("Hora normal");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
