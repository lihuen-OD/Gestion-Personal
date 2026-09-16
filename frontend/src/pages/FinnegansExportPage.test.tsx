import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinnegansExportPage } from "./FinnegansExportPage";
import { ApiError } from "../services/api/apiClient";
import {
  finnegansExportApiService,
  type FinnegansExportBatchSummary,
  type FinnegansExportHistory,
  type FinnegansExportPreview,
  type FinnegansExportResult,
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
    finnegansExportApiService: {
      ...actual.finnegansExportApiService,
      getPreview: vi.fn(),
      exportDefinitive: vi.fn(),
      getHistory: vi.fn(),
      getHistoryDetail: vi.fn(),
    },
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

function buildBatchSummary(overrides: Partial<FinnegansExportBatchSummary> = {}): FinnegansExportBatchSummary {
  return {
    id: "batch-1",
    version: 1,
    format: "XLSX",
    createdAt: "2026-09-16T14:20:00.000Z",
    createdByName: "RRHH",
    rowCount: 1,
    reason: null,
    isReexport: false,
    sameAsPrevious: false,
    ...overrides,
  };
}

function buildPreview(rows: FinnegansExportRow[], overrides: Partial<{ readiness: Partial<FinnegansReadinessSummary>; hash: string; lastExport: FinnegansExportPreview["lastExport"] }> = {}): FinnegansExportPreview {
  return {
    period: initialPeriod,
    rows,
    readiness: buildReadiness({ totalRows: rows.length, readyRows: rows.filter((row) => row.estado === "LISTO").length, ...overrides.readiness }),
    hash: overrides.hash ?? "hash-preview",
    lastExport: overrides.lastExport === undefined ? null : overrides.lastExport,
  };
}

function buildExportResult(rows: FinnegansExportRow[], batchOverrides: Partial<FinnegansExportBatchSummary & { diff: FinnegansExportResult["batch"]["diff"] }> = {}): FinnegansExportResult {
  return {
    period: initialPeriod,
    rows,
    readiness: buildReadiness({ totalRows: rows.length, readyRows: rows.length }),
    batch: { ...buildBatchSummary(), diff: null, ...batchOverrides },
  };
}

function emptyHistory(): FinnegansExportHistory {
  return { period: initialPeriod, batches: [] };
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
  vi.mocked(finnegansExportApiService.getHistory).mockResolvedValue(emptyHistory());
});

describe("FinnegansExportPage — preview (Etapa 15L.3A/15L.4)", () => {
  it("muestra el loading grande en la carga inicial, cuando todavía no hay filas en pantalla", async () => {
    let resolveRows!: (value: FinnegansExportPreview) => void;
    vi.mocked(finnegansExportApiService.getPreview).mockReturnValue(new Promise((resolve) => { resolveRows = resolve; }));

    renderPage();

    expect(document.querySelector(".skeleton-bar")).not.toBeNull();

    resolveRows(buildPreview([buildRow()]));
    await screen.findByText("Gomez, Ana");
    expect(document.querySelector(".skeleton-bar")).toBeNull();
  });

  it("la preview pide preview=true (vía getPreview) y nunca dispara la exportación definitiva", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(finnegansExportApiService.getPreview).toHaveBeenCalledWith(initialPeriod);
    expect(finnegansExportApiService.exportDefinitive).not.toHaveBeenCalled();
    expect(XLSX_WRITE).not.toHaveBeenCalled();
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

  it("empty state: sin filas muestra la tabla vacía y el banner neutro", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([]));
    renderPage();
    await screen.findByText("No hay registros para exportar en este periodo.");
    expect(screen.getByText("No hay novedades exportables en este período.")).toBeInTheDocument();
  });

  it("muestra el badge de Estado por fila", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ valor1: "3", estado: "FALTA_CANTIDAD" })], { readiness: { ready: false, blockedRows: 1, readyRows: 0, reasons: ["1 novedad sin cantidad de días"] } }),
    );
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Falta cantidad")).toBeInTheDocument();
  });

  it("muestra los motivos humanos del banner de readiness y nunca UUIDs", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ estado: "CIERRE_PENDIENTE" })], { readiness: { ready: false, readyRows: 0, blockedRows: 1, reasons: ["1 persona con cierre mensual pendiente"] } }),
    );
    renderPage();
    await screen.findByText("⚠ Exportación pendiente de completar");
    expect(screen.getByText("1 persona con cierre mensual pendiente")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("readiness.ready=false deshabilita visualmente el botón de exportar", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow({ estado: "FALTA_CONFIGURACION" })], { readiness: { ready: false, readyRows: 0, blockedRows: 1 } }),
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

