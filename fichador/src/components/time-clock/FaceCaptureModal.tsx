import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { isIOSDevice } from "../../pwa/platform";
import { CAMERA_PAUSED_MESSAGE } from "./captureMessages";

export type FaceValidationStatus = "VALID" | "NO_FACE" | "MULTIPLE_FACES" | "LOW_LIGHT" | "FACE_TOO_SMALL" | "CAMERA_ERROR";

export type FaceCaptureResult = {
  photo: string;
  thumbnail: string;
  faceValidationStatus: FaceValidationStatus;
  faceDetectionScore?: number;
  device: {
    userAgent: string;
    platform: string;
    language: string;
    cameraLabel?: string;
  };
};

type FaceState = {
  status: FaceValidationStatus | "LOADING";
  message: string;
  valid: boolean;
  score?: number;
};

// F3: MediaPipe self-hosted (mismo origin, precacheado por el service
// worker): el detector funciona sin depender de jsDelivr ni de Google. Ver
// scripts/mediapipe-assets.mjs.
const MODEL_URL = "/mediapipe/models/blaze_face_short_range.tflite";
const WASM_URL = "/mediapipe/wasm";

// F1 (fichador standalone): el modal del admin mostraba "Permití el acceso
// a la cámara" ante cualquier falla, incluso si lo que fallaba era la carga
// del detector de rostros. Acá se distingue la causa con un texto de
// negocio; el estado sigue siendo CAMERA_ERROR (no válido), igual que antes.
export const CAMERA_MESSAGES = {
  insecureContext: "La cámara sólo funciona con una conexión segura (HTTPS). Avisá a RRHH.",
  unavailable: "Cámara no disponible en este dispositivo.",
  denied: "Permití el acceso a la cámara para registrar la fichada.",
  // F10: en iPad/iPhone un permiso denegado no se vuelve a preguntar; se
  // habilita desde los ajustes del equipo (sin inventar una ruta exacta).
  deniedIOS: "El acceso a la cámara está bloqueado. Activalo desde Ajustes del dispositivo y volvé al fichador.",
  notFound: "No se encontró una cámara en este dispositivo.",
  busy: "La cámara está siendo usada por otra aplicación. Cerrala e intentá nuevamente.",
  unexpected: "No se pudo iniciar la cámara. Intentá nuevamente.",
  detectorUnavailable: "No se pudo iniciar la validación de rostro. Revisá la conexión e intentá nuevamente.",
} as const;

export function cameraUnavailableMessage(isSecureContext: boolean) {
  return isSecureContext ? CAMERA_MESSAGES.unavailable : CAMERA_MESSAGES.insecureContext;
}

export function cameraErrorMessage(error: unknown, ios: boolean = isIOSDevice()) {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(name)) return ios ? CAMERA_MESSAGES.deniedIOS : CAMERA_MESSAGES.denied;
  if (["NotFoundError", "OverconstrainedError", "DevicesNotFoundError"].includes(name)) return CAMERA_MESSAGES.notFound;
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) return CAMERA_MESSAGES.busy;
  return CAMERA_MESSAGES.unexpected;
}

function statusForDetection(detections: Detection[], video: HTMLVideoElement): FaceState {
  if (!detections.length) {
    return { status: "NO_FACE", message: "No se detectó una cara.", valid: false };
  }
  if (detections.length > 1) {
    return { status: "MULTIPLE_FACES", message: "Se detectó más de una cara. Solo debe aparecer el empleado que ficha.", valid: false };
  }

  const detection = detections[0];
  const box = detection.boundingBox;
  if (!box) {
    return { status: "NO_FACE", message: "Ubicá tu rostro dentro del recuadro.", valid: false };
  }

  const score = detection.categories?.[0]?.score;
  const width = video.videoWidth || 1;
  const height = video.videoHeight || 1;
  const centerX = box.originX + box.width / 2;
  const centerY = box.originY + box.height / 2;
  const guide = {
    left: width * 0.24,
    right: width * 0.76,
    top: height * 0.14,
    bottom: height * 0.86,
  };

  const centered = centerX >= guide.left && centerX <= guide.right && centerY >= guide.top && centerY <= guide.bottom;
  if (!centered) {
    return { status: "NO_FACE", message: "Ubicá tu rostro dentro del recuadro.", valid: false, score };
  }

  if (box.width < width * 0.22 || box.height < height * 0.24) {
    return { status: "FACE_TOO_SMALL", message: "Acercate un poco más a la cámara.", valid: false, score };
  }

  return { status: "VALID", message: "Rostro detectado. Ya podés confirmar la fichada.", valid: true, score };
}

function averageBrightness(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 60;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 255;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }
  return total / (data.length / 4);
}

// La evidencia se dibuja tal como la entrega la cámara (sin espejar): la vista
// previa se espeja sólo por CSS para que la persona se vea "como en un espejo".
export function captureCompressedPhoto(video: HTMLVideoElement, maxWidth = 800, quality = 0.82) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth < 320 || video.videoHeight < 240) {
    throw new Error("La cámara todavía no entregó una imagen completa.");
  }
  const ratio = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo capturar la imagen.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function encodedImageBytes(dataUrl: string) {
  const payload = dataUrl.split(",", 2)[1] || "";
  return Math.floor(payload.length * 0.75);
}

