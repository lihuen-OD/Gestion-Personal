import { defineConfig, devices } from "@playwright/test";

/**
 * Fichador standalone — E2E sin backend ni datos reales: el API apunta a un
 * host inexistente y cada spec responde con page.route. Chromium usa una
 * cámara falsa (sin permiso que conceder y sin rostro real).
 *
 * Dos servidores Vite propios (no chocan con el admin 5174 ni con el
 * fichador de desarrollo 5175):
 * - 5185, detector de rostros REAL (MediaPipe self-hosted): kioskJourney.spec.ts
 *   comprueba que con la cámara falsa informa "No se detectó una cara".
 * - 5186, detector FALSO (F8, FICHADOR_E2E_FAKE_FACE=1 → alias en
 *   vite.config.ts): punchFlow.spec.ts recorre la fichada completa (captura,
 *   envío, recuperación, cooldown, éxito) con cámara y flujo reales.
 */
const API_URL = "http://127.0.0.1:59999/api";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: [
    {
      command: "npx vite --port 5185 --strictPort",
      url: "http://localhost:5185",
      reuseExistingServer: false,
      env: { VITE_API_URL: API_URL },
    },
    {
      command: "npx vite --port 5186 --strictPort",
      url: "http://localhost:5186",
      reuseExistingServer: false,
      env: { VITE_API_URL: API_URL, FICHADOR_E2E_FAKE_FACE: "1" },
    },
  ],
  projects: [
    { name: "chromium", testMatch: "kioskJourney.spec.ts", use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5185" } },
    { name: "chromium-fake-face", testMatch: "punchFlow.spec.ts", use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5186" } },
  ],
});
