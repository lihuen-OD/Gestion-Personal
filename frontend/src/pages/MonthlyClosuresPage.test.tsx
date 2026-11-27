import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MonthlyClosuresPage } from "./MonthlyClosuresPage";
import { employeeApiService } from "../services/api/employeeApiService";
import { workforceApiService, type ClosureBlocker, type ClosureBlockersPreview } from "../services/api/workforceApiService";
import { ApiError } from "../services/api/apiClient";

vi.mock("../services/api/employeeApiService", () => ({ employeeApiService: { getAllOptions: vi.fn() } }));
vi.mock("../services/api/workforceApiService", () => ({ workforceApiService: { closures: vi.fn(), closeClosures: vi.fn(), reopenClosure: vi.fn(), closureBlockers: vi.fn() } }));
vi.mock("../components/hours/MonthlyClosureReviewPanel", () => ({ MonthlyClosureReviewPanel: () => null }));

const employee = { id: "11111111-1111-4111-8111-111111111111", legajo: "100", firstName: "Ana", lastName: "Gómez" };
const other = { id: "22222222-2222-4222-8222-222222222222", legajo: "200", firstName: "Bruno", lastName: "Paz" };

const PERIOD = "2026-10";
const openShift = (owner = employee): ClosureBlocker => ({
  id: `shift:${owner.id}`,
  type: "INCOMPLETE_SHIFT",
  employee: owner,
  date: "2026-10-27",
  title: "Jornada sin salida registrada",
  reason: "La jornada quedó incompleta y sin revisar: sus horas no están cargadas, así que el total del período puede cambiar.",
  action: "Si la persona trabajó, cargá las horas reales del día en Carga de horas; después resolvé la observación de la jornada en Asistencia.",
  resolution: { module: "ATTENDANCE", label: "Ir a observaciones", path: "/asistencia?observationDate=2026-10-27" },
});
const preview = (blockers: ClosureBlocker[]): ClosureBlockersPreview => {
  const groups = new Map<string, ClosureBlocker[]>();
  for (const blocker of blockers) groups.set(blocker.employee.id, [...(groups.get(blocker.employee.id) ?? []), blocker]);
  return { period: PERIOD, employees: [...groups.values()].map((items) => ({ employee: items[0]!.employee, blockers: items })), totals: { employees: groups.size, blockers: blockers.length } };
};

const renderPage = () => render(<MemoryRouter initialEntries={[`/cierres?period=${PERIOD}`]}><MonthlyClosuresPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(employeeApiService.getAllOptions).mockResolvedValue([employee, other] as never);
  vi.mocked(workforceApiService.closures).mockResolvedValue([]);
  vi.mocked(workforceApiService.closeClosures).mockResolvedValue([]);
  vi.mocked(workforceApiService.closureBlockers).mockResolvedValue(preview([]));
});

