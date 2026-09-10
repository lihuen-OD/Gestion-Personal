import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PuestoCreatePage } from "./PuestoCreatePage";
import { positionApiService } from "../services/api/positionApiService";
import type { Position } from "../types/position.types";

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
  return { ...actual, positionApiService: { ...actual.positionApiService, getOptions: vi.fn(), getAll: vi.fn(), create: vi.fn() } };
});

function buildPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    code: "PUE-001",
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

function renderPage() {
  return render(
    <MemoryRouter>
      <PuestoCreatePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

// Etapa 14H.7: PuestoCreatePage.tsx pasó de getAll() (positionInclude
// completo) a getOptions() (select liviano, 14D.4) para calcular el próximo
// código — getNextCode() sólo lee `.code`, ya incluido en el catálogo
// liviano. Ver docs/decisions/POSITIONS_MODULE_PERFORMANCE_14H7.md.
describe("PuestoCreatePage — Etapa 14H.7 (catálogo liviano para el próximo código)", () => {
  it("calcula el próximo código con getOptions(), no con getAll()", async () => {
    vi.mocked(positionApiService.getOptions).mockResolvedValue([buildPosition({ code: "PUE-001" }), buildPosition({ code: "PUE-002" })]);

    renderPage();

    await screen.findByDisplayValue("PUE-003");
    expect(positionApiService.getOptions).toHaveBeenCalledTimes(1);
    expect(positionApiService.getAll).not.toHaveBeenCalled();
  });
});
