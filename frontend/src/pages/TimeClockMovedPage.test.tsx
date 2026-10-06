import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeClockMovedPage } from "./TimeClockMovedPage";
import { navByLevel, flattenNavigation } from "../app/navigation";

// F6: /fichador del admin ya no es un segundo fichador. No puede buscar
// empleados ni fichar (el backend rechaza el token compartido con el que
// funcionaba), así que sólo informa dónde se ficha ahora.
function renderPage(element: React.ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TimeClockMovedPage — /fichador del admin sin bypass (F6)", () => {
  it.each([
    ["pública (kiosco sin sesión)", <TimeClockMovedPage variant="public" />],
    ["dentro de la app", <TimeClockMovedPage variant="app" canManageDevices />],
  ])("vista %s: informa, no llama al API y no ofrece fichar", (_label, element) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPage(element);

    expect(screen.getByText(/Este fichador ya no está disponible/)).toBeInTheDocument();
    expect(screen.getAllByText(/Las fichadas se registran desde la app Fichador/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Marcar ingreso|Marcar salida/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Buscar por nombre/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("RRHH ve el acceso a Dispositivos de fichada; el resto no", () => {
    const { unmount } = renderPage(<TimeClockMovedPage variant="app" canManageDevices />);
    expect(screen.getByRole("link", { name: "Dispositivos de fichada" })).toHaveAttribute("href", "/configuracion/dispositivos-fichada");
    unmount();

    renderPage(<TimeClockMovedPage variant="app" />);
    expect(screen.queryByRole("link", { name: "Dispositivos de fichada" })).not.toBeInTheDocument();
    expect(screen.getByText(/avisá a RRHH/)).toBeInTheDocument();
  });

  it("el menú ya no ofrece el fichador viejo en ningún nivel", () => {
    for (const items of Object.values(navByLevel)) {
      expect(flattenNavigation(items).map((item) => item.href)).not.toContain("/fichador");
    }
  });
});
