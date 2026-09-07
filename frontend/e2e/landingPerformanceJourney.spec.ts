import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { buildLandingMarkdownReport, countHttpErrors, toSanitizedRequest, type LandingCapturedRequest, type LandingJourneyRun, type LandingRunResult } from "./support/landingJourney";

/**
 * Etapa 14F.1 — Journey chico y específico del aterrizaje inicial (login →
 * primer contenido en `/`). Ver docs/decisions/
 * INITIAL_APP_LANDING_PERFORMANCE_14F1.md para el diagnóstico completo y por
 * qué se creó este script aparte de `perf:journey:employees` (14D.1).
 *
 * Precondición: backend y frontend ya corriendo localmente (`npm run dev` en
 * cada uno). Este spec no los levanta ni los apaga.
 *
 * Modo lectura por diseño: nunca envía ningún formulario de escritura de
 * datos de negocio — sólo login, logout (acción real de la app, no destruye
 * datos) y navegación. No guarda ningún dato de Legajos/Carga
 * Horaria/Fichador/etc.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "../../docs/performance");
const MD_REPORT_PATH = path.join(REPORT_DIR, "LANDING_PERFORMANCE_JOURNEY_14F1.md");
const JSON_REPORT_PATH = path.join(REPORT_DIR, "LANDING_PERFORMANCE_JOURNEY_14F1.json");

const BASE_URL = (process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174").replace(/\/$/, "");
const API_BASE_URL = (process.env.PERF_JOURNEY_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const ACTION_TIMEOUT_MS = 15_000;
// Etapa 14F.1: 16s (no 30s+) — pasa el TTL de auditListCache (15s) sin pasar
// el de dashboardMetricsCache (30s), dando una corrida intermedia realmente
// distinguible de la corrida inmediata sin alargar el script a >30s (que
// contradiría el objetivo de esta herramienta: iteración rápida sobre el
// aterrizaje, no un recorrido completo). Documentado como limitación
// explícita, no como "corrida fría" — ver reporte generado, sección de la
// 3ª corrida.
const WARM_CACHE_WAIT_MS = 16_000;

test.describe.configure({ mode: "serial" });

test("landing performance journey — login → primer contenido en / (Etapa 14F.1)", async ({ page }) => {
  test.setTimeout(180_000);

  let capturedRequests: LandingCapturedRequest[] = [];
  let consoleErrors: string[] = [];
  let runStart = 0;

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (!url.startsWith(API_BASE_URL)) return;
    request
      .response()
      .then((response) => {
        if (!response) return;
        const timing = request.timing();
        const durationMs = timing.responseEnd >= 0 ? timing.responseEnd : 0;
        const endOffsetMs = Date.now() - runStart;
        capturedRequests.push(
          toSanitizedRequest({
            method: request.method(),
            rawUrl: url,
            statusCode: response.status(),
            durationMs,
            startOffsetMs: endOffsetMs - durationMs,
            endOffsetMs,
          }),
        );
      })
      .catch(() => undefined);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 300)));

  const runs: LandingRunResult[] = [];

  async function logout(): Promise<void> {
    // Etapa 14F.1: `.sidebar-user-card` sólo existe dentro de `AppShell`
    // (montado sólo con sesión activa) — esperarla explícitamente (en vez de
    // un `waitForTimeout` fijo) confirma que el login anterior realmente
    // completó antes de intentar cerrarlo.
    const card = page.locator(".sidebar-user-card");
    await card.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await card.click();
    // `AuthContext.logout()` es async (espera `authApiService.logout()`
    // antes de limpiar tokens/estado) — esperar a que la propia card
    // desaparezca confirma que el logout ya completó, no un tiempo fijo
    // adivinado.
    await card.waitFor({ state: "hidden", timeout: ACTION_TIMEOUT_MS });
  }

  async function runLanding(label: string): Promise<void> {
    capturedRequests = [];
    consoleErrors = [];
    runStart = Date.now();

    await page.goto("/");
    const quickLoginButton = page.getByRole("button", { name: /Nivel 1 - RRHH/ });
    await quickLoginButton.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await quickLoginButton.click();

    // Etapa 14F.1: el `h1` de LoginPage (headline de marketing) y el de
    // DashboardPage (saludo "Buen día, ...") son el MISMO selector genérico
    // `h1` — usarlo como señal de "visible" es ambiguo (el de LoginPage ya
    // está en el DOM antes del click). La señal real e inequívoca de que el
    // login se resolvió y el shell autenticado montó es `.app-shell`
    // (`AppShell.tsx`), que sólo existe con `user` definido — nunca antes.
    let loginVisibleMs: number | undefined;
    try {
      await page.locator(".app-shell").first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      loginVisibleMs = Date.now() - runStart;
    } catch {
      loginVisibleMs = undefined;
    }

    // Mismo margen que perf:journey:employees antes de chequear networkidle
    // (el useEffect que dispara los fetches corre después de que el elemento
    // visible ya montó) — ver comentario en employeesPerformanceJourney.spec.ts.
    await page.waitForTimeout(150);
    let loginNetworkIdleMs: number | undefined;
    try {
      await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS });
      loginNetworkIdleMs = Date.now() - runStart;
    } catch {
      loginNetworkIdleMs = undefined;
    }
    await page.waitForTimeout(250);

    runs.push({
      label,
      loginVisibleMs,
      loginNetworkIdleMs,
      requests: [...capturedRequests],
      consoleErrors: [...consoleErrors],
    });
  }

  // Corrida 1: fría — primera visita de este proceso de Playwright, sin
  // sesión previa en este `page`/contexto.
  await runLanding("fría");

  // Corrida 2: logout + login inmediato. `AuthContext.logout()` ya limpia
  // todo el cache frontend (`clearAllAppCaches("logout")`) — esta corrida
  // mide qué tan tibio queda el cache BACKEND (dashboard 30s, audit 15s)
  // cuando se re-entra sin ninguna demora, con el cache frontend
  // garantizado en cero por el logout mismo.
  await logout();
  await runLanding("tibia (logout + login inmediato — cache backend probablemente vigente)");

  // Corrida 3: logout, esperar 16s (pasa el TTL de audit, 15s; no pasa el de
  // dashboard/metrics, 30s) y volver a entrar. No es una corrida "fría" —
  // documentado explícitamente como tal en el label y en el reporte.
  await logout();
  await page.waitForTimeout(WARM_CACHE_WAIT_MS);
  await runLanding("después de 16s (cache de audit vencido, cache de dashboard probablemente aún vigente — no es una corrida fría)");

  const run: LandingJourneyRun = {
    generatedAt: new Date().toISOString(),
    environment:
      "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
    command: "npm run perf:journey:landing (desde frontend/)",
    runs,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT_PATH, JSON.stringify(run, null, 2));
  fs.writeFileSync(MD_REPORT_PATH, buildLandingMarkdownReport(run));

  expect(runs.every((r) => r.loginVisibleMs !== undefined), "las 3 corridas deben mostrar contenido visible tras el login").toBe(true);
  expect(runs.flatMap((r) => r.consoleErrors)).toEqual([]);
  expect(runs.reduce((total, r) => total + countHttpErrors(r.requests), 0), "ninguna request del aterrizaje debe responder con status >= 400").toBe(0);
});
