import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { mediapipeWasmAssets } from "./scripts/mediapipe-assets.mjs";
import { pwaOptions } from "./scripts/pwa-config.mjs";

// Fichador standalone. Puerto fijo 5175: el admin usa 5174 y el backend
// 4002 (docs/LOCAL_DEVELOPMENT.md). strictPort evita que Vite salte a otro
// puerto en silencio y quede fuera del CORS del backend.
// F3: PWA (manifest + service worker, scripts/pwa-config.mjs) y MediaPipe
// self-hosted (scripts/mediapipe-assets.mjs).
export default defineConfig({
  plugins: [react(), mediapipeWasmAssets(), VitePWA(pwaOptions)],
  server: { port: 5175, strictPort: true },
  preview: { port: 5175, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setupTests.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
