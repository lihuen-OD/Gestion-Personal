import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinnegansExportPage } from "./FinnegansExportPage";
import { ApiError } from "../services/api/apiClient";
import {
  finnegansExportApiService,
  type FinnegansExportPreview,
  type FinnegansExportRow,
  type FinnegansReadinessSummary,
} from "../services/api/finnegansExportApiService";
import { currentMonthPeriod } from "../utils/period";

const initialPeriod = currentMonthPeriod();
// Etapa 15L.3A: distinto del período inicial sin importar cuándo corra el
// test (currentMonthPeriod() depende de la fecha real) — evita que "cambiar
// de período" termine escribiendo el mismo valor que ya estaba.
const [initialYear, initialMonth] = initialPeriod.split("-").map(Number);
const changedPeriod = initialMonth === 12 ? `${initialYear + 1}-01` : `${initialYear}-${String(initialMonth + 1).padStart(2, "0")}`;

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
  return {
    ...actual,
    finnegansExportApiService: { ...actual.finnegansExportApiService, getPreview: vi.fn(), getDefinitive: vi.fn() },
  };
});

const XLSX_WRITE = vi.fn();
vi.mock("xlsx", () => ({
  utils: { aoa_to_sheet: vi.fn(() => ({})), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: (...args: unknown[]) => XLSX_WRITE(...args),
}));

function buildRow(overrides: Partial<FinnegansExportRow> = {}): FinnegansExportRow {
  return {
    id: "row-1",
    source: "Novedad",
    employeeName: "Gomez, Ana",
    legajo: "100",
    novedad: "Vacaciones",
    centroCosto: "",
    valor1: "5",
    fechaAplicacion: "01/08/2026",
    fechaDesde: "01/08/2026",
    fechaHasta: "05/08/2026",
    detail: "Novedad exportable",
    estado: "LISTO",
    ...overrides,
  };
}

function buildReadiness(overrides: Partial<FinnegansReadinessSummary> = {}): FinnegansReadinessSummary {
  return { ready: true, totalRows: 1, readyRows: 1, blockedRows: 0, reasons: [], ...overrides };
}

function buildPreview(rows: FinnegansExportRow[], readiness?: Partial<FinnegansReadinessSummary>): FinnegansExportPreview {
  return {
    period: initialPeriod,
    rows,
    readiness: buildReadiness({ totalRows: rows.length, readyRows: rows.filter((row) => row.estado === "LISTO").length, ...readiness }),
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

describe("FinnegansExportPage — preview (Etapa 15L.3A)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay filas en pantalla", async () => {
    let resolveRows!: (value: FinnegansExportPreview) => void;
    vi.mocked(finnegansExportApiService.getPreview).mockReturnValue(new Promise((resolve) => { resolveRows = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveRows(buildPreview([buildRow()]));
    await screen.findByText("Gomez, Ana");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("la preview pide preview=true", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(finnegansExportApiService.getPreview).toHaveBeenCalledWith(initialPeriod);
  });

  it("la preview no dispara ninguna descarga de archivo", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(XLSX_WRITE).not.toHaveBeenCalled();
    expect(finnegansExportApiService.getDefinitive).not.toHaveBeenCalled();
  });

  it("al cambiar de período con filas ya cargadas, no blanquea la vista previa mientras llega la respuesta nueva", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValueOnce(buildPreview([buildRow({ employeeName: "Gomez, Ana" })]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    let resolveNextPeriod!: (value: FinnegansExportPreview) => void;
    vi.mocked(finnegansExportApiService.getPreview).mockReturnValue(new Promise((resolve) => { resolveNextPeriod = resolve; }));

    await user.clear(screen.getByLabelText("Periodo"));
    await user.type(screen.getByLabelText("Periodo"), changedPeriod);

    expect(screen.getByText("Gomez, Ana")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bar")).toBeNull();

    resolveNextPeriod(buildPreview([buildRow({ id: "row-2", employeeName: "Perez, Luis" })]));
    await waitFor(() => expect(vi.mocked(finnegansExportApiService.getPreview)).toHaveBeenLastCalledWith(changedPeriod));
    await screen.findByText("Perez, Luis");
  });

  it("cambiar de período vuelve a pedir la preview (refresca)", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.clear(screen.getByLabelText("Periodo"));
    await user.type(screen.getByLabelText("Periodo"), changedPeriod);

    await waitFor(() => expect(finnegansExportApiService.getPreview).toHaveBeenCalledWith(changedPeriod));
  });

  it("empty state: sin filas muestra la tabla vacía y el banner neutro", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([]));
    renderPage();
    await screen.findByText("No hay registros para exportar en este periodo.");
    expect(screen.getByText("No hay novedades exportables en este período.")).toBeInTheDocument();
  });

  it("muestra el estado de Valor 1 y el badge de Estado por fila", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ valor1: "3", estado: "FALTA_CANTIDAD" })], { ready: false, blockedRows: 1, readyRows: 0, reasons: ["1 novedad sin cantidad de días"] }),
    );
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Falta cantidad")).toBeInTheDocument();
  });

  it("muestra los motivos humanos del banner de readiness y nunca UUIDs", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ estado: "CIERRE_PENDIENTE" })], {
        ready: false,
        readyRows: 0,
        blockedRows: 1,
        reasons: ["1 persona con cierre mensual pendiente"],
      }),
    );
    renderPage();
    await screen.findByText("⚠ Exportación pendiente de completar");
    expect(screen.getByText("1 persona con cierre mensual pendiente")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("readiness.ready=false deshabilita visualmente el botón de exportar", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ estado: "FALTA_CONFIGURACION" })], { ready: false, readyRows: 0, blockedRows: 1 }),
    );
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeDisabled();
  });

  it("readiness.ready=true habilita el botón de exportar", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeEnabled();
  });
});

