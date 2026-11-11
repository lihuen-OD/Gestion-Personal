import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { CAMERA_MESSAGES, FaceCaptureModal, captureTone } from "./FaceCaptureModal";
import { CAMERA_PAUSED_MESSAGE } from "./captureMessages";

// Etapa 3 del rediseño («Calma y certeza»): sólo presentación de la captura.
// El detector, la validación y el envío están cubiertos en FaceCaptureModal.test.tsx;
// acá se verifica que lo visual acompañe al estado REAL sin adelantarse.
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  FaceDetector: { createFromOptions: vi.fn() },
}));

const originalMediaDevices = navigator.mediaDevices;
const setMediaDevices = (value: unknown) => Object.defineProperty(navigator, "mediaDevices", { value, configurable: true });
const shell = () => document.querySelector(".face-video-shell") as HTMLElement;
const video = () => document.querySelector("video.face-video") as HTMLVideoElement;
const confirmButton = () => screen.getByRole("button", { name: /Confirmar (ingreso|salida)/ });

type Box = { originX: number; originY: number; width: number; height: number };
function withDetections(boxes: Box[]) {
  vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue({} as never);
  vi.mocked(FaceDetector.createFromOptions).mockResolvedValue({
    detectForVideo: () => ({ detections: boxes.map((boundingBox) => ({ boundingBox, categories: [{ score: 0.93 }] })) }),
    close: vi.fn(),
  } as never);
}
const CENTERED: Box = { originX: 440, originY: 160, width: 400, height: 400 };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(80 * 60 * 4).fill(200) }),
  } as unknown as CanvasRenderingContext2D);
  setMediaDevices({ getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ label: "Cámara" }] })) });
});

afterEach(() => {
  setMediaDevices(originalMediaDevices);
  vi.restoreAllMocks();
});

describe("FaceCaptureModal — presentación (Etapa 3)", () => {
  it("encabezado con la persona; el visor indica el tipo de fichada y la hora Argentina", () => {
    setMediaDevices({ getUserMedia: () => new Promise(() => {}) });
    // 15:30:05 UTC = 12:30 en Argentina.
    render(<FaceCaptureModal punchType="OUT" onCancel={vi.fn()} onConfirm={vi.fn()} employeeLabel="Ana Gómez · Legajo 100" now={new Date("2026-11-06T15:30:05.000Z")} />);

    expect(screen.getByRole("dialog", { name: "Confirmar fichada con foto" })).toBeInTheDocument();
    expect(screen.getByText("Ana Gómez · Legajo 100")).toBeInTheDocument();
    expect(screen.getByText("Salida")).toBeInTheDocument();
    expect(screen.getByText("12:30")).toBeInTheDocument();
    expect(confirmButton()).toHaveTextContent("Confirmar salida");
  });

  it("antes de que el video muestre imagen: 'Preparando la cámara…', sin guía de color ni confirmación", () => {
    setMediaDevices({ getUserMedia: () => new Promise(() => {}) });
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Preparando la cámara…");
    expect(shell()).toHaveAttribute("data-phase", "preparing");
    expect(shell()).toHaveAttribute("data-tone", "neutral");
    expect(confirmButton()).toBeDisabled();
  });

  it("la guía se pone verde sólo cuando el detector confirmó un rostro válido", async () => {
    withDetections([CENTERED]);
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.playing(video());

    await screen.findByText("Rostro detectado. Ya podés confirmar la fichada.");
    expect(shell()).toHaveAttribute("data-phase", "live");
    expect(shell()).toHaveAttribute("data-tone", "ok");
    expect(confirmButton()).toBeEnabled();
  });

  it("con más de una cara: guía en ámbar, aviso con texto (no sólo color) y la confirmación sigue deshabilitada", async () => {
    withDetections([CENTERED, { ...CENTERED, originX: 900 }]);
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    fireEvent.playing(video());

    expect(await screen.findByText(/más de una cara/)).toBeInTheDocument();
    expect(shell()).toHaveAttribute("data-tone", "warn");
    expect(screen.getByRole("status")).toHaveClass("tone-warn");
    expect(confirmButton()).toBeDisabled();
  });

  it("cámara denegada: el visor muestra 'La cámara no está disponible' y el aviso queda en tono de error", async () => {
    setMediaDevices({ getUserMedia: vi.fn(async () => { throw new DOMException("x", "NotAllowedError"); }) });
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(await screen.findByText(CAMERA_MESSAGES.denied)).toBeInTheDocument();
    expect(screen.getByText("La cámara no está disponible")).toBeInTheDocument();
    expect(shell()).toHaveAttribute("data-phase", "off");
    expect(screen.getByRole("status")).toHaveClass("tone-danger");
    expect(confirmButton()).toBeDisabled();
  });

  it("durante el envío: sólo la etapa real, nunca un éxito ni la guía verde", async () => {
    withDetections([CENTERED]);
    render(<FaceCaptureModal punchType="IN" onCancel={vi.fn()} onConfirm={vi.fn()} submitting submissionStage="sending" />);

    await waitFor(() => expect(shell()).toHaveAttribute("data-phase", "submitting"));
    expect(shell()).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByRole("status")).toHaveTextContent("Registrando fichada…");
    expect(screen.queryByText(/registrada|Rostro detectado/i)).not.toBeInTheDocument();
  });
});

describe("captureTone — tono de cada estado real del detector", () => {
  it.each([
    [{ status: "LOADING", message: "Buscando rostro...", valid: false }, "neutral"],
    [{ status: "VALID", message: "ok", valid: true }, "ok"],
    [{ status: "NO_FACE", message: "x", valid: false }, "warn"],
    [{ status: "MULTIPLE_FACES", message: "x", valid: false }, "warn"],
    [{ status: "FACE_TOO_SMALL", message: "x", valid: false }, "warn"],
    [{ status: "LOW_LIGHT", message: "x", valid: false }, "warn"],
    [{ status: "CAMERA_ERROR", message: CAMERA_MESSAGES.busy, valid: false }, "danger"],
    // F10: la pausa por segundo plano se avisa sin error.
    [{ status: "CAMERA_ERROR", message: CAMERA_PAUSED_MESSAGE, valid: false }, "neutral"],
  ] as const)("%o → %s", (state, tone) => {
    expect(captureTone(state)).toBe(tone);
  });
});
