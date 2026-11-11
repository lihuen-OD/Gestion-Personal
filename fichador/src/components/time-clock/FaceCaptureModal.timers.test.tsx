import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { FaceCaptureModal } from "./FaceCaptureModal";

/**
 * Etapa 6B-5 (AUDITORIA_6A R6-01): el ciclo de detección usa
 * requestAnimationFrame mientras el video no está listo y setTimeout después.
 * Cada handle se cancela sólo con su API: nunca se cancela un temporizador
 * ajeno que comparta el número. Cámara, video y detector simulados.
 */
vi.mock("@mediapipe/tasks-vision", () => ({ FilesetResolver: { forVisionTasks: vi.fn() }, FaceDetector: { createFromOptions: vi.fn() } }));

const originalMediaDevices = navigator.mediaDevices;
let stops: Array<ReturnType<typeof vi.fn>>;
let detectorClose: ReturnType<typeof vi.fn>;
let readyState = 4;
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId = 1;

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function stubCamera() {
  stops = [];
  const getUserMedia = vi.fn(async () => { const stop = vi.fn(); stops.push(stop); return { getTracks: () => [{ stop }], getVideoTracks: () => [{ label: "Cámara simulada" }] }; });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockImplementation(() => readyState);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(80 * 60 * 4).fill(200) }) } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/jpeg;base64,${"A".repeat(10_000)}`);
  detectorClose = vi.fn();
  vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue({} as never);
  vi.mocked(FaceDetector.createFromOptions).mockResolvedValue({
    detectForVideo: () => ({ detections: [{ boundingBox: { originX: 440, originY: 160, width: 400, height: 400 }, categories: [{ score: 0.93 }] }] }),
    close: detectorClose,
  } as never);
}

/** requestAnimationFrame controlado: ids propios (pueden coincidir con los de setTimeout) y frames a mano. */
function controlRaf(firstId: number) {
  rafCallbacks = new Map();
  nextRafId = firstId;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { const id = nextRafId++; rafCallbacks.set(id, callback); return id; });
  // En el navegador los ids son números; los temporizadores simulados de Vitest son objetos que valen su número.
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { rafCallbacks.delete(Number(id)); });
  return { request, cancel };
}
const runFrame = () => act(() => { const entries = [...rafCallbacks.entries()]; rafCallbacks.clear(); entries.forEach(([, callback]) => callback(performance.now())); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  readyState = 4;
  stubCamera();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", { value: originalMediaDevices, configurable: true });
});

describe("R6-01 — cada handle del ciclo de detección se cancela con su propia API", () => {
  it("video listo (ciclo con setTimeout): al cerrar no se llama a cancelAnimationFrame y el ciclo queda detenido", async () => {
    const { cancel } = controlRaf(1);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const view = render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    await flush(500);
    expect(screen.getByText("Rostro detectado. Ya podés confirmar la fichada.")).toBeInTheDocument();
    const before = vi.getTimerCount();
    view.unmount();
    expect(cancel).not.toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeLessThan(before);
    expect(vi.getTimerCount()).toBe(0);
    expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    expect(detectorClose).toHaveBeenCalled();
  });

  it("video sin datos todavía (ciclo con requestAnimationFrame): al cerrar no se llama a clearTimeout con el id del frame", async () => {
    readyState = 1;
    const { cancel } = controlRaf(1);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const view = render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    await flush(0);
    await runFrame();
    const pendingFrames = [...rafCallbacks.keys()];
    expect(pendingFrames.length).toBe(1);
    clearTimeoutSpy.mockClear();
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(pendingFrames[0]);
    expect(clearTimeoutSpy.mock.calls.map(([id]) => id)).not.toContain(pendingFrames[0]);
    expect(rafCallbacks.size).toBe(0);
  });

  it("un temporizador ajeno con el mismo número que el frame pendiente NO se cancela al cerrar la cámara", async () => {
    readyState = 1;
    // Un temporizador de otra parte del fichador (p. ej. el de inactividad o el reloj).
    const victim = vi.fn();
    const victimId = Number(window.setTimeout(victim, 5_000));
    controlRaf(victimId); // el próximo frame recibe el mismo número
    const view = render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    await flush(0);
    expect([...rafCallbacks.keys()]).toContain(victimId);
    view.unmount();
    await flush(5_000);
    expect(victim).toHaveBeenCalledTimes(1);
  });

  it("un frame ajeno con el mismo número que el setTimeout pendiente NO se cancela al cerrar la cámara", async () => {
    const { cancel } = controlRaf(1);
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const view = render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    await flush(500);
    const detectTimers = setTimeoutSpy.mock.results.filter((_r, index) => setTimeoutSpy.mock.calls[index]![1] === 220).map((r) => Number(r.value));
    const pendingTimer = detectTimers[detectTimers.length - 1]!;
    // Otra animación registrada con ese mismo número.
    const foreignFrame = vi.fn();
    rafCallbacks.set(pendingTimer, foreignFrame);
    view.unmount();
    expect(cancel.mock.calls.some(([id]) => Number(id) === pendingTimer)).toBe(false);
    await runFrame();
    expect(foreignFrame).toHaveBeenCalledTimes(1);
  });

  it("confirmar la foto, pasar a segundo plano y el doble montaje de StrictMode dejan el ciclo detenido sin handles cruzados", async () => {
    const { cancel } = controlRaf(1);
    const onConfirm = vi.fn();
    render(<StrictMode><FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={onConfirm} /></StrictMode>);
    await flush(500);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
  });

  it("segundo plano con el video sin datos: cancela el frame con cancelAnimationFrame y no deja ciclo", async () => {
    readyState = 1;
    const { cancel } = controlRaf(1);
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} onInterrupted={vi.fn()} />);
    await flush(0);
    const frame = [...rafCallbacks.keys()][0]!;
    clearTimeoutSpy.mockClear();
    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(cancel).toHaveBeenCalledWith(frame);
    expect(clearTimeoutSpy.mock.calls.map(([id]) => id)).not.toContain(frame);
    expect(rafCallbacks.size).toBe(0);
  });
});
