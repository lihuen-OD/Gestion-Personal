import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuditPage } from "./AuditPage";
import { auditApiService } from "../services/api/auditApiService";
import type { AuditEntry } from "../types";

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

vi.mock("../services/api/auditApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/auditApiService")>();
  return { ...actual, auditApiService: { ...actual.auditApiService, list: vi.fn() } };
});

function buildAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    date: "01/08/2026",
    time: "10:00",
    user: "Ana Gomez",
    role: "Nivel 1 - RRHH",
    action: "Alta",
    entity: "Employee",
    previous: "-",
    next: "-",
    reason: "Se creó el legajo 100.",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("AuditPage — Etapa 9B (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay eventos en pantalla", async () => {
    let resolveList!: (value: { items: AuditEntry[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(auditApiService.list).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildAudit()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    await screen.findByText("Se creó el legajo 100.");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("al cambiar de página con eventos ya cargados, no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(auditApiService.list).mockResolvedValueOnce({
      items: [buildAudit({ id: "audit-1", reason: "Se creó el legajo 100." })],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Se creó el legajo 100.");

    let resolveNextPage!: (value: { items: AuditEntry[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(auditApiService.list).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Se creó el legajo 100.")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPage({
      items: [buildAudit({ id: "audit-2", reason: "Se actualizó el legajo 101." })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });

    await waitFor(() => expect(screen.getByText("Se actualizó el legajo 101.")).toBeInTheDocument());
    expect(screen.queryByText("Se creó el legajo 100.")).not.toBeInTheDocument();
  });
});
