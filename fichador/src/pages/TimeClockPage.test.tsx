import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeClockPage } from "./TimeClockPage";
import { timeClockApiService } from "../services/api/timeClockApiService";
import { ApiError, NetworkError } from "../services/api/apiClient";
import { kioskActivity } from "../pwa/kioskActivity";

vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: {
    searchEmployees: vi.fn(),
    status: vi.fn(),
    photoPunch: vi.fn(),
    attemptStatus: vi.fn(),
  },
}));

vi.mock("../components/time-clock/FaceCaptureModal", () => ({
  FaceCaptureModal: ({ punchType, onConfirm, onCancel }: { punchType: "IN" | "OUT"; onConfirm: (capture: unknown) => void; onCancel: () => void }) => (
    <div data-testid="face-capture-modal">
      <span>captura para {punchType}</span>
      <button
        onClick={() =>
          onConfirm({
            photo: "data:image/jpeg;base64,AAAA",
            thumbnail: "data:image/jpeg;base64,AAAA",
            faceValidationStatus: "VALID",
            faceDetectionScore: 0.94,
            device: { userAgent: "test-agent", platform: "test", language: "es-AR" },
          })
        }
      >
        Confirmar captura
      </button>
      <button onClick={onCancel}>Cancelar captura</button>
    </div>
  ),
}));

const employeeMatch = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };

// Fechas relativas al reloj real de la corrida, no hardcodeadas: un turno
// abierto hace 8 horas nunca "expira" (supera las 20h de
// MAX_CLOCK_SHIFT_MINUTES en TimeClockPage.tsx) sin importar cuándo se
// ejecute el test — a diferencia de un ISO fijo, que sí termina superando ese
// umbral con el correr de los días reales.
function nowIso() {
  return new Date().toISOString();
}
function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function mockNoOpenShift() {
  vi.mocked(timeClockApiService.status).mockResolvedValue({
    employee: employeeMatch,
    openShift: null,
  });
}

function mockOpenShift() {
  vi.mocked(timeClockApiService.status).mockResolvedValue({
    employee: employeeMatch,
    openShift: { id: "shift-1", startAt: isoHoursAgo(8) },
  });
}

async function selectEmployee() {
  const user = userEvent.setup();
  render(<TimeClockPage />);
  await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
  const resultButton = await screen.findByText("Gomez, Ana");
  await user.click(resultButton);
  await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalledWith("employee-1"));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(timeClockApiService.searchEmployees).mockResolvedValue([employeeMatch]);
});

