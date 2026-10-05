import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthlyHoursReviewGrid } from "./MonthlyHoursReviewGrid";
import type { Novelty } from "../../types";
import { dayAccounting, timeGridFixture } from "../../test/workedTimeAccountingFixtures";

function buildNovelty(overrides: Partial<Novelty> = {}): Novelty {
  return {
    id: "novelty-1",
    employeeId: "employee-1",
    type: "Vacaciones",
    from: "2026-08-04",
    to: "2026-08-04",
    quantity: "1 día",
    status: "Aprobado",
    createdBy: "Sistema",
    ...overrides,
  };
}

function rowNamed(name: string) {
  const row = screen.getAllByRole("row").find((item) => within(item).queryByText(name, { selector: "b" }));
  expect(row).toBeTruthy();
  return row!;
}

function lastCell(row: HTMLElement) {
  const cells = within(row).getAllByRole("cell");
  return cells[cells.length - 1]!;
}

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: la grilla del panel de cierre
// muestra la composición real — Sereno dentro de la jornada nunca se vuelve a
// sumar, Colectivo sí suma al total.
describe("MonthlyHoursReviewGrid — modelo de tiempo trabajado", () => {
  it("día común: Horas base 8, Horas normales 5, Sereno 3 dentro de la jornada, Colectivo 1 adicional, Total trabajado 9", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);

    expect(lastCell(rowNamed("Horas base"))).toHaveTextContent("8h");
    expect(screen.getByText("Distribución de la jornada")).toBeInTheDocument();
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("5h");
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("3h");
    expect(screen.getByText("Horas adicionales")).toBeInTheDocument();
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("1h");
    expect(lastCell(rowNamed("Total trabajado"))).toHaveTextContent("9h");
    // Sin Hora Especial no hay fila de equivalencia.
    expect(screen.queryByText("Equivalencia para liquidación")).not.toBeInTheDocument();
  });

  it("copy de negocio: cada fila dice si suma o no al total, sin enums técnicos", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);
    expect(screen.getByText("Registradas · fichada o carga")).toBeInTheDocument();
    expect(screen.getByText("No suma al total · Manual y automático")).toBeInTheDocument();
    expect(screen.getByText("Suma al total · Manual")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/WITHIN_BASE|ADDITIVE_TO_WORKED_TOTAL|NORMAL_BASE|HourConceptBreakdown/);
  });

  it("domingo x2: total trabajado 9 y equivalencia para liquidación 18 (nunca 22 ni 24)", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(2, { multiplier: 2 })])} period="2026-08" />);

    expect(lastCell(rowNamed("Total trabajado"))).toHaveTextContent("9h");
    expect(lastCell(rowNamed("Equivalencia para liquidación"))).toHaveTextContent("18h");
    expect(container.textContent).not.toMatch(/22h|24h/);
    expect(container.querySelector(".alert-dot.orange")).toBeInTheDocument();
  });

  it("muestra una columna por día del período", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-02" />);
    // Febrero 2026 no es bisiesto -> 28 días + columna "Concepto" + columna "Total"
    expect(screen.getAllByRole("columnheader")).toHaveLength(30);
  });

  it("maneja un día sin horas mostrando un guion, sin romper", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);
    expect(within(rowNamed("Horas base")).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("muestra un indicador cuando hay novedades asociadas al día", () => {
    const grid = timeGridFixture(undefined, { novelties: [buildNovelty()] });
    const { container } = render(<MonthlyHoursReviewGrid grid={grid} period="2026-08" />);
    expect(container.querySelector(".alert-dot.purple")).toBeInTheDocument();
  });

  it("es read-only: no expone ningún botón dentro de la grilla", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("usa duración compacta legible para valores de más de 10 y 24 horas", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(1, { base: 12 + 40 / 60, sereno: 0, colectivo: 0 })])} period="2026-08" />);
    expect(screen.getAllByText("12h 40m").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/12\.67/)).not.toBeInTheDocument();
  });

  it("expone el contenedor horizontal y la tabla mensual mediante clases estables", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);
    expect(container.querySelector(".hours-grid.monthly-concept-grid[tabindex='0']")).toBeInTheDocument();
    expect(container.querySelector("table.monthly-concept-table")).toBeInTheDocument();
  });

  it("muestra un mensaje de vacío en vez de una tabla cuando no hay filas", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture(undefined, { rows: [] })} period="2026-08" />);
    expect(screen.getByText("No hay horas registradas para este período.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
