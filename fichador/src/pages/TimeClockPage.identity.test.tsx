import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TimeClockPage, SUCCESS_RESET_MS } from "./TimeClockPage";
import { timeClockApiService, type ClockEmployee } from "../services/api/timeClockApiService";
import { ApiError } from "../services/api/apiClient";
import { kioskActivity } from "../pwa/kioskActivity";

/**
 * Etapa 6B-1 (AUDITORIA_6A F6-01 / F6-02): la persona que se ve, su estado de
 * jornada, la captura y el employeeId enviado son SIEMPRE la misma. Las
 * consultas de estado se controlan a mano (promesas diferidas) para resolverlas
 * en cualquier orden.
 */
vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: { searchEmployees: vi.fn(), status: vi.fn(), photoPunch: vi.fn(), attemptStatus: vi.fn() },
}));

vi.mock("../components/time-clock/FaceCaptureModal", () => ({
  FaceCaptureModal: ({ onConfirm, onCancel, employeeLabel }: { onConfirm: (capture: unknown) => void; onCancel: () => void; employeeLabel?: string }) => (
    <div data-testid="face-capture-modal">
      <span data-testid="capture-employee">{employeeLabel}</span>
      <button onClick={() => onConfirm({ photo: "data:image/jpeg;base64,AAAA", thumbnail: "data:image/jpeg;base64,AAAA", faceValidationStatus: "VALID", faceDetectionScore: 0.9, device: { userAgent: "t", platform: "t", language: "es-AR" } })}>Confirmar captura</button>
      <button onClick={onCancel}>Cancelar captura</button>
    </div>
  ),
}));

const ANA: ClockEmployee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const BETO: ClockEmployee = { id: "employee-2", legajo: "200", dniSuffix: "789", firstName: "Beto", lastName: "Paz", name: "Paz, Beto" };
type Status = Awaited<ReturnType<typeof timeClockApiService.status>>;
type Pending = { employeeId: string; resolve: (value: Status) => void; reject: (error: unknown) => void };

let pending: Pending[];
const openShift = (hours = 3) => ({ id: "shift-1", startAt: new Date(Date.now() - hours * 3_600_000).toISOString() });
const statusOf = (employee: ClockEmployee, open = false): Status => ({ employee, openShift: open ? openShift() : null });
/** La consulta n-ésima (0 = la primera) todavía pendiente para ese legajo. */
const nextPending = (employeeId: string) => {
  const index = pending.findIndex((entry) => entry.employeeId === employeeId);
  if (index < 0) throw new Error(`sin consulta pendiente para ${employeeId}`);
  return pending.splice(index, 1)[0]!;
};
const resolveStatus = async (employee: ClockEmployee, open = false) => { await act(async () => { nextPending(employee.id).resolve(statusOf(employee, open)); }); };
const rejectStatus = async (employeeId: string, error: unknown = new ApiError("El servicio no está disponible en este momento. Intentá nuevamente en unos minutos.", "INTERNAL_ERROR", 503)) => {
  await act(async () => { nextPending(employeeId).reject(error); });
};

const personShown = () => document.querySelector(".kiosk-person h2")?.textContent ?? null;
const action = () => screen.getByRole("button", { name: /^Marcar/ });
const searchInput = () => screen.getByLabelText("Buscar por nombre o apellido");

async function select(employee: ClockEmployee) {
  fireEvent.change(searchInput(), { target: { value: employee.lastName } });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(employee.name) }));
  await waitFor(() => expect(personShown()).not.toBeNull());
}
const change = () => fireEvent.click(screen.getByRole("button", { name: "Cambiar empleado" }));

beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  vi.mocked(timeClockApiService.searchEmployees).mockImplementation(async (query: string) => [ANA, BETO].filter((employee) => employee.name.includes(query)));
  vi.mocked(timeClockApiService.status).mockImplementation((employeeId: string) => new Promise<Status>((resolve, reject) => { pending.push({ employeeId, resolve, reject }); }));
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F6-01 — una respuesta de estado vieja nunca se aplica a otra selección", () => {
  it("1. A → B y la respuesta de A llega después: se sigue viendo B, sin acción hasta conocer el estado de B", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await resolveStatus(ANA, true);

    expect(personShown()).toBe("Beto Paz");
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
    expect(action()).toBeDisabled();

    await resolveStatus(BETO);
    expect(personShown()).toBe("Beto Paz");
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled();
  });

  it("2. A → B resueltas en orden inverso: la respuesta tardía de A no pisa el estado confirmado de B", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await resolveStatus(BETO);
    await resolveStatus(ANA, true);

    expect(personShown()).toBe("Beto Paz");
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Marcar salida" })).not.toBeInTheDocument();
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
  });

  it("3. un éxito viejo (A) que llega después del error de la consulta actual (B) no habilita nada", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await rejectStatus(BETO.id);
    await resolveStatus(ANA, true);

    expect(personShown()).toBe("Beto Paz");
    expect(screen.getByText("No pudimos consultar tu jornada")).toBeInTheDocument();
    expect(action()).toBeDisabled();
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
  });

  it("4. un error viejo (A) que llega después de la respuesta válida actual (B) no la invalida", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await resolveStatus(BETO);
    await rejectStatus(ANA.id);

    expect(personShown()).toBe("Beto Paz");
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("5. limpiar la selección con la consulta pendiente: la respuesta no restaura datos al elegir a otro", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    expect(personShown()).toBeNull();
    // La respuesta de A llega con el buscador ya escrito y antes de tocar a B.
    fireEvent.change(searchInput(), { target: { value: BETO.lastName } });
    const betoRow = await screen.findByRole("button", { name: new RegExp(BETO.name) });
    await resolveStatus(ANA, true);
    expect(personShown()).toBeNull();

    fireEvent.click(betoRow);
    await waitFor(() => expect(personShown()).not.toBeNull());
    expect(personShown()).toBe("Beto Paz");
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
    expect(action()).toBeDisabled();
  });

  it("6. el kiosco vuelve solo al inicio con un refresco pendiente: al llegar no restaura al legajo anterior", async () => {
    vi.mocked(timeClockApiService.photoPunch)
      .mockRejectedValueOnce(new ApiError("La jornada anterior fue actualizada por otro intento.", "CLOCK_SHIFT_CHANGED", 409))
      .mockResolvedValueOnce({ employee: ANA, workShift: { id: "shift-9", startAt: new Date().toISOString() } });
    render(<TimeClockPage />);
    await select(ANA);
    await resolveStatus(ANA);
    fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar captura" }));
    await screen.findByText("La jornada anterior fue actualizada por otro intento.");
    // El refresco silencioso de A quedó pendiente; una segunda fichada termina bien.
    fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar captura" }));
    await screen.findByRole("heading", { name: "Entrada registrada" });
    await waitFor(() => expect(searchInput()).toBeInTheDocument(), { timeout: SUCCESS_RESET_MS + 2_000 });

    fireEvent.change(searchInput(), { target: { value: BETO.lastName } });
    const betoRow = await screen.findByRole("button", { name: new RegExp(BETO.name) });
    await resolveStatus(ANA, true); // el refresco silencioso de A, ya con el kiosco reiniciado
    fireEvent.click(betoRow);
    await waitFor(() => expect(personShown()).not.toBeNull());
    expect(personShown()).toBe("Beto Paz");
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
    expect(action()).toBeDisabled();
  }, 10_000);

  it("7. un refresco silencioso de A que llega después de cambiar a B se descarta", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValueOnce(new ApiError("Ya existe un ingreso abierto para este empleado.", "CLOCK_ALREADY_OPEN", 409));
    render(<TimeClockPage />);
    await select(ANA);
    await resolveStatus(ANA);
    fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar captura" }));
    await screen.findByText("Ya existe un ingreso abierto para este empleado.");
    change();
    await select(BETO);
    await resolveStatus(ANA, true); // el refresco silencioso de A

    expect(personShown()).toBe("Beto Paz");
    expect(screen.queryByText("Jornada abierta")).not.toBeInTheDocument();
    expect(action()).toBeDisabled();
    await resolveStatus(BETO);
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled();
  });
});

