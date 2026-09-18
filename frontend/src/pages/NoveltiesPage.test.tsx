import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoveltiesPage } from "./NoveltiesPage";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Novelty } from "../types";
import { currentMonthPeriod } from "../utils/period";

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

function authAsRrhh() {
  mockUseAuth.mockReturnValue({
    user: { id: "user-1", name: "RRHH", email: "rrhh@test.com", password: "", role: "Nivel 1 - RRHH", status: "Activo" },
    login: vi.fn(),
    loginAs: vi.fn(),
    logout: vi.fn(),
  });
}

vi.mock("../services/api/noveltyApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyApiService")>();
  return { ...actual, noveltyApiService: { ...actual.noveltyApiService, list: vi.fn() } };
});

function buildNovelty(overrides: Partial<Novelty> = {}): Novelty {
  return {
    id: "novelty-1",
    employeeId: "employee-1",
    type: "Licencia médica",
    from: "2026-08-10",
    to: "2026-08-12",
    quantity: "3",
    status: "Aprobada",
    createdBy: "user-1",
    employeeLegajo: "100",
    employeeName: "Gomez, Ana",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("NoveltiesPage — Etapa 9B (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay novedades en pantalla", async () => {
    let resolveList!: (value: { items: Novelty[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(noveltyApiService.list).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    render(<NoveltiesPage />);

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildNovelty()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    await screen.findByText("Licencia médica");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("al cambiar de página con novedades ya cargadas, no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValueOnce({
      items: [buildNovelty({ id: "novelty-1", type: "Licencia médica" })],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    const user = userEvent.setup();
    render(<NoveltiesPage />);
    await screen.findByText("Licencia médica");

    let resolveNextPage!: (value: { items: Novelty[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(noveltyApiService.list).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // Mientras la página 2 todavía está en vuelo, la fila de la página 1
    // sigue visible y no aparece el skeleton de carga completo.
    expect(screen.getByText("Licencia médica")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPage({
      items: [buildNovelty({ id: "novelty-2", type: "Vacaciones", employeeName: "Perez, Luis" })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });

    await waitFor(() => expect(screen.getByText("Vacaciones")).toBeInTheDocument());
    expect(screen.queryByText("Licencia médica")).not.toBeInTheDocument();
  });
});

// Etapa 15M.15: filtro principal por período mensual. La regla de
// intersección de fechas en sí (Casos A/B/C/I del pedido) se prueba a nivel
// del motor real en backend/src/modules/novelties/novelties.repository.test.ts
// -- acá se cubre lo que es observable desde la pantalla: qué le manda al
// backend, cómo se combina con la búsqueda, y cómo se muestra.
describe("NoveltiesPage — Etapa 15M.15 (filtro por período)", () => {
  it("pide el período del mes actual al entrar a la pantalla, sin fecha inventada", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [buildNovelty()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    render(<NoveltiesPage />);
    await screen.findByText("Licencia médica");

    expect(vi.mocked(noveltyApiService.list).mock.calls[0]?.[0]).toMatchObject({ period: currentMonthPeriod() });
  });

  // Caso H
  it("Caso H: muestra la vigencia en formato humano (DD/MM/YYYY), nunca ISO", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [buildNovelty({ from: "2026-09-17", to: "2026-09-20" })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    render(<NoveltiesPage />);

    await screen.findByText("17/09/2026");
    expect(screen.getByText("Hasta 20/09/2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-17")).not.toBeInTheDocument();
  });

  // Caso F
  it("Caso F: pluraliza correctamente (1 novedad, sin 'registro(s)')", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [buildNovelty()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    render(<NoveltiesPage />);

    await waitFor(() => expect(screen.getByText(/1 novedad en/)).toBeInTheDocument());
    // "registro(s)" era el copy anterior (sección 9 del pedido) -- no debe
    // seguir presente en el subtítulo de la sección.
    expect(document.querySelector(".panel-title-block p")?.textContent).not.toMatch(/registro/i);
  });

  // Caso E
  it("Caso E: 0 resultados muestra un empty state con el período, no una tabla vacía muda", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [],
      meta: { total: 0, page: 1, pageSize: 25, hasMore: false },
    });
    render(<NoveltiesPage />);

    await waitFor(() => expect(screen.getByText(/0 novedades en/)).toBeInTheDocument());
    expect(await screen.findByText(new RegExp(`No hay novedades registradas para .*\\.`))).toBeInTheDocument();
    // El botón "Nueva novedad" sigue disponible aunque no haya resultados.
    expect(screen.getByRole("button", { name: "Nueva novedad" })).toBeInTheDocument();
  });

  // Caso G
  it("Caso G: cambiar de período pide de nuevo al backend con el nuevo período y vuelve a la página 1", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [buildNovelty()],
      meta: { total: 1, page: 2, pageSize: 25, hasMore: false },
    });
    render(<NoveltiesPage />);
    await screen.findByText("Licencia médica");

    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "2026-10" } });

    await waitFor(() => {
      const calls = vi.mocked(noveltyApiService.list).mock.calls;
      expect(calls[calls.length - 1]?.[0]).toMatchObject({ period: "2026-10", page: 1 });
    });
  });

  // Caso D
  it("Caso D: búsqueda y período se combinan en el mismo pedido, sin resetear el período al escribir", async () => {
    vi.mocked(noveltyApiService.list).mockResolvedValue({
      items: [buildNovelty()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const user = userEvent.setup();
    render(<NoveltiesPage />);
    await screen.findByText("Licencia médica");

    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "2026-09" } });
    await waitFor(() => {
      const calls = vi.mocked(noveltyApiService.list).mock.calls;
      expect(calls[calls.length - 1]?.[0]).toMatchObject({ period: "2026-09" });
    });

    await user.type(screen.getByPlaceholderText("Buscar por legajo, DNI, empleado o tipo de novedad"), "Prueba");

    await waitFor(() => {
      const calls = vi.mocked(noveltyApiService.list).mock.calls;
      expect(calls[calls.length - 1]?.[0]).toMatchObject({ search: "Prueba", period: "2026-09" });
    });
  });
});
