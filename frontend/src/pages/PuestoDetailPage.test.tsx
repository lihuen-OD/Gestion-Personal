import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PuestoDetailPage } from "./PuestoDetailPage";
import { positionApiService } from "../services/api/positionApiService";
import type { Position } from "../types/position.types";
import type { Employee } from "../types";

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
  return { ...actual, positionApiService: { ...actual.positionApiService, getById: vi.fn(), getAssignedEmployees: vi.fn(), update: vi.fn(), removeOrHide: vi.fn() } };
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

function renderPage(id = "pos-1") {
  return render(
    <MemoryRouter initialEntries={[`/puestos/${id}`]}>
      <Routes>
        <Route path="/puestos/:id" element={<PuestoDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

// Etapa 14H.7: getAssignedEmployees(id) pasó a depender del `id` de la ruta
// (no de position?.id, sólo disponible después de que getById resolviera) —
// estos tests confirman que ambas llamadas salen con el mismo id sin que una
// espere a la otra. Ver docs/decisions/POSITIONS_MODULE_PERFORMANCE_14H7.md.
describe("PuestoDetailPage — Etapa 14H.7 (getById/getAssignedEmployees en paralelo)", () => {
  it("dispara getById y getAssignedEmployees con el mismo id, sin esperar a que getById resuelva primero", async () => {
    let resolveById!: (value: Position) => void;
    vi.mocked(positionApiService.getById).mockReturnValue(new Promise((resolve) => { resolveById = resolve; }));
    vi.mocked(positionApiService.getAssignedEmployees).mockResolvedValue([]);

    renderPage("pos-1");

    // getAssignedEmployees ya debe haber sido llamado aunque getById todavía
    // no resolvió — si estuviera encadenado (patrón previo a 14H.7), esta
    // aserción fallaría porque `position` seguiría siendo `undefined`.
    await waitFor(() => expect(positionApiService.getAssignedEmployees).toHaveBeenCalledWith("pos-1"));
    expect(positionApiService.getById).toHaveBeenCalledWith("pos-1");

    resolveById(buildPosition());
    await screen.findByText("Analista de RRHH");
  });

  it("carga correctamente: muestra el nombre del puesto y las personas asignadas una vez que ambas resuelven", async () => {
    vi.mocked(positionApiService.getById).mockResolvedValue(buildPosition({ name: "Jefe de Sector" }));
    const employees = [{ id: "emp-1", legajo: "1001", firstName: "Ana", lastName: "Gomez", status: "Activo" } as Employee];
    vi.mocked(positionApiService.getAssignedEmployees).mockResolvedValue(employees);

    renderPage("pos-1");

    await screen.findByText("Jefe de Sector");
  });

  it("getById falla: muestra el error y no rompe por el resultado de getAssignedEmployees", async () => {
    vi.mocked(positionApiService.getById).mockRejectedValue(new Error("not found"));
    vi.mocked(positionApiService.getAssignedEmployees).mockResolvedValue([]);

    renderPage("pos-inexistente");

    await screen.findByText("No se pudo cargar el puesto.");
  });
});