describe("FinnegansExportPage — exportación definitiva (Etapa 15L.3A)", () => {
  it("al hacer click, vuelve a pedir el endpoint definitivo (sin preview=true) — nunca reutiliza las filas de preview", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getDefinitive).mockResolvedValue(buildPreview([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await waitFor(() => expect(finnegansExportApiService.getDefinitive).toHaveBeenCalledWith(initialPeriod));
  });

  it("éxito: genera el xlsx con las filas definitivas", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getDefinitive).mockResolvedValue(buildPreview([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await waitFor(() => expect(XLSX_WRITE).toHaveBeenCalled());
  });

  it("409 FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED: no genera el xlsx y muestra el mensaje", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getDefinitive).mockRejectedValue(
      new ApiError("El período tiene cierres pendientes para personas incluidas en la exportación.", "FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED", 409),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await screen.findByText("El período tiene cierres pendientes para personas incluidas en la exportación.");
    expect(XLSX_WRITE).not.toHaveBeenCalled();
  });

  it("409 FINNEGANS_EXPORT_NOT_READY: no genera el xlsx y muestra el mensaje", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getDefinitive).mockRejectedValue(
      new ApiError("Hay novedades que necesitan completar su configuración antes de exportar.", "FINNEGANS_EXPORT_NOT_READY", 409),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await screen.findByText("Hay novedades que necesitan completar su configuración antes de exportar.");
    expect(XLSX_WRITE).not.toHaveBeenCalled();
  });

  it("loading state: muestra 'Generando...' mientras espera el endpoint definitivo", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    let resolveDefinitive!: (value: FinnegansExportPreview) => void;
    vi.mocked(finnegansExportApiService.getDefinitive).mockReturnValue(new Promise((resolve) => { resolveDefinitive = resolve; }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    expect(await screen.findByRole("button", { name: /generando/i })).toBeDisabled();
    resolveDefinitive(buildPreview([buildRow()]));
    await waitFor(() => expect(XLSX_WRITE).toHaveBeenCalled());
  });
});

describe("FinnegansExportPage — Etapa 9G (refresh silencioso al cambiar de período)", () => {
  it("la exportación no se dispara al montar la pantalla — sólo al hacer click en el botón", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();

    await screen.findByText("Gomez, Ana");
    expect(finnegansExportApiService.getDefinitive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeEnabled();
  });
});
