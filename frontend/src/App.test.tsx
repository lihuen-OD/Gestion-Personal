import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

// Sin sesión: App sólo monta el login, sin AppShell ni llamadas al API.
vi.mock("./context/AuthContext", () => ({ useAuth: () => ({ user: null, login: vi.fn() }) }));

// F11 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §30): el admin ya no
// tiene /fichador (desde F6 sólo informaba dónde se ficha). Un kiosco que
// abriera esa URL ve el login como cualquier otra ruta, nunca un fichador.
describe("App — /fichador retirado del admin (F11)", () => {
  it("sin sesión, /fichador muestra el login como cualquier ruta desconocida", async () => {
    render(<MemoryRouter initialEntries={["/fichador"]}><App /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Ingresar al sistema" })).toBeInTheDocument();
    expect(screen.queryByText(/Este fichador ya no está disponible/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar ingreso|Marcar salida/ })).not.toBeInTheDocument();
  });
});
