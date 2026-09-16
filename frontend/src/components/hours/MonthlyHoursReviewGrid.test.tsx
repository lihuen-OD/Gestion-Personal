import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthlyHoursReviewGrid } from "./MonthlyHoursReviewGrid";
import type { EmployeeTimeGrid, EmployeeTimeGridRow } from "../../services/api/employeeApiService";
import type { Novelty } from "../../types";

const CONCEPT_BASE = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function buildRows(serenoMinutes = 360): EmployeeTimeGridRow[] {
  return [
    {
      concept: { ...CONCEPT_BASE, id: "normal", code: "HC-NORMAL", name: "Hora normal", kind: "NORMAL", status: "ACTIVO", loadMode: null, systemRole: "NORMAL_BASE" },
      role: "NORMAL_BASE",
      minutesByDay: { "1": 480 },
      totalMinutes: 480,
    },
    {
      concept: { ...CONCEPT_BASE, id: "sereno", code: "HC-SERENO", name: "Sereno", kind: "SERENO", status: "ACTIVO", loadMode: "AUTOMATIC", systemRole: null },
      role: "ADDITIONAL",
      minutesByDay: { "1": serenoMinutes },
      totalMinutes: serenoMinutes,
    },
  ];
}

function buildNovelty(overrides: Partial<Novelty> = {}): Novelty {
  return {
    id: "novelty-1",
    employeeId: "employee-1",
    type: "Vacaciones",
    from: "2026-08-01",
    to: "2026-08-01",
    quantity: "1 día",
    status: "Aprobado",
    createdBy: "Sistema",
    ...overrides,
  };
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
    attendanceIssues: 0,
    specialHoursByDay: {},
    specialHourAdditionalMinutes: 0,
    specialHourLiquidableTotalMinutes: 480,
    ...overrides,
  };
}

describe("MonthlyHoursReviewGrid — Etapa 15K", () => {
  it("muestra la fila de Hora normal", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-08" />);
    expect(screen.getByText("Hora normal")).toBeInTheDocument();
    expect(screen.getByText("Total trabajado · Base del sistema")).toBeInTheDocument();
  });

  it("muestra los conceptos adicionales como desglose, no como parte del total real", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-08" />);
    expect(screen.getByText("Sereno")).toBeInTheDocument();
    expect(screen.getByText(/Desglose ·/)).toBeInTheDocument();
  });

  it("muestra una columna por día del período", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-02" />);
    // Febrero 2026 no es bisiesto -> 28 días + columna "Concepto" + columna "Total"
    expect(screen.getAllByRole("columnheader")).toHaveLength(30);
  });

  it("muestra el total por fila usando el valor ya calculado en la grilla", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-08" />);
    const rows = screen.getAllByRole("row");
    const serenoRow = rows.find((row) => within(row).queryByText("Sereno"));
    expect(serenoRow).toBeTruthy();
    const cells = within(serenoRow!).getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent("6.00");
  });

  it("maneja un día sin horas mostrando un guion, sin romper", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-08" />);
    const rows = screen.getAllByRole("row");
    const normalRow = rows.find((row) => within(row).queryByText("Hora normal"));
    // día 2 (segunda celda de datos) no tiene carga
    expect(within(normalRow!).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("muestra un indicador cuando hay novedades asociadas al día", () => {
    const grid = buildGrid({ novelties: [buildNovelty({ from: "2026-08-01", to: "2026-08-01" })] });
    const { container } = render(<MonthlyHoursReviewGrid grid={grid} period="2026-08" />);
    expect(container.querySelector(".alert-dot.purple")).toBeInTheDocument();
  });

  it("muestra un indicador de Hora Especial cuando la grilla ya trae el multiplicador del día", () => {
    const grid = buildGrid({
      specialHoursByDay: { "1": { multiplier: 2, additionalMinutes: 480, liquidableTotalMinutes: 960, ruleNames: ["Feriado"], conflict: false } },
      specialHourAdditionalMinutes: 480,
      specialHourLiquidableTotalMinutes: 960,
    });
    const { container } = render(<MonthlyHoursReviewGrid grid={grid} period="2026-08" />);
    expect(container.querySelector(".alert-dot.orange")).toBeInTheDocument();
  });

  it("es read-only: no expone ningún botón dentro de la grilla", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={buildGrid()} period="2026-08" />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("muestra un mensaje de vacío en vez de una tabla cuando no hay filas", () => {
    render(<MonthlyHoursReviewGrid grid={buildGrid({ rows: [] })} period="2026-08" />);
    expect(screen.getByText("No hay horas registradas para este período.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
