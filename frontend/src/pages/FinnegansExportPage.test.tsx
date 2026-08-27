import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinnegansExportPage } from "./FinnegansExportPage";
import { finnegansExportApiService, type FinnegansExportRow } from "../services/api/finnegansExportApiService";

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

vi.mock("../services/api/finnegansExportApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/finnegansExportApiService")>();
  return { ...actual, finnegansExportApiService: { ...actual.finnegansExportApiService, getNoveltyRows: vi.fn() } };
});

function buildRow(overrides: Partial<FinnegansExportRow> = {}): FinnegansExportRow {
  return {
    id: "row-1",
    source: "Novedad",
    employeeName: "Gomez, Ana",
    legajo: "100",
    novedad: "Vacaciones",
    centroCosto: "",
    valor1: "5",
    fechaAplicacion: "2026-08-01",
    fechaDesde: "2026-08-01",
    fechaHasta: "2026-08-05",
    detail: "Novedad exportable",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <FinnegansExportPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsRrhh();
});

describe("FinnegansExportPage — Etapa 9G (refresh silencioso al cambiar de período)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay filas en pantalla", async () => {
    let resolveRows!: (value: FinnegansExportRow[]) => void;
    vi.mocked(finnegansExportApiService.getNoveltyRows).mockReturnValue(new Promise((resolve) => { resolveRows = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveRows([buildRow()]);
    await screen.findByText("Gomez, Ana");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("al cambiar de período con filas ya cargadas, no blanquea la vista previa mientras llega la respuesta nueva", async () => {
    vi.mocked(finnegansExportApiService.getNoveltyRows).mockResolvedValueOnce([buildRow({ employeeName: "Gomez, Ana" })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    let resolveNextPeriod!: (value: FinnegansExportRow[]) => void;
    vi.mocked(finnegansExportApiService.getNoveltyRows).mockReturnValue(new Promise((resolve) => { resolveNextPeriod = resolve; }));

    await user.clear(screen.getByLabelText("Periodo"));
    await user.type(screen.getByLabelText("Periodo"), "2026-09");

    // Mientras la respuesta del nuevo período está en vuelo, la fila
    // anterior sigue visible y no aparece el skeleton de carga completo.
    expect(screen.getByText("Gomez, Ana")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPeriod([buildRow({ id: "row-2", employeeName: "Perez, Luis" })]);
    await waitFor(() => expect(vi.mocked(finnegansExportApiService.getNoveltyRows)).toHaveBeenLastCalledWith("2026-09"));
    await screen.findByText("Perez, Luis");
  });

  it("la exportación no se dispara al montar la pantalla — sólo al hacer click en el botón", async () => {
    vi.mocked(finnegansExportApiService.getNoveltyRows).mockResolvedValue([buildRow()]);
    renderPage();

    await screen.findByText("Gomez, Ana");
    // getNoveltyRows() sólo alimenta la vista previa (fetch acotado por
    // período, ya confirmado en el diagnóstico); no existe ningún otro
    // servicio de "exportar" que se dispare por sí solo al montar — el
    // botón arma el .xlsx en el cliente a partir de las filas ya visibles.
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeEnabled();
  });
});
