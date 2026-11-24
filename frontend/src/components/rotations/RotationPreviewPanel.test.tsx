/**
 * R4.8D: vista previa (rango, paginación, simulación, nocturnos sin
 * duplicar, doble bloque, estados del plan, advertencias, detalle y teclado).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationPreviewPanel, SIMULATION_NOTICE } from "./RotationPreviewPanel";
import { shiftRotationApiService, type PreviewResponse } from "../../services/api/shiftRotationApiService";
import { rotationFixture } from "../../test/shiftRotationFixtures";
import { previewBlock, previewCell, previewResponse, previewRow } from "../../test/shiftRotationPreviewFixtures";

vi.mock("../../services/api/shiftRotationApiService", () => ({ shiftRotationApiService: { preview: vi.fn() } }));

const FROM = "2026-11-23";
const dates = Array.from({ length: 14 }, (_, index) => { const d = new Date(`${FROM}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + index); return d.toISOString().slice(0, 10); });

function joseDays() {
  return dates.map((date, index) => {
    if (index === 4) return previewCell(date, { blocks: [previewBlock(date, "P-0711", "07:00", "11:00", 0), previewBlock(date, "P-1907", "19:00", "07:00", 1)], transitionFromPrevious: { previousOperationalDate: dates[3]!, restMinutes: 960, overlap: false } });
    if (index === 5) return previewCell(date, { blocks: [previewBlock(date, "P-1907", "19:00", "07:00")], transitionFromPrevious: { previousOperationalDate: dates[4]!, restMinutes: 720, overlap: false } });
    if (index === 6) return previewCell(date, { kind: "REST", facts: { dayOff: true, holidayScope: null, convoked: false, regimeKind: "TURNO_OBLIGATORIO" } });
    if (index === 7) return previewCell(date, { kind: "MISSING", week: "B", facts: { dayOff: true, holidayScope: "IN_SCOPE", convoked: false, regimeKind: null }, warnings: [{ code: "ROTATION_PLAN_MISSING", severity: "ERROR", message: "Falta completar la configuración de la rotación para esta fecha." }] });
    if (index === 8) return previewCell(date, { kind: "CONFLICT", week: "B", warnings: [{ code: "ROTATION_PLAN_CONFLICT", severity: "ERROR", message: "La configuración de la rotación es contradictoria para esta fecha." }] });
    return previewCell(date, { week: index < 7 ? "A" : "B", blocks: [previewBlock(date, "P-0715", "07:00", "15:00")] });
  });
}
function johannaDays() {
  return dates.map((date, index) => (index < 7
    ? previewCell(date, { kind: index >= 5 ? "NONE" : "FIXED_ASSIGNMENT", week: null, blocks: index >= 5 ? [] : [previewBlock(date, "F-0715", "07:00", "15:00", 0, "FIXED_ASSIGNMENT")] })
    : previewCell(date, { week: "B", blocks: [previewBlock(date, "P-0715", "07:00", "15:00")] })));
}
const ROWS = [previewRow("e-jose", "Gómez", "José", "19", joseDays()), previewRow("e-joh", "Ruiz", "Johanna", "22", johannaDays())];

const renderPanel = () => render(<RotationPreviewPanel rotation={rotationFixture()} />);

// "Hoy" fijo (martes 24/11/2026, mediodía en Argentina) sin tocar el formateo de instantes.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
  vi.mocked(shiftRotationApiService.preview).mockReset();
  vi.mocked(shiftRotationApiService.preview).mockImplementation(async (query) => previewResponse(ROWS, { from: query.from, days: Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86_400_000) + 1, page: query.page }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("consulta", () => {
  it("por defecto pide 2 semanas desde el lunes actual, 25 por página, y avisa que es una simulación", async () => {
    renderPanel();
    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(shiftRotationApiService.preview).toHaveBeenCalledWith({ rotationId: "rot-1", from: "2026-11-23", to: "2026-12-06", page: 1, take: 25 });
    expect(screen.getByText(SIMULATION_NOTICE)).toBeInTheDocument();
    expect(screen.getByText("Del 23/11/2026 al 06/12/2026")).toBeInTheDocument();
    // Semana del ciclo al empezar cada tramo, tomada de la respuesta (el lunes 23/11 es semana A en estos datos).
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers[1]).toBe("Semana ALun23/11");
    expect(headers[8]).toBe("Semana BLun30/11");
    expect(headers[2]).toBe("AMar24/11Semana A");
  });

  it("una rotación activa no muestra el aviso de simulación", async () => {
    vi.mocked(shiftRotationApiService.preview).mockResolvedValue(previewResponse(ROWS, { from: FROM, days: 14, inactive: false }));
    renderPanel();
    await screen.findByRole("grid");
    expect(screen.queryByText(SIMULATION_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByText(/Configuración vigente de la rotación/)).toBeInTheDocument();
  });

  it("período de 6 semanas (42 días) y navegación anterior/siguiente vuelven a la página 1", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("grid");
    await user.selectOptions(screen.getByLabelText("Período"), "6");
    expect(shiftRotationApiService.preview).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-11-23", to: "2027-01-03", page: 1 }));
    await user.click(screen.getByRole("button", { name: /Período siguiente/ }));
    expect(shiftRotationApiService.preview).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2027-01-04", to: "2027-02-14" }));
    await user.click(screen.getByRole("button", { name: "Esta semana" }));
    expect(shiftRotationApiService.preview).toHaveBeenLastCalledWith(expect.objectContaining({ from: "2026-11-23" }));
  });

  it("pagina de a 25 personas y mantiene el calendario visible mientras llega la página nueva", async () => {
    vi.mocked(shiftRotationApiService.preview).mockResolvedValueOnce(previewResponse(ROWS, { from: FROM, days: 14, total: 30 }));
    let resolveNext: (value: PreviewResponse) => void = () => {};
    vi.mocked(shiftRotationApiService.preview).mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("grid");
    expect(screen.getByText(/Página 1 de 2 · 30 personas/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(shiftRotationApiService.preview).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByRole("grid")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();
    await act(async () => resolveNext(previewResponse([ROWS[1]!], { from: FROM, days: 14, total: 30, page: 2 })));
    expect(screen.getByRole("grid")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument();
  });

  it("vacío y error con reintento", async () => {
    vi.mocked(shiftRotationApiService.preview).mockResolvedValueOnce(previewResponse([], { from: FROM, days: 14 }));
    const { unmount } = renderPanel();
    expect(await screen.findByText(/No hay personas para mostrar en el período elegido/)).toBeInTheDocument();
    unmount();
    vi.mocked(shiftRotationApiService.preview).mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: /Reintentar/ }));
    expect(await screen.findByRole("grid")).toBeInTheDocument();
  });
});

describe("celdas", () => {
  it("nocturno con +1 sólo en su día, doble bloque, descanso, sin configurar, conflicto, fijo y sin programación", async () => {
    renderPanel();
    const grid = await screen.findByRole("grid");
    const friday = within(grid).getByRole("button", { name: /^Gómez, José, viernes 27\/11\/2026, semana A: P-0711 de 07:00 a 11:00 y P-1907 de 19:00 a 07:00 del día siguiente/ });
    expect(within(friday).getAllByTitle("Termina al día siguiente")).toHaveLength(1);
    const saturday = within(grid).getByRole("button", { name: /^Gómez, José, sábado 28\/11\/2026/ });
    // El nocturno del viernes no se repite el sábado: el sábado sólo tiene su propio bloque.
    expect(within(saturday).getAllByText(/19:00–07:00/)).toHaveLength(1);
    expect(within(grid).getByRole("button", { name: /domingo 29\/11\/2026, semana A: Descanso \(Franco\)/ })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /lunes 30\/11\/2026, semana B: Sin configurar \(Franco, Feriado, 1 error\)/ })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /martes 01\/12\/2026, semana B: Configuración contradictoria \(1 error\)/ })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /^Ruiz, Johanna, lunes 23\/11\/2026: F-0715 de 07:00 a 15:00 \(turno fijo\)/ })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /^Ruiz, Johanna, sábado 28\/11\/2026: Sin programación/ })).toBeInTheDocument();
    expect(within(grid).getAllByText(/Fijo · F-0715/).length).toBe(5);
  });

  it("el detalle muestra plan, bloques reales, obligación, jornada, hechos, descanso y advertencias sin códigos internos", async () => {
    const user = userEvent.setup();
    renderPanel();
    const grid = await screen.findByRole("grid");
    await user.click(within(grid).getByRole("button", { name: /^Gómez, José, viernes 27\/11\/2026/ }));
    let dialog = screen.getByRole("dialog", { name: "Detalle del día" });
    expect(within(dialog).getByText("Gómez, José · Legajo 19 · viernes 27/11/2026")).toBeInTheDocument();
    expect(within(dialog).getByText("José (equipo JOSE)")).toBeInTheDocument();
    expect(within(dialog).getByText("Semana A")).toBeInTheDocument();
    expect(within(dialog).getByText("vie 27/11 19:00 → sáb 28/11 07:00 · 12 h · Rotación")).toBeInTheDocument();
    expect(within(dialog).getByText("Debe trabajar")).toBeInTheDocument();
    expect(within(dialog).getByText("16 h")).toBeInTheDocument();
    expect(within(dialog).getByText("16 h desde el bloque del 26/11/2026.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(grid).getByRole("button", { name: /^Gómez, José, martes 01\/12\/2026/ }));
    dialog = screen.getByRole("dialog", { name: "Detalle del día" });
    expect(within(dialog).getByText("Los bloques del día se superponen.")).toBeInTheDocument();
    expect(within(dialog).getByText("La configuración de la rotación es contradictoria para esta fecha.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/block:|membership:|OVERLAPPING_BLOCKS|ROTATION_|3f1c2a4b/);
  });

  it("teclado: una sola celda tabulable, flechas para moverse, Enter abre y Escape devuelve el foco", async () => {
    const user = userEvent.setup();
    renderPanel();
    const grid = await screen.findByRole("grid");
    const buttons = within(grid).getAllByRole("button");
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(document.activeElement).toHaveAccessibleName(/^Ruiz, Johanna, miércoles 25\/11\/2026/);
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveAccessibleName(/^Ruiz, Johanna, domingo 06\/12\/2026/);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Detalle del día" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName(/^Ruiz, Johanna, domingo 06\/12\/2026/);
  });

  it("es de sólo lectura: no hay acciones de edición", async () => {
    renderPanel();
    await screen.findByRole("grid");
    expect(screen.queryByRole("button", { name: /Editar|Guardar|Eliminar|Incorporar|Activar/ })).not.toBeInTheDocument();
  });
});
