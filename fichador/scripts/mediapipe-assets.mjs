// Fichador standalone (F3, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §21).
// MediaPipe self-hosted: el detector ya no depende de jsDelivr ni de
// storage.googleapis.com, y el service worker lo puede precachear.
//
// - WASM: sale de node_modules/@mediapipe/tasks-vision/wasm (misma versión que
//   el paquete JS, sin copiar ~21 MB al repo). Este plugin lo sirve en dev y
//   lo emite en dist/mediapipe/wasm/ en el build.
// - Modelo: no viene en el paquete npm; está versionado en
//   public/mediapipe/models/ (Apache-2.0, descargado de MODEL_SOURCE_URL) y un
//   test verifica su SHA-256.
import { createReadStream, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MEDIAPIPE_WASM_PATH = "/mediapipe/wasm";
export const MEDIAPIPE_MODEL_PATH = "/mediapipe/models/blaze_face_short_range.tflite";
export const MODEL_SOURCE_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
export const MODEL_SHA256 = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";

// FilesetResolver.forVisionTasks(basePath) carga la variante SIMD si el
// navegador la soporta (iOS 16.4+, todos los navegadores actuales) y la
// "nosimd" si no. Sólo la SIMD entra al precache (decisión de F3); la otra
// queda servida para equipos viejos.
export const SIMD_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];
export const NOSIMD_FILES = ["vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];
const WASM_FILES = [...SIMD_FILES, ...NOSIMD_FILES];
const wasmDir = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");

export function mediapipeWasmAssets() {
  return {
    name: "fichador-mediapipe-wasm",
    configureServer(server) {
      server.middlewares.use(MEDIAPIPE_WASM_PATH, (req, res, next) => {
        const file = basename((req.url || "").split("?")[0]);
        if (!WASM_FILES.includes(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        createReadStream(join(wasmDir, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of WASM_FILES) {
        this.emitFile({ type: "asset", fileName: `${MEDIAPIPE_WASM_PATH.slice(1)}/${file}`, source: readFileSync(join(wasmDir, file)) });
      }
    },
  };
}
