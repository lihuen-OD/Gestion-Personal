import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FALLBACK_COOLDOWN_SECONDS, OFFLINE_MESSAGE, SUCCESS_RESET_MS, TimeClockPage, UNCONFIRMED_MESSAGE } from "./TimeClockPage";
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
  FaceCaptureModal: ({ punchType, onConfirm, onCancel, onInterrupted }: { punchType: "IN" | "OUT"; onConfirm: (capture: unknown) => void; onCancel: () => void; onInterrupted?: () => void }) => (
    <div data-testid="face-capture-modal">
      {/* F10: simula que el fichador pasó a segundo plano con la cámara abierta. */}
      <button onClick={() => onInterrupted?.()}>Interrumpir captura</button>
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

    expect(await screen.findByText("Entrada registrada")).toBeInTheDocument();
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

  it("si la respuesta se pierde (red), verifica el MISMO requestId y aplica el resultado ya registrado, sin reenviar (COMPLETED recuperado = éxito normal)", async () => {
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

    expect(await screen.findByText("Entrada registrada")).toBeInTheDocument();
    const sentRequestId = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].requestId;
    expect(timeClockApiService.attemptStatus).toHaveBeenCalledWith(sentRequestId, "employee-1");
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("409 de negocio del POST: es definitivo (F8: no consulta el intento), muestra el mensaje del backend y libera la pantalla", async () => {
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
    expect(timeClockApiService.attemptStatus).not.toHaveBeenCalled();
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
    expect(await screen.findByText("Entrada registrada")).toBeInTheDocument();
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

// F8 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §27): confirmación con
// hora del servidor, retorno automático, recuperación por requestId, cooldown
// con cuenta regresiva local y estados sin red. Timers falsos: ninguna espera
// real (polling, cuenta regresiva y retorno automático se adelantan).
describe("TimeClockPage — F8: confirmación, recuperación, cooldown y retorno al inicio", () => {
  // 15:30 UTC en el reloj del equipo = 12:30 en Argentina: distinto de la hora
  // del servidor que devuelve el backend, para probar cuál se muestra.
  const DEVICE_NOW = new Date("2026-10-13T15:30:00.000Z");
  const SERVER_START = "2026-10-13T11:01:00.000Z"; // 08:01 ART
  const SERVER_END = "2026-10-13T19:07:00.000Z"; // 16:07 ART
  const inResult = { employee: employeeMatch, workShift: { id: "shift-1", startAt: SERVER_START } };
  const outResult = { employee: employeeMatch, workShift: { id: "shift-1", startAt: SERVER_START, endAt: SERVER_END, totalMinutes: 486, totalHours: 8.1 }, segments: [] };
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const notFound = () => new ApiError("No se encontró el intento de fichada.", "CLOCK_ATTEMPT_NOT_FOUND", 404);
  let onLine: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(DEVICE_NOW);
    onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    onLine.mockRestore();
    vi.useRealTimers();
  });

  // fireEvent (síncrono) en vez de userEvent: el asyncWrapper de Testing
  // Library espera un setTimeout(0) que con los timers falsos de Vitest nunca
  // dispara.
  async function searchAndSelect() {
    fireEvent.change(screen.getByLabelText("Buscar por nombre o apellido"), { target: { value: "Gomez" } });
    await flush(300);
    fireEvent.click(screen.getByText("Gomez, Ana"));
    await flush();
  }

  async function selectWithFakeTimers() {
    render(<TimeClockPage />);
    await searchAndSelect();
  }

  async function openCapture(punch: RegExp) {
    fireEvent.click(screen.getByRole("button", { name: punch }));
    await flush();
    expect(screen.getByTestId("face-capture-modal")).toBeInTheDocument();
  }

  async function confirm() {
    fireEvent.click(screen.getByRole("button", { name: /Confirmar captura/i }));
    await flush();
  }

  const sentRequestIds = () => vi.mocked(timeClockApiService.photoPunch).mock.calls.map(([sent]) => sent.requestId);

  it("éxito: confirma con la hora DEL SERVIDOR (no la del equipo) y vuelve solo al inicio", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.getByText("Entrada registrada")).toBeInTheDocument();
    expect(screen.getByText("Ana Gomez")).toBeInTheDocument();
    expect(screen.getByText("08:01")).toBeInTheDocument();
    expect(screen.queryByText("12:30")).not.toBeInTheDocument();
    expect(screen.getByText("Podés continuar.")).toBeInTheDocument();
    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(false);
    // Nada técnico en pantalla.
    expect(document.body.textContent).not.toMatch(/shift-1|KIOSK|requestId|[0-9a-f]{8}-[0-9a-f]{4}-/i);

    await flush(SUCCESS_RESET_MS);

    expect(screen.queryByText("Entrada registrada")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre o apellido")).toHaveValue("");
    expect(screen.queryByText("Legajo 100 · DNI terminado en 456")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
    expect(kioskActivity.isIdle()).toBe(true);
  });

  it("salida: muestra 'Salida registrada' con el endAt del servidor", async () => {
    mockOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(outResult);
    await selectWithFakeTimers();
    await openCapture(/Marcar salida/i);
    await confirm();

    expect(screen.getByText("Salida registrada")).toBeInTheDocument();
    expect(screen.getByText("16:07")).toBeInTheDocument();
  });

  it("cada intención usa un requestId nuevo; después del retorno automático la siguiente fichada genera otro", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();
    await flush(SUCCESS_RESET_MS);

    mockOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(outResult);
    await searchAndSelect();
    await openCapture(/Marcar salida/i);
    await confirm();

    const [first, second] = sentRequestIds();
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("respuesta perdida → 'verificando' → intento 404, 404 → reenvía el MISMO POST → éxito, sin requestId nuevo", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(inResult);
    vi.mocked(timeClockApiService.attemptStatus).mockRejectedValueOnce(notFound()).mockRejectedValueOnce(notFound());
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    // Resultado desconocido: nunca "fichada fallida", el kiosco sigue ocupado.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(kioskActivity.isIdle()).toBe(false);

    await flush(500);
    await flush(1_000);

    expect(screen.getByText("Entrada registrada")).toBeInTheDocument();
    const ids = sentRequestIds();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(vi.mocked(timeClockApiService.attemptStatus).mock.calls.every(([requestId]) => requestId === ids[0])).toBe(true);
  });

  it("PROCESSING: sigue confirmando y termina en éxito normal (COMPLETED recuperado)", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    vi.mocked(timeClockApiService.attemptStatus)
      .mockResolvedValueOnce({ requestId: "x", status: "PROCESSING", response: null, error: null })
      .mockResolvedValueOnce({ requestId: "x", status: "COMPLETED", response: inResult, error: null });
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();
    await flush(500);
    expect(screen.queryByText("Entrada registrada")).not.toBeInTheDocument();
    await flush(1_000);

    expect(screen.getByText("Entrada registrada")).toBeInTheDocument();
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("cooldown del POST: cuenta regresiva local sin consultar al backend y, al llegar a 0, habilita sin fichar sola", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Ya registraste una fichada hace instantes.", "CLOCK_PUNCH_COOLDOWN", 409, 3));
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.getByText("Ya registraste una fichada hace unos segundos.")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("Podés volver a intentar en 3 s.");
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // no es un error grave
    const callsBefore = [timeClockApiService.status, timeClockApiService.attemptStatus, timeClockApiService.photoPunch].map((fn) => vi.mocked(fn).mock.calls.length);

    await flush(1_000);
    expect(screen.getByRole("timer")).toHaveTextContent("Podés volver a intentar en 2 s.");
    await flush(2_000);

    expect(screen.queryByText("Ya registraste una fichada hace unos segundos.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();
    const callsAfter = [timeClockApiService.status, timeClockApiService.attemptStatus, timeClockApiService.photoPunch].map((fn) => vi.mocked(fn).mock.calls.length);
    expect(callsAfter).toEqual(callsBefore);
  });

  it("cooldown recuperado por la verificación (respuesta perdida) usa la misma UX y el retryAfterSeconds guardado", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new NetworkError());
    vi.mocked(timeClockApiService.attemptStatus).mockResolvedValueOnce({
      requestId: "x", status: "FAILED", response: null,
      error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes.", httpStatus: 409, retryAfterSeconds: 42 },
    });
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();
    await flush(500);

    expect(screen.getByText("Ya registraste una fichada hace unos segundos.")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("Podés volver a intentar en 42 s.");
  });

  // F8.1: un cooldown SIN retryAfterSeconds (intento anterior a F7.1, backend
  // desactualizado o respuesta incompleta) no habilita de inmediato: espera
  // local de FALLBACK_COOLDOWN_SECONDS con la misma UX y sin requests.
  const allBackendCalls = () => Object.values(timeClockApiService).map((fn) => vi.mocked(fn).mock.calls.length);

  it("cooldown del POST sin retryAfterSeconds: fallback local, botones deshabilitados, sin requests y al terminar habilita según el legajo", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Ya registraste una fichada hace instantes.", "CLOCK_PUNCH_COOLDOWN", 409));
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.getByText("Ya registraste una fichada hace unos segundos.")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent(`Podés volver a intentar en ${FALLBACK_COOLDOWN_SECONDS} s.`);
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/CLOCK_|retryAfterSeconds/);
    const callsBefore = allBackendCalls();

    await flush((FALLBACK_COOLDOWN_SECONDS - 1) * 1_000);
    expect(screen.getByRole("timer")).toHaveTextContent("Podés volver a intentar en 1 s.");
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeDisabled();
    await flush(1_000);

    expect(screen.queryByText("Ya registraste una fichada hace unos segundos.")).not.toBeInTheDocument();
    // Según el estado real del legajo (sin ingreso abierto): ingreso sí, salida no.
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeDisabled();
    // El empleado sigue elegido; nada se fichó solo ni se consultó.
    expect(screen.getByText("Legajo 100 · DNI terminado en 456")).toBeInTheDocument();
    expect(allBackendCalls()).toEqual(callsBefore);
  });

  it("cooldown recuperado de un intento guardado sin retryAfterSeconds (anterior a F7.1): mismo fallback, también para la salida", async () => {
    mockOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new NetworkError());
    vi.mocked(timeClockApiService.attemptStatus).mockResolvedValueOnce({
      requestId: "x", status: "FAILED", response: null,
      error: { code: "CLOCK_PUNCH_COOLDOWN", message: "Ya registraste una fichada hace instantes.", httpStatus: 409 },
    });
    await selectWithFakeTimers();
    await openCapture(/Marcar salida/i);
    await confirm();
    await flush(500);

    expect(screen.getByRole("timer")).toHaveTextContent(`Podés volver a intentar en ${FALLBACK_COOLDOWN_SECONDS} s.`);
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeDisabled();
    const callsBefore = allBackendCalls();

    await flush(FALLBACK_COOLDOWN_SECONDS * 1_000);

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeEnabled();
    expect(allBackendCalls()).toEqual(callsBefore);
  });

  it("retryAfterSeconds = 0 es un valor válido del backend: NO aplica el fallback, no bloquea y no ficha sola", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Ya registraste una fichada hace instantes.", "CLOCK_PUNCH_COOLDOWN", 409, 0));
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("sin conexión antes de empezar: no abre la cámara ni sale ningún request", async () => {
    mockNoOpenShift();
    await selectWithFakeTimers();
    onLine.mockReturnValue(false);

    fireEvent.click(screen.getByRole("button", { name: /Marcar ingreso/i }));
    await flush();

    expect(screen.getByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();
    expect(timeClockApiService.photoPunch).not.toHaveBeenCalled();
  });

  it("se cae la red con la cámara abierta: al confirmar descarta el intento sin enviar nada", async () => {
    mockNoOpenShift();
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    onLine.mockReturnValue(false);
    await confirm();

    expect(screen.getByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();
    expect(timeClockApiService.photoPunch).not.toHaveBeenCalled();
  });

  it("resultado imposible de confirmar: mensaje claro, refresca el estado del legajo y libera el kiosco con un requestId nuevo", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new NetworkError());
    vi.mocked(timeClockApiService.attemptStatus).mockRejectedValue(new NetworkError());
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();
    await flush(45_000);

    expect(screen.getByRole("alert")).toHaveTextContent(UNCONFIRMED_MESSAGE);
    expect(timeClockApiService.status).toHaveBeenCalledTimes(2); // selección + refresco
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();

    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await openCapture(/Marcar ingreso/i);
    await confirm();
    const ids = sentRequestIds();
    expect(ids[ids.length - 1]).not.toBe(ids[0]);
  });

  it("CLOCK_IDEMPOTENCY_KEY_REUSED: abandona el intento con un mensaje humano y no reintenta con otro requestId", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("No pudimos recuperar esta fichada. Volvé a iniciar el proceso.", "CLOCK_IDEMPOTENCY_KEY_REUSED", 409));
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos recuperar esta fichada. Volvé a iniciar el proceso.");
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Marcar ingreso/i })).toBeEnabled();
  });

  it("error de negocio que cambia la jornada: muestra el mensaje del backend y refresca el estado real", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Ya existe un ingreso abierto para este empleado.", "CLOCK_ALREADY_OPEN", 409));
    await selectWithFakeTimers();
    mockOpenShift();
    await openCapture(/Marcar ingreso/i);
    await confirm();
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("Ya existe un ingreso abierto para este empleado.");
    expect(screen.getByText("Ingreso abierto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Marcar salida/i })).toBeEnabled();
  });

  it("revocación durante el envío: no lo muestra como error de fichada (el Gate bloquea el fichador)", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(new ApiError("Este dispositivo fue deshabilitado por RRHH.", "CLOCK_DEVICE_REVOKED", 403));
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(timeClockApiService.attemptStatus).not.toHaveBeenCalled();
  });

  it("doble tap en 'Marcar ingreso' → una sola intención, un solo requestId y un solo POST", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await selectWithFakeTimers();
    const button = screen.getByRole("button", { name: /Marcar ingreso/i });
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(screen.getAllByTestId("face-capture-modal")).toHaveLength(1);

    await confirm();
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("el payload enviado no lleva source, deviceId ni hora del cliente", async () => {
    mockNoOpenShift();
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await selectWithFakeTimers();
    await openCapture(/Marcar ingreso/i);
    await confirm();

    const sent = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["device", "employeeId", "faceDetectionScore", "faceValidationStatus", "photo", "punchType", "requestId", "thumbnail"]);
  });
});

// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29): jerarquía de las
// acciones según el estado del legajo, ícono de actualizar y cámara pausada.
describe("TimeClockPage — F10: acción principal, actualizar estado y cámara pausada", () => {
  const ingreso = () => screen.getByRole("button", { name: /Marcar (nuevo )?ingreso/i });
  const salida = () => screen.getByRole("button", { name: /Marcar salida/i });

  it("sin ingreso abierto: el ingreso es la acción principal", async () => {
    mockNoOpenShift();
    await selectEmployee();
    expect(ingreso()).toHaveClass("primary");
    expect(salida()).not.toHaveClass("primary");
    expect(salida()).toBeDisabled();
  });

  it("con un ingreso abierto: la salida pasa a ser la principal y el ingreso queda deshabilitado y secundario", async () => {
    mockOpenShift();
    await selectEmployee();
    expect(salida()).toHaveClass("primary");
    expect(salida()).toBeEnabled();
    expect(ingreso()).not.toHaveClass("primary");
    expect(ingreso()).toBeDisabled();
  });

  it("con la jornada vencida (olvido de salida): 'Marcar nuevo ingreso' es la principal y la salida vieja no", async () => {
    vi.mocked(timeClockApiService.status).mockResolvedValue({ employee: employeeMatch, openShift: { id: "shift-old", startAt: isoHoursAgo(21) } });
    await selectEmployee();
    expect(ingreso()).toHaveTextContent("Marcar nuevo ingreso");
    expect(ingreso()).toHaveClass("primary");
    expect(ingreso()).toBeEnabled();
    expect(salida()).not.toHaveClass("primary");
    expect(salida()).toBeDisabled();
  });

  it("'Actualizar estado' usa el ícono de actualizar (no una lupa) y conserva su nombre accesible", async () => {
    mockNoOpenShift();
    await selectEmployee();
    const refresh = screen.getByRole("button", { name: "Actualizar estado" });
    expect(refresh).toHaveAttribute("title", "Actualizar estado");
    expect(refresh.querySelector("svg")).toHaveClass("lucide-refresh-cw");
    expect(refresh.querySelector(".lucide-search")).toBeNull();
  });

  it("si la cámara se pausa (segundo plano) se descarta la intención, se avisa sin error y la próxima captura usa otro requestId", async () => {
    const user = userEvent.setup();
    mockNoOpenShift();
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() as `${string}-${string}-${string}-${string}-${string}`);
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue({ employee: employeeMatch, workShift: { id: "shift-1", startAt: nowIso() } });
    await selectEmployee();

    await user.click(ingreso());
    await user.click(await screen.findByRole("button", { name: "Interrumpir captura" }));

    expect(screen.queryByTestId("face-capture-modal")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("La cámara se pausó. Volvé a iniciar la captura.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(timeClockApiService.photoPunch).not.toHaveBeenCalled();

    await user.click(ingreso());
    expect(screen.queryByText("La cámara se pausó. Volvé a iniciar la captura.")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Confirmar captura" }));
    await waitFor(() => expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].requestId).toBe("22222222-2222-4222-8222-222222222222");
    uuid.mockRestore();
  });
});
