import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { CAPTURE_IDLE_MS, KIOSK_IDLE_MS, SUCCESS_RESET_MS, TimeClockPage } from "./TimeClockPage";
import { timeClockApiService, type ClockEmployee } from "../services/api/timeClockApiService";
import { ApiError, NetworkError } from "../services/api/apiClient";
import { kioskActivity } from "../pwa/kioskActivity";
import { ClockMaintenanceMode } from "../features/maintenance/ClockMaintenanceMode";
import { MAINTENANCE_LONG_PRESS_MS } from "../features/maintenance/maintenanceTrigger";
import { MAINTENANCE_ACCESS_IDLE_MS } from "../features/maintenance/MaintenanceAccessDialog";

/**
 * Etapa 6B-3 (AUDITORIA_6A F6-03 / P2): un kiosco abandonado vuelve solo al
 * inicio. Temporizadores simulados; la cámara es el componente real con un
 * stream y un detector simulados (sin imágenes reales).
 */
vi.mock("../services/api/timeClockApiService", () => ({
  timeClockApiService: { searchEmployees: vi.fn(), status: vi.fn(), photoPunch: vi.fn(), attemptStatus: vi.fn() },
}));
vi.mock("@mediapipe/tasks-vision", () => ({ FilesetResolver: { forVisionTasks: vi.fn() }, FaceDetector: { createFromOptions: vi.fn() } }));

const ANA: ClockEmployee = { id: "employee-1", legajo: "100", dniSuffix: "456", firstName: "Ana", lastName: "Gomez", name: "Gomez, Ana" };
const DEVICE_NOW = new Date("2026-11-11T12:00:00.000Z");
const inResult = { employee: ANA, workShift: { id: "shift-1", startAt: DEVICE_NOW.toISOString() } };
const PHOTO = `data:image/jpeg;base64,${"A".repeat(10_000)}`;
const originalMediaDevices = navigator.mediaDevices;

let visibility: DocumentVisibilityState;
let stops: Array<ReturnType<typeof vi.fn>>;
let detectorClose: ReturnType<typeof vi.fn>;

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const personShown = () => document.querySelector(".kiosk-person h2")?.textContent ?? null;
const searchInput = () => screen.queryByLabelText("Buscar por nombre o apellido") as HTMLInputElement | null;
const captureOpen = () => screen.queryByRole("dialog", { name: "Confirmar fichada con foto" }) !== null;
const touch = (element: Element = document.body) => fireEvent.pointerDown(element);

async function search(text = "Gomez") {
  fireEvent.change(searchInput()!, { target: { value: text } });
  await flush(300);
}
async function selectAna() {
  await search();
  fireEvent.click(screen.getByRole("button", { name: /Gomez, Ana/ }));
  await flush();
}
async function openCamera() {
  fireEvent.click(screen.getByRole("button", { name: "Marcar ingreso" }));
  // React puede retener unos cientos de ms el reemplazo del "Preparando cámara…" de Suspense.
  for (let index = 0; index < 10 && !captureOpen(); index += 1) await flush(100);
  expect(captureOpen()).toBe(true);
}
async function waitForValidFace() {
  for (let index = 0; index < 10 && !screen.queryByText("Rostro detectado. Ya podés confirmar la fichada."); index += 1) await flush(50);
  expect(screen.getByText("Rostro detectado. Ya podés confirmar la fichada.")).toBeInTheDocument();
}
function expectInitialScreen() {
  expect(personShown()).toBeNull();
  expect(captureOpen()).toBe(false);
  expect(searchInput()).toHaveValue("");
  expect(screen.queryByText(/Gomez|Legajo 100|DNI terminado en 456/)).not.toBeInTheDocument();
}

// La cámara se carga diferida (React.lazy); con temporizadores simulados la
// primera carga del módulo no termina. Se precarga una vez con el reloj real.
beforeAll(async () => {
  await import("../components/time-clock/FaceCaptureModal");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(DEVICE_NOW);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(timeClockApiService.searchEmployees).mockResolvedValue([ANA]);
  vi.mocked(timeClockApiService.status).mockResolvedValue({ employee: ANA, openShift: null });
  // Cámara simulada: stream con pistas espiables, video "listo" y un rostro válido.
  stops = [];
  const getUserMedia = vi.fn(async () => { const stop = vi.fn(); stops.push(stop); return { getTracks: () => [{ stop }], getVideoTracks: () => [{ label: "Cámara simulada" }] }; });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(80 * 60 * 4).fill(200) }) } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PHOTO);
  detectorClose = vi.fn();
  vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue({} as never);
  vi.mocked(FaceDetector.createFromOptions).mockResolvedValue({
    detectForVideo: () => ({ detections: [{ boundingBox: { originX: 440, originY: 160, width: 400, height: 400 }, categories: [{ score: 0.93 }] }] }),
    close: detectorClose,
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", { value: originalMediaDevices, configurable: true });
  Reflect.deleteProperty(navigator, "onLine");
});

