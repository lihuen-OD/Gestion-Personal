import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PuestosPage } from "./PuestosPage";
import { positionApiService } from "../services/api/positionApiService";
import { orgStructureApiService } from "../services/api/orgStructureApiService";
import type { Position } from "../types/position.types";

vi.mock("../services/appDialog", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));

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

vi.mock("../services/api/positionApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/positionApiService")>();
  return { ...actual, positionApiService: { ...actual.positionApiService, list: vi.fn(), getAll: vi.fn(), update: vi.fn(), removeOrHide: vi.fn() } };
});

vi.mock("../services/api/orgStructureApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/orgStructureApiService")>();
  return { ...actual, orgStructureApiService: { ...actual.orgStructureApiService, getCatalog: vi.fn() } };
});

function buildPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    code: "PUE-100",
    name: "Analista de RRHH",
    lastUpdatedAt: "2026-08-01",
    status: "ACTIVO",
    mission: "",
    responsibilities: [],
    internalRelations: [],
    externalRelations: [],
    competencies: [],
    workConditions: { modality: "PRESENCIAL", workload: "", workplace: "", relationType: "", observations: "" },
    performanceIndicators: [],
    evaluationCriteria: [],
    history: [],
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    assignedCount: 0,
    ...overrides,
  };
}

const emptyCatalog = { companies: [], businessUnits: [], establishments: [], areas: [], sectors: [], costCenters: [] };

function renderPage() {
  return render(
    <MemoryRouter>
      <PuestosPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(orgStructureApiService.getCatalog).mockResolvedValue(emptyCatalog);
  vi.mocked(positionApiService.getAll).mockResolvedValue([]);
});

describe("PuestosPage — Etapa 9E (paginación real)", () => {
  it("carga inicial: muestra el loading grande y luego los datos", async () => {
    let resolveList!: (value: { items: Position[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(positionApiService.list).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildPosition()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    await screen.findByText("Analista de RRHH");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("la paginación cambia de página, pasando el page correcto a positionApiService.list", async () => {
    vi.mocked(positionApiService.list).mockResolvedValueOnce({
      items: [buildPosition({ id: "pos-1", name: "Analista de RRHH" })],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Analista de RRHH");

    vi.mocked(positionApiService.list).mockResolvedValueOnce({
      items: [buildPosition({ id: "pos-2", name: "Analista Senior" })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await screen.findByText("Analista Senior");
    const calls = vi.mocked(positionApiService.list).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toMatchObject({ page: 2, take: 25 });
  });

  it("la búsqueda espera el debounce antes de pedir al backend", async () => {
    vi.mocked(positionApiService.list).mockResolvedValue({
      items: [buildPosition()],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Analista de RRHH");
    const callsBeforeTyping = vi.mocked(positionApiService.list).mock.calls.length;

    await user.type(screen.getByPlaceholderText("Buscar por nombre o codigo de puesto"), "Senior");

    // Inmediatamente después de tipear, todavía no debería haber una llamada
    // nueva por cada letra (debounce en curso).
    expect(vi.mocked(positionApiService.list).mock.calls.length).toBe(callsBeforeTyping);

    await waitFor(() => {
      const calls = vi.mocked(positionApiService.list).mock.calls;
      expect(calls[calls.length - 1]?.[0]).toMatchObject({ search: "Senior" });
    });
  });

  it("al inactivar un puesto ya cargado, no blanquea la tabla mientras llega el reload", async () => {
    vi.mocked(positionApiService.list).mockResolvedValueOnce({
      items: [buildPosition({ id: "pos-1", name: "Analista de RRHH", status: "ACTIVO" })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    vi.mocked(positionApiService.update).mockResolvedValue(buildPosition({ status: "INACTIVO" }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Analista de RRHH");

    let resolveReload!: (value: { items: Position[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(positionApiService.list).mockReturnValue(new Promise((resolve) => { resolveReload = resolve; }));

    await user.click(screen.getByRole("button", { name: "Inactivar" }));

    await waitFor(() => expect(positionApiService.update).toHaveBeenCalled());
    expect(screen.getByText("Analista de RRHH")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveReload({
      items: [buildPosition({ status: "INACTIVO" })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument());
  });

  it("empty state: sin puestos para los filtros, muestra el mensaje correspondiente", async () => {
    vi.mocked(positionApiService.list).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    renderPage();

    await screen.findByText("No hay puestos para los filtros seleccionados.");
  });

  it("eliminar/ocultar un puesto sigue funcionando (acción existente intacta)", async () => {
    vi.mocked(positionApiService.list).mockResolvedValueOnce({
      items: [buildPosition({ id: "pos-1", name: "Analista de RRHH", assignedCount: 0 })],
      meta: { total: 1, page: 1, pageSize: 25, hasMore: false },
    });
    vi.mocked(positionApiService.removeOrHide).mockResolvedValue(undefined);
    vi.mocked(positionApiService.list).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 25, hasMore: false } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Analista de RRHH");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(positionApiService.removeOrHide).toHaveBeenCalledWith("pos-1"));
  });
});
