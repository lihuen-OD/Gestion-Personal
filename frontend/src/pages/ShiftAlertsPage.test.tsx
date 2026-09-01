import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ShiftAlertsPage } from "./ShiftAlertsPage";
import { shiftAlertApiService, type ShiftAlert } from "../services/api/shiftAlertApiService";

vi.mock("../services/api/shiftAlertApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/shiftAlertApiService")>();
  return { ...actual, shiftAlertApiService: { ...actual.shiftAlertApiService, getAll: vi.fn() } };
});

function buildAlert(overrides: Partial<ShiftAlert> = {}): ShiftAlert {
  return {
    id: "alert-1",
    employeeId: "employee-1",
    workShiftId: "shift-1",
    type: "CONCEPTO_NO_HABILITADO",
    status: "PENDIENTE",
    severity: "ADVERTENCIA",
    actualAt: "2026-08-20T10:00:00.000Z",
    createdAt: "2026-08-20T10:00:00.000Z",
    employee: { id: "employee-1", legajo: "100", dni: "30111222", firstName: "Ana", lastName: "Gomez", status: "ACTIVO" },
    workShift: { id: "shift-1", startAt: "2026-08-20T08:00:00.000Z", status: "CERRADO", shiftTemplate: null },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ShiftAlertsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShiftAlertsPage — Etapa 10B (enum drift corregido, 10A §11.4)", () => {
  it("muestra un texto claro para CONCEPTO_NO_HABILITADO, no el enum crudo ni una celda en blanco", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ type: "CONCEPTO_NO_HABILITADO" })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Concepto no habilitado");
    expect(screen.queryByText("CONCEPTO_NO_HABILITADO")).not.toBeInTheDocument();
  });

  it("muestra un texto claro para SEGMENTO_SIN_CLASIFICAR, no el enum crudo ni una celda en blanco", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ id: "alert-2", type: "SEGMENTO_SIN_CLASIFICAR" })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Segmento sin clasificar");
    expect(screen.queryByText("SEGMENTO_SIN_CLASIFICAR")).not.toBeInTheDocument();
  });

  it("el filtro de Tipo incluye las dos alertas antes faltantes, con label legible", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [],
      meta: { total: 0, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("No hay alertas para los filtros seleccionados.");

    const typeSelect = screen.getByLabelText("Tipo") as HTMLSelectElement;
    const optionLabels = Array.from(typeSelect.options).map((option) => option.text);
    expect(optionLabels).toContain("Concepto no habilitado");
    expect(optionLabels).toContain("Segmento sin clasificar");
  });
});

describe("ShiftAlertsPage — Etapa 10E (severidad legible, sin enum crudo en la tabla)", () => {
  it("una alerta CRITICA se muestra como 'Crítica' en la tabla, no como el enum crudo sin acento", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ severity: "CRITICA" })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Crítica");
    expect(screen.queryByText("CRITICA")).not.toBeInTheDocument();
  });

  it("el filtro de Severidad muestra labels legibles ('Informativa', 'Advertencia', 'Crítica')", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [],
      meta: { total: 0, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("No hay alertas para los filtros seleccionados.");

    const severitySelect = screen.getByLabelText("Severidad") as HTMLSelectElement;
    const optionLabels = Array.from(severitySelect.options).map((option) => option.text);
    expect(optionLabels).toEqual(["Todas", "Informativa", "Advertencia", "Crítica"]);
  });
});

describe("ShiftAlertsPage — Etapa 13A (nuevo tipo INGRESO_ANTICIPADO)", () => {
  it("muestra 'Ingreso anticipado' para el nuevo tipo, no el enum crudo", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ type: "INGRESO_ANTICIPADO", differenceMinutes: -30 })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Ingreso anticipado");
    expect(screen.queryByText("INGRESO_ANTICIPADO")).not.toBeInTheDocument();
  });

  it("el filtro de Tipo incluye 'Ingreso anticipado'", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [],
      meta: { total: 0, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("No hay alertas para los filtros seleccionados.");

    const typeSelect = screen.getByLabelText("Tipo") as HTMLSelectElement;
    const optionLabels = Array.from(typeSelect.options).map((option) => option.text);
    expect(optionLabels).toContain("Ingreso anticipado");
  });

  it("una diferencia negativa (ingreso antes del horario) se muestra con signo '-' en la columna Diferencia", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ type: "INGRESO_ANTICIPADO", severity: "INFO", differenceMinutes: -30 })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Ingreso anticipado");
    expect(screen.getByText("-30m")).toBeInTheDocument();
  });
});
