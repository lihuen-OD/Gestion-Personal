import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { buildJsonReport, buildMarkdownReport, type CapturedRequest, type JourneyRun, type ScreenResult } from "./support/reportBuilder";
import { sanitizeRequestPath } from "./support/sanitizePath";
import { JOURNEY_SCREENS, LOGIN_ROUTE } from "./support/screens";

/**
 * Etapa 14B.3 — Performance Journey.
 * Ver docs/decisions/PERFORMANCE_JOURNEY_14B3.md para el diseño completo.
 *
 * Precondición: backend y frontend ya corriendo localmente
 * (`npm run dev` en cada uno — ver docs/LOCAL_DEVELOPMENT.md). Este spec no
 * los levanta ni los apaga.
 *
 * Solo lectura por diseño: nunca envía un formulario, nunca crea/edita/borra
 * nada. Sólo navega y observa (goto + esperar + leer la primera fila de una
 * tabla cuando hace falta un ID real para el detalle de legajo).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "../../docs/performance");
const MD_REPORT_PATH = path.join(REPORT_DIR, "PERFORMANCE_JOURNEY_14B3.md");
const JSON_REPORT_PATH = path.join(REPORT_DIR, "PERFORMANCE_JOURNEY_14B3.json");

const BASE_URL = (process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174").replace(/\/$/, "");
const API_BASE_URL = (process.env.PERF_JOURNEY_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const SLOW_THRESHOLD_MS = Number(process.env.PERFORMANCE_SLOW_REQUEST_MS || 1000);
const VERY_SLOW_THRESHOLD_MS = Number(process.env.PERFORMANCE_VERY_SLOW_REQUEST_MS || 3000);
const HEADER_TIMEOUT_MS = 15_000;
const SETTLE_GRACE_MS = 250;

type TimestampedRequest = CapturedRequest & { capturedAt: number };
type TimestampedError = { message: string; capturedAt: number };

test.describe.configure({ mode: "serial" });

test("performance journey — recorrido crítico de la app (Etapa 14B.3)", async ({ page }) => {
  test.setTimeout(180_000);

  const allCaptured: TimestampedRequest[] = [];
  const allConsoleErrors: TimestampedError[] = [];

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (!url.startsWith(API_BASE_URL)) return;
    request
      .response()
      .then((response) => {
        if (!response) return;
        // OJO: `timing().startTime` es un epoch absoluto (ms desde 1970), NO
        // el punto cero de referencia — los demás campos (`responseEnd`,
        // `responseStart`, etc.) ya vienen como "ms transcurridos desde
        // startTime". La duración total del request es directamente
        // `responseEnd` (o -1 si el navegador no lo pudo resolver, ej. una
        // respuesta sin body). Restar `startTime` acá sería el bug real que
        // esta misma etapa encontró en su primera corrida (ver "riesgos" en
        // docs/decisions/PERFORMANCE_JOURNEY_14B3.md).
        const timing = request.timing();
        const durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : 0;
        allCaptured.push({
          method: request.method(),
          path: sanitizeRequestPath(url),
          statusCode: response.status(),
          durationMs,
          capturedAt: Date.now(),
        });
      })
      .catch(() => undefined);
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      allConsoleErrors.push({ message: msg.text().slice(0, 500), capturedAt: Date.now() });
    }
  });
  page.on("pageerror", (error) => {
    allConsoleErrors.push({ message: String(error).slice(0, 500), capturedAt: Date.now() });
  });

  function requestsInWindow(windowStart: number, windowEnd: number): CapturedRequest[] {
    return allCaptured
      .filter((item) => item.capturedAt >= windowStart && item.capturedAt <= windowEnd)
      .map(({ capturedAt: _capturedAt, ...rest }) => rest);
  }

  function errorsInWindow(windowStart: number, windowEnd: number): string[] {
    return allConsoleErrors.filter((item) => item.capturedAt >= windowStart && item.capturedAt <= windowEnd).map((item) => item.message);
  }

  /**
   * Navega a `route` y espera dos señales, ambas aproximadas por diseño
   * (ver Parte 2 del pedido: "tiempo aproximado de carga visual"):
   * - headerVisibleMs: cuándo el <h1> de la pantalla (todas las pantallas
   *   del proyecto tienen uno, con o sin PageHeader) queda visible — proxy de
   *   "el shell de la pantalla ya renderizó".
   * - networkIdleMs: cuándo la red quedó inactiva — proxy aproximado de "ya
   *   terminó de traer datos", no una garantía exacta (una pantalla puede
   *   seguir mostrando un loader interno de una sección puntual).
   */
  async function visitScreen(target: Page, route: string) {
    const windowStart = Date.now();
    await target.goto(route);

    let headerVisibleMs: number | undefined;
    try {
      await target.locator("h1").first().waitFor({ state: "visible", timeout: HEADER_TIMEOUT_MS });
      headerVisibleMs = Date.now() - windowStart;
    } catch {
      headerVisibleMs = undefined;
    }

    let networkIdleMs: number | undefined;
    try {
      await target.waitForLoadState("networkidle", { timeout: HEADER_TIMEOUT_MS });
      networkIdleMs = Date.now() - windowStart;
    } catch {
      networkIdleMs = undefined;
    }

    // Da margen a que los `requestfinished` en vuelo terminen de resolver
    // antes de cerrar la ventana de captura de esta pantalla.
    await target.waitForTimeout(SETTLE_GRACE_MS);
    const windowEnd = Date.now();

    return { windowStart, windowEnd, headerVisibleMs, networkIdleMs };
  }

  const screens: ScreenResult[] = [];
  const extraActions: ScreenResult[] = [];

  // 1. Login — acceso rápido demo (botón de rol), sin escribir email/password
  // a mano: mismo mecanismo que ya usan las etapas anteriores para validación
  // manual (ver docs/decisions/WORK_REGIME_ASSIGNMENT_UX_13J1.md).
  {
    const windowStart = Date.now();
    await page.goto(LOGIN_ROUTE);
    await page.getByRole("button", { name: /Nivel 1 - RRHH/ }).click();

    let headerVisibleMs: number | undefined;
    try {
      await page.locator("h1").first().waitFor({ state: "visible", timeout: HEADER_TIMEOUT_MS });
      headerVisibleMs = Date.now() - windowStart;
    } catch {
      headerVisibleMs = undefined;
    }
    let networkIdleMs: number | undefined;
    try {
      await page.waitForLoadState("networkidle", { timeout: HEADER_TIMEOUT_MS });
      networkIdleMs = Date.now() - windowStart;
    } catch {
      networkIdleMs = undefined;
    }
    await page.waitForTimeout(SETTLE_GRACE_MS);
    const windowEnd = Date.now();

    const covered = headerVisibleMs !== undefined;
    screens.push({
      name: "Login",
      route: LOGIN_ROUTE,
      covered,
      reason: covered ? undefined : "no se pudo confirmar el login (no apareció ningún <h1> tras el acceso rápido)",
      headerVisibleMs,
      networkIdleMs,
      requests: requestsInWindow(windowStart, windowEnd),
      consoleErrors: errorsInWindow(windowStart, windowEnd),
    });

    // Falla rápido y explícito si el login no funcionó — sin sesión real, el
    // resto del recorrido no tiene sentido (todas las pantallas siguientes
    // exigen auth).
    expect(covered, "El login con el acceso rápido demo (Nivel 1 - RRHH) debe dejar ver el shell de la app").toBe(true);
  }

  // 2..N. Resto de las pantallas mínimas (Dashboard incluido, como una
  // navegación completa igual que las demás — ver docs/decisions/
  // PERFORMANCE_JOURNEY_14B3.md sobre por qué se mide dos veces
  // conceptualmente: una como aterrizaje del login, otra como navegación
  // limpia comparable con el resto).
  for (const screen of JOURNEY_SCREENS) {
    const { windowStart, windowEnd, headerVisibleMs, networkIdleMs } = await visitScreen(page, screen.route);
    const covered = headerVisibleMs !== undefined;
    screens.push({
      name: screen.name,
      route: screen.route,
      covered,
      reason: covered ? undefined : "no apareció ningún <h1> visible dentro del timeout — posible pantalla rota o permiso denegado",
      headerVisibleMs,
      networkIdleMs,
      requests: requestsInWindow(windowStart, windowEnd),
      consoleErrors: errorsInWindow(windowStart, windowEnd),
    });

    if (screen.name === "Legajos / Empleados") {
      // 4. Detalle de un legajo existente — primer registro real de la
      // tabla, nunca uno inventado (Parte 2, punto 9 del pedido).
      const detailLinks = page.locator('a[href^="/legajos/"]:not([href="/legajos/nuevo"])');
      const detailLinksCount = await detailLinks.count();

      if (detailLinksCount === 0) {
        screens.push({
          name: "Detalle de un legajo existente",
          route: "/legajos/:id",
          covered: false,
          reason: "el listado de Legajos no devolvió ningún registro para abrir un detalle real",
          requests: [],
          consoleErrors: [],
        });
      } else {
        const href = (await detailLinks.first().getAttribute("href")) || "/legajos/:id";
        const detailVisit = await visitScreen(page, href);
        const detailCovered = detailVisit.headerVisibleMs !== undefined;
        screens.push({
          name: "Detalle de un legajo existente",
          route: href,
          covered: detailCovered,
          reason: detailCovered ? undefined : "no apareció ningún <h1> visible dentro del timeout en el detalle de legajo",
          headerVisibleMs: detailVisit.headerVisibleMs,
          networkIdleMs: detailVisit.networkIdleMs,
          requests: requestsInWindow(detailVisit.windowStart, detailVisit.windowEnd),
          consoleErrors: errorsInWindow(detailVisit.windowStart, detailVisit.windowEnd),
        });
      }
    }
  }

  // Acción extra (no es una de las 14 pantallas pedidas): Logout. Se agrega
  // porque el contexto de esta etapa marca `POST /api/auth/logout` como un
  // endpoint que los logs reales ya mostraron lento — vale la pena que quede
  // medido en este recorrido también.
  {
    const windowStart = Date.now();
    const logoutButton = page.getByTitle("Cerrar sesión");
    const hasLogoutButton = (await logoutButton.count()) > 0;

    if (!hasLogoutButton) {
      extraActions.push({
        name: "Logout",
        route: "(acción de sidebar, no una pantalla)",
        covered: false,
        reason: "no se encontró el botón de cerrar sesión en el sidebar",
        requests: [],
        consoleErrors: [],
      });
    } else {
      await logoutButton.click();
      let headerVisibleMs: number | undefined;
      try {
        await page.locator("h1").first().waitFor({ state: "visible", timeout: HEADER_TIMEOUT_MS });
        headerVisibleMs = Date.now() - windowStart;
      } catch {
        headerVisibleMs = undefined;
      }
      await page.waitForLoadState("networkidle", { timeout: HEADER_TIMEOUT_MS }).catch(() => undefined);
      await page.waitForTimeout(SETTLE_GRACE_MS);
      const windowEnd = Date.now();

      extraActions.push({
        name: "Logout",
        route: "(acción de sidebar, no una pantalla)",
        covered: headerVisibleMs !== undefined,
        reason: headerVisibleMs !== undefined ? undefined : "no volvió a verse un <h1> (pantalla de login) tras cerrar sesión",
        headerVisibleMs,
        requests: requestsInWindow(windowStart, windowEnd),
        consoleErrors: errorsInWindow(windowStart, windowEnd),
      });
    }
  }

  const run: JourneyRun = {
    generatedAt: new Date().toISOString(),
    environment:
      "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
    user: "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
    command: "npm run perf:journey (desde frontend/)",
    screens,
    extraActions,
    slowThresholdMs: SLOW_THRESHOLD_MS,
    verySlowThresholdMs: VERY_SLOW_THRESHOLD_MS,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdownReport(run), "utf-8");
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(buildJsonReport(run), null, 2)}\n`, "utf-8");
});
