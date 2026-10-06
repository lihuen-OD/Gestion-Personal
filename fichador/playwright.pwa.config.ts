import { defineConfig, devices } from "@playwright/test";

/**
 * Fichador standalone (F3) — PWA contra el build real (`vite build` +
 * `vite preview`), que es donde existe el service worker. Mismo criterio que
 * playwright.config.ts: API inexistente respondido con page.route, cámara
 * falsa de Chromium, sin datos reales. Puerto propio 5195.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pwa.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5195",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: {
    command: "npm run build && npx vite preview --port 5195 --strictPort",
    url: "http://localhost:5195",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_URL: "http://127.0.0.1:59999/api", VITE_CLOCK_DEVICE_TOKEN: "e2e-fake-token" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