describe("TimeClockPage — fichador sin selector de concepto horario (Etapa 6K)", () => {
  it("no muestra ningún selector (radio) de concepto horario", async () => {
    mockNoOpenShift();
    await selectEmployee();

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/qué tipo de jornada/i)).not.toBeInTheDocument();
  });

  it("no muestra Normal, Sereno, Colectivo ni Guardia como opciones en pantalla", async () => {
    mockNoOpenShift();
    const { container } = render(<TimeClockPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));
    await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalled());

    expect(container.textContent).not.toMatch(/Sereno/);
    expect(container.textContent).not.toMatch(/Colectivo/);
    expect(container.textContent).not.toMatch(/Guardia/);
    expect(container.textContent).not.toMatch(/Hora normal/);
  });

  it("no expone 'priority' ni 'countsAsWorked' en el fichador", async () => {
    mockNoOpenShift();
    const { container } = render(<TimeClockPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));
    await waitFor(() => expect(timeClockApiService.status).toHaveBeenCalled());

    expect(container.textContent).not.toMatch(/priority/i);
    expect(container.textContent).not.toMatch(/countsAsWorked/i);
  });

  it("permite marcar ingreso y el payload de fichada no incluye hourConceptId/conceptId/hourType", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({
      employee: employeeMatch,
      workShift: { id: "shift-1", startAt: nowIso() },
    });
    const user = await selectEmployee();

    const clockInButton = screen.getByRole("button", { name: /Marcar ingreso/i });
    expect(clockInButton).toBeEnabled();
    await user.click(clockInButton);

    await screen.findByTestId("face-capture-modal");
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));

    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("hourConceptId");
    expect(payload).not.toHaveProperty("conceptId");
    expect(payload).not.toHaveProperty("hourType");
    expect(payload).toMatchObject({ punchType: "IN", employeeId: "employee-1" });

    expect(await screen.findByText(/Ingreso registrado/i)).toBeInTheDocument();
  });

  it("permite marcar salida y el payload de fichada tampoco incluye conceptos", async () => {
    mockOpenShift();
    const shiftStartAt = isoHoursAgo(8);
    const shiftEndAt = nowIso();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({
      employee: employeeMatch,
      workShift: { id: "shift-1", startAt: shiftStartAt, endAt: shiftEndAt, totalMinutes: 480, totalHours: 8 },
      segments: [{ date: shiftStartAt.slice(0, 10), startAt: shiftStartAt, endAt: shiftEndAt, minutes: 480, hours: 8, label: "8 h trabajadas" }],
    });
    const user = await selectEmployee();

    const clockOutButton = screen.getByRole("button", { name: /Marcar salida/i });
    expect(clockOutButton).toBeEnabled();
    await user.click(clockOutButton);

    await screen.findByTestId("face-capture-modal");
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));

    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("hourConceptId");
    expect(payload).not.toHaveProperty("conceptId");
    expect(payload).not.toHaveProperty("hourType");
    expect(payload).toMatchObject({ punchType: "OUT" });

    expect(await screen.findByText(/Salida registrada/i)).toBeInTheDocument();
  });

  it("muestra un error claro si falla la consulta de estado, sin romper la pantalla", async () => {
    vi.mocked(timeClockApiService.status).mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<TimeClockPage />);
    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");
    await user.click(await screen.findByText("Gomez, Ana"));

    expect(await screen.findByText("No pudimos consultar el estado del legajo seleccionado.")).toBeInTheDocument();
  });

  it("identifica al empleado por legajo y los últimos 3 dígitos del DNI (F0: el DNI completo no llega al kiosco)", async () => {
    mockNoOpenShift();
    await selectEmployee();

    expect(await screen.findByText("Legajo 100 · DNI terminado en 456")).toBeInTheDocument();
    expect(screen.queryByText(/DNI \d{6,}/)).not.toBeInTheDocument();
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function confirmCapture(user: ReturnType<typeof userEvent.setup>, punch: RegExp) {
  await user.click(screen.getByRole("button", { name: punch }));
  await screen.findByTestId("face-capture-modal");
  await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));
}

