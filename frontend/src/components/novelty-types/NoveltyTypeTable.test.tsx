import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NoveltyTypeTable } from "./NoveltyTypeTable";
import type { NoveltyType } from "../../types/noveltyType.types";

const type = (id: string, code: string, name: string, status: NoveltyType["status"]) =>
  ({ id, code, name, description: "", kind: "AUSENCIA", status, rules: { exportsToFinnegans: false, requiresApproval: false } }) as NoveltyType;

const items = [type("1", "NOV-10", "vacaciones", "ACTIVO"), type("2", "NOV-2", "Ausencia", "INACTIVO"), type("3", "NOV-1", "Licencia", "ACTIVO")];

function renderTable() {
  render(<MemoryRouter><NoveltyTypeTable items={items} canEdit onToggleStatus={() => {}} /></MemoryRouter>);
}

const column = (index: number) => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[index].querySelector("b")?.textContent ?? within(row).getAllByRole("cell")[index].textContent);

describe("NoveltyTypeTable — ordenamiento", () => {
  it("mantiene el orden recibido hasta el primer click", () => {
    renderTable();
    expect(column(0)).toEqual(["NOV-10", "NOV-2", "NOV-1"]);
  });

  it("Novedad: ASC, DESC y aria-sort", async () => {
    renderTable();
    const button = screen.getByRole("button", { name: "Novedad" });
    await userEvent.click(button);
    expect(column(1)).toEqual(["Ausencia", "Licencia", "vacaciones"]);
    expect(screen.getByRole("columnheader", { name: "Novedad" })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(button);
    expect(column(1)).toEqual(["vacaciones", "Licencia", "Ausencia"]);
    expect(screen.getByRole("columnheader", { name: "Novedad" })).toHaveAttribute("aria-sort", "descending");
  });

  it("cambio a Codigo usa orden natural y resetea aria-sort de la columna anterior", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Novedad" }));
    await userEvent.click(screen.getByRole("button", { name: "Codigo" }));
    expect(column(0)).toEqual(["NOV-1", "NOV-2", "NOV-10"]);
    expect(screen.getByRole("columnheader", { name: "Novedad" })).toHaveAttribute("aria-sort", "none");
  });

  it("Acciones no es ordenable", () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: "Acciones" });
    expect(within(header).queryByRole("button")).toBeNull();
    expect(header).not.toHaveAttribute("aria-sort");
  });
});