describe("FinnegansExportPage — estado del período (Etapa 15L.4 §29)", () => {
  it("sin exportaciones previas: informa que el período nunca fue exportado", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    renderPage();
    await screen.findByText(/sin exportaciones registradas para este período/i);
  });

  it("con exportación previa: muestra la última versión y su fecha", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow()], { lastExport: { ...buildBatchSummary({ version: 2 }), sameAsCurrent: true } }),
    );
    renderPage();
    await screen.findByText(/última exportación: versión 2/i);
  });

  it("hash igual al último batch: informa que no hay cambios", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow()], { lastExport: { ...buildBatchSummary(), sameAsCurrent: true } }),
    );
    renderPage();
    await screen.findByText(/sin cambios desde la última exportación/i);
  });

  it("hash distinto al último batch: informa que hay cambios", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(
      buildPreview([buildRow()], { lastExport: { ...buildBatchSummary(), sameAsCurrent: false } }),
    );
    renderPage();
    await screen.findByText(/hay cambios desde la última exportación/i);
  });
});

describe("FinnegansExportPage — historial (Etapa 15L.4 §28/§38)", () => {
  it("el historial se pide para el período seleccionado", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(finnegansExportApiService.getHistory).toHaveBeenCalledWith(initialPeriod);
  });

  it("sin historial: muestra el estado vacío", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getHistory).mockResolvedValue(emptyHistory());
    renderPage();
    await screen.findByText("Historial de exportaciones");
    expect(await screen.findAllByText(/sin exportaciones registradas para este período/i)).not.toHaveLength(0);
  });

  it("con historial: lista las versiones, más nueva primero, sin ids técnicos", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getHistory).mockResolvedValue({
      period: initialPeriod,
      batches: [
        { ...buildBatchSummary({ id: "batch-2", version: 2, isReexport: true, reason: "Corrección licencia Juan Pérez" }), diff: { added: 0, removed: 0, modified: 1 } },
        { ...buildBatchSummary({ id: "batch-1", version: 1 }), diff: null },
      ],
    });

    renderPage();

    await screen.findByText("Versión 2");
    expect(screen.getByText("Versión 1")).toBeInTheDocument();
    expect(screen.getByText("Corrección licencia Juan Pérez", { exact: false })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("muestra el resumen de diff de una reexportación (§33)", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.getHistory).mockResolvedValue({
      period: initialPeriod,
      batches: [{ ...buildBatchSummary({ version: 2, isReexport: true }), diff: { added: 2, removed: 1, modified: 3 } }],
    });

    renderPage();

    await screen.findByText(/\+2 novedades.*-1 novedad.*~3 modificadas/);
  });

  it("el historial se refresca después de una exportación exitosa", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()]));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockResolvedValue(buildExportResult([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    const callsBefore = vi.mocked(finnegansExportApiService.getHistory).mock.calls.length;

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await waitFor(() => expect(vi.mocked(finnegansExportApiService.getHistory).mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe("FinnegansExportPage — primera exportación (Etapa 15L.4 §31)", () => {
  it("sin historial: el botón dice 'Exportar Excel Finnegans' y no pide confirmación", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reexportar excel finnegans/i })).not.toBeInTheDocument();
  });

  it("click exporta directo (sin abrir modal) y vuelve a pedir el endpoint definitivo con idempotencyKey", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockResolvedValue(buildExportResult([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await waitFor(() => expect(finnegansExportApiService.exportDefinitive).toHaveBeenCalledWith(
      expect.objectContaining({ period: initialPeriod, format: "XLSX", reexportReason: undefined, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    ));
    expect(screen.queryByText("Reexportar período")).not.toBeInTheDocument();
    await waitFor(() => expect(XLSX_WRITE).toHaveBeenCalled());
  });
});

describe("FinnegansExportPage — reexportación (Etapa 15L.4 §30/§32)", () => {
  function previewWithHistory(sameAsCurrent: boolean) {
    return buildPreview([buildRow()], { lastExport: { ...buildBatchSummary({ version: 2 }), sameAsCurrent } });
  }

  it("con historial: el botón dice 'Reexportar Excel Finnegans'", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    renderPage();
    await screen.findByText("Gomez, Ana");
    expect(screen.getByRole("button", { name: /reexportar excel finnegans/i })).toBeInTheDocument();
  });

  it("click abre el modal de confirmación con motivo obligatorio, sin exportar todavía", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));

    await screen.findByText("Reexportar período");
    expect(screen.getByLabelText(/motivo de reexportación/i)).toBeInTheDocument();
    expect(finnegansExportApiService.exportDefinitive).not.toHaveBeenCalled();
  });

  it("motivo obligatorio: el botón de confirmar queda deshabilitado hasta escribir al menos 5 caracteres", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));
    await screen.findByText("Reexportar período");

    const confirmButton = screen.getByRole("button", { name: /confirmar reexportación/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/motivo de reexportación/i), "abc");
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/motivo de reexportación/i), "de");
    expect(confirmButton).toBeEnabled();
  });

  it("mismo dataset (sameAsCurrent=true): el modal advierte que no hay cambios, pero permite continuar", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(true));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));

    await screen.findByText(/no se detectaron cambios respecto de la última exportación/i);
    expect(screen.getByRole("button", { name: /confirmar reexportación/i })).toBeInTheDocument();
  });

  it("dataset con cambios (sameAsCurrent=false): el modal informa que hay cambios", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));

    await screen.findByText(/hay cambios respecto de la última exportación/i);
  });

  it("confirmar con motivo válido: exporta con el motivo y cierra el modal", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockResolvedValue(buildExportResult([buildRow()], { version: 2, isReexport: true, reason: "Corrección de licencia" }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));
    await user.type(screen.getByLabelText(/motivo de reexportación/i), "Corrección de licencia");
    await user.click(screen.getByRole("button", { name: /confirmar reexportación/i }));

    await waitFor(() => expect(finnegansExportApiService.exportDefinitive).toHaveBeenCalledWith(
      expect.objectContaining({ reexportReason: "Corrección de licencia" }),
    ));
    await waitFor(() => expect(screen.queryByText("Reexportar período")).not.toBeInTheDocument());
    expect(XLSX_WRITE).toHaveBeenCalled();
  });

  it("cancelar cierra el modal sin exportar", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(previewWithHistory(false));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");
    await user.click(screen.getByRole("button", { name: /reexportar excel finnegans/i }));
    await screen.findByText("Reexportar período");

    await user.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.queryByText("Reexportar período")).not.toBeInTheDocument();
    expect(finnegansExportApiService.exportDefinitive).not.toHaveBeenCalled();
  });
});