// F1 — fichador standalone: mismo flujo que /fichador del admin, ahora
// cubierto también para errores de red/HTTP, verificación e idempotencia.
describe("TimeClockPage standalone (F1) — flujo, errores e idempotencia", () => {
  it("carga inicial: muestra sólo el fichador, con los botones deshabilitados hasta elegir empleado", () => {
    render(<TimeClockPage />);

    expect(screen.getByRole("heading", { name: "Fichador de personal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeDisabled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Cerrar sesión/i)).not.toBeInTheDocument();
  });

  it("búsqueda: no consulta con menos de 2 caracteres y muestra legajo + DNI terminado en", async () => {
    const user = userEvent.setup();
    render(<TimeClockPage />);
    const input = screen.getByLabelText("Buscar por nombre o apellido");

    await user.type(input, "G");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(timeClockApiService.searchEmployees).not.toHaveBeenCalled();

    await user.type(input, "o");
    await waitFor(() => expect(timeClockApiService.searchEmployees).toHaveBeenCalledWith("Go"));
    expect(await screen.findByText("Legajo 100 · DNI terminado en 456")).toBeInTheDocument();
  });

  it("sin conexión con el backend: la búsqueda muestra un estado claro y no permite fichar", async () => {
    vi.mocked(timeClockApiService.searchEmployees).mockRejectedValue(new NetworkError());
    const user = userEvent.setup();
    render(<TimeClockPage />);

    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");

    expect(await screen.findByText(/No hay conexión con el servidor/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
  });

  it("403 (dispositivo deshabilitado) en la búsqueda: mensaje de negocio, sin detalle técnico", async () => {
    vi.mocked(timeClockApiService.searchEmployees).mockRejectedValue(
      new ApiError("Este dispositivo fue deshabilitado por RRHH.", "CLOCK_DEVICE_REVOKED", 403),
    );
    const user = userEvent.setup();
    render(<TimeClockPage />);

    await user.type(screen.getByLabelText("Buscar por nombre o apellido"), "Gomez");

    expect(await screen.findByText("Este dispositivo fue deshabilitado por RRHH.")).toBeInTheDocument();
  });

  it("429 al consultar el estado: avisa que hay demasiados intentos", async () => {
    vi.mocked(timeClockApiService.status).mockRejectedValue(
      new ApiError("Hay demasiados intentos seguidos desde este dispositivo. Esperá unos minutos y volvé a intentar.", "API_ERROR", 429),
    );
    await selectEmployee();

    expect(await screen.findByText(/demasiados intentos/i)).toBeInTheDocument();
  });

  it("cada intención de fichar usa un requestId UUID nuevo", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({ employee: employeeMatch, workShift: { id: "shift-1", startAt: nowIso() } });
    const user = await selectEmployee();

    await confirmCapture(user, /Marcar ingreso/i);
    await screen.findByText(/Ingreso registrado/i);
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({
      employee: employeeMatch,
      workShift: { id: "shift-1", startAt: isoHoursAgo(1), endAt: nowIso(), totalMinutes: 60, totalHours: 1 },
      segments: [],
    });
    await confirmCapture(user, /Marcar salida/i);
    await screen.findByText(/Salida registrada/i);

    const [first, second] = vi.mocked(timeClockApiService.photoPunch).mock.calls.map(([input]) => input.requestId);
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("si la respuesta se pierde (red), verifica el MISMO requestId y aplica el resultado ya registrado, sin reenviar", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new NetworkError());
    vi.mocked(timeClockApiService.attemptStatus).mockResolvedValue({
      requestId: "ignored",
      status: "COMPLETED",
      response: { employee: employeeMatch, workShift: { id: "shift-1", startAt: nowIso() } },
      error: null,
    });
    const user = await selectEmployee();

    await confirmCapture(user, /Marcar ingreso/i);

    expect(await screen.findByText(/Ingreso registrado/i)).toBeInTheDocument();
    const sentRequestId = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].requestId;
    expect(timeClockApiService.attemptStatus).toHaveBeenCalledWith(sentRequestId, "employee-1");
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("409 de negocio confirmado por el intento: muestra el mensaje del backend y libera la pantalla", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Ya existe un ingreso abierto para este empleado.", "CLOCK_ALREADY_OPEN", 409));
    vi.mocked(timeClockApiService.attemptStatus).mockResolvedValue({
      requestId: "ignored",
      status: "FAILED",
      response: null,
      error: { code: "CLOCK_ALREADY_OPEN", message: "Ya existe un ingreso abierto para este empleado.", httpStatus: 409 },
    });
    const user = await selectEmployee();

    await confirmCapture(user, /Marcar ingreso/i);

    expect(await screen.findByText("Ya existe un ingreso abierto para este empleado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();
  });

  it("impide el doble envío: dos confirmaciones mientras la fichada está en curso mandan una sola", async () => {
    mockNoOpenShift();
    let resolvePunch: (value: Awaited<ReturnType<typeof timeClockApiService.photoPunch>>) => void = () => undefined;
    vi.mocked(timeClockApiService.photoPunch).mockImplementation(() => new Promise((resolve) => { resolvePunch = resolve; }));
    const user = await selectEmployee();

    await confirmCapture(user, /Marcar ingreso/i);
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));
    await user.click(screen.getByRole("button", { name: /Confirmar captura/i }));

    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
    resolvePunch({ employee: employeeMatch, workShift: { id: "shift-1", startAt: nowIso() } });
    expect(await screen.findByText(/Ingreso registrado/i)).toBeInTheDocument();
  });
});

// F3 — una actualización de la app nunca recarga en medio de una fichada.
describe("TimeClockPage — kiosco ocupado/ocioso para las actualizaciones (F3)", () => {
  it("ocupado con un empleado elegido; vuelve a ocioso al cambiar de empleado", async () => {
    mockNoOpenShift();
    expect(kioskActivity.isIdle()).toBe(true);
    const user = await selectEmployee();

    expect(kioskActivity.isIdle()).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cambiar empleado" }));
    await waitFor(() => expect(kioskActivity.isIdle()).toBe(true));
  });

  it("ocupado mientras la cámara está abierta y la fichada se envía", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockImplementation(() => new Promise(() => undefined));
    const user = await selectEmployee();

    await confirmCapture(user, /Marcar ingreso/i);
    expect(kioskActivity.isIdle()).toBe(false);
  });
});
