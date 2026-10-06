import { defineConfig, devices } from "@playwright/test";

/**
 * Fichador standalone (F1) — journey mínimo sin backend ni datos reales.
 * Levanta su propio Vite en 5185 (no choca con el admin 5174 ni con el
 * fichador de desarrollo 5175) apuntando a un API inexistente: todas las
 * llamadas se responden con page.route en el spec. Chromium usa una cámara
 * falsa (sin permiso que conceder y sin rostro real).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5185",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: {
    command: "npx vite --port 5185 --strictPort",
    url: "http://localhost:5185",
    reuseExistingServer: false,
    env: { VITE_API_URL: "http://127.0.0.1:59999/api" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
