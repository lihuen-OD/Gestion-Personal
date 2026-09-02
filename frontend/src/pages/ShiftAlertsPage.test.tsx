import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Etapa 13E (docs/decisions/SHIFT_CONFIGURATION_ALERT_POLICY_13E.md): copy
// más honesto para POSSIBLE_SHIFT_CONFIGURATION_MISSING -- pide revisar, no
// afirma un diagnóstico de configuración que sólo es una hipótesis.
describe("ShiftAlertsPage — Etapa 13E (copy revisado de POSSIBLE_SHIFT_CONFIGURATION_MISSING)", () => {
  it("muestra 'Revisar configuración de turno', ni el enum crudo ni el copy técnico anterior", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ type: "POSSIBLE_SHIFT_CONFIGURATION_MISSING" })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Revisar configuración de turno");
    expect(screen.queryByText("POSSIBLE_SHIFT_CONFIGURATION_MISSING")).not.toBeInTheDocument();
    expect(screen.queryByText("Posible falta de configuración")).not.toBeInTheDocument();
    expect(screen.queryByText("Posible falta de configuración de turno")).not.toBeInTheDocument();
  });

  it("el filtro de Tipo muestra 'Revisar configuración de turno', no el copy anterior", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [],
      meta: { total: 0, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("No hay alertas para los filtros seleccionados.");

    const typeSelect = screen.getByLabelText("Tipo") as HTMLSelectElement;
    const optionLabels = Array.from(typeSelect.options).map((option) => option.text);
    expect(optionLabels).toContain("Revisar configuración de turno");
    expect(optionLabels).not.toContain("Posible falta de configuración");
  });
});

// Etapa 13H (docs/decisions/SHIFT_ALERTS_GROUPED_VIEW_13H.md): Alertas de
// Turnos agrupa las filas que comparten workShiftId (misma jornada/fichada)
// en vez de mostrarlas como filas sueltas -- Notificaciones ya quedó
// limpia desde la Etapa 13G, esta etapa hace lo mismo por el lado de la
// vista técnica/detallada.
describe("ShiftAlertsPage — Etapa 13H (agrupación por jornada/fichada)", () => {
  it("Tests obligatorios #1/#10: dos alertas con el mismo workShiftId se muestran como un único grupo, no como filas sueltas", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO" }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Concepto no habilitado");
    // Una sola fila de empleado (el legajo aparece una sola vez) -- no dos
    // filas sueltas para el mismo cierre.
    expect(screen.getAllByText("Legajo 100")).toHaveLength(1);
    // "Segmento sin clasificar" sigue existiendo como opción del filtro de
    // Tipo (siempre presente) -- lo que se verifica acá es que NO aparece
    // además como contenido de la tabla (lo que daría 2 coincidencias).
    expect(screen.queryAllByText("Segmento sin clasificar")).toHaveLength(1);
  });

  it("Tests obligatorios #2: alertas de empleados distintos (distinto workShiftId) no se agrupan", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-a", workShiftId: "shift-empleado-a", employeeId: "employee-a", employee: { id: "employee-a", legajo: "100", dni: "1", firstName: "Ana", lastName: "Gomez", status: "ACTIVO" } }),
        buildAlert({ id: "alert-b", workShiftId: "shift-empleado-b", employeeId: "employee-b", employee: { id: "employee-b", legajo: "200", dni: "2", firstName: "Beto", lastName: "Diaz", status: "ACTIVO" } }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Legajo 100");
    expect(screen.getByText("Legajo 200")).toBeInTheDocument();
  });

  it("Tests obligatorios #3: alertas de días distintos (distinto workShiftId) no se agrupan", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-day1", workShiftId: "shift-day-1", actualAt: "2026-08-20T10:00:00.000Z" }),
        buildAlert({ id: "alert-day2", workShiftId: "shift-day-2", actualAt: "2026-08-21T10:00:00.000Z" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    // Dos filas de empleado (mismo empleado, dos jornadas distintas) -- cada
    // una con su propia fecha, no combinadas en un solo grupo.
    await waitFor(() => expect(screen.getAllByText("Legajo 100")).toHaveLength(2));
  });

  it("Tests obligatorios #4: la fila principal muestra el tipo de mayor prioridad (CONCEPTO_NO_HABILITADO sobre SALIDA_TARDIA)", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-tardia", workShiftId: "shift-1", type: "SALIDA_TARDIA" }),
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Concepto no habilitado");
    // "Salida tardía" sigue existiendo como opción del filtro de Tipo -- lo
    // que se verifica es que no aparece TAMBIÉN como contenido de la tabla.
    expect(screen.queryAllByText("Salida tardía")).toHaveLength(1);
  });

  it("Tests obligatorios #5/#11: muestra '+1 hallazgo asociado', sin lenguaje técnico (ni workShiftId ni el enum crudo)", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO" }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("+1 hallazgo asociado");
    expect(screen.queryByText("shift-1")).not.toBeInTheDocument();
    expect(screen.queryByText("SEGMENTO_SIN_CLASIFICAR")).not.toBeInTheDocument();
  });

  it("Tests obligatorios #6: al expandir, muestra el hallazgo secundario con su propio detalle", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO", differenceMinutes: 30 }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR", differenceMinutes: 226 }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("+1 hallazgo asociado");

    await userEvent.click(screen.getByText("+1 hallazgo asociado"));

    const detailHeading = await screen.findByText("También se detectó en esta misma jornada");
    const detail = within(detailHeading.closest(".shift-alert-group-detail") as HTMLElement);
    expect(detail.getByText("Segmento sin clasificar")).toBeInTheDocument();
    expect(detail.getByText("+3h 46m")).toBeInTheDocument(); // 226 min
  });

  it("Tests obligatorios #8: el grupo queda Pendiente si alguna alerta interna está pendiente, aunque la principal ya esté resuelta", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO", status: "RESUELTA" }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR", status: "PENDIENTE" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Concepto no habilitado");
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("Tests obligatorios #9: la acción de detalle ('Ver legajo') sigue funcionando sobre la fila principal del grupo", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO" }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();
    await screen.findByText("Concepto no habilitado");

    const legajoLink = screen.getByRole("link", { name: /Ver legajo de Ana Gomez/i });
    expect(legajoLink).toHaveAttribute("href", "/legajos/employee-1");
  });

  it("un empleado con una sola alerta no muestra ningún indicador de hallazgos asociados (sin regresión sobre el caso simple)", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [buildAlert({ id: "alert-unica", workShiftId: "shift-1", type: "SALIDA_TARDIA" })],
      meta: { total: 1, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("Salida tardía");
    expect(screen.queryByText(/hallazgo/i)).not.toBeInTheDocument();
  });

  it("el subtítulo distingue grupos de alertas individuales cuando difieren", async () => {
    vi.mocked(shiftAlertApiService.getAll).mockResolvedValue({
      data: [
        buildAlert({ id: "alert-concepto", workShiftId: "shift-1", type: "CONCEPTO_NO_HABILITADO" }),
        buildAlert({ id: "alert-segmento", workShiftId: "shift-1", type: "SEGMENTO_SIN_CLASIFICAR" }),
      ],
      meta: { total: 2, pageSize: 20, hasMore: false, nextBefore: null },
    });

    renderPage();

    await screen.findByText("1 grupo(s) de alertas (2 alerta(s) individuales) según filtros aplicados.");
  });
});