describe("Pantalla principal abandonada", () => {
  it("1/19. con un empleado elegido y sin interacción, vuelve al inicio a los 45 s y libera el kiosco", async () => {
    render(<TimeClockPage />);
    await selectAna();
    expect(personShown()).toBe("Ana Gomez");
    expect(kioskActivity.isIdle()).toBe(false);
    await flush(KIOSK_IDLE_MS - 1_000);
    expect(personShown()).toBe("Ana Gomez");
    await flush(1_000);
    expectInitialScreen();
    expect(kioskActivity.isIdle()).toBe(true);
  });

  it("2. una interacción real antes del vencimiento reinicia el plazo", async () => {
    render(<TimeClockPage />);
    await selectAna();
    await flush(40_000);
    touch(screen.getByRole("region", { name: "Fichada" }));
    await flush(40_000);
    expect(personShown()).toBe("Ana Gomez");
    fireEvent.keyDown(document.body, { key: "Tab" });
    await flush(KIOSK_IDLE_MS - 1);
    expect(personShown()).toBe("Ana Gomez");
    await flush(1);
    expectInitialScreen();
  });

  it("3. el reloj, el movimiento del puntero y las respuestas de la API no cuentan como actividad", async () => {
    let resolveStatus: (value: Awaited<ReturnType<typeof timeClockApiService.status>>) => void = () => undefined;
    vi.mocked(timeClockApiService.status).mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    render(<TimeClockPage />);
    await selectAna();
    await flush(20_000); // el reloj se actualiza cada segundo
    fireEvent.pointerMove(document.body);
    await act(async () => { resolveStatus({ employee: ANA, openShift: null }); });
    expect(screen.getByRole("button", { name: "Marcar ingreso" })).toBeEnabled();
    await flush(KIOSK_IDLE_MS - 20_000);
    expectInitialScreen();
  });

  it("4. una búsqueda abandonada (texto y coincidencias) también se limpia", async () => {
    render(<TimeClockPage />);
    await search();
    expect(screen.getByRole("button", { name: /Gomez, Ana/ })).toBeInTheDocument();
    await flush(KIOSK_IDLE_MS);
    expectInitialScreen();
    expect(screen.queryByRole("button", { name: /Gomez, Ana/ })).not.toBeInTheDocument();
  });

  it("5/6. con la consulta de jornada pendiente, el reinicio la invalida: la respuesta tardía no restaura nada", async () => {
    let resolveStatus: (value: Awaited<ReturnType<typeof timeClockApiService.status>>) => void = () => undefined;
    vi.mocked(timeClockApiService.status).mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    render(<TimeClockPage />);
    await selectAna();
    await flush(KIOSK_IDLE_MS);
    expectInitialScreen();
    await act(async () => { resolveStatus({ employee: ANA, openShift: null }); });
    expectInitialScreen();
  });

  it("7. un error tardío de la consulta después del reinicio no muestra nada", async () => {
    let rejectStatus: (error: unknown) => void = () => undefined;
    vi.mocked(timeClockApiService.status).mockImplementation(() => new Promise((_resolve, reject) => { rejectStatus = reject; }));
    render(<TimeClockPage />);
    await selectAna();
    await flush(KIOSK_IDLE_MS);
    await act(async () => { rejectStatus(new ApiError("El servicio no está disponible en este momento.", "INTERNAL_ERROR", 503)); });
    expectInitialScreen();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("con la consulta fallida (F6-02), el reinicio también limpia la persona y el aviso", async () => {
    vi.mocked(timeClockApiService.status).mockRejectedValue(new ApiError("El servicio no está disponible en este momento.", "INTERNAL_ERROR", 503));
    render(<TimeClockPage />);
    await selectAna();
    expect(screen.getByText("No pudimos consultar tu jornada")).toBeInTheDocument();
    await flush(KIOSK_IDLE_MS);
    expectInitialScreen();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("16. si la app estuvo en segundo plano más del plazo, al volver se reinicia en el acto", async () => {
    render(<TimeClockPage />);
    await selectAna();
    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    // El sistema congeló los temporizadores: pasa el tiempo sin que disparen.
    vi.setSystemTime(new Date(DEVICE_NOW.getTime() + 5 * 60_000));
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expectInitialScreen();
  });
});

describe("Cámara abandonada", () => {
  it("8/9/20/21. sin interacción se cierra a los 60 s: apaga cámara y detector, vuelve al inicio y no envía nada", async () => {
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await waitForValidFace(); // 10. también con un rostro válido sin confirmar
    expect(stops).toHaveLength(1);
    await flush(CAPTURE_IDLE_MS - 1_000);
    expect(captureOpen()).toBe(true);
    await flush(1_000);
    expectInitialScreen();
    expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    expect(detectorClose).toHaveBeenCalled();
    expect(timeClockApiService.photoPunch).not.toHaveBeenCalled();
    expect(kioskActivity.isIdle()).toBe(true);
    // No queda nada que confirmar: la próxima intención es nueva (otro requestId).
    const uuid = vi.spyOn(crypto, "randomUUID");
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush();
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].requestId).toBe(uuid.mock.results[0]!.value);
  });

  it("11. una interacción real en la cámara reinicia su plazo", async () => {
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await flush(50_000);
    touch(screen.getByRole("dialog", { name: "Confirmar fichada con foto" }));
    await flush(50_000);
    expect(captureOpen()).toBe(true);
    await flush(10_000);
    expectInitialScreen();
  });

  it("la cámara sin permiso también se cierra por inactividad", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) }, configurable: true });
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    for (let index = 0; index < 10 && !screen.queryByText("Permití el acceso a la cámara para registrar la fichada."); index += 1) await flush(50);
    expect(screen.getByText("Permití el acceso a la cámara para registrar la fichada.")).toBeInTheDocument();
    await flush(CAPTURE_IDLE_MS);
    expectInitialScreen();
  });

  it("16. pasar a segundo plano con la cámara abierta mantiene el apagado de F10; luego vence la selección", async () => {
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    expect(captureOpen()).toBe(false);
    expect(stops[0]).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("La cámara se pausó.");
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush(KIOSK_IDLE_MS);
    expectInitialScreen();
  });
});

