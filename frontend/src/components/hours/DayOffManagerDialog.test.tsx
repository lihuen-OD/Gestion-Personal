import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../../services/api/apiClient";
import { employeeDayOffApiService, type DayOffCandidate } from "../../services/api/employeeDayOffApiService";
import { DayOffManagerDialog } from "./DayOffManagerDialog";

vi.mock("../../services/api/employeeDayOffApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api/employeeDayOffApiService")>();
  return { ...actual, employeeDayOffApiService: { getByDate: vi.fn(), save: vi.fn() } };
});

const candidate = (id: string, legajo: string, lastName: string, overrides: Partial<DayOffCandidate> = {}): DayOffCandidate => ({
  employee: { id, legajo, firstName: "Ana", lastName },
  dayOff: null,
  holidayWork: false,
  periodLocked: false,
  ...overrides,
});

const people = [
  candidate("e1", "10", "Pérez"),
  candidate("e2", "20", "Gómez", { dayOff: { id: "d2", status: "ACTIVO", notes: "Compensatorio", updatedAt: "2026-11-01T00:00:00.000Z" } }),
  candidate("e3", "30", "Ruiz", { dayOff: { id: "d3", status: "CANCELADO", notes: null, updatedAt: "2026-11-01T00:00:00.000Z" } }),
  candidate("e4", "40", "Sosa", { holidayWork: true }),
  candidate("e5", "50", "Vera", { periodLocked: true }),
];

function renderDialog(props: Partial<Parameters<typeof DayOffManagerDialog>[0]> = {}) {
  const onSaved = vi.fn();
  const close = vi.fn();
  render(<DayOffManagerDialog initialDate="2026-11-05" canCorrectClosedPeriods={false} close={close} onSaved={onSaved} {...props} />);
  return { onSaved, close };
}

const rowOf = async (lastName: string) => (await screen.findByText(`${lastName}, Ana`)).closest("tr")!;
const checkboxOf = async (lastName: string) => within(await rowOf(lastName)).getByRole("checkbox");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(employeeDayOffApiService.getByDate).mockResolvedValue({ items: people, meta: { total: people.length, page: 1, pageSize: 50, hasMore: false } });
  vi.mocked(employeeDayOffApiService.save).mockResolvedValue({ date: "2026-11-05", summary: { changed: 2, unchanged: 0, activityAlerts: 1, resolvedActivityAlerts: 0, resolvedInactivityIncidents: 0 } });
});

