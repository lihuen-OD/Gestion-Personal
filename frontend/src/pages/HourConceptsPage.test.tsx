import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HourConceptsPage } from "./HourConceptsPage";
import { hourConceptApiService } from "../services/api/hourConceptApiService";
import type { HourConcept } from "../types/hourConcept.types";

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

vi.mock("../services/api/hourConceptApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/hourConceptApiService")>();
  return {
    ...actual,
    hourConceptApiService: {
      ...actual.hourConceptApiService,
      getAll: vi.fn(),
      getNextCode: vi.fn().mockReturnValue("001"),
    },
  };
});

function buildConcept(overrides: Partial<HourConcept> = {}): HourConcept {
  return {
    id: "concept-1",
    code: "001",
    name: "Horas normales",
    kind: "NORMAL",
    status: "ACTIVO",
    loadMode: "MANUAL",
    systemRole: "NORMAL_BASE",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("HourConceptsPage — Etapa 14B.1 (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial cuando no hay datos", async () => {
    let resolveGetAll!: (value: HourConcept[]) => void;
    vi.mocked(hourConceptApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);

    expect(screen.getByText("Cargando catálogo...")).toBeInTheDocument();

    resolveGetAll([buildConcept()]);
    await screen.findByText("Horas normales");
    expect(screen.queryByText("Cargando catálogo...")).not.toBeInTheDocument();
  });

  it("mantiene los datos visibles tras cargar (guard contra blanqueo)", async () => {
    vi.mocked(hourConceptApiService.getAll).mockResolvedValue([buildConcept()]);
    render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);
    await screen.findByText("Horas normales");

    expect(screen.queryByText("Cargando catálogo...")).not.toBeInTheDocument();
    expect(screen.getByText("Horas normales")).toBeInTheDocument();
  });

  it("el error state sigue funcionando cuando falla la primera carga", async () => {
    vi.mocked(hourConceptApiService.getAll).mockRejectedValue(new Error("Network error"));
    render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("No se pudo cargar el catálogo de conceptos horarios.")).toBeInTheDocument());
  });

  it("al volver a montar con getAll pendiente, muestra loading inicial y resuelve correctamente", async () => {
    let resolveGetAll!: (value: HourConcept[]) => void;
    vi.mocked(hourConceptApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    const { unmount } = render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);
    resolveGetAll([buildConcept()]);
    await screen.findByText("Horas normales");
    expect(screen.getByText("Horas normales")).toBeInTheDocument();

    unmount();

    let resolveGetAll2!: (value: HourConcept[]) => void;
    vi.mocked(hourConceptApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll2 = resolve; }));

    render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);

    expect(screen.getByText("Cargando catálogo...")).toBeInTheDocument();

    resolveGetAll2([buildConcept({ name: "Horas especiales" })]);
    await screen.findByText("Horas especiales");
    expect(screen.queryByText("Cargando catálogo...")).not.toBeInTheDocument();
  });
});