describe("Operaciones protegidas", () => {
  it("12. con la fichada enviándose, ningún plazo la interrumpe ni cambia de persona", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockReturnValue(new Promise(() => {}));
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush(10 * 60_000);
    expect(captureOpen()).toBe(true);
    expect(screen.getByText(/Registrando fichada…|Estamos verificando/)).toBeInTheDocument();
    expect(personShown()).toBe("Ana Gomez");
    expect(vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].employeeId).toBe(ANA.id);
  });

  it("13. un resultado incierto sigue su verificación (mismo requestId) y termina en el resultado del servidor", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValueOnce(new NetworkError());
    vi.mocked(timeClockApiService.attemptStatus)
      .mockResolvedValueOnce({ requestId: "x", status: "PROCESSING", response: null, error: null })
      .mockResolvedValueOnce({ requestId: "x", status: "PROCESSING", response: null, error: null })
      .mockResolvedValue({ requestId: "x", status: "COMPLETED", response: inResult, error: null });
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush(CAPTURE_IDLE_MS + KIOSK_IDLE_MS);
    expect(screen.getByRole("heading", { name: "Entrada registrada" })).toBeInTheDocument();
    const requestId = vi.mocked(timeClockApiService.photoPunch).mock.calls[0]![0].requestId;
    expect(vi.mocked(timeClockApiService.attemptStatus).mock.calls.every(([id]) => id === requestId)).toBe(true);
    expect(timeClockApiService.photoPunch).toHaveBeenCalledTimes(1);
  });

  it("14. el éxito conserva su confirmación y su vuelta al inicio habitual", async () => {
    vi.mocked(timeClockApiService.photoPunch).mockResolvedValue(inResult);
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Entrada registrada" })).toBeInTheDocument();
    await flush(SUCCESS_RESET_MS - 100);
    expect(screen.getByRole("heading", { name: "Entrada registrada" })).toBeInTheDocument();
    await flush(100);
    expectInitialScreen();
  });

  it("15. el reinicio no saltea el cooldown: el backend lo vuelve a aplicar y no se registra nada", async () => {
    const cooldown = () => new ApiError("Ya registraste una fichada hace unos segundos.", "CLOCK_PUNCH_COOLDOWN", 409, 120);
    vi.mocked(timeClockApiService.photoPunch).mockRejectedValue(cooldown());
    render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush();
    expect(screen.getByText("Ya registraste una fichada hace unos segundos.")).toBeInTheDocument();
    await flush(KIOSK_IDLE_MS);
    expectInitialScreen();
    await selectAna();
    await openCamera();
    await waitForValidFace();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    await flush();
    expect(screen.getByText("Ya registraste una fichada hace unos segundos.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Entrada registrada" })).not.toBeInTheDocument();
  });

  it("17. si el Gate desmonta el fichador (revocación), no queda ningún plazo vivo ni cámara encendida", async () => {
    const view = render(<TimeClockPage />);
    await selectAna();
    await openCamera();
    view.unmount();
    await flush(10 * 60_000);
    expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    expect(timeClockApiService.photoPunch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("18. el acceso de mantenimiento conserva su propio plazo; el fichador de fondo se limpia igual", async () => {
    render(<ClockMaintenanceMode onReconfigure={async () => true}><TimeClockPage /></ClockMaintenanceMode>);
    await selectAna();
    const clock = document.querySelector(".kiosk-clock")!;
    fireEvent.pointerDown(clock, { pointerType: "mouse", button: 0, clientX: 10, clientY: 10 });
    await flush(MAINTENANCE_LONG_PRESS_MS);
    fireEvent.pointerUp(clock);
    expect(screen.getByRole("dialog", { name: "Acceso de mantenimiento" })).toBeInTheDocument();
    await flush(KIOSK_IDLE_MS);
    expect(personShown()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Acceso de mantenimiento" })).toBeInTheDocument();
    await flush(MAINTENANCE_ACCESS_IDLE_MS - KIOSK_IDLE_MS);
    expect(screen.queryByRole("dialog", { name: "Acceso de mantenimiento" })).not.toBeInTheDocument();
  });
});
