import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ShiftTable } from "./ShiftTable";
import type { ShiftTemplate } from "../../services/api/workforceApiService";

const shift = (id: string, code: string, name: string, categoryName: string | null, startTime: string) =>
  ({ id, code, name, categoryName, startTime, endTime: "18:00", crossesMidnight: false, status: "ACTIVO" }) as ShiftTemplate;

const items = [shift("a", "T-10", "Tarde", "Operativo", "14:00"), shift("b", "T-2", "Mañana", null, "06:00"), shift("c", "T-1", "Noche", "Administrativo", "22:00")];
const counts = { a: { enabled: 9, disabled: 0 }, b: { enabled: 10, disabled: 1 }, c: { enabled: 2, disabled: 0 } };

function renderTable() {
  render(<MemoryRouter><ShiftTable items={items} counts={counts} canEdit onToggleStatus={() => {}} /></MemoryRouter>);
}

const column = (index: number) => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[index].textContent);

describe("ShiftTable — ordenamiento", () => {
  it("ordena conteos numéricamente, no como texto (2 < 9 < 10)", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Empleados habilitados" }));
    expect(column(5)).toEqual(["2", "9", "10"]);
    await userEvent.click(screen.getByRole("button", { name: "Empleados habilitados" }));
    expect(column(5)).toEqual(["10", "9", "2"]);
  });

  it("al cambiar de columna arranca en ASC y la anterior vuelve a none", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Turno" }));
    await userEvent.click(screen.getByRole("button", { name: "Turno" }));
    await userEvent.click(screen.getByRole("button", { name: "Horario" }));
    expect(column(3)).toEqual(["06:00–18:00", "14:00–18:00", "22:00–18:00"]);
    expect(screen.getByRole("columnheader", { name: "Horario" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "Turno" })).toHaveAttribute("aria-sort", "none");
  });

  it("categoría vacía queda al final en ASC y DESC", async () => {
    renderTable();
    const button = screen.getByRole("button", { name: "Categoría" });
    await userEvent.click(button);
    expect(column(2)).toEqual(["Administrativo", "Operativo", "Sin categoría"]);
    await userEvent.click(button);
    expect(column(2)).toEqual(["Operativo", "Administrativo", "Sin categoría"]);
  });

  it("Acciones y Cruza medianoche no son ordenables", () => {
    renderTable();
    for (const name of ["Acciones", "Cruza medianoche"]) {
      const header = screen.getByRole("columnheader", { name });
      expect(within(header).queryByRole("button")).toBeNull();
      expect(header).not.toHaveAttribute("aria-sort");
    }
  });
});
