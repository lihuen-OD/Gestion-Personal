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

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md: si el concepto suma o no al
// total trabajado es una decisión explícita, nunca deducida del modo de carga.
describe("HourConceptsPage — tratamiento en el total trabajado", () => {
  it("no permite guardar un concepto nuevo sin elegir el tratamiento y lo envía al backend cuando se elige", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    // jsdom no implementa scrollIntoView (la pantalla lleva el editor a la vista).
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(hourConceptApiService.getAll).mockResolvedValue([]);
    const create = vi.spyOn(hourConceptApiService, "create").mockResolvedValue(buildConcept({ id: "nuevo", systemRole: null, kind: "TRANSPORTE", workTreatment: "ADDITIVE_TO_WORKED_TOTAL" }));
    render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Crear concepto horario" }));
    await user.type(screen.getByLabelText("Nombre *"), "Camioneta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Elegí si el concepto está dentro de la jornada o suma horas adicionales.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText(/Tratamiento en el total/), "ADDITIVE_TO_WORKED_TOTAL");
    expect(screen.getByText("Tiempo trabajado fuera de la fichada. Suma al total trabajado.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "Camioneta", workTreatment: "ADDITIVE_TO_WORKED_TOTAL" })));
  });

  it("la tabla muestra el tratamiento en lenguaje de negocio", async () => {
    vi.mocked(hourConceptApiService.getAll).mockResolvedValue([
      buildConcept(),
      buildConcept({ id: "sereno", code: "HOR-001", name: "Sereno", kind: "SERENO", loadMode: "BOTH", systemRole: null, workTreatment: "WITHIN_BASE" }),
      buildConcept({ id: "colectivo", code: "HOR-002", name: "Colectivo", kind: "TRANSPORTE", systemRole: null, workTreatment: "ADDITIVE_TO_WORKED_TOTAL" }),
    ]);
    const { container } = render(<MemoryRouter><HourConceptsPage /></MemoryRouter>);

    expect(await screen.findByText("Dentro de la jornada")).toBeInTheDocument();
    expect(screen.getByText("Horas adicionales")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/WITHIN_BASE|ADDITIVE_TO_WORKED_TOTAL/);
  });
});
