import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MonthlyHoursReviewGrid } from "./MonthlyHoursReviewGrid";
import type { Novelty } from "../../types";
import { dayAccounting, periodAccounting, timeGridFixture } from "../../test/workedTimeAccountingFixtures";

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
  it("día común: Horas base 8, Horas normales 5, Sereno 3 dentro de la jornada, Colectivo 1 adicional, Total para liquidación 9", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);

    expect(lastCell(rowNamed("Horas base"))).toHaveTextContent("8h");
    expect(screen.getByText("Distribución de la jornada")).toBeInTheDocument();
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("5h");
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("3h");
    expect(screen.getByText("Horas adicionales")).toBeInTheDocument();
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("1h");
    expect(lastCell(rowNamed("Total para liquidación"))).toHaveTextContent("9h");
    // Sin Hora Especial no hay fila de equivalencia ni ruido de liquidación (CASO A/G).
    expect(screen.queryByText("Equivalencia para liquidación")).not.toBeInTheDocument();
    expect(document.querySelector(".hours-total-real")).not.toBeInTheDocument();
    expect(document.querySelector(".alert-dot.orange")).not.toBeInTheDocument();
  });

  it("copy de negocio: cada fila dice si suma o no al total, sin enums técnicos", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture()} period="2026-08" />);
    expect(screen.getByText("Registradas · fichada o carga")).toBeInTheDocument();
    expect(screen.getByText("No suma al total · Manual y automático")).toBeInTheDocument();
    expect(screen.getByText("Suma al total · Manual")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/WITHIN_BASE|ADDITIVE_TO_WORKED_TOTAL|NORMAL_BASE|HourConceptBreakdown/);
  });

  // docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §17: cada fila que se
  // liquida muestra su tiempo PARA LIQUIDACIÓN; no hay fila global que mezcle
  // conceptos con valores distintos. La fila final suma lo liquidable de las
  // filas (backend settlement.totalMinutes); Horas base sigue siendo real.
  it("CASO B/E/F — día x2 (base 8, Sereno 3, Colectivo 1): Horas normales 10, Sereno 6, Colectivo 2; Total para liquidación 18", () => {
    const { container } = render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(2, { multiplier: 2 })])} period="2026-08" />);

    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("10h");
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("5h reales");
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("6h");
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("3h reales");
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("2h");
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("1h real");
    expect(lastCell(rowNamed("Total para liquidación"))).toHaveTextContent("18h");
    expect(within(rowNamed("Total para liquidación")).getByLabelText(/Total para liquidación, día 2:/)).toHaveTextContent("18h");
    // Horas base: siempre tiempo real registrado, sin indicador de Hora Especial.
    expect(lastCell(rowNamed("Horas base"))).toHaveTextContent("8h");
    expect(rowNamed("Horas base").querySelector(".alert-dot.orange")).not.toBeInTheDocument();
    // En la grilla no queda ningún "Total trabajado" con otro significado.
    expect(screen.queryByText("Total trabajado")).not.toBeInTheDocument();
    expect(screen.queryByText("Equivalencia para liquidación")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/22h|24h/);
  });

  it("la celda del día especial muestra lo liquidable y el indicador explica el real y la regla", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(2, { multiplier: 2 })])} period="2026-08" />);

    const colectivoDay2 = within(rowNamed("Colectivo")).getByLabelText(/Colectivo, día 2:/);
    expect(colectivoDay2).toHaveTextContent("2h");
    expect(colectivoDay2).toHaveAttribute("aria-label", "Colectivo, día 2: Domingos x2 · 1 h real · 2 h para liquidación");
    expect(colectivoDay2.querySelector(".alert-dot.orange")).toHaveAttribute("title", "Domingos x2 · 1 h real · 2 h para liquidación");
    expect(within(rowNamed("Horas normales")).getByLabelText(/Horas normales, día 2:/)).toHaveTextContent("10h");
    expect(within(rowNamed("Sereno")).getByLabelText(/Sereno, día 2:/)).toHaveAttribute("aria-label", "Sereno, día 2: Domingos x2 · 3 h reales · 6 h para liquidación");
  });

  it("CASO C/D — período mixto: TOTAL de cada concepto = suma de lo liquidable de cada día (real como subtexto)", () => {
    const days = [
      dayAccounting(1, { sereno: 2, colectivo: 2 }),
      dayAccounting(2, { sereno: 2, colectivo: 2 }),
      dayAccounting(3, { sereno: 2, colectivo: 2 }),
      dayAccounting(5, { base: 2 + 26 / 60, sereno: 1, colectivo: 2, multiplier: 2 }),
    ];
    render(<MonthlyHoursReviewGrid grid={timeGridFixture(days)} period="2026-10" />);

    // Sereno (dentro de la jornada): 2+2+2 + 1×2 = 8 para liquidación, 7 reales.
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("8h");
    expect(lastCell(rowNamed("Sereno"))).toHaveTextContent("7h reales");
    // Colectivo (adicional): 2+2+2 + 2×2 = 10 para liquidación, 8 reales.
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("10h");
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("8h reales");
    // Horas normales: 6+6+6 + 1 h 26 min × 2 = 20 h 52 min para liquidación.
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("20h 52m");
  });

  it("multiplicador x1.5: Colectivo 2 h reales → 3 h para liquidación", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(6, { colectivo: 2, multiplier: 1.5 })])} period="2026-08" />);
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("3h");
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("2h reales");
  });

  it("sin conceptos dentro de la jornada pero con Hora Especial, igual muestra Horas normales para liquidación", () => {
    render(<MonthlyHoursReviewGrid grid={timeGridFixture([dayAccounting(2, { sereno: 0, colectivo: 1, multiplier: 2 })])} period="2026-08" />);
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("16h");
    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("2h");
    expect(lastCell(rowNamed("Total para liquidación"))).toHaveTextContent("18h");
  });

  it("el frontend no recalcula: muestra exactamente lo que liquida el backend", () => {
    const day = dayAccounting(2, { multiplier: 2 });
    day.settlement = { ...day.settlement, totalMinutes: 1234 };
    // Valores del backend deliberadamente distintos de real × multiplicador.
    day.concepts = day.concepts.map((concept) => (concept.hourConceptId === "colectivo" ? { ...concept, settlementMinutes: 97 } : concept));
    day.settlement = { ...day.settlement, normalMinutes: 611 };
    const grid = timeGridFixture([day]);
    grid.accounting = periodAccounting([day]);
    render(<MonthlyHoursReviewGrid grid={grid} period="2026-08" />);

    expect(lastCell(rowNamed("Colectivo"))).toHaveTextContent("1h 37m");
    expect(lastCell(rowNamed("Horas normales"))).toHaveTextContent("10h 11m");
    // Total para liquidación = settlement.totalMinutes del backend, no la suma de las celdas.
    expect(lastCell(rowNamed("Total para liquidación"))).toHaveTextContent("20h 34m");
  });

  it("caso del lunes 05/10: Horas base 2h 26m, Horas normales 2h 52m, Prueba 02 2h, Colectivo 4h, Total para liquidación 8h 52m", () => {
    const day = dayAccounting(5, { base: 2 + 26 / 60, sereno: 1, colectivo: 2, multiplier: 2 });
    render(<MonthlyHoursReviewGrid grid={timeGridFixture([day])} period="2026-10" />);
    const cellOf = (row: string) => within(rowNamed(row)).getByLabelText(new RegExp(`${row}, día 5:`));
    expect(cellOf("Horas base")).toHaveTextContent("2h 26m");
    expect(cellOf("Horas normales")).toHaveTextContent("2h 52m");
    expect(cellOf("Sereno")).toHaveTextContent("2h");
    expect(cellOf("Colectivo")).toHaveTextContent("4h");
    expect(cellOf("Total para liquidación")).toHaveTextContent("8h 52m");
    expect(cellOf("Horas base").querySelector(".alert-dot.orange")).not.toBeInTheDocument();
    expect(cellOf("Horas normales").querySelector(".alert-dot.orange")).toBeInTheDocument();
    expect(cellOf("Colectivo").querySelector(".alert-dot.orange")).toBeInTheDocument();
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
