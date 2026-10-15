import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { CAMERA_MESSAGES, FaceCaptureModal, cameraErrorMessage, cameraUnavailableMessage, captureCompressedPhoto } from "./FaceCaptureModal";

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  FaceDetector: { createFromOptions: vi.fn() },
}));

const originalMediaDevices = navigator.mediaDevices;

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
}

function renderModal() {
  return render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

afterEach(() => {
  setMediaDevices(originalMediaDevices);
  vi.restoreAllMocks();
});

describe("cameraErrorMessage — causa de la falla de cámara en texto de negocio", () => {
  it.each([
    ["NotAllowedError", CAMERA_MESSAGES.denied],
    ["SecurityError", CAMERA_MESSAGES.denied],
    ["NotFoundError", CAMERA_MESSAGES.notFound],
    ["OverconstrainedError", CAMERA_MESSAGES.notFound],
    ["NotReadableError", CAMERA_MESSAGES.busy],
    ["SomethingElse", CAMERA_MESSAGES.unexpected],
  ])("%s → mensaje correspondiente", (name, message) => {
    expect(cameraErrorMessage(new DOMException("detalle técnico", name))).toBe(message);
  });

  it("sin mediaDevices: distingue contexto inseguro (sin HTTPS) de dispositivo sin cámara", () => {
    expect(cameraUnavailableMessage(false)).toBe(CAMERA_MESSAGES.insecureContext);
    expect(cameraUnavailableMessage(true)).toBe(CAMERA_MESSAGES.unavailable);
  });
});

describe("FaceCaptureModal — estados de cámara", () => {
  it("permiso denegado: lo explica y no habilita la confirmación", async () => {
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")) });
    renderModal();

    expect(await screen.findByText(CAMERA_MESSAGES.denied)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar ingreso/i })).toBeDisabled();
    expect(screen.queryByText(/Permission denied/)).not.toBeInTheDocument();
  });

  it("cámara ocupada por otra aplicación", async () => {
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(new DOMException("Could not start video source", "NotReadableError")) });
    renderModal();

    expect(await screen.findByText(CAMERA_MESSAGES.busy)).toBeInTheDocument();
  });

  it("navegador sin mediaDevices: cámara no disponible", async () => {
    setMediaDevices(undefined);
    renderModal();

    expect(await screen.findByText(/Cámara no disponible|conexión segura/)).toBeInTheDocument();
  });

  it("cámara concedida pero el detector de rostros no carga: no culpa al permiso de cámara y libera la pista", async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }], getVideoTracks: () => [{ label: "FaceTime HD" }] }),
    });
    vi.mocked(FilesetResolver.forVisionTasks).mockRejectedValue(new Error("network"));
    const { unmount } = renderModal();

    expect(await screen.findByText(CAMERA_MESSAGES.detectorUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(CAMERA_MESSAGES.denied)).not.toBeInTheDocument();
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});

// F8: con la foto enviada, el modal sólo informa la etapa del envío (nunca
// "fichada fallida" mientras el resultado es incierto) y no se puede cerrar
// ni volver a confirmar.
describe("FaceCaptureModal — etapas del envío (F8)", () => {
  it.each([
    ["sending", "Registrando fichada…"],
    ["slow", "Esto puede demorar unos segundos"],
    ["verifying", "Estamos verificando si la fichada se registró…"],
    ["confirming", "Estamos confirmando tu fichada…"],
  ] as const)("%s → %s, sin el estado del detector y con las acciones deshabilitadas", (stage, text) => {
    setMediaDevices(undefined);
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} submitting submissionStage={stage} />);

    expect(screen.getByText(new RegExp(text.replace(/[…?]/g, ".")))).toBeInTheDocument();
    expect(screen.queryByText(CAMERA_MESSAGES.unavailable)).not.toBeInTheDocument();
    expect(screen.queryByText(CAMERA_MESSAGES.insecureContext)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Procesando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();
    expect(screen.queryByText(/fallida|falló/i)).not.toBeInTheDocument();
  });
});

