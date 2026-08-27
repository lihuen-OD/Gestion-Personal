import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoveltiesPage } from "./NoveltiesPage";
import { noveltyApiService } from "../services/api/noveltyApiService";
import type { Novelty } from "../types";

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
    affectsSettlement: false,
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
