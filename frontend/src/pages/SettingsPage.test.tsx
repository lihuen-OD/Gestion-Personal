import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "./SettingsPage";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAs(role: string) {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "Usuario", email: "user@test.com", password: "", role, status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

// Etapa 15M.17: "Exportación" ya es un acceso operativo principal en el
// sidebar (navigation.tsx, Gestión horaria → Exportación, sólo Nivel 1,
// misma ruta /configuracion/liquidacion). Repetirlo acá como card era
// duplicación innecesaria -- Configuración es para catálogos/parámetros.
describe("SettingsPage — Etapa 15M.17 (sin duplicar el acceso operativo de Exportación)", () => {
  it("no muestra la card 'Exportación Finnegans'", () => {
    authAs("Nivel 1 - RRHH");
    renderPage();

    expect(screen.queryByText("Exportación Finnegans")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Administrar.*liquidacion/i })).not.toBeInTheDocument();
  });

  it("conserva el resto de las cards de catálogos/parámetros, cada una con su ruta", () => {
    authAs("Nivel 1 - RRHH");
    renderPage();

    const expectedCards: Array<[string, string]> = [
      ["Turnos", "/configuracion/turnos"],
      ["Asignaciones de feriados", "/configuracion/turnos-asignaciones-feriados"],
      ["Horas especiales", "/configuracion/turnos-horas-especiales"],
      ["Regímenes laborales", "/configuracion/regimenes-laborales"],
      ["Empresas y estructura", "/configuracion/empresas-estructura"],
      ["Tipos de novedades", "/configuracion/tipos-novedades"],
      ["Conceptos horarios", "/configuracion/conceptos-horarios"],
      ["Categorías documentales", "/configuracion/categorias-documentales"],
      ["Parámetros de auditoría", "/configuracion/parametros-auditoria"],
    ];

    for (const [name, path] of expectedCards) {
      const heading = screen.getByText(name);
      const card = heading.closest(".setting-card") as HTMLElement;
      expect(card).not.toBeNull();
      expect(card.querySelector("a")).toHaveAttribute("href", path);
    }
    // Ninguna card "de más" además de las 9 esperadas -- confirma que no
    // quedó ningún acceso operativo duplicado sin nombrar acá arriba.
    expect(document.querySelectorAll(".setting-card")).toHaveLength(expectedCards.length);
  });

  it("un rol distinto de Nivel 1 - RRHH no accede a Configuración", () => {
    authAs("Nivel 2 - Supervisión / Gestión");
    renderPage();

    expect(screen.queryByText("Parámetros del sistema")).not.toBeInTheDocument();
  });
});
