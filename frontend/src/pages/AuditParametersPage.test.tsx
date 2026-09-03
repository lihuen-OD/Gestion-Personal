import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuditParametersPage } from "./AuditParametersPage";
import { auditParameterApiService } from "../services/api/auditParameterApiService";
import type { AuditParameter } from "../types/auditParameter.types";

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

vi.mock("../services/api/auditParameterApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/auditParameterApiService")>();
  return {
    ...actual,
    auditParameterApiService: {
      ...actual.auditParameterApiService,
      getAll: vi.fn(),
    },
  };
});

function buildParameter(overrides: Partial<AuditParameter> = {}): AuditParameter {
  return {
    id: "param-1",
    code: "AUD-001",
    name: "Auditoría de legajos",
    scope: "LEGAJO",
    severity: "INFO",
    status: "ACTIVO",
    description: "Auditoría general de legajos",
    trackCreate: true,
    trackUpdate: true,
    trackDeleteOrDeactivate: false,
    trackApproval: false,
    trackExport: false,
    requiresReason: false,
    requiresEffectiveDate: false,
    visibleToRoles: ["Nivel 1 - RRHH"],
    notification: { enabled: false, rolesToNotify: [], notifyOnCreate: false, notifyOnUpdate: true, notifyOnDeleteOrDeactivate: true, notifyOnExport: false },
    retention: { amount: 5, unit: "ANIOS", lockAfterClose: false, allowExport: true },
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
    history: [],
    notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("AuditParametersPage — Etapa 14B.1 (refresh silencioso)", () => {
  it("muestra el loading en la carga inicial cuando no hay datos", async () => {
    let resolveGetAll!: (value: AuditParameter[]) => void;
    vi.mocked(auditParameterApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    render(<MemoryRouter><AuditParametersPage /></MemoryRouter>);

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveGetAll([buildParameter()]);
    await screen.findByText("Auditoría de legajos");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("mantiene los datos visibles tras cargar (guard contra blanqueo)", async () => {
    vi.mocked(auditParameterApiService.getAll).mockResolvedValue([buildParameter()]);
    render(<MemoryRouter><AuditParametersPage /></MemoryRouter>);
    await screen.findByText("Auditoría de legajos");

    expect(document.querySelector(".skeleton-bar")).toBeNull();
    expect(screen.getByText("Auditoría de legajos")).toBeInTheDocument();
  });

  it("el error state sigue funcionando cuando falla la primera carga", async () => {
    vi.mocked(auditParameterApiService.getAll).mockRejectedValue(new Error("Network error"));
    render(<MemoryRouter><AuditParametersPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("No se pudieron cargar los parametros de auditoria.")).toBeInTheDocument());
  });

  it("al volver a montar con getAll pendiente, muestra skeleton y resuelve correctamente", async () => {
    let resolveGetAll!: (value: AuditParameter[]) => void;
    vi.mocked(auditParameterApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll = resolve; }));

    const { unmount } = render(<MemoryRouter><AuditParametersPage /></MemoryRouter>);
    resolveGetAll([buildParameter()]);
    await screen.findByText("Auditoría de legajos");
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    unmount();

    let resolveGetAll2!: (value: AuditParameter[]) => void;
    vi.mocked(auditParameterApiService.getAll).mockReturnValue(new Promise((resolve) => { resolveGetAll2 = resolve; }));

    render(<MemoryRouter><AuditParametersPage /></MemoryRouter>);

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveGetAll2([buildParameter({ name: "Auditoría actualizada" })]);
    await screen.findByText("Auditoría actualizada");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });
});
