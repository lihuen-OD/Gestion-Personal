import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocumentCategoriesPage } from "./DocumentCategoriesPage";
import { documentCategoryApiService } from "../services/api/documentCategoryApiService";
import type { DocumentCategory } from "../types/documentCategory.types";

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

vi.mock("../services/api/documentCategoryApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/documentCategoryApiService")>();
  return {
    ...actual,
    documentCategoryApiService: {
      ...actual.documentCategoryApiService,
      getAll: vi.fn(),
      getFiltered: actual.documentCategoryApiService.getFiltered,
      getFilterOptions: actual.documentCategoryApiService.getFilterOptions,
      getEmptyFilters: actual.documentCategoryApiService.getEmptyFilters,
      getNextCode: vi.fn().mockReturnValue("DC-001"),
    },
  };
});

function buildCategory(overrides: Partial<DocumentCategory> = {}): DocumentCategory {
  return {
    id: "cat-1",
    code: "DC-01",
    name: "Legajo personal",
    kind: "PERSONAL",
    status: "ACTIVO",
    description: "Documentación del legajo",
    scopes: ["LEGAJO"],
    rules: { expires: false, alertBeforeDays: 0, mandatory: true, requiresApproval: false, allowMultipleFiles: true },
    uploadRoles: ["Nivel 1 - RRHH"],
    viewRoles: ["Nivel 1 - RRHH"],
    approvalRoles: ["Nivel 1 - RRHH"],
    externalLinks: [],
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

describe("DocumentCategoriesPage — Etapa 14B.1 (refresh silencioso)", () => {
  it("muestra el loading en la carga inicial cuando no hay datos", async () => {
    let resolveGetAll!: (value: DocumentCategory[]) => void;
    vi.mocked(documentCategoryApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    render(<MemoryRouter><DocumentCategoriesPage /></MemoryRouter>);

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveGetAll([buildCategory()]);
    await screen.findByText("Legajo personal");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("mantiene los datos visibles tras cargar (guard contra blanqueo)", async () => {
    vi.mocked(documentCategoryApiService.getAll).mockResolvedValue([buildCategory()]);
    render(<MemoryRouter><DocumentCategoriesPage /></MemoryRouter>);
    await screen.findByText("Legajo personal");

    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.getByText("Legajo personal")).toBeInTheDocument();
  });

  it("el error state sigue funcionando cuando falla la primera carga", async () => {
    vi.mocked(documentCategoryApiService.getAll).mockRejectedValue(new Error("Network error"));
    render(<MemoryRouter><DocumentCategoriesPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("No se pudieron cargar las categorias documentales.")).toBeInTheDocument());
  });

  it("al volver a montar con getAll pendiente, muestra skeleton y resuelve correctamente", async () => {
    let resolveGetAll!: (value: DocumentCategory[]) => void;
    vi.mocked(documentCategoryApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    const { unmount } = render(<MemoryRouter><DocumentCategoriesPage /></MemoryRouter>);
    resolveGetAll([buildCategory()]);
    await screen.findByText("Legajo personal");
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    unmount();

    let resolveGetAll2!: (value: DocumentCategory[]) => void;
    vi.mocked(documentCategoryApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll2 = resolve; }));

    render(<MemoryRouter><DocumentCategoriesPage /></MemoryRouter>);

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveGetAll2([buildCategory({ name: "Categoría actualizada" })]);
    await screen.findByText("Categoría actualizada");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });
});