describe("DayOffManagerDialog — Gestionar francos", () => {
  it("lista las personas del alcance para la fecha y muestra quién ya tiene franco", async () => {
    renderDialog();

    expect(employeeDayOffApiService.getByDate).toHaveBeenCalledWith({ date: "2026-11-05", search: "", page: 1, take: 50 });
    expect(within(await rowOf("Gómez")).getByText("Franco")).toBeInTheDocument();
    expect(within(await rowOf("Gómez")).getByText("Compensatorio")).toBeInTheDocument();
    expect(within(await rowOf("Ruiz")).getByText("Franco cancelado")).toBeInTheDocument();
    expect(within(await rowOf("Pérez")).getByText("Sin franco")).toBeInTheDocument();
    expect(within(await rowOf("Sosa")).getByText("Convocado al feriado")).toBeInTheDocument();
  });

  it("selección múltiple: asigna (y reactiva) a varias personas de una vez con la observación, y avisa a la grilla", async () => {
    const { onSaved } = renderDialog();

    fireEvent.click(await checkboxOf("Pérez"));
    fireEvent.click(await checkboxOf("Ruiz"));
    fireEvent.click(await checkboxOf("Gómez")); // ya tiene franco: no se vuelve a asignar
    fireEvent.change(screen.getByPlaceholderText(/franco compensatorio/), { target: { value: "Pedido del encargado" } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar franco (2)" }));

    await waitFor(() => expect(employeeDayOffApiService.save).toHaveBeenCalledWith({
      date: "2026-11-05",
      correctionReason: null,
      employees: [
        { employeeId: "e1", status: "ACTIVO", notes: "Pedido del encargado" },
        { employeeId: "e3", status: "ACTIVO", notes: "Pedido del encargado" },
      ],
    }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Franco asignado a 2 personas para el 05\/11\/2026\. 1 jornada ya registrada quedó para revisión/)).toBeInTheDocument();
    // Recarga la lista con el estado nuevo.
    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledTimes(2));
  });

  it("cancelar aplica sólo a quienes tienen franco activo, sin borrar la observación", async () => {
    renderDialog();

    fireEvent.click(await checkboxOf("Gómez"));
    fireEvent.click(await checkboxOf("Pérez"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar franco (1)" }));

    await waitFor(() => expect(employeeDayOffApiService.save).toHaveBeenCalledWith({ date: "2026-11-05", correctionReason: null, employees: [{ employeeId: "e2", status: "CANCELADO" }] }));
  });

  it("convocado al feriado o período cerrado (sin ser RRHH): no se puede seleccionar", async () => {
    renderDialog();

    expect(await checkboxOf("Sosa")).toBeDisabled();
    expect(await checkboxOf("Vera")).toBeDisabled();
  });

  it("RRHH con período cerrado: exige el motivo y lo envía", async () => {
    renderDialog({ canCorrectClosedPeriods: true });

    fireEvent.click(await checkboxOf("Vera"));
    fireEvent.click(screen.getByRole("button", { name: "Asignar franco (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Indicá el motivo de la corrección");
    expect(employeeDayOffApiService.save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Queda registrado en auditoría/), { target: { value: "Franco acordado y omitido" } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar franco (1)" }));
    await waitFor(() => expect(employeeDayOffApiService.save).toHaveBeenCalledWith(expect.objectContaining({ correctionReason: "Franco acordado y omitido" })));
  });

  it("muestra el error del backend dentro del modal (p. ej. 409 por convocatoria) y no avisa a la grilla", async () => {
    vi.mocked(employeeDayOffApiService.save).mockRejectedValue(new ApiError("No se puede asignar franco: Pérez, Ana · Legajo 10 está convocado a trabajar el feriado.", "DAY_OFF_CONFLICTS_HOLIDAY_WORK", 409));
    const { onSaved } = renderDialog();

    fireEvent.click(await checkboxOf("Pérez"));
    fireEvent.click(screen.getByRole("button", { name: "Asignar franco (1)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("está convocado a trabajar el feriado");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("estados de carga, error con reintento y vacío", async () => {
    vi.mocked(employeeDayOffApiService.getByDate).mockRejectedValueOnce(new Error("network"));
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Pérez, Ana")).toBeInTheDocument();
  });

  it("vacío: nadie del alcance coincide", async () => {
    vi.mocked(employeeDayOffApiService.getByDate).mockResolvedValue({ items: [], meta: { total: 0, page: 1, pageSize: 50, hasMore: false } });
    renderDialog();
    expect(await screen.findByText("No hay personas activas en tu alcance.")).toBeInTheDocument();
  });

  it("abierto desde una celda: preselecciona a esa persona y busca por su legajo", async () => {
    renderDialog({ initialSearch: "10", initialSelectedEmployeeId: "e1" });

    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledWith(expect.objectContaining({ search: "10" })));
    expect(await checkboxOf("Pérez")).toBeChecked();
    expect(screen.getByRole("button", { name: "Asignar franco (1)" })).toBeEnabled();
  });

  it("cambiar la fecha limpia la selección y vuelve a consultar", async () => {
    renderDialog();
    fireEvent.click(await checkboxOf("Pérez"));

    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-06" } });

    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-11-06" })));
    expect(screen.getByText("Seleccioná una o más personas")).toBeInTheDocument();
  });
});

describe("DayOffManagerDialog — preselección", () => {
  it("después de guardar desde una celda no vuelve a preseleccionar a la persona", async () => {
    renderDialog({ initialSearch: "10", initialSelectedEmployeeId: "e1" });
    expect(await checkboxOf("Pérez")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Asignar franco (1)" }));

    await waitFor(() => expect(employeeDayOffApiService.getByDate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Seleccioná una o más personas")).toBeInTheDocument());
  });
});
