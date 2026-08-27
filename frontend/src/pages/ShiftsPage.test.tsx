import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ShiftsPage } from "./ShiftsPage";
import { workforceApiService, type ShiftTemplate } from "../services/api/workforceApiService";
import { shiftAssignmentApiService } from "../services/api/shiftAssignmentApiService";

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

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return { ...actual, workforceApiService: { ...actual.workforceApiService, shiftTemplates: vi.fn(), updateShiftTemplate: vi.fn() } };
});

vi.mock("../services/api/shiftAssignmentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/shiftAssignmentApiService")>();
  return { ...actual, shiftAssignmentApiService: { ...actual.shiftAssignmentApiService, getSummary: vi.fn() } };
});

function buildTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: "template-1",
    code: "T-1",
    name: "Turno mañana",
    startTime: "06:00",
    endTime: "14:00",
    crossesMidnight: false,
    entryToleranceBeforeMinutes: 10,
    entryToleranceAfterMinutes: 10,
    exitToleranceBeforeMinutes: 10,
    exitToleranceAfterMinutes: 10,
    absoluteOpenShiftLimitMinutes: 1200,
    status: "ACTIVO",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShiftsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(shiftAssignmentApiService.getSummary).mockResolvedValue([]);
});

describe("ShiftsPage — Etapa 9C (refresh silencioso pendiente de 9B)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay turnos en pantalla", async () => {
    let resolveTemplates!: (value: ShiftTemplate[]) => void;
    vi.mocked(workforceApiService.shiftTemplates).mockReturnValue(new Promise((resolve) => { resolveTemplates = resolve; }));

    renderPage();

    // "Cargando turnos..." aparece dos veces durante la carga inicial (el
    // subtítulo de la sección y el texto del skeleton) — se valida por la
    // presencia del skeleton en sí, que es lo que realmente bloquea la vista.
    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveTemplates([buildTemplate()]);
    await screen.findByText("Turno mañana");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.queryByText("Cargando turnos...")).not.toBeInTheDocument();
  });

  it("al activar/inactivar un turno ya cargado, no blanquea la tabla ni pierde los filtros aplicados mientras llega la respuesta nueva", async () => {
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValueOnce([buildTemplate()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Turno mañana");

    // Aplica un filtro de búsqueda antes de disparar el refresh.
    await user.type(screen.getByPlaceholderText("Código, nombre o categoría"), "mañana");
    expect(screen.getByText("Turno mañana")).toBeInTheDocument();

    vi.mocked(workforceApiService.updateShiftTemplate).mockResolvedValue(buildTemplate({ status: "INACTIVO" }));
    let resolveReload!: (value: ShiftTemplate[]) => void;
    vi.mocked(workforceApiService.shiftTemplates).mockReturnValue(new Promise((resolve) => { resolveReload = resolve; }));

    await user.click(screen.getByRole("button", { name: /inactivar turno mañana/i }));

    await waitFor(() => expect(workforceApiService.updateShiftTemplate).toHaveBeenCalledWith("template-1", { status: "INACTIVO" }));
    // Mientras el reload sigue en vuelo: la fila anterior sigue visible, no
    // aparece el skeleton de carga completo, y el filtro de búsqueda escrito
    // por el usuario no se perdió.
    expect(screen.getByText("Turno mañana")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.getByPlaceholderText("Código, nombre o categoría")).toHaveValue("mañana");

    resolveReload([buildTemplate({ status: "INACTIVO" })]);

    await waitFor(() => expect(screen.getByText("Inactivo")).toBeInTheDocument());
    // La acción de activar/inactivar (funcionalidad existente) sigue intacta.
    expect(screen.getByRole("button", { name: /activar turno mañana/i })).toBeInTheDocument();
  });

  it("el filtro de estado sigue funcionando después del refresh silencioso", async () => {
    vi.mocked(workforceApiService.shiftTemplates).mockResolvedValueOnce([
      buildTemplate({ id: "template-1", name: "Turno mañana", status: "ACTIVO" }),
      buildTemplate({ id: "template-2", name: "Turno tarde", status: "INACTIVO" }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Turno mañana");
    expect(screen.getByText("Turno tarde")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Estado"), "INACTIVO");
    expect(screen.queryByText("Turno mañana")).not.toBeInTheDocument();
    expect(screen.getByText("Turno tarde")).toBeInTheDocument();
  });
});
