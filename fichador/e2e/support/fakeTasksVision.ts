// SÓLO PARA E2E (F8). Reemplaza a "@mediapipe/tasks-vision" vía alias de Vite
// cuando FICHADOR_E2E_FAKE_FACE=1 (servidor de E2E propio, ver
// playwright.config.ts). La cámara falsa de Chromium no tiene un rostro, así
// que sin esto ningún E2E podría confirmar una fichada. Todo lo demás es real:
// cámara (getUserMedia), brillo, captura y compresión de la foto, modal y
// flujo de envío. Nunca entra al build de producción: el alias sólo existe
// con esa variable y check-bundle-isolation.mjs falla si ve esta marca.
export const E2E_FAKE_FACE_DETECTOR_MARKER = "E2E_FAKE_FACE_DETECTOR";

type Box = { originX: number; originY: number; width: number; height: number };
export type Detection = { boundingBox?: Box; categories?: Array<{ score: number }> };

export const FilesetResolver = {
  async forVisionTasks(_wasmPath: string) {
    return { marker: E2E_FAKE_FACE_DETECTOR_MARKER };
  },
};

export class FaceDetector {
  static async createFromOptions(_vision: unknown, _options: unknown) {
    return new FaceDetector();
  }

  /** Un único rostro centrado y del tamaño esperado por el recuadro guía. */
  detectForVideo(video: HTMLVideoElement, _timestamp: number): { detections: Detection[] } {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    return { detections: [{ boundingBox: { originX: width * 0.3, originY: height * 0.2, width: width * 0.4, height: height * 0.55 }, categories: [{ score: 0.97 }] }] };
  }

  close() {}
}
