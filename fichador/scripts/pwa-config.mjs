// Fichador standalone (F3, docs/decisions/FICHADOR_STANDALONE_PWA_PLAN.md §21).
// Opciones de vite-plugin-pwa en un módulo propio para poder testearlas.
import { MEDIAPIPE_MODEL_PATH, MEDIAPIPE_WASM_PATH, NOSIMD_FILES, SIMD_FILES } from "./mediapipe-assets.mjs";

export const THEME_COLOR = "#f8fafc";

export const manifest = {
  name: "Fichador | Los O'Dwyer",
  short_name: "Fichador",
  description: "Registro de entrada y salida del personal.",
  lang: "es-AR",
  start_url: "/",
  scope: "/",
  display: "standalone",
  // Sin bloquear: el layout funciona en vertical y horizontal; se decide en
  // el piloto según cómo se monte el iPad.
  orientation: "any",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const wasmDir = MEDIAPIPE_WASM_PATH.slice(1);

export const workbox = {
  // App shell + fuente + íconos + MediaPipe SIMD + modelo: con esto la app
  // abre y el detector funciona sin red. Las fichadas nunca: sin conexión el
  // fichador bloquea la operación (F1) y no hay cola offline.
  globPatterns: [
    // El manifest lo agrega vite-plugin-pwa por su cuenta.
    "**/*.{js,css,html,woff2,svg,png}",
    ...SIMD_FILES.map((file) => `${wasmDir}/${file}`),
    MEDIAPIPE_MODEL_PATH.slice(1),
  ],
  globIgnores: ["**/node_modules/**", ...NOSIMD_FILES.map((file) => `${wasmDir}/${file}`)],
  // El WASM SIMD pesa ~11 MB; el default de Workbox (2 MB) lo dejaría afuera.
  maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
  navigateFallback: "index.html",
  navigateFallbackDenylist: [/^\/mediapipe\//],
  cleanupOutdatedCaches: true,
  // Sin skipWaiting automático: la versión nueva se activa sólo cuando el
  // kiosco está ocioso (src/pwa/kioskUpdates.ts), nunca a mitad de una
  // fichada.
  skipWaiting: false,
  clientsClaim: false,
  // Único runtime cache: la variante sin SIMD, sólo si un equipo viejo la
  // pide. El API está en otro origin y no se intercepta (sin NetworkFirst ni
  // cache de respuestas de fichada).
  runtimeCaching: [
    {
      // RegExp (no función): Workbox serializa la regla dentro del SW y una
      // función no podría usar constantes de este módulo.
      urlPattern: new RegExp(`${MEDIAPIPE_WASM_PATH.replace(/\//g, "\\/")}\\/vision_wasm_nosimd_internal\\.`),
      handler: "CacheFirst",
      options: { cacheName: "mediapipe-nosimd", expiration: { maxEntries: 4 } },
    },
  ],
};

export const pwaOptions = {
  // Registro manual (src/pwa/registerServiceWorker.ts) para controlar cuándo
  // se aplica una actualización.
  injectRegister: false,
  registerType: "prompt",
  manifest,
  workbox,
  // El glob de workbox ya incluye favicon, íconos y manifest: sin esto
  // entrarían dos veces al precache.
  includeManifestIcons: false,
  // Sin service worker en `npm run dev`: evita servir código viejo desde
  // cache mientras se desarrolla. Se prueba con build + preview.
  devOptions: { enabled: false },
};
