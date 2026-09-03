import { defineConfig, devices } from "@playwright/test";

/**
 * Etapa 14B.3 — configuración mínima para el performance journey.
 *
 * Precondición documentada (no automatizada acá a propósito, ver
 * docs/decisions/PERFORMANCE_JOURNEY_14B3.md "riesgos"): backend y frontend
 * ya deben estar corriendo localmente (`npm run dev` en cada uno, como ya
 * documenta docs/LOCAL_DEVELOPMENT.md). No se usa `webServer` para
 * levantarlos automáticamente — orquestar dos procesos (uno de los cuales
 * necesita DB/migraciones/seed) desde acá sería más frágil que documentar el
 * precondición y dejar que cada quien levante su propio entorno como ya hace
 * hoy.
 */
const baseURL = process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
