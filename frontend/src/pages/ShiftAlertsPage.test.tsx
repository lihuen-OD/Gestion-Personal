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