describe("FinnegansExportPage — errores de exportación definitiva", () => {
  it("409 FINNEGANS_MONTHLY_CLOSURE_NOT_APPROVED: no genera el xlsx y muestra el mensaje", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockRejectedValue(
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
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockRejectedValue(
      new ApiError("Hay novedades que necesitan completar su configuración antes de exportar.", "FINNEGANS_EXPORT_NOT_READY", 409),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await screen.findByText("Hay novedades que necesitan completar su configuración antes de exportar.");
    expect(XLSX_WRITE).not.toHaveBeenCalled();
  });

  it("400 FINNEGANS_EXPORT_REASON_REQUIRED: no genera el xlsx, muestra el mensaje y abre el modal de motivo", async () => {
    // Carrera: la preview todavía no reflejaba un batch creado por otra sesión.
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockRejectedValue(
      new ApiError("Reexportar este período requiere indicar un motivo.", "FINNEGANS_EXPORT_REASON_REQUIRED", 400),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    await screen.findByText(/indicá un motivo para reexportar este período/i);
    expect(screen.getByText("Reexportar período")).toBeInTheDocument();
    expect(XLSX_WRITE).not.toHaveBeenCalled();
  });

  it("loading state: muestra 'Generando...' mientras espera el endpoint definitivo", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    let resolveDefinitive!: (value: FinnegansExportResult) => void;
    vi.mocked(finnegansExportApiService.exportDefinitive).mockReturnValue(new Promise((resolve) => { resolveDefinitive = resolve; }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));

    expect(await screen.findByRole("button", { name: /generando/i })).toBeDisabled();
    resolveDefinitive(buildExportResult([buildRow()]));
    await waitFor(() => expect(XLSX_WRITE).toHaveBeenCalled());
  });
});

describe("FinnegansExportPage — doble click e idempotencia (Etapa 15L.4 §23/§24/§38)", () => {
  it("dos clicks rápidos sólo generan una llamada al endpoint definitivo (double click bloqueado)", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    let resolveDefinitive!: (value: FinnegansExportResult) => void;
    vi.mocked(finnegansExportApiService.exportDefinitive).mockReturnValue(new Promise((resolve) => { resolveDefinitive = resolve; }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    const button = screen.getByRole("button", { name: /exportar excel finnegans/i });
    await user.click(button);
    await user.click(button);

    expect(finnegansExportApiService.exportDefinitive).toHaveBeenCalledTimes(1);
    resolveDefinitive(buildExportResult([buildRow()]));
    await waitFor(() => expect(XLSX_WRITE).toHaveBeenCalled());
  });

  it("dos exportaciones separadas (no un doble click del mismo intento) usan idempotencyKey distinta", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    vi.mocked(finnegansExportApiService.exportDefinitive).mockResolvedValue(buildExportResult([buildRow()]));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Gomez, Ana");

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));
    await waitFor(() => expect(finnegansExportApiService.exportDefinitive).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /exportar excel finnegans/i }));
    await waitFor(() => expect(finnegansExportApiService.exportDefinitive).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(finnegansExportApiService.exportDefinitive).mock.calls;
    const firstKey = calls[0]![0].idempotencyKey;
    const secondKey = calls[1]![0].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });
});

describe("FinnegansExportPage — Etapa 9G (refresh silencioso al cambiar de período)", () => {
  it("la exportación no se dispara al montar la pantalla — sólo al hacer click en el botón", async () => {
    vi.mocked(finnegansExportApiService.getPreview).mockResolvedValue(buildPreview([buildRow()], { lastExport: null }));
    renderPage();

    await screen.findByText("Gomez, Ana");
    expect(finnegansExportApiService.exportDefinitive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /exportar excel finnegans/i })).toBeEnabled();
  });
});