export function FaceDetectionStatus({ state }: { state: FaceState }) {
  const valid = state.valid;
  const Icon = state.status === "LOADING" ? Loader2 : valid ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`face-status ${valid ? "valid" : "invalid"}`} role="status" aria-live="polite">
      <Icon size={18} className={state.status === "LOADING" ? "spin-icon" : ""} />
      <span>{state.message}</span>
    </div>
  );
}

/**
 * F8: etapa del envío mientras la cámara ya entregó la foto.
 * - sending/slow: el POST está en curso (slow = pasaron unos segundos).
 * - verifying: no hubo respuesta confiable; se consulta el intento por su
 *   requestId. Nunca se presenta como "fichada fallida".
 * - confirming: el backend todavía la está procesando (PROCESSING).
 */
export type SubmissionStage = "sending" | "slow" | "verifying" | "confirming";

const SUBMISSION_TEXT: Record<SubmissionStage, { title: string; detail: string }> = {
  sending: { title: "Registrando fichada…", detail: "Guardando evidencia fotográfica. No cierres esta pantalla." },
  slow: { title: "Registrando fichada…", detail: "Esto puede demorar unos segundos porque estamos guardando la evidencia. No cierres esta pantalla." },
  verifying: { title: "Estamos verificando si la fichada se registró…", detail: "No vuelvas a fichar: en unos segundos te confirmamos el resultado." },
  confirming: { title: "Estamos confirmando tu fichada…", detail: "El servidor todavía la está procesando. No cierres esta pantalla." },
};

/**
 * Cámara de una fichada (F1; F8 etapas del envío; F10 ciclo de vida de kiosco,
 * docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §29).
 *
 * - La cámara se abre al montar el modal (una intención de fichar) y se apaga
 *   al capturar, cancelar, cerrar o desmontar (también cuando el Gate desmonta
 *   el fichador por una revocación). Nunca queda abierta en segundo plano.
 * - Al capturar queda visible la foto congelada (sólo en memoria, mientras dure
 *   la intención): nada de video negro durante "registrando / verificando /
 *   confirmando", y no se vuelve a pedir la cámara ni a detectar rostros.
 * - Si el fichador pasa a segundo plano antes de confirmar, la cámara y el
 *   detector se apagan y se avisa a la página (`onInterrupted`): la captura
 *   queda invalidada y se empieza de nuevo. Después de confirmar, el envío
 *   sigue su curso (la foto ya se tomó).
 */