describe("F6-02 — sin estado confirmado no hay acción", () => {
  it("8. si falla la consulta del legajo elegido, ingreso y salida quedan bloqueados y se explica cómo seguir", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    await rejectStatus(ANA.id);

    expect(personShown()).toBe("Ana Gomez");
    expect(screen.getByText("No pudimos consultar tu jornada")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("El servicio no está disponible en este momento.");
    expect(action()).toBeDisabled();
    // No afirma ingreso ni salida: texto neutro y sin el ícono de ninguno de los dos.
    expect(action()).toHaveAccessibleName("Marcar ingreso o salida");
    expect(action()).toHaveClass("is-unknown");
    expect(action().querySelector(".lucide-log-in, .lucide-log-out")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Marcar (nuevo )?ingreso$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar salida" })).not.toBeInTheDocument();
    fireEvent.click(action());
    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar estado" })).toBeEnabled();
  });

  it("9. el reintento exitoso recupera sólo la acción que corresponde (jornada abierta → salida)", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    await rejectStatus(ANA.id);
    expect(action()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" }));
    expect(action()).toBeDisabled();
    await resolveStatus(ANA, true);

    expect(screen.getByRole("button", { name: "Marcar salida" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /ingreso/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos consultar tu jornada")).not.toBeInTheDocument();
  });
});

describe("F6-01 — cámara y envío con una sola identidad", () => {
  it("10. la cámara sólo se abre con el estado confirmado de la persona elegida y la nombra a ella", async () => {
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await resolveStatus(ANA, true);
    fireEvent.click(action());
    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();

    await resolveStatus(BETO);
    fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
    expect(await screen.findByTestId("capture-employee")).toHaveTextContent("Beto Paz · Legajo 200");
  });

  it("11. el envío usa el employeeId de quien inició la fichada; con la cámara abierta no se puede cambiar de empleado", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({ employee: BETO, workShift: { id: "shift-2", startAt: new Date().toISOString() } });
    render(<TimeClockPage />);
    await select(ANA);
    change();
    await select(BETO);
    await resolveStatus(ANA, true);
    await resolveStatus(BETO);
    fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
    await screen.findByTestId("face-capture-modal");

    const changeButton = screen.getByRole("button", { name: "Cambiar empleado" });
    expect(changeButton).toBeDisabled();
    fireEvent.click(changeButton);
    expect(personShown()).toBe("Beto Paz");

    fireEvent.click(screen.getByRole("button", { name: "Confirmar captura" }));
    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    const [sent] = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]!;
    expect(sent).toMatchObject({ employeeId: BETO.id, punchType: "IN" });
    expect(await screen.findByText("Beto Paz")).toBeInTheDocument();
  });

  it("13. elegir a alguien con una búsqueda todavía en vuelo no deja el kiosco ocupado al volver al inicio", async () => {
    let finishSearch: (value: ClockEmployee[]) => void = () => undefined;
    render(<TimeClockPage />);
    fireEvent.change(searchInput(), { target: { value: ANA.lastName } });
    const anaRow = await screen.findByRole("button", { name: new RegExp(ANA.name) });
    vi.mocked(timeClockApiService.searchEmployees).mockImplementationOnce(() => new Promise((resolve) => { finishSearch = resolve; }));
    fireEvent.change(searchInput(), { target: { value: "Gome" } });
    await waitFor(() => expect(timeClockApiService.searchEmployees).toHaveBeenCalledWith("Gome"));
    fireEvent.click(anaRow);
    await waitFor(() => expect(personShown()).toBe("Ana Gomez"));
    await act(async () => { finishSearch([ANA]); });
    change();
    expect(kioskActivity.isIdle()).toBe(true);
  });

  it("12. una respuesta que llega después de desmontar no actualiza nada ni produce errores", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<TimeClockPage />);
    await select(ANA);
    view.unmount();
    await resolveStatus(ANA, true);
    expect(consoleError).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("");
  });
});
