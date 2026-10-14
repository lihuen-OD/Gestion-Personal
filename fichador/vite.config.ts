import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { mediapipeWasmAssets } from "./scripts/mediapipe-assets.mjs";
import { pwaOptions } from "./scripts/pwa-config.mjs";

// F8: sólo el servidor de E2E que lo pide (playwright.config.ts) reemplaza el
// detector de rostros por uno falso; sin la variable, el alias no existe.
const e2eFakeFace = process.env.FICHADOR_E2E_FAKE_FACE === "1";

// Fichador standalone. Puerto fijo 5175: el admin usa 5174 y el backend
// 4002 (docs/LOCAL_DEVELOPMENT.md). strictPort evita que Vite salte a otro
// puerto en silencio y quede fuera del CORS del backend.
// F3: PWA (manifest + service worker, scripts/pwa-config.mjs) y MediaPipe
// self-hosted (scripts/mediapipe-assets.mjs).
export default defineConfig({
  plugins: [react(), mediapipeWasmAssets(), VitePWA(pwaOptions)],
  resolve: {
    alias: e2eFakeFace
      ? [{ find: /^@mediapipe\/tasks-vision$/, replacement: fileURLToPath(new URL("./e2e/support/fakeTasksVision.ts", import.meta.url)) }]
      : [],
  },
  // Caché de dependencias propia para el servidor con el detector falso: con
  // la misma caché, los dos servidores de E2E se pisan la pre-optimización y
  // Vite recarga la página al abrir la cámara. El detector real se
  // pre-optimiza al arrancar (se importa recién con el modal, en lazy).
  cacheDir: e2eFakeFace ? "node_modules/.vite-e2e-fake-face" : undefined,
  optimizeDeps: e2eFakeFace ? undefined : { include: ["@mediapipe/tasks-vision"] },
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setupTests.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
