import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, X } from "lucide-react";
import { FaceDetector, FilesetResolver, type Detection } from "@mediapipe/tasks-vision";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

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

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

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

function captureCompressedPhoto(video: HTMLVideoElement, maxWidth = 800, quality = 0.82) {
  const ratio = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo capturar la imagen.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function FaceDetectionStatus({ state }: { state: FaceState }) {
  const valid = state.valid;
  const Icon = state.status === "LOADING" ? Loader2 : valid ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`face-status ${valid ? "valid" : "invalid"}`}>
      <Icon size={18} className={state.status === "LOADING" ? "spin-icon" : ""} />
      <span>{state.message}</span>
    </div>
  );
}

export function FaceCaptureModal({ punchType, onCancel, onConfirm, submitting = false, submissionStage = "registering" }: { punchType: "IN" | "OUT"; onCancel: () => void; onConfirm: (result: FaceCaptureResult) => void; submitting?: boolean; submissionStage?: "registering" | "slow" | "checking" }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const frameRef = useRef<number>();
  const submitGuardRef = useRef(false);
  const [state, setState] = useState<FaceState>({ status: "LOADING", message: "Buscando rostro...", valid: false });
  const [cameraLabel, setCameraLabel] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setState({ status: "CAMERA_ERROR", message: "Cámara no disponible en este dispositivo.", valid: false });
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraLabel(stream.getVideoTracks()[0]?.label || undefined);

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        detectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.55,
        });

        const detect = () => {
          const currentVideo = videoRef.current;
          const detector = detectorRef.current;
          if (!currentVideo || !detector || currentVideo.readyState < 2) {
            frameRef.current = window.requestAnimationFrame(detect);
            return;
          }

          const brightness = averageBrightness(currentVideo);
          if (brightness < 42) {
            setState({ status: "LOW_LIGHT", message: "La imagen está muy oscura. Buscá mejor iluminación.", valid: false });
          } else {
            const detections = detector.detectForVideo(currentVideo, performance.now()).detections;
            setState(statusForDetection(detections, currentVideo));
          }
          frameRef.current = window.setTimeout(detect, 220) as unknown as number;
        };
        detect();
      } catch {
        setState({ status: "CAMERA_ERROR", message: "Permití el acceso a la cámara para registrar la fichada.", valid: false });
      }
    }

    start();
    return () => {
      cancelled = true;
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        window.clearTimeout(frameRef.current);
      }
      detectorRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const confirm = useCallback(() => {
    if (submitting || submitGuardRef.current) return;
    const video = videoRef.current;
    if (!video || !state.valid) return;
    if (averageBrightness(video) < 42) {
      setState({ status: "LOW_LIGHT", message: "La imagen está muy oscura. Buscá mejor iluminación.", valid: false });
      return;
    }

    submitGuardRef.current = true;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
    onConfirm({
      photo: captureCompressedPhoto(video, 800, 0.82),
      thumbnail: captureCompressedPhoto(video, 180, 0.74),
      faceValidationStatus: "VALID",
      faceDetectionScore: state.score,
      device: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        cameraLabel,
      },
    });
  }, [cameraLabel, onConfirm, state.score, state.valid, submitting]);

  useEffect(() => {
    if (!submitting) submitGuardRef.current = false;
  }, [submitting]);

  return (
    <Modal title="Confirmar fichada con foto" close={onCancel} closeDisabled={submitting}>
      <div className="face-capture">
        <p className="face-subtitle">Ubicá tu rostro dentro del recuadro para registrar la {punchType === "IN" ? "entrada" : "salida"}.</p>
        <div className="face-video-shell">
          <video ref={videoRef} className="face-video" muted playsInline />
          <div className="face-guide" aria-hidden="true" />
        </div>
        <FaceDetectionStatus state={state} />
        {submitting ? (
          <div className="face-status valid" role="status" aria-live="polite">
            <Loader2 size={18} className="spin-icon" />
            <span>
              <b>{submissionStage === "checking" ? "Verificando la fichada..." : "Registrando fichada..."}</b><br />
              Guardando evidencia fotográfica...<br />
              No cierres esta pantalla.
              {submissionStage === "slow" ? <><br />Esto puede demorar unos segundos porque estamos guardando la evidencia.</> : null}
            </span>
          </div>
        ) : null}
        <div className="form-actions">
          <Button variant="ghost" icon={X} onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button variant="primary" icon={Camera} disabled={!state.valid} loading={submitting} onClick={confirm}>
            {submitting ? "Registrando fichada..." : punchType === "IN" ? "Confirmar ingreso" : "Confirmar salida"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
