import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import { CAMERA_MESSAGES, FaceCaptureModal, cameraErrorMessage, cameraUnavailableMessage } from "./FaceCaptureModal";

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