export function FaceCaptureModal({ punchType, onCancel, onConfirm, onInterrupted, submitting = false, submissionStage = "sending" }: { punchType: "IN" | "OUT"; onCancel: () => void; onConfirm: (result: FaceCaptureResult) => void; onInterrupted?: () => void; submitting?: boolean; submissionStage?: SubmissionStage }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const frameRef = useRef<number>();
  const submitGuardRef = useRef(false);
  // F8: con la foto ya capturada la cámara se apaga; la detección no sigue
  // corriendo sobre el video negro (mostraba "imagen muy oscura" durante el envío).
  const capturedRef = useRef(false);
  // F10: la cámara se apagó por pasar a segundo plano; nada la vuelve a encender.
  const interruptedRef = useRef(false);
  const onInterruptedRef = useRef(onInterrupted);
  onInterruptedRef.current = onInterrupted;
  const [state, setState] = useState<FaceState>({ status: "LOADING", message: "Buscando rostro...", valid: false });
  const [cameraLabel, setCameraLabel] = useState<string>();
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);

  // Apaga detector y cámara y suelta el video. Idempotente.
  const stopCamera = useCallback(() => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(frameRef.current);
      frameRef.current = undefined;
    }
    detectorRef.current?.close();
    detectorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    // Por corrida del efecto: StrictMode monta, desmonta y vuelve a montar.
    let cancelled = false;
    const stopped = () => cancelled || interruptedRef.current;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ status: "CAMERA_ERROR", message: cameraUnavailableMessage(window.isSecureContext), valid: false });
        return;
      }

      // Stream de ESTA corrida: distingue si falló getUserMedia o lo posterior,
      // aun después de que stopCamera() haya soltado streamRef.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (stopped()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraLabel(stream.getVideoTracks()[0]?.label || undefined);

        const video = videoRef.current;
        // Sin el elemento de video la cámara no es usable: misma salida que un play() fallido.
        if (!video) throw new Error("Sin elemento de video para la cámara.");
        video.srcObject = stream;
        await video.play();
      } catch (error) {
        // Quien detuvo esta corrida (desmontaje o segundo plano) ya apagó la
        // cámara; un stopCamera() acá podría apagar la de una corrida nueva.
        if (stopped()) return;
        // F10.1: si la cámara no llegó a un estado usable, todo stream obtenido
        // se libera ya, no al cerrar el modal.
        stopCamera();
        // Con el stream ya obtenido, la falla es de reproducción (play()), no
        // de permisos/dispositivo: no se la presenta como cámara ocupada.
        const message = stream ? CAMERA_MESSAGES.unexpected : cameraErrorMessage(error);
        setState({ status: "CAMERA_ERROR", message, valid: false });
        return;
      }

      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (stopped()) return;
        const detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.55,
        });
        if (stopped()) {
          detector.close();
          return;
        }
        detectorRef.current = detector;

        const detect = () => {
          if (capturedRef.current || stopped()) return;
          const currentVideo = videoRef.current;
          const currentDetector = detectorRef.current;
          if (!currentVideo || !currentDetector || currentVideo.readyState < 2) {
            frameRef.current = window.requestAnimationFrame(detect);
            return;
          }

          const brightness = averageBrightness(currentVideo);
          if (brightness < 42) {
            setState({ status: "LOW_LIGHT", message: "La imagen está muy oscura. Buscá mejor iluminación.", valid: false });
          } else {
            const detections = currentDetector.detectForVideo(currentVideo, performance.now()).detections;
            setState(statusForDetection(detections, currentVideo));
          }
          frameRef.current = window.setTimeout(detect, 220) as unknown as number;
        };
        detect();
      } catch {
        if (stopped()) return;
        // F10.1: sin detector no hay confirmación posible (confirm exige una
        // detección válida): la cámara no queda encendida sin propósito.
        stopCamera();
        setState({ status: "CAMERA_ERROR", message: CAMERA_MESSAGES.detectorUnavailable, valid: false });
      }
    }

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  // F10: a segundo plano antes de confirmar → cámara y detector apagados (iOS
  // puede suspender el stream sin avisar) y la captura queda invalidada. Al
  // volver nunca se reabre sola: se empieza una captura nueva.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || capturedRef.current || interruptedRef.current) return;
      interruptedRef.current = true;
      stopCamera();
      setState({ status: "CAMERA_ERROR", message: CAMERA_PAUSED_MESSAGE, valid: false });
      onInterruptedRef.current?.();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stopCamera]);

  const confirm = useCallback(() => {
    if (submitting || submitGuardRef.current || interruptedRef.current) return;
    const video = videoRef.current;
    if (!video || !state.valid) return;
    if (averageBrightness(video) < 42) {
      setState({ status: "LOW_LIGHT", message: "La imagen está muy oscura. Buscá mejor iluminación.", valid: false });
      return;
    }

    // La imagen debe copiarse mientras el stream sigue activo. Detener la pista
    // antes de drawImage puede producir un JPEG vacío o casi vacío en algunos navegadores.
    let photo: string;
    let thumbnail: string;
    try {
      photo = captureCompressedPhoto(video, 800, 0.84);
      thumbnail = captureCompressedPhoto(video, 240, 0.76);
    } catch {
      setState({ status: "CAMERA_ERROR", message: "La cámara no entregó una foto completa. Esperá un instante e intentá nuevamente.", valid: false });
      return;
    }
    if (encodedImageBytes(photo) < 5_000 || encodedImageBytes(thumbnail) < 500) {
      setState({ status: "CAMERA_ERROR", message: "La foto no se capturó correctamente. Mantené el rostro visible e intentá nuevamente.", valid: false });
      return;
    }

    submitGuardRef.current = true;
    capturedRef.current = true;
    // F10: la foto tomada queda a la vista mientras se envía (sólo en memoria;
    // se descarta con el modal).
    setFrozenFrame(photo);
    stopCamera();
    onConfirm({
      photo,
      thumbnail,
      faceValidationStatus: "VALID",
      faceDetectionScore: state.score,
      device: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        cameraLabel,
      },
    });
  }, [cameraLabel, onConfirm, state.score, state.valid, stopCamera, submitting]);

  useEffect(() => {
    if (!submitting) submitGuardRef.current = false;
  }, [submitting]);

  return (
    <Modal title="Confirmar fichada con foto" close={onCancel} closeDisabled={submitting}>
      <div className="face-capture">
        <p className="face-subtitle">Ubicá tu rostro dentro del recuadro para registrar la {punchType === "IN" ? "entrada" : "salida"}.</p>
        <div className="face-video-shell">
          <video ref={videoRef} className={frozenFrame ? "face-video is-frozen" : "face-video"} muted playsInline />
          {frozenFrame ? <img className="face-frozen" src={frozenFrame} alt="Foto tomada para esta fichada" /> : null}
          <div className="face-guide" aria-hidden="true" />
        </div>
        {submitting ? null : <FaceDetectionStatus state={state} />}
        {submitting ? (
          <div className="face-status valid" role="status" aria-live="polite">
            <Loader2 size={18} className="spin-icon" />
            <span>
              <b>{SUBMISSION_TEXT[submissionStage].title}</b><br />
              {SUBMISSION_TEXT[submissionStage].detail}
            </span>
          </div>
        ) : null}
        <div className="form-actions">
          <Button variant="ghost" icon={X} onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" icon={Camera} disabled={!state.valid} loading={submitting} onClick={confirm}>
            {submitting ? "Procesando…" : punchType === "IN" ? "Confirmar ingreso" : "Confirmar salida"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
