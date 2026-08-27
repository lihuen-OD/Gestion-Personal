import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthlyClosuresPage } from "./MonthlyClosuresPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { workforceApiService, type MonthlyClosure } from "../services/api/workforceApiService";

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

vi.mock("../services/api/employeeApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/employeeApiService")>();
  return { ...actual, employeeApiService: { ...actual.employeeApiService, getOptions: vi.fn() } };
});

vi.mock("../services/api/workforceApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/workforceApiService")>();
  return {
    ...actual,
    workforceApiService: {
      ...actual.workforceApiService,
      closures: vi.fn(),
      corrections: vi.fn(),
      approveClosures: vi.fn(),
    },
  };
});

function buildClosure(overrides: Partial<MonthlyClosure> = {}): MonthlyClosure {
  return {
    id: "closure-1",
    employeeId: "employee-1",
    period: "2026-08",
    status: "ENVIADO",
    employee: { id: "employee-1", legajo: "100", firstName: "Ana", lastName: "Gomez" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
  vi.mocked(employeeApiService.getOptions).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false } });
  vi.mocked(workforceApiService.corrections).mockResolvedValue([]);
});

describe("MonthlyClosuresPage — Etapa 9B (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay cierres en pantalla", async () => {
    let resolveClosures!: (value: MonthlyClosure[]) => void;
    vi.mocked(workforceApiService.closures).mockReturnValue(new Promise((resolve) => { resolveClosures = resolve; }));

    render(<MonthlyClosuresPage />);

    expect(screen.getByText("Cargando cierres...")).toBeInTheDocument();

    resolveClosures([buildClosure()]);
    await screen.findByText("100");
    expect(screen.queryByText("Cargando cierres...")).not.toBeInTheDocument();
  });

  it("tras aprobar un cierre (load() invocado fuera del efecto de montaje), no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValueOnce([buildClosure({ status: "ENVIADO" })]);
    vi.mocked(workforceApiService.approveClosures).mockResolvedValue({ count: 1 });
    const user = userEvent.setup();
    render(<MonthlyClosuresPage />);
    await screen.findByText("100");
    expect(screen.getByText("Esperando a RH")).toBeInTheDocument();

    let resolveReload!: (value: MonthlyClosure[]) => void;
    vi.mocked(workforceApiService.closures).mockReturnValue(new Promise((resolve) => { resolveReload = resolve; }));

    await user.click(screen.getByLabelText("Seleccionar pendientes"));
    await user.click(screen.getByRole("button", { name: "Aprobar seleccionados" }));

    // load() acá se invoca desde execute(), no desde el efecto de montaje —
    // exactamente el camino que exponía el cierre stale (useCallback
    // memoizado por [period], invocado fuera del efecto). Mientras la
    // segunda carga está en vuelo, la fila anterior sigue visible.
    await waitFor(() => expect(workforceApiService.approveClosures).toHaveBeenCalled());
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.queryByText("Cargando cierres...")).not.toBeInTheDocument();

    resolveReload([buildClosure({ status: "APROBADO" })]);

    await waitFor(() => expect(screen.getByText("Aprobado por RH")).toBeInTheDocument());
  });
});