describe("MonthlyClosuresPage", () => {
  it("permite cerrar directamente un legajo sin pendientes", async () => {
    renderPage();
    expect(await screen.findByText(/Sin pendientes: los legajos abiertos de octubre de 2026 se pueden cerrar/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Seleccionar 100"));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar seleccionados" }));
    expect(workforceApiService.closeClosures).toHaveBeenCalledWith(PERIOD, [employee.id]);
    expect(workforceApiService.closureBlockers).toHaveBeenCalledWith(PERIOD);
  });

  it("al consultar el período muestra quién tiene pendientes y el detalle por incidencia, con acceso al módulo", async () => {
    vi.mocked(workforceApiService.closureBlockers).mockResolvedValue(preview([openShift()]));
    renderPage();

    expect(await screen.findByText(/legajo tiene/)).toHaveTextContent("1 legajo tiene 1 pendiente que impide cerrar.");
    const summaryRow = screen.getByText("Jornada incompleta · 1").closest("tr")!;
    expect(within(summaryRow).getByText("Gómez, Ana")).toBeInTheDocument();
    expect(within(summaryRow).getByText("100")).toBeInTheDocument();
    expect(within(summaryRow).getByText("27/10/2026")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ver incidencias" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Pendientes de Gómez, Ana")).toBeInTheDocument();
    expect(within(dialog).getByText("Legajo 100 · octubre de 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("Jornada sin salida registrada")).toBeInTheDocument();
    expect(within(dialog).getByText(/sus horas no están cargadas/)).toBeInTheDocument();
    expect(within(dialog).getByText(/cargá las horas reales del día/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Ir a observaciones/ })).toHaveAttribute("href", "/asistencia?observationDate=2026-10-27");
  });

  it("la columna Pendientes distingue listos para cerrar de bloqueados", async () => {
    vi.mocked(workforceApiService.closureBlockers).mockResolvedValue(preview([openShift()]));
    renderPage();
    const anaRow = (await screen.findByLabelText("Seleccionar 100")).closest("tr")!;
    const brunoRow = screen.getByLabelText("Seleccionar 200").closest("tr")!;
    expect(within(anaRow).getByRole("button", { name: /1 pendiente/ })).toBeInTheDocument();
    expect(within(brunoRow).getByText("Listo para cerrar")).toBeInTheDocument();
  });

  it("cerrar varios con alguno bloqueado muestra el resumen agrupado y permite cerrar sólo los listos", async () => {
    vi.mocked(workforceApiService.closureBlockers).mockResolvedValue(preview([openShift(), { ...openShift(), id: "conflict:1", type: "MANUAL_CLOCK_CONFLICT", date: "2026-10-12", title: "Fichada sobre horas cargadas a mano", resolution: { module: "HOURS", label: "Ir a Carga de horas", path: "/horas?period=2026-10" } }]));
    renderPage();
    await userEvent.click(await screen.findByLabelText("Seleccionar abiertos"));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar seleccionados" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("No se pueden cerrar todos los seleccionados")).toBeInTheDocument();
    expect(within(dialog).getByText("2 pendientes")).toBeInTheDocument();
    expect(within(dialog).getByText("Jornada sin salida registrada")).toBeInTheDocument();
    expect(within(dialog).getByText("Fichada sobre horas cargadas a mano")).toBeInTheDocument();
    expect(workforceApiService.closeClosures).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar sólo 1 sin pendientes" }));
    expect(workforceApiService.closeClosures).toHaveBeenCalledWith(PERIOD, [other.id]);
  });

  it("si el backend rechaza el cierre por pendientes, vuelve a consultar y los muestra agrupados (sin interpretar el texto)", async () => {
    vi.mocked(workforceApiService.closureBlockers).mockResolvedValueOnce(preview([])).mockResolvedValue(preview([openShift()]));
    vi.mocked(workforceApiService.closeClosures).mockRejectedValueOnce(new ApiError("texto libre", "CLOSURE_HAS_OPERATIONAL_BLOCKERS", 409));
    renderPage();
    await userEvent.click(await screen.findByLabelText("Seleccionar 100"));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar seleccionados" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Jornada sin salida registrada")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Cerrar sólo/ })).not.toBeInTheDocument();
    expect(screen.queryByText("texto libre")).not.toBeInTheDocument();
  });

  it("si no se pueden revisar los pendientes muestra el error con reintento y no bloquea la tabla", async () => {
    vi.mocked(workforceApiService.closureBlockers).mockRejectedValueOnce(new Error("red")).mockResolvedValue(preview([]));
    renderPage();
    expect(await screen.findByText("No se pudieron revisar los pendientes")).toBeInTheDocument();
    expect(await screen.findByLabelText("Seleccionar 100")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText(/Sin pendientes/)).toBeInTheDocument());
  });

  it("al volver a la pestaña recalcula los pendientes", async () => {
    renderPage();
    await screen.findByText(/Sin pendientes/);
    const calls = vi.mocked(workforceApiService.closureBlockers).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(vi.mocked(workforceApiService.closureBlockers).mock.calls.length).toBe(calls + 1));
  });

  it("muestra el historial exportado sin alterar sus versiones", async () => {
    vi.mocked(workforceApiService.closures).mockResolvedValue([{ id: "c1", employeeId: employee.id, period: PERIOD, status: "CERRADO", employee, exportHistory: { count: 2, latestVersion: 2, latestExportedAt: "2026-11-27T12:00:00Z" } }]);
    renderPage();
    expect(await screen.findByText("2 · última v2")).toBeInTheDocument();
  });
});