// F10 (docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29): ciclo de vida de la
// cámara de kiosco. Canvas, video y detector stubbeados: jsdom no los tiene.
describe("FaceCaptureModal — ciclo de vida de la cámara (F10)", () => {
  const PHOTO = `data:image/jpeg;base64,${"A".repeat(10_000)}`;
  let visibility: DocumentVisibilityState = "visible";
  let stops: Array<ReturnType<typeof vi.fn>>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let detectorClose: ReturnType<typeof vi.fn>;
  let drawImage: ReturnType<typeof vi.fn>;
  const transforms = { scale: vi.fn(), translate: vi.fn(), setTransform: vi.fn(), transform: vi.fn() };

  function fakeStream() {
    const stop = vi.fn();
    stops.push(stop);
    return { getTracks: () => [{ stop }], getVideoTracks: () => [{ label: "Cámara frontal" }] };
  }

  function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  }

  beforeEach(() => {
    visibility = "visible";
    stops = [];
    getUserMedia = vi.fn(async () => fakeStream());
    setMediaDevices({ getUserMedia });
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    // Video "listo" de 1280×720 y un canvas que dibuja y codifica.
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage, ...transforms, getImageData: () => ({ data: new Uint8ClampedArray(80 * 60 * 4).fill(200) }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PHOTO);
    // Un rostro centrado y de buen tamaño.
    detectorClose = vi.fn();
    vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue({} as never);
    vi.mocked(FaceDetector.createFromOptions).mockResolvedValue({
      detectForVideo: () => ({ detections: [{ boundingBox: { originX: 440, originY: 160, width: 400, height: 400 }, categories: [{ score: 0.93 }] }] }),
      close: detectorClose,
    } as never);
  });

  async function openValid(props: Partial<Parameters<typeof FaceCaptureModal>[0]> = {}) {
    const onConfirm = vi.fn();
    const onInterrupted = vi.fn();
    const view = render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={onConfirm} onInterrupted={onInterrupted} {...props} />);
    await screen.findByText("Rostro detectado. Ya podés confirmar la fichada.");
    return { ...view, onConfirm, onInterrupted };
  }

  it("al capturar: apaga cámara y detector, suelta el video y deja la foto congelada (no un video negro)", async () => {
    const { onConfirm, rerender, onInterrupted } = await openValid();
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(video.srcObject).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar ingreso/ }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ photo: PHOTO, faceValidationStatus: "VALID" }));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(detectorClose).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(video).toHaveClass("is-frozen");
    expect(screen.getByRole("img", { name: "Foto tomada para esta fichada" })).toHaveAttribute("src", PHOTO);

    // Durante el envío: la foto sigue, el detector no vuelve y no se pide la cámara otra vez.
    rerender(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={onConfirm} onInterrupted={onInterrupted} submitting submissionStage="verifying" />);
    expect(screen.getByRole("img", { name: "Foto tomada para esta fichada" })).toBeInTheDocument();
    expect(screen.getByText("Estamos verificando si la fichada se registró…")).toBeInTheDocument();
    expect(screen.queryByText(/Rostro detectado|No se detectó/)).not.toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    // Ya capturada, pasar a segundo plano no interrumpe nada (el envío sigue).
    setVisibility("hidden");
    expect(onInterrupted).not.toHaveBeenCalled();
  });

  it("la foto enviada va en orientación natural: se dibuja tal cual (el espejo es sólo de la vista previa)", () => {
    const video = document.createElement("video");
    expect(captureCompressedPhoto(video, 800, 0.84)).toBe(PHOTO);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 800, 450);
    for (const fn of Object.values(transforms)) expect(fn).not.toHaveBeenCalled();
  });

  it("a segundo plano antes de confirmar: apaga cámara y detector, avisa a la página y no la vuelve a abrir sola", async () => {
    const { onInterrupted, onConfirm } = await openValid();
    const video = document.querySelector("video") as HTMLVideoElement;

    setVisibility("hidden");

    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(detectorClose).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(screen.getByText("La cámara se pausó. Volvé a iniciar la captura.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar ingreso/ })).toBeDisabled();

    setVisibility("visible");
    setVisibility("hidden");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("si la cámara llega después de pasar a segundo plano, se apaga en el acto (no queda abierta)", async () => {
    let resolve!: (stream: unknown) => void;
    getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} onInterrupted={vi.fn()} />);
    setVisibility("hidden");
    await act(async () => { resolve(fakeStream()); });
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect((document.querySelector("video") as HTMLVideoElement).srcObject).toBeNull();
  });

  it("cancelar, cerrar o desmontar (p. ej. el Gate al revocarse): cámara, detector y listeners limpios", async () => {
    const { unmount, onInterrupted } = await openValid();
    unmount();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(detectorClose).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    expect(onInterrupted).not.toHaveBeenCalled();
  });

  it("cada intención es una captura nueva: otro modal pide la cámara de nuevo y no reutiliza la foto anterior", async () => {
    const first = await openValid();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ingreso/ }));
    first.unmount();

    await openValid();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("img", { name: "Foto tomada para esta fichada" })).not.toBeInTheDocument();
  });

  it("la foto no se guarda en ningún almacenamiento del navegador", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const openDb = vi.fn();
    const openCache = vi.fn();
    vi.stubGlobal("indexedDB", { open: openDb });
    vi.stubGlobal("caches", { open: openCache });
    await openValid();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar ingreso/ }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Foto tomada para esta fichada" })).toBeInTheDocument());
    expect(setItem).not.toHaveBeenCalled();
    expect(openDb).not.toHaveBeenCalled();
    expect(openCache).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("cameraErrorMessage — permiso denegado en iPad/iPhone (F10)", () => {
  it("indica habilitar la cámara desde los ajustes del equipo, sin nombres técnicos", () => {
    const message = cameraErrorMessage(new DOMException("denied", "NotAllowedError"), true);
    expect(message).toBe(CAMERA_MESSAGES.deniedIOS);
    expect(message).toContain("Ajustes del dispositivo");
    expect(message).not.toMatch(/NotAllowed|Error/);
    expect(cameraErrorMessage(new DOMException("denied", "NotAllowedError"), false)).toBe(CAMERA_MESSAGES.denied);
  });
});
