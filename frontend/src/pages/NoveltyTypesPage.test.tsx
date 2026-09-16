import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoveltyTypesPage } from "./NoveltyTypesPage";
import { noveltyTypeApiService } from "../services/api/noveltyTypeApiService";
import type { NoveltyType } from "../types/noveltyType.types";

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

vi.mock("../services/api/noveltyTypeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/noveltyTypeApiService")>();
  return {
    ...actual,
    noveltyTypeApiService: {
      ...actual.noveltyTypeApiService,
      getAll: vi.fn(),
    },
  };
});

function buildNoveltyType(overrides: Partial<NoveltyType> = {}): NoveltyType {
  return {
    id: "nt-1",
    code: "NT-01",
    name: "Licencia médica",
    description: "Ausencia por illness",
    kind: "AUSENCIA",
    origin: "INTERNA",
    uiColor: "blue",
    status: "ACTIVO",
    finnegansLinks: [],
    allowedLoadRoles: [],
    approvalRoles: [],
    rules: { exportsToFinnegans: false, requiresApproval: false, requiresDocumentation: false, allowsHours: false, allowsDateTo: false, hasValidity: false, blocksTimeEntry: false, setsWorkedHoursToZero: false, timeImpact: "NO_AFECTA_HORAS", timeEntryBehavior: "NO_BLOQUEA", allowsDateRange: false, finnegansValueUnit: null, finnegansRequiresValidity: false },
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("NoveltyTypesPage — Etapa 14B.1 (refresh silencioso)", () => {
  it("muestra el loading en la carga inicial cuando no hay datos", async () => {
    let resolveGetAll!: (value: NoveltyType[]) => void;
    vi.mocked(noveltyTypeApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);

    expect(screen.getByText("Cargando tipos de novedades...")).toBeInTheDocument();

    resolveGetAll([buildNoveltyType()]);
    await screen.findByText("Licencia médica");
    expect(screen.queryByText("Cargando tipos de novedades...")).not.toBeInTheDocument();
  });

  it("mantiene los datos visibles tras cargar (guard contra blanqueo)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType()]);
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    await screen.findByText("Licencia médica");

    expect(screen.queryByText("Cargando tipos de novedades...")).not.toBeInTheDocument();
    expect(screen.getByText("Licencia médica")).toBeInTheDocument();
  });

  it("el error state sigue funcionando cuando falla la primera carga", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockRejectedValue(new Error("Network error"));
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("No pudimos cargar los tipos de novedades.")).toBeInTheDocument());
  });

  it("al volver a montar con getAll pendiente, muestra loading inicial y resuelve correctamente", async () => {
    let resolveGetAll!: (value: NoveltyType[]) => void;
    vi.mocked(noveltyTypeApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    const { unmount } = render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    resolveGetAll([buildNoveltyType()]);
    await screen.findByText("Licencia médica");
    expect(screen.getByText("Licencia médica")).toBeInTheDocument();

    unmount();

    let resolveGetAll2!: (value: NoveltyType[]) => void;
    vi.mocked(noveltyTypeApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll2 = resolve; }));

    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);

    expect(screen.getByText("Cargando tipos de novedades...")).toBeInTheDocument();

    resolveGetAll2([buildNoveltyType({ name: "Vacaciones" })]);
    await screen.findByText("Vacaciones");
    expect(screen.queryByText("Cargando tipos de novedades...")).not.toBeInTheDocument();
  });
});

// Etapa 15L.2B (docs/decisions/NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md,
// punto 20): columnas realmente útiles -- se quita "Origen" (legacy).
describe("NoveltyTypesPage — Etapa 15L.2B (listado)", () => {
  it("la tabla no muestra la columna Origen ni el valor del enum", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType({ origin: "MIXTA" })]);
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    await screen.findByText("Licencia médica");

    expect(screen.queryByText("Origen")).not.toBeInTheDocument();
    expect(screen.queryByText("MIXTA")).not.toBeInTheDocument();
  });

  it("muestra las columnas Codigo/Novedad/Categoria/Estado/Finnegans/Aprobacion/Acciones", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType()]);
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    await screen.findByText("Licencia médica");

    ["Codigo", "Novedad", "Categoria", "Estado", "Finnegans", "Aprobacion", "Acciones"].forEach((header) => {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    });
  });

  it("no queda ningun filtro con la etiqueta legacy Tipo (ahora Categoria)", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType()]);
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    await screen.findByText("Licencia médica");

    expect(screen.queryByText("Tipo")).not.toBeInTheDocument();
    expect(screen.getAllByText("Categoria").length).toBeGreaterThan(0);
  });

  it("las tarjetas de resumen muestran Total/Activos/Exportables a Finnegans/Requieren aprobacion", async () => {
    vi.mocked(noveltyTypeApiService.getAll).mockResolvedValue([buildNoveltyType()]);
    render(<MemoryRouter><NoveltyTypesPage /></MemoryRouter>);
    await screen.findByText("Licencia médica");

    expect(screen.getByText("Total de tipos")).toBeInTheDocument();
    expect(screen.getByText("Activos")).toBeInTheDocument();
    expect(screen.getByText("Exportables a Finnegans")).toBeInTheDocument();
    expect(screen.getByText("Requieren aprobación")).toBeInTheDocument();
  });
});
