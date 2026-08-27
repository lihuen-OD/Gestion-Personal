import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DocumentsPage } from "./DocumentsPage";
import { documentApiService } from "../services/api/documentApiService";
import type { DocumentMock } from "../types";

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

vi.mock("../services/api/documentApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/documentApiService")>();
  return { ...actual, documentApiService: { ...actual.documentApiService, list: vi.fn() } };
});

function buildDocument(overrides: Partial<DocumentMock> = {}): DocumentMock {
  return {
    id: "doc-1",
    employeeId: "employee-1",
    category: "DNI",
    fileName: "dni-frente.pdf",
    uploadedAt: "2026-08-01",
    status: "Vigente",
    employeeLegajo: "100",
    employeeName: "Gomez, Ana",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DocumentsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("DocumentsPage — Etapa 9B (refresh silencioso)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay documentos en pantalla", async () => {
    let resolveList!: (value: { items: DocumentMock[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(documentApiService.list).mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveList({ items: [buildDocument()], meta: { total: 1, page: 1, pageSize: 25, hasMore: false } });
    await screen.findByText("dni-frente.pdf");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("al cambiar de página con documentos ya cargados, no blanquea la tabla mientras llega la respuesta nueva", async () => {
    vi.mocked(documentApiService.list).mockResolvedValueOnce({
      items: [buildDocument({ id: "doc-1", fileName: "dni-frente.pdf" })],
      meta: { total: 30, page: 1, pageSize: 25, hasMore: true },
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("dni-frente.pdf");

    let resolveNextPage!: (value: { items: DocumentMock[]; meta: { total: number; page: number; pageSize: number; hasMore: boolean } }) => void;
    vi.mocked(documentApiService.list).mockReturnValue(new Promise((resolve) => { resolveNextPage = resolve; }));

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("dni-frente.pdf")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPage({
      items: [buildDocument({ id: "doc-2", fileName: "cuil-constancia.pdf", employeeName: "Perez, Luis" })],
      meta: { total: 30, page: 2, pageSize: 25, hasMore: false },
    });

    await waitFor(() => expect(screen.getByText("cuil-constancia.pdf")).toBeInTheDocument());
    expect(screen.queryByText("dni-frente.pdf")).not.toBeInTheDocument();
  });
});
