import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  buildJsonReport,
  buildMarkdownReport,
  type ActionResult,
  type CapturedRequest,
  type WorkforceJourneyRun,
} from "./support/workforceManagementJourney";
import { sanitizeRequestPath } from "./support/sanitizePath";

/**
 * Etapa 14G.1 — Diagnóstico macro de performance del módulo Gestión horaria.
 * Ver docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md para el
 * mapa completo (Matriz 1: inventario de submódulos, Matriz 2: cobertura) y
 * docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md (generado
 * por este mismo spec) para los resultados.
 *
 * Precondición: backend y frontend ya corriendo localmente (`npm run dev` en
 * cada uno — ver docs/LOCAL_DEVELOPMENT.md). Este spec no los levanta ni los
 * apaga (mismo criterio que `employeesPerformanceJourney.spec.ts`/
 * `landingPerformanceJourney.spec.ts`).
 *
 * Modo lectura exclusivo (Parte 4 del pedido): nunca guarda carga horaria, ni
 * envía a revisión, ni aprueba/rechaza/devuelve nada, ni cierra/reabre un
 * período, ni marca notificaciones como leídas, ni ficha entrada/salida, ni
 * acepta permisos de cámara, ni sube documentos, ni genera una exportación
 * real, ni crea/edita/resuelve novedades o alertas. Cada una de esas acciones
 * queda como `skip(...)` con `isWrite: true` y su motivo documentado — ver
 * §14 del reporte generado.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "../../docs/performance");
const MD_REPORT_PATH = path.join(REPORT_DIR, "WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md");
const JSON_REPORT_PATH = path.join(REPORT_DIR, "WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json");

const BASE_URL = (process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174").replace(/\/$/, "");
const API_BASE_URL = (process.env.PERF_JOURNEY_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const OK_THRESHOLD_MS = Number(process.env.WORKFORCE_PERF_OK_MS || 1000);
const MEDIUM_THRESHOLD_MS = Number(process.env.WORKFORCE_PERF_MEDIUM_MS || 2000);
const SLOW_THRESHOLD_MS = Number(process.env.WORKFORCE_PERF_SLOW_MS || 3000);
const ACTION_TIMEOUT_MS = 15_000;
const SETTLE_GRACE_MS = 250;

// Zonas A-J del pedido — `zone` y `submodule` son el mismo valor en este
// journey (ver nota de cabecera de workforceManagementJourney.ts). Centralizado
// acá para que nunca haya un typo entre acciones de la misma zona.
const ZONE = {
  login: "Login",
  inicio: "A. Inicio",
  asistencia: "B. Asistencia",
  alertas: "C. Alertas de turnos",
  cargaHoras: "D. Carga de horas",
  cierres: "E. Cierres mensuales",
  bandeja: "F. Bandeja de revisión",
  novedades: "G. Novedades",
  notificaciones: "H. Notificaciones",
  fichador: "I. Fichador",
  exportacion: "J. Exportación",
} as const;

function shiftPeriod(period: string, deltaMonths: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + deltaMonths, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

test.describe.configure({ mode: "serial" });

test("workforce management performance journey — recorrido macro de Gestión horaria (Etapa 14G.1)", async ({ page }) => {
  // ~68 acciones sobre 10 rutas reales contra Neon staging (no una SPA con
  // datos mockeados): una corrida completa observada tarda más de 10
  // minutos sin que eso implique un bug de selectores — es justamente el
  // tipo de lentitud macro que esta etapa busca documentar.
  test.setTimeout(1_800_000);

  // `playwright.config.ts` no fija `use.actionTimeout` (compartido con
  // employeesPerformanceJourney/landingPerformanceJourney — no se toca acá
  // para no afectarlos), así que el default de Playwright para toda acción
  // (`.fill()`, `.click()`, `.selectOption()`, etc.) es "sin límite": si una
  // acción nunca queda accionable, `await perform()` dentro de `measure()`
  // se cuelga para siempre sin lanzar nada, y el try/catch de `measure()`
  // nunca se activa (sólo atrapa excepciones, no promesas que nunca
  // resuelven). Confirmado en una corrida real: el journey colgó dos veces
  // (10 min y luego 30 min) en el mismo `.fill()` de reseteo de período.
  // `setDefaultTimeout` acota esto SÓLO para el `page` de este test.
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);

  const actions: ActionResult[] = [];
  const allCaptured: (CapturedRequest & { capturedAt: number })[] = [];
  const allConsoleErrors: { message: string; capturedAt: number }[] = [];

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (!url.startsWith(API_BASE_URL)) return;
    // Capturado ACÁ, al entrar al handler — no dentro del `.then()` de más
    // abajo. El request ya terminó cuando Playwright emite "requestfinished",
    // así que este es el momento real en que debe caer dentro de la ventana
    // de medición de la acción en curso; resolver `response()` es async y
    // puede correr varios milisegundos después, desplazando el request a la
    // ventana de la PRÓXIMA acción si se usara `Date.now()` ahí adentro.
    const capturedAt = Date.now();
    request
      .response()
      .then((response) => {
        if (!response) return;
        const timing = request.timing();
        const durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : 0;
        // Sanitizado ACÁ, al capturar — nunca se guarda la URL cruda (Parte 2
        // del pedido). `buildJsonReport`/`buildMarkdownReport` vuelven a
        // sanitizar como red de seguridad (ver `sanitizeAction` en el módulo
        // de soporte), pero no dependen de que este paso lo haga bien.
        allCaptured.push({ method: request.method(), path: sanitizeRequestPath(url), statusCode: response.status(), durationMs, capturedAt });
      })
      .catch(() => undefined);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") allConsoleErrors.push({ message: msg.text().slice(0, 500), capturedAt: Date.now() });
  });
  page.on("pageerror", (error) => {
    allConsoleErrors.push({ message: String(error).slice(0, 500), capturedAt: Date.now() });
  });

  function requestsInWindow(start: number, end: number): CapturedRequest[] {
    return allCaptured.filter((item) => item.capturedAt >= start && item.capturedAt <= end).map(({ capturedAt: _c, ...rest }) => rest);
  }
  function errorsInWindow(start: number, end: number): string[] {
    return allConsoleErrors.filter((item) => item.capturedAt >= start && item.capturedAt <= end).map((item) => item.message);
  }

  type MeasureOutcome = { visibleLocator?: Locator | null; hiddenLocator?: Locator | null; emptyLocator?: Locator | null; notes?: string[]; preNetworkIdleWaitMs?: number };

  async function measure(name: string, zone: string, isWrite: boolean, perform: () => Promise<MeasureOutcome>): Promise<void> {
    const windowStart = Date.now();
    try {
      const { visibleLocator, hiddenLocator, emptyLocator, notes = [], preNetworkIdleWaitMs } = await perform();

      let visibleMs: number | undefined;
      if (visibleLocator) {
        try {
          await visibleLocator.first().waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
          visibleMs = Date.now() - windowStart;
        } catch {
          visibleMs = undefined;
        }
      } else if (hiddenLocator) {
        try {
          await hiddenLocator.first().waitFor({ state: "hidden", timeout: ACTION_TIMEOUT_MS });
          visibleMs = Date.now() - windowStart;
        } catch {
          visibleMs = undefined;
        }
      }

      // Margen antes de chequear "networkidle" — mismo criterio que 14D.1:
      // el `visibleLocator` suele resolver antes de que el efecto de React
      // que dispara el fetch llegue a ejecutarse.
      await page.waitForTimeout(Math.max(preNetworkIdleWaitMs ?? 0, 80));

      let networkIdleMs: number | undefined;
      try {
        await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS });
        networkIdleMs = Date.now() - windowStart;
      } catch {
        networkIdleMs = undefined;
      }
      await page.waitForTimeout(SETTLE_GRACE_MS);
      const windowEnd = Date.now();

      const emptyScreen = emptyLocator ? (await emptyLocator.count().catch(() => 0)) > 0 : null;

      // Ruta final, capturada DESPUÉS de `perform()` y de esperar
      // visible/hidden — varias acciones navegan (page.goto/click en un
      // link), así que la ruta correcta a reportar es la de destino, no la
      // que había al arrancar la medición.
      const finalRoute = page.url();

      actions.push({
        name,
        zone,
        submodule: zone,
        route: finalRoute,
        covered: true,
        skippedReason: null,
        visibleMs,
        networkIdleMs,
        requests: requestsInWindow(windowStart, windowEnd),
        consoleErrors: errorsInWindow(windowStart, windowEnd),
        notes,
        isWrite,
        emptyScreen,
      });
    } catch (error) {
      actions.push({
        name,
        zone,
        submodule: zone,
        route: page.url(),
        covered: false,
        skippedReason: `error durante la acción: ${String(error).slice(0, 300)}`,
        requests: requestsInWindow(windowStart, Date.now()),
        consoleErrors: errorsInWindow(windowStart, Date.now()),
        notes: [],
        isWrite,
        emptyScreen: null,
      });
    }
  }

  function skip(name: string, zone: string, reason: string, isWrite = false): void {
    actions.push({
      name,
      zone,
      submodule: zone,
      route: page.url(),
      covered: false,
      skippedReason: reason,
      requests: [],
      consoleErrors: [],
      notes: [],
      isWrite,
      emptyScreen: null,
    });
  }

  /** Abre un modal (click en `trigger`), lo mide, y lo mide de nuevo al cerrarlo con el ícono "Cerrar" del Modal compartido — nunca toca un botón de guardar. Reusado en las 4 zonas que abren modales de sólo lectura (B, D x2, G). */
  async function measureModalOpenAndCancel(openName: string, closeName: string, zone: string, trigger: Locator): Promise<void> {
    if ((await trigger.count()) === 0) {
      skip(openName, zone, "no se encontró el disparador de este modal en el estado actual del entorno");
      skip(closeName, zone, "depende de la acción anterior, salteada");
      return;
    }
    await measure(openName, zone, false, async () => {
      await trigger.first().click();
      return { visibleLocator: page.locator(".modal"), notes: ["se abrió el modal y se cerró sin guardar (modo lectura de esta etapa)"] };
    });
    if (!actions.at(-1)!.covered) {
      skip(closeName, zone, "depende de la acción anterior, que no llegó a abrir el modal");
      return;
    }
    const closeButton = page.getByRole("button", { name: "Cerrar" });
    await measure(closeName, zone, false, async () => {
      await closeButton.first().click();
      return { hiddenLocator: page.locator(".modal") };
    });
  }

  /**
   * Deja el filtro de período en el mes actual otra vez, sin medirlo como
   * acción (es sólo un reset de estado entre pasos, ya se midió "Cambiar
   * período" con el mes anterior). Corre FUERA de `measure()` a propósito —
   * pero por eso mismo necesita su propio timeout+catch: un `.fill()` sin
   * acotar puede quedar esperando accionabilidad indefinidamente (el
   * `actionTimeout` de `playwright.config.ts` no está configurado, así que
   * el default es "sin límite") y consumir el `test.setTimeout` completo.
   * Confirmado en una corrida real: el journey colgó acá mismo dos veces
   * (10 min y 30 min) exactamente en este `.fill()`, nunca por lentitud real
   * de Neon en las acciones medidas.
   */
  async function resetPeriodQuietly(): Promise<void> {
    await page.getByLabel("Período").fill(currentPeriod, { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  }

  const run: WorkforceJourneyRun = {
    generatedAt: "",
    environment:
      "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
    user: "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
    command: "npm run perf:journey:workforce (desde frontend/)",
    mode: "read-only",
    actions,
    okThresholdMs: OK_THRESHOLD_MS,
    mediumThresholdMs: MEDIUM_THRESHOLD_MS,
    slowThresholdMs: SLOW_THRESHOLD_MS,
  };

  const currentPeriod = new Date().toISOString().slice(0, 7);
  const previousPeriod = shiftPeriod(currentPeriod, -1);

  // ---------------------------------------------------------------------
  // Login — Nivel 1 (RRHH), el único nivel con acceso a los 10 submódulos
  // (Exportación es exclusivo de Nivel 1; Bandeja de revisión no existe para
  // Nivel 3). Mismo mecanismo que 14D.1/14F.1.
  // ---------------------------------------------------------------------
  await measure("Login (acceso rápido RRHH)", ZONE.login, false, async () => {
    await page.goto("/");
    await page.getByRole("button", { name: /Nivel 1 - RRHH/ }).click();
    return {
      visibleLocator: page.locator("h1").first(),
      notes: ["Nivel 1 aterriza en / (DashboardPage) — dispara GET /dashboard/metrics como efecto colateral inevitable del login, fuera del alcance de Gestión horaria (ver docs/decisions/DASHBOARD_METRICS_PERFORMANCE_14E1.md para ese endpoint)."],
    };
  });
  expect(actions.at(-1)!.covered, "El login con el acceso rápido demo debe dejar ver el shell de la app").toBe(true);

  // ---------------------------------------------------------------------
  // A. Inicio
  // ---------------------------------------------------------------------
  await measure("Entrar a Inicio (Gestión horaria)", ZONE.inicio, false, async () => {
    await page.goto("/gestion-horaria");
    return { visibleLocator: page.locator("h1").first() };
  });

  const statGrid = page.locator(".stat-grid");
  if (actions.at(-1)!.covered && (await statGrid.count())) {
    await measure("Ver KPIs/resumen de Inicio", ZONE.inicio, false, async () => ({
      visibleLocator: statGrid.first(),
      notes: ["no dispara endpoint propio — los StatLink son <Link>, se confirma ausencia de requests nuevos en la ventana de esta acción"],
    }));
  } else {
    skip("Ver KPIs/resumen de Inicio", ZONE.inicio, "el resumen de Inicio no cargó (estado de error) en el entorno actual");
  }

  // ---------------------------------------------------------------------
  // B. Asistencia
  // ---------------------------------------------------------------------
  await measure("Entrar a Asistencia (carga inicial del día)", ZONE.asistencia, false, async () => {
    await page.goto("/asistencia");
    return { visibleLocator: page.locator("h1").first() };
  });

  const attendanceDateInput = page.locator('input[type="date"]').first();
  await measure("Cambiar fecha del día", ZONE.asistencia, false, async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await attendanceDateInput.fill(yesterday);
    return { visibleLocator: page.locator(".stat-grid").first() };
  });

  const observedFirstName = await page
    .locator(".attendance-review-table tbody tr td strong")
    .first()
    .textContent()
    .catch(() => null);
  if (observedFirstName?.trim()) {
    await measure("Buscar en problemas de fichada", ZONE.asistencia, false, async () => {
      await page.getByPlaceholder("Nombre, legajo o sector").fill(observedFirstName.trim());
      return { visibleLocator: page.locator(".attendance-observed-panel").first(), notes: ["término tomado de un problema de fichada real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en problemas de fichada", ZONE.asistencia, "no hay ningún problema de fichada pendiente en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar problemas de fichada por tipo", ZONE.asistencia, false, async () => {
    await page.getByLabel("Mostrar").selectOption("SHIFT");
    return { visibleLocator: page.locator(".attendance-observed-panel").first() };
  });

  const clearAttendanceFilters = page.getByRole("button", { name: /Limpiar/ });
  if (await clearAttendanceFilters.count()) {
    await measure("Limpiar filtros de problemas de fichada", ZONE.asistencia, false, async () => {
      await clearAttendanceFilters.first().click();
      return { visibleLocator: page.locator(".attendance-observed-panel").first() };
    });
  } else {
    skip("Limpiar filtros de problemas de fichada", ZONE.asistencia, "no había ningún filtro activo para limpiar en el entorno actual");
  }

  const viewSegmentsButton = page.getByRole("button", { name: "Ver detalle de tramos" });
  await measureModalOpenAndCancel("Abrir detalle de tramos de una jornada cerrada", "Cerrar detalle de tramos", ZONE.asistencia, viewSegmentsButton);

  skip("Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada", ZONE.asistencia, "Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia.", true);
  skip("Resolver problema de fichada", ZONE.asistencia, "Prohibido por defecto — cierra un caso de revisión real.", true);

  // ---------------------------------------------------------------------
  // C. Alertas de turnos
  // ---------------------------------------------------------------------
  await measure("Entrar a Alertas de turnos", ZONE.alertas, false, async () => {
    await page.goto("/asistencia/alertas");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const firstAlertName = await page.locator("table tbody tr td b").first().textContent().catch(() => null);
  if (firstAlertName?.trim()) {
    await measure("Buscar alerta por texto", ZONE.alertas, false, async () => {
      await page.getByPlaceholder("Nombre, legajo o DNI").fill(firstAlertName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de una alerta real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
    await measure("Limpiar búsqueda de alertas", ZONE.alertas, false, async () => {
      await page.getByPlaceholder("Nombre, legajo o DNI").fill("");
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar alerta por texto", ZONE.alertas, "no hay ninguna alerta en el entorno actual para tomar un término real de búsqueda");
    skip("Limpiar búsqueda de alertas", ZONE.alertas, "depende de la acción anterior, salteada");
  }

  await measure("Filtrar alertas por tipo", ZONE.alertas, false, async () => {
    await page.getByLabel("Tipo").selectOption({ index: 1 });
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  const clearAlertFilters = page.getByRole("button", { name: "Limpiar" });
  if (await clearAlertFilters.count()) {
    await measure("Limpiar filtros de alertas", ZONE.alertas, false, async () => {
      await clearAlertFilters.first().click();
      return { visibleLocator: page.locator("table tbody tr, .empty").first() };
    });
  } else {
    skip("Limpiar filtros de alertas", ZONE.alertas, "no se encontró el botón Limpiar del panel de filtros en el entorno actual");
  }

  const groupToggle = page.locator(".shift-alert-toggle");
  if (await groupToggle.count()) {
    await measure("Expandir hallazgos asociados de un grupo", ZONE.alertas, false, async () => {
      await groupToggle.first().click();
      return { visibleLocator: page.locator(".shift-alert-group-detail").first() };
    });
  } else {
    skip("Expandir hallazgos asociados de un grupo", ZONE.alertas, "ningún grupo de alertas tiene más de 1 hallazgo asociado en el entorno actual");
  }

  skip("Resolver alerta de turno", ZONE.alertas, "Prohibido por defecto — cierra una alerta real.", true);

  // ---------------------------------------------------------------------
  // D. Carga de horas
  // ---------------------------------------------------------------------
  await measure("Entrar a Carga de horas (período actual)", ZONE.cargaHoras, false, async () => {
    await page.goto("/horas");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const hasGridRows = actions.at(-1)!.covered && (await page.locator("table.people-hours-table tbody tr").count()) > 0;

  if (hasGridRows) {
    await measure("Cambiar período (Carga de horas)", ZONE.cargaHoras, false, async () => {
      await page.getByLabel("Período").fill(previousPeriod);
      return { visibleLocator: page.locator("table.people-hours-table tbody tr, .empty").first() };
    });
    await resetPeriodQuietly();

    const firstEmployeeName = await page.locator("table.people-hours-table tbody tr td b").first().textContent().catch(() => null);
    if (firstEmployeeName?.trim()) {
      await measure("Buscar empleado (Carga de horas)", ZONE.cargaHoras, false, async () => {
        await page.getByPlaceholder("Buscar persona por legajo, DNI, CUIL, apellido o nombre").fill(firstEmployeeName.trim());
        return { visibleLocator: page.locator("table.people-hours-table tbody tr, .empty").first(), notes: ["término tomado de la primera fila real de la grilla — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
      });
      await measure("Limpiar búsqueda (Carga de horas)", ZONE.cargaHoras, false, async () => {
        await page.getByPlaceholder("Buscar persona por legajo, DNI, CUIL, apellido o nombre").fill("");
        return { visibleLocator: page.locator("table.people-hours-table tbody tr").first(), preNetworkIdleWaitMs: 400 };
      });
    } else {
      skip("Buscar empleado (Carga de horas)", ZONE.cargaHoras, "no se encontró ningún empleado en la grilla para usar como término de búsqueda real");
      skip("Limpiar búsqueda (Carga de horas)", ZONE.cargaHoras, "depende de la acción anterior, salteada");
    }

    const openDetailLink = page.getByRole("link", { name: "Cargar / Ver" }).first();
    const detailHref = (await openDetailLink.count()) ? await openDetailLink.getAttribute("href") : null;

    if (detailHref) {
      await measure("Abrir edición de horas de un empleado (navega a /horas/:id)", ZONE.cargaHoras, false, async () => {
        await page.goto(detailHref);
        return { visibleLocator: page.locator("h1").first() };
      });

      if (actions.at(-1)!.covered) {
        const workedHoursLabel = page.getByText("Horas trabajadas");
        if (await workedHoursLabel.count()) {
          await measure("Ver total real/liquidable", ZONE.cargaHoras, false, async () => ({
            visibleLocator: workedHoursLabel.first(),
            notes: ["\"Horas trabajadas\" (total real) siempre presente; \"Valor liquidable\" sólo si el empleado tiene horas especiales adicionales este período — sin request propio, ya incluido en time-grid"],
          }));
        } else {
          skip("Ver total real/liquidable", ZONE.cargaHoras, "no se encontró la card de horas trabajadas en el detalle en el entorno actual");
        }

        const hourCellButton = page.locator("table tbody tr").first().locator("button").first();
        await measureModalOpenAndCancel("Abrir edición de hora sin guardar", "Cancelar edición de hora", ZONE.cargaHoras, hourCellButton);

        const manualBreakdownButton = page.locator('button[title*="editar desglose"]').first();
        await measureModalOpenAndCancel("Abrir conceptos adicionales sin guardar", "Cancelar conceptos adicionales", ZONE.cargaHoras, manualBreakdownButton);

        await measure("Volver a Carga de horas", ZONE.cargaHoras, false, async () => {
          await page.locator(".back-link").first().click();
          return { visibleLocator: page.locator("h1").first() };
        });
      } else {
        for (const name of ["Ver total real/liquidable", "Abrir edición de hora sin guardar", "Cancelar edición de hora", "Abrir conceptos adicionales sin guardar", "Cancelar conceptos adicionales", "Volver a Carga de horas"]) {
          skip(name, ZONE.cargaHoras, "depende de la acción anterior (abrir el detalle del empleado), que falló");
        }
      }
    } else {
      for (const name of [
        "Abrir edición de horas de un empleado (navega a /horas/:id)",
        "Ver total real/liquidable",
        "Abrir edición de hora sin guardar",
        "Cancelar edición de hora",
        "Abrir conceptos adicionales sin guardar",
        "Cancelar conceptos adicionales",
        "Volver a Carga de horas",
      ]) {
        skip(name, ZONE.cargaHoras, "no se encontró ningún link \"Cargar / Ver\" en la grilla del entorno actual");
      }
    }
  } else {
    for (const name of [
      "Cambiar período (Carga de horas)",
      "Buscar empleado (Carga de horas)",
      "Limpiar búsqueda (Carga de horas)",
      "Abrir edición de horas de un empleado (navega a /horas/:id)",
      "Ver total real/liquidable",
      "Abrir edición de hora sin guardar",
      "Cancelar edición de hora",
      "Abrir conceptos adicionales sin guardar",
      "Cancelar conceptos adicionales",
      "Volver a Carga de horas",
    ]) {
      skip(name, ZONE.cargaHoras, "la grilla de Carga de horas no devolvió ningún registro en el entorno actual");
    }
  }

  skip("Guardar hora / Guardar desglose manual / Enviar a revisión", ZONE.cargaHoras, "Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación.", true);
  skip("Exportar horas", ZONE.cargaHoras, "El endpoint es GET, pero el click dispara una descarga de archivo con datos de horas — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto).");

  // ---------------------------------------------------------------------
  // E. Cierres mensuales
  // ---------------------------------------------------------------------
  await measure("Entrar a Cierres mensuales (período actual)", ZONE.cierres, false, async () => {
    await page.goto("/cierres");
    return { visibleLocator: page.locator("h1").first() };
  });

  await measure("Cambiar período (Cierres mensuales)", ZONE.cierres, false, async () => {
    await page.getByLabel("Período").fill(previousPeriod);
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  skip("Aprobar seleccionados / Enviar cierre a RH / Devolver cierre", ZONE.cierres, "Prohibido por defecto — cierra/reabre un período real de liquidación.", true);
  skip("Aprobar/Rechazar corrección", ZONE.cierres, "Prohibido por defecto.", true);

  // ---------------------------------------------------------------------
  // F. Bandeja de revisión — mismo componente que Carga de horas
  // (HoursPage pendingOnly). Los botones Aprobar/Rechazar/Devolver
  // comparten aria-label genérico entre registro/novedad/desglose — NUNCA
  // se usa un locator de rol sin scope exacto en esta zona.
  // ---------------------------------------------------------------------
  await measure("Entrar a Bandeja de revisión (Por registro)", ZONE.bandeja, false, async () => {
    await page.goto("/pendientes");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const porPersonaTab = page.getByRole("button", { name: "Por persona" });
  if (await porPersonaTab.count()) {
    await measure('Cambiar a pestaña "Por persona"', ZONE.bandeja, false, async () => {
      await porPersonaTab.click();
      return { visibleLocator: page.locator("table tbody tr, .empty").first() };
    });
  } else {
    skip('Cambiar a pestaña "Por persona"', ZONE.bandeja, "no se encontraron las pestañas Por registro/Por persona en el entorno actual");
  }

  const firstPendingName = await page.locator("table tbody tr td b").first().textContent().catch(() => null);
  if (firstPendingName?.trim()) {
    await measure("Buscar en Bandeja de revisión", ZONE.bandeja, false, async () => {
      await page.getByPlaceholder("Buscar por legajo, DNI, CUIL, apellido o nombre").fill(firstPendingName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de una fila real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Bandeja de revisión", ZONE.bandeja, "no hay ninguna fila en Bandeja de revisión en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Cambiar período (Bandeja de revisión)", ZONE.bandeja, false, async () => {
    await page.getByLabel("Período").fill(previousPeriod);
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });
  await resetPeriodQuietly();

  const pendingDetailLink = page.getByRole("link", { name: "Ver detalle" }).first();
  const pendingDetailHref = (await pendingDetailLink.count()) ? await pendingDetailLink.getAttribute("href") : null;
  if (pendingDetailHref) {
    await measure("Abrir detalle (Ver detalle, Por persona)", ZONE.bandeja, false, async () => {
      await page.goto(pendingDetailHref);
      return { visibleLocator: page.locator("h1").first() };
    });
    if (actions.at(-1)!.covered) {
      await measure("Volver a Bandeja de revisión", ZONE.bandeja, false, async () => {
        await page.locator(".back-link").first().click();
        return { visibleLocator: page.locator("h1").first() };
      });
    } else {
      skip("Volver a Bandeja de revisión", ZONE.bandeja, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Abrir detalle (Ver detalle, Por persona)", ZONE.bandeja, "no hay ninguna fila en la vista Por persona en el entorno actual, o la pestaña no está disponible");
    skip("Volver a Bandeja de revisión", ZONE.bandeja, "depende de la acción anterior, salteada");
  }

  skip("Aprobar/Rechazar/Devolver registro", ZONE.bandeja, "Prohibido por defecto.", true);
  skip("Aprobar/Rechazar novedad (desde Bandeja)", ZONE.bandeja, "Prohibido por defecto.", true);
  skip("Aprobar/Rechazar/Devolver desglose manual", ZONE.bandeja, "Prohibido por defecto.", true);

  // ---------------------------------------------------------------------
  // G. Novedades
  // ---------------------------------------------------------------------
  await measure("Entrar a Novedades", ZONE.novedades, false, async () => {
    await page.goto("/novedades");
    return { visibleLocator: page.locator("h1").first() };
  });

  const firstNoveltyName = await page.locator("table tbody tr td b").first().textContent().catch(() => null);
  if (firstNoveltyName?.trim()) {
    await measure("Buscar en Novedades", ZONE.novedades, false, async () => {
      await page.getByPlaceholder("Buscar por legajo, DNI, empleado o tipo de novedad").fill(firstNoveltyName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de una novedad real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Novedades", ZONE.novedades, "no hay ninguna novedad registrada en el entorno actual para tomar un término real de búsqueda");
  }

  await measureModalOpenAndCancel('Abrir modal "Nueva novedad" sin guardar', 'Cancelar "Nueva novedad"', ZONE.novedades, page.getByRole("button", { name: "Nueva novedad" }));

  skip("Guardar nueva novedad", ZONE.novedades, "Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real.", true);
  skip("Aprobar/Rechazar/Eliminar novedad", ZONE.novedades, "Prohibido por defecto.", true);
  skip("Aprobar pendientes visibles (bulk)", ZONE.novedades, "Prohibido por defecto.", true);

  // ---------------------------------------------------------------------
  // H. Notificaciones — NUNCA se hace click en una fila (link "Ver detalle"
  // o botón "Marcar leída"): ambos disparan markRead() como efecto
  // colateral (hallazgo documentado en la Matriz 1, fila H).
  // ---------------------------------------------------------------------
  await measure("Entrar a Notificaciones (Todas)", ZONE.notificaciones, false, async () => {
    await page.goto("/notificaciones");
    return { visibleLocator: page.locator("h1").first() };
  });

  await measure('Filtrar por "No leídas"', ZONE.notificaciones, false, async () => {
    await page.getByLabel("Estado").selectOption("NO_LEIDA");
    return { visibleLocator: page.locator(".notification-list").first() };
  });

  const loadMoreNotifications = page.getByRole("button", { name: /Cargar \d+ más/ });
  if (await loadMoreNotifications.count()) {
    await measure("Cargar más notificaciones", ZONE.notificaciones, false, async () => {
      await loadMoreNotifications.click();
      return { visibleLocator: page.locator(".notification-row").first() };
    });
  } else {
    skip("Cargar más notificaciones", ZONE.notificaciones, "no hay una segunda página de notificaciones en el entorno actual");
  }

  skip("Marcar como leída / Ver detalle", ZONE.notificaciones, "Prohibido por defecto — ambos disparan POST /workforce/notifications/:id/read (el link \"Ver detalle\" también, como efecto colateral de su onClick).", true);

  // ---------------------------------------------------------------------
  // I. Fichador — perfil de riesgo alto (kiosco sin auth de usuario,
  // cámara, rate-limit compartido con uso real). Sólo se mide la carga
  // inicial, tal como pide la Parte 6 del pedido para esta zona.
  // ---------------------------------------------------------------------
  await measure("Entrar a Fichador (carga inicial)", ZONE.fichador, false, async () => {
    await page.goto("/fichador");
    return { visibleLocator: page.locator("h1").first() };
  });

  skip("Buscar empleado en Fichador", ZONE.fichador, "Fuera del alcance mínimo pedido para Fichador (Parte 6, Zona I sólo pide \"entrar\" y \"medir carga inicial\", dado el perfil de riesgo del kiosco: sin auth de usuario, cámara, rate-limit compartido con uso real de 30/5min).");
  skip("Marcar ingreso", ZONE.fichador, "Prohibido por defecto — fichada real de un empleado real.", true);
  skip("Marcar salida", ZONE.fichador, "Prohibido por defecto.", true);
  skip("Capturar foto / enviar punch", ZONE.fichador, "Prohibido por defecto — el pedido prohíbe explícitamente aceptar permisos de cámara o ejecutar la acción.", true);

  // ---------------------------------------------------------------------
  // J. Exportación
  // ---------------------------------------------------------------------
  await measure("Entrar a Exportación (período actual)", ZONE.exportacion, false, async () => {
    await page.goto("/configuracion/liquidacion");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  await measure("Cambiar período (Exportación)", ZONE.exportacion, false, async () => {
    await page.getByLabel("Periodo").fill(previousPeriod);
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  const firstExportRow = await page.locator("table tbody tr td b").first().textContent().catch(() => null);
  if (firstExportRow?.trim()) {
    await measure("Buscar en Exportación", ZONE.exportacion, false, async () => {
      await page.getByPlaceholder("Buscar por legajo, persona, codigo o detalle").fill(firstExportRow.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["filtra en memoria sobre las filas ya cargadas — no dispara un request nuevo; término tomado de una fila real, no se registra el valor buscado"], preNetworkIdleWaitMs: 300 };
    });
  } else {
    skip("Buscar en Exportación", ZONE.exportacion, "no hay ningún registro para el período elegido en el entorno actual");
  }

  skip("Exportar Excel Finnegans", ZONE.exportacion, "No es una escritura de API (build 100% client-side), pero genera y descarga un archivo con datos de novedades reales — prohibido por defecto (Parte 4: no generar exportación sensible / no descarga por defecto).");

  // ---------------------------------------------------------------------
  // Reporte final + asserts de seguridad/cobertura.
  // ---------------------------------------------------------------------
  run.generatedAt = new Date().toISOString();

  // Se computa una sola vez y se reusa tanto para escribir el JSON como para
  // los asserts de abajo — evita recalcular la misma agregación dos veces.
  const report = buildJsonReport(run);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdownReport(run), "utf-8");
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  // Parte 4/7 del pedido: este journey es de sólo lectura por diseño — si
  // algo lo rompe (una escritura que se coló, un HTTP error real, un error
  // de consola) el test debe fallar de forma visible, no quedar como un
  // reporte "verde" silencioso.
  expect(report.summary.httpErrors, "el journey no debe registrar HTTP errors").toBe(0);
  expect(report.summary.consoleErrors, "el journey no debe registrar console errors").toBe(0);
  expect(report.summary.coveredActions, "el journey debe cubrir acciones reales").toBeGreaterThan(0);
  expect(
    report.actions.filter((action) => action.isWrite && action.covered),
    "el journey no debe ejecutar acciones de escritura",
  ).toEqual([]);
});
