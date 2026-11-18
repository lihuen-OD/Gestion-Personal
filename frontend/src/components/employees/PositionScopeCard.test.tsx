import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Position } from "../../types/position.types";
import { PositionScopeCard } from "./PositionScopeCard";

vi.mock("../../services/api/orgStructureApiService", () => ({
  orgStructureApiService: { getCatalog: vi.fn(() => new Promise(() => {})) },
}));

const position = { id: "pos-1", name: "Operario", status: "ACTIVO", lastUpdatedAt: "2026-11-01", orgScopes: [] } as unknown as Position;

// 2026-11-17: Puestos es sólo de Nivel 1. El legajo (visible para Nivel 2)
// no ofrece un link a una ruta que ese nivel tiene bloqueada.
describe("PositionScopeCard — link 'Ver puesto'", () => {
  it("se muestra cuando el nivel puede abrir Puestos", () => {
    render(<MemoryRouter><PositionScopeCard position={position} hasPositionId canOpenPosition /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Ver puesto" })).toHaveAttribute("href", "/puestos/pos-1");
  });

  it("no se muestra por defecto (Nivel 2 en Legajos de mi área)", () => {
    render(<MemoryRouter><PositionScopeCard position={position} hasPositionId /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Ver puesto" })).not.toBeInTheDocument();
    expect(screen.getByText("Alcance organizacional del puesto")).toBeInTheDocument();
  });
});
