import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkRegimesPage } from "./WorkRegimesPage";
import { workRegimeApiService } from "../services/api/workRegimeApiService";
import type { WorkRegime } from "../types/workRegime.types";

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

vi.mock("../services/api/workRegimeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workRegimeApiService")>();
  return {
    ...actual,
    workRegimeApiService: { ...actual.workRegimeApiService, getAll: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
});

function buildRegime(overrides: Partial<WorkRegime> = {}): WorkRegime {
  return {
    id: "regime-1",
    code: "CAMPANA",
    name: "Campaña",
    kind: "TURNO_FLEXIBLE",
    alertOnOutOfShift: false,
    openShiftOverflowAction: "ALERT_ONLY",
    extendedShiftAlertMinutes: null,
    description: "Régimen de cosecha",
    status: "ACTIVO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("WorkRegimesPage — Etapa 10D (alerta de jornada extendida)", () => {
  it("el modal de crear régimen muestra el campo con label y helper claros, sin lenguaje técnico", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));

    expect(screen.getByText("Alerta de jornada extendida")).toBeInTheDocument();
    expect(screen.getByText("Cantidad máxima de horas trabajadas antes de generar una alerta informativa. No modifica las horas registradas.")).toBeInTheDocument();
    expect(screen.queryByText(/extendedShiftAlertMinutes/i)).not.toBeInTheDocument();
  });

  it("al crear un régimen dejando el campo vacío, se envía extendedShiftAlertMinutes en null (nunca 0)", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    vi.mocked(workRegimeApiService.create).mockResolvedValue(buildRegime());
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));
    await user.type(screen.getByLabelText("Código *"), "CAMPANA");
    await user.type(screen.getByLabelText("Nombre *"), "Campaña");
    await user.click(screen.getByRole("button", { name: "Guardar régimen" }));

    await vi.waitFor(() => expect(workRegimeApiService.create).toHaveBeenCalled());
    expect(workRegimeApiService.create).toHaveBeenCalledWith(expect.objectContaining({ extendedShiftAlertMinutes: null }));
  });

  it("al crear un régimen con 15 horas cargadas, convierte y envía 900 minutos", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    vi.mocked(workRegimeApiService.create).mockResolvedValue(buildRegime({ extendedShiftAlertMinutes: 900 }));
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));
    await user.type(screen.getByLabelText("Código *"), "CAMPANA");
    await user.type(screen.getByLabelText("Nombre *"), "Campaña");
    await user.type(screen.getByLabelText("Alerta de jornada extendida"), "15");
    await user.click(screen.getByRole("button", { name: "Guardar régimen" }));

    await vi.waitFor(() => expect(workRegimeApiService.create).toHaveBeenCalled());
    expect(workRegimeApiService.create).toHaveBeenCalledWith(expect.objectContaining({ extendedShiftAlertMinutes: 900 }));
  });

  it("al editar un régimen existente con el campo ya seteado, lo precarga en horas (no lo pisa con vacío)", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({
      items: [buildRegime({ extendedShiftAlertMinutes: 720 })],
      meta: { total: 1, page: 1, pageSize: 200, hasMore: false },
    });
    const user = userEvent.setup();
    render(<WorkRegimesPage />);
    await screen.findByText("CAMPANA");

    await user.click(screen.getByRole("button", { name: "Editar régimen" }));

    expect(await screen.findByLabelText("Alerta de jornada extendida")).toHaveValue(12);
  });

  it("al editar y guardar sin tocar el campo, conserva el valor precargado (no lo resetea a null)", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({
      items: [buildRegime({ extendedShiftAlertMinutes: 720 })],
      meta: { total: 1, page: 1, pageSize: 200, hasMore: false },
    });
    vi.mocked(workRegimeApiService.update).mockResolvedValue(buildRegime({ extendedShiftAlertMinutes: 720 }));
    const user = userEvent.setup();
    render(<WorkRegimesPage />);
    await screen.findByText("CAMPANA");

    await user.click(screen.getByRole("button", { name: "Editar régimen" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await vi.waitFor(() => expect(workRegimeApiService.update).toHaveBeenCalled());
    expect(workRegimeApiService.update).toHaveBeenCalledWith("regime-1", expect.objectContaining({ extendedShiftAlertMinutes: 720 }));
  });
});

describe("WorkRegimesPage — Etapa 15M.7C.1 (política de turno por kind)", () => {
  it("oculta la opción de alerta para TURNO_FLEXIBLE y explica que no requiere turno fijo", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));

    expect(screen.getByText("Este régimen no requiere un turno fijo.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Alertar si el empleado no tiene turno compatible" })).not.toBeInTheDocument();
  });

  it("muestra y activa el control al seleccionar TURNO_OBLIGATORIO", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));
    await user.selectOptions(screen.getByLabelText("Tipo de régimen"), "TURNO_OBLIGATORIO");

    expect(screen.getByRole("checkbox", { name: "Alertar si el empleado no tiene turno compatible" })).toBeChecked();
    expect(screen.queryByText("Este régimen no requiere un turno fijo.")).not.toBeInTheDocument();
  });

  it("al volver de TURNO_OBLIGATORIO a SIN_TURNO envía alertOnOutOfShift=false", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 200, hasMore: false } });
    vi.mocked(workRegimeApiService.create).mockResolvedValue(buildRegime({ kind: "SIN_TURNO" }));
    const user = userEvent.setup();
    render(<WorkRegimesPage />);

    await user.click(screen.getByRole("button", { name: "Crear régimen" }));
    await user.type(screen.getByLabelText("Código *"), "LIBRE");
    await user.type(screen.getByLabelText("Nombre *"), "Libre");
    await user.selectOptions(screen.getByLabelText("Tipo de régimen"), "TURNO_OBLIGATORIO");
    await user.selectOptions(screen.getByLabelText("Tipo de régimen"), "SIN_TURNO");
    await user.click(screen.getByRole("button", { name: "Guardar régimen" }));

    await vi.waitFor(() => expect(workRegimeApiService.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "SIN_TURNO", alertOnOutOfShift: false })));
  });

  it("renderiza No aplica para datos históricos contradictorios de un kind sin turno", async () => {
    vi.mocked(workRegimeApiService.getAll).mockResolvedValue({
      items: [buildRegime({ kind: "SIN_TURNO", alertOnOutOfShift: true })],
      meta: { total: 1, page: 1, pageSize: 200, hasMore: false },
    });
    render(<WorkRegimesPage />);

    expect(await screen.findByText("No aplica")).toBeInTheDocument();
    expect(screen.queryByText("Sí")).not.toBeInTheDocument();
  });
});
