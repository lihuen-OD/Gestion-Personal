import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  buildJsonReport,
  buildMarkdownReport,
  type ActionResult,
  type CapturedRequest,
  type EmployeesJourneyRun,
} from "./support/performanceEmployeesJourney";
import { sanitizeRequestPath } from "./support/sanitizePath";

/**
 * Etapa 14D.1 — Performance Journey específico del módulo Legajos.
 * Ver docs/performance/EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md (generado por
 * este mismo spec) para el mapa completo del módulo y los resultados.
 *
 * Precondición: backend y frontend ya corriendo localmente (`npm run dev` en
 * cada uno — ver docs/LOCAL_DEVELOPMENT.md). Este spec no los levanta ni los
 * apaga.
 *
 * Modo lectura por diseño (default y único implementado esta etapa — ver
 * Parte 3/§15 del reporte generado): nunca envía un formulario, nunca
 * crea/edita/borra nada. Abre modales de edición para medir su tiempo de
 * apertura y los cierra sin guardar. `EMPLOYEES_PERF_WRITE_MODE` queda
 * reconocida como variable pendiente para una futura etapa (no implementada
 * acá — ningún guardado del módulo es reversible sin perder historial de
 * auditoría, ver justificación completa en la matriz del reporte).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "../../docs/performance");
const MD_REPORT_PATH = path.join(REPORT_DIR, "EMPLOYEES_PERFORMANCE_JOURNEY_14D1.md");
const JSON_REPORT_PATH = path.join(REPORT_DIR, "EMPLOYEES_PERFORMANCE_JOURNEY_14D1.json");

const BASE_URL = (process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174").replace(/\/$/, "");
const API_BASE_URL = (process.env.PERF_JOURNEY_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const OK_THRESHOLD_MS = Number(process.env.EMPLOYEES_PERF_OK_MS || 1000);
const MEDIUM_THRESHOLD_MS = Number(process.env.EMPLOYEES_PERF_MEDIUM_MS || 2000);
const SLOW_THRESHOLD_MS = Number(process.env.EMPLOYEES_PERF_SLOW_MS || 3000);
const ACTION_TIMEOUT_MS = 15_000;
const SETTLE_GRACE_MS = 250;

// Etapa 14D.1 confirma leyendo `EmployeeDetailPage.tsx` (const tabs = [...])
// qué pestañas caen dentro de las zonas C-I explícitamente pedidas (drill-down
// de historiales/edición) vs cuáles quedan fuera de alcance (se recorren para
// cubrir "cambiar entre pestañas", sin abrir historiales que el pedido no
// pidió medir).
const ZONE_BY_TAB_LABEL: Record<string, string> = {
  "Información General": "C. Información general",
  "Contacto y Domicilio": "D. Contacto y domicilio",
  "Datos Laborales": "E. Datos laborales",
  "Responsables / Asignaciones": "F. Responsables/Asignaciones",
  "Transporte": "G. Transporte",
  "Configuración Horaria": "H. Configuración",
  "Gestión Documental": "I. Adjuntos/Documentos",
};
const DEEP_ZONES = new Set(Object.keys(ZONE_BY_TAB_LABEL));

test.describe.configure({ mode: "serial" });

test("employees performance journey — recorrido crítico del módulo Legajos (Etapa 14D.1)", async ({ page }) => {
  test.setTimeout(300_000);

  const actions: ActionResult[] = [];
  const allCaptured: (CapturedRequest & { capturedAt: number })[] = [];
  const allConsoleErrors: { message: string; capturedAt: number }[] = [];

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (!url.startsWith(API_BASE_URL)) return;
    request
      .response()
      .then((response) => {
        if (!response) return;
        const timing = request.timing();
        const durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : 0;
        // Sanitizado ACÁ, al capturar (no sólo al final): mismo helper que
        // usa el journey general (14B.3), sin querystring y con cualquier
        // UUID normalizado a `:id` — nunca debe quedar un id real de
        // empleado en memoria más tiempo del necesario. `buildJsonReport`/
        // `buildMarkdownReport` vuelven a sanitizar como red de seguridad
        // (ver `sanitizeAction` en el módulo de soporte), pero no dependen
        // de que este paso lo haga bien.
        allCaptured.push({ method: request.method(), path: sanitizeRequestPath(url), statusCode: response.status(), durationMs, capturedAt: Date.now() });
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
    const route = page.url();
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
        // Para acciones de "cerrar" (el elemento se desmonta, nunca vuelve
        // a estar "visible") — el tiempo relevante es cuánto tardó en
        // desaparecer, no en aparecer.
        try {
          await hiddenLocator.first().waitFor({ state: "hidden", timeout: ACTION_TIMEOUT_MS });
          visibleMs = Date.now() - windowStart;
        } catch {
          visibleMs = undefined;
        }
      }

      // Espera mínima antes de chequear "networkidle": el `visibleLocator`
      // (cuando existe) suele resolver ANTES de que el efecto de React que
      // dispara el fetch llegue a ejecutarse (el contenedor ya renderizó,
      // el `useEffect` corre después) — sin este margen, `networkidle`
      // puede reportar "ya está quieto" un instante antes de que el
      // request recién arranque, y ese request termina atribuido a la
      // PRÓXIMA acción medida en vez de a esta. Confirmado en la primera
      // corrida real de este journey (los 8 field-history de "Datos
      // Laborales" aparecían contados en la acción siguiente).
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

      actions.push({
        name,
        zone,
        route,
        covered: true,
        skippedReason: null,
        visibleMs,
        networkIdleMs,
        requests: requestsInWindow(windowStart, windowEnd),
        consoleErrors: errorsInWindow(windowStart, windowEnd),
        notes,
        isWrite,
        hadRefetch: null,
        emptyScreen,
      });
    } catch (error) {
      actions.push({
        name,
        zone,
        route,
        covered: false,
        skippedReason: `error durante la acción: ${String(error).slice(0, 300)}`,
        requests: requestsInWindow(windowStart, Date.now()),
        consoleErrors: errorsInWindow(windowStart, Date.now()),
        notes: [],
        isWrite,
        hadRefetch: null,
        emptyScreen: null,
      });
    }
  }

  function skip(name: string, zone: string, reason: string, isWrite = false): void {
    actions.push({
      name,
      zone,
      route: page.url(),
      covered: false,
      skippedReason: reason,
      requests: [],
      consoleErrors: [],
      notes: [],
      isWrite,
      hadRefetch: null,
      emptyScreen: null,
    });
  }

  /** Abre un modal (click en `trigger`), mide su aparición, lo cierra SIN guardar. Modo lectura por diseño de esta etapa. */
  async function measureModalOpenAndClose(name: string, zone: string, trigger: Locator): Promise<void> {
    if ((await trigger.count()) === 0) {
      skip(name, zone, "no se encontró el botón para abrir esta edición en el estado actual del legajo");
      return;
    }
    await measure(name, zone, false, async () => {
      await trigger.first().click();
      return { visibleLocator: page.locator(".modal"), notes: ["se abrió el modal y se cerró sin guardar (modo lectura de esta etapa)"] };
    });
    const closeButton = page.getByRole("button", { name: "Cerrar" });
    if (await closeButton.count()) {
      await closeButton.first().click().catch(() => undefined);
      await page.locator(".modal").first().waitFor({ state: "hidden", timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
    }
  }

  /** Abre (y opcionalmente cierra) el historial "Ver historial" de un `.block-card` — patrón lazy (Domicilio/Responsables/Transporte/Configuración). */
  async function measureBlockHistory(zone: string, card: Locator, label: string): Promise<void> {
    const toggle = card.getByRole("button", { name: "Ver historial" });
    if ((await toggle.count()) === 0) {
      skip(`Abrir historial de ${label}`, zone, "no se encontró el botón 'Ver historial' para este bloque");
      return;
    }
    await measure(`Abrir historial de ${label}`, zone, false, async () => {
      await toggle.first().click();
      return {
        visibleLocator: card.locator(".timeline, .empty-compact"),
        emptyLocator: card.locator(".empty-compact"),
        // Confirmado leyendo BlockHistoryTimeline (FieldHistoryControls.tsx):
        // el loading ("Cargando historial...") queda scopeado dentro de esta
        // card, nunca bloquea el resto del detalle del legajo — loading
        // localizado, no global.
        notes: ["loading localizado: el spinner de esta acción queda contenido dentro de la card del bloque, no bloquea el resto de la pantalla"],
      };
    });
    await measure(`Cerrar historial de ${label}`, zone, false, async () => {
      await toggle.first().click();
      return { hiddenLocator: card.locator(".timeline, .empty-compact") };
    }).catch(() => undefined);
  }

  const run: EmployeesJourneyRun = {
    generatedAt: "",
    environment:
      "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
    user: "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
    command: "npm run perf:journey:employees (desde frontend/)",
    mode: "read-only",
    actions,
    okThresholdMs: OK_THRESHOLD_MS,
    mediumThresholdMs: MEDIUM_THRESHOLD_MS,
    slowThresholdMs: SLOW_THRESHOLD_MS,
  };

  // ---------------------------------------------------------------------
  // Login (mismo mecanismo que el journey general, Etapa 14B.3).
  // ---------------------------------------------------------------------
  await measure("Login (acceso rápido RRHH)", "Login", false, async () => {
    await page.goto("/");
    await page.getByRole("button", { name: /Nivel 1 - RRHH/ }).click();
    return { visibleLocator: page.locator("h1").first() };
  });
  expect(actions.at(-1)!.covered, "El login con el acceso rápido demo debe dejar ver el shell de la app").toBe(true);

  // ---------------------------------------------------------------------
  // A. Listado
  // ---------------------------------------------------------------------
  await measure("Entrar a /legajos", "A. Listado", false, async () => {
    await page.goto("/legajos");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const hasTable = actions.at(-1)!.covered && (await page.locator("table tbody tr").count()) > 0;

  if (hasTable) {
    // Paginación siguiente/anterior — item 6/7/12 del pedido.
    const nextButton = page.getByRole("button", { name: "Siguiente", exact: true });
    if (await nextButton.isEnabled().catch(() => false)) {
      await measure("Paginación — Siguiente", "A. Listado", false, async () => {
        await nextButton.click();
        const rowsRightAfterClick = await page.locator("table tbody tr").count();
        return {
          visibleLocator: page.locator("table tbody tr").first(),
          notes: [rowsRightAfterClick > 0 ? "la tabla mantuvo filas visibles inmediatamente después del click (no se blanqueó)" : "la tabla quedó sin filas inmediatamente después del click"],
        };
      });
      const prevButton = page.getByRole("button", { name: "Anterior", exact: true });
      await measure("Paginación — Anterior", "A. Listado", false, async () => {
        await prevButton.click();
        const rowsRightAfterClick = await page.locator("table tbody tr").count();
        return {
          visibleLocator: page.locator("table tbody tr").first(),
          notes: [rowsRightAfterClick > 0 ? "la tabla mantuvo filas visibles inmediatamente después del click (no se blanqueó)" : "la tabla quedó sin filas inmediatamente después del click"],
        };
      });
    } else {
      skip("Paginación — Siguiente", "A. Listado", "el botón \"Siguiente\" está deshabilitado en el entorno actual (una sola página de legajos con los filtros/permisos vigentes)");
      skip("Paginación — Anterior", "A. Listado", "depende de la paginación anterior, salteada por el mismo motivo");
    }

    // Búsqueda — item 8/9. Término real tomado de la tabla, nunca inventado
    // ni registrado en el reporte (Parte 2, sanitización obligatoria).
    const searchInput = page.getByPlaceholder("Buscar por legajo, DNI, CUIL, apellido o nombre");
    const firstLegajoText = (await page.locator("table tbody tr td b").first().textContent().catch(() => null))?.trim();
    if (firstLegajoText) {
      await measure("Buscar empleado por texto", "A. Listado", false, async () => {
        await searchInput.fill(firstLegajoText);
        return {
          visibleLocator: page.locator("table tbody tr, .empty").first(),
          notes: ["término de búsqueda tomado del primer legajo real de la tabla — no se registra el valor buscado en este reporte"],
          preNetworkIdleWaitMs: 400,
        };
      });
      await measure("Limpiar búsqueda", "A. Listado", false, async () => {
        await searchInput.fill("");
        return { visibleLocator: page.locator("table tbody tr").first(), preNetworkIdleWaitMs: 400 };
      });
    } else {
      skip("Buscar empleado por texto", "A. Listado", "no se encontró ningún legajo en el listado inicial para usar como término de búsqueda real");
      skip("Limpiar búsqueda", "A. Listado", "depende de la búsqueda anterior, salteada");
    }

    // Filtro — item 10/11. Se ejercita sólo el filtro de Empresa como
    // representativo (mismo mecanismo `buildWhere` que Sector/Centro de
    // costo — evitar 3 mediciones redundantes del mismo patrón backend).
    const companySelect = page.locator("select").first();
    const companyOptionsCount = await companySelect.locator("option").count();
    if (companyOptionsCount > 1) {
      await measure("Aplicar filtro (Empresa)", "A. Listado", false, async () => {
        await companySelect.selectOption({ index: 1 });
        return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["filtro representativo — Sector/Centro de costo comparten el mismo mecanismo de where en backend"] };
      });
      await measure("Limpiar filtro (Empresa)", "A. Listado", false, async () => {
        await companySelect.selectOption({ index: 0 });
        return { visibleLocator: page.locator("table tbody tr").first() };
      });
    } else {
      skip("Aplicar filtro (Empresa)", "A. Listado", "el catálogo de empresas está vacío en el entorno actual");
      skip("Limpiar filtro (Empresa)", "A. Listado", "depende del filtro anterior, salteado");
    }
  } else {
    for (const name of ["Paginación — Siguiente", "Paginación — Anterior", "Buscar empleado por texto", "Limpiar búsqueda", "Aplicar filtro (Empresa)", "Limpiar filtro (Empresa)"]) {
      skip(name, "A. Listado", "el listado de Legajos no devolvió ningún registro en el entorno actual");
    }
  }

  // ---------------------------------------------------------------------
  // B. Detalle — primer legajo real de la tabla, nunca inventado.
  // ---------------------------------------------------------------------
  const detailLinks = page.locator('a[href^="/legajos/"]:not([href="/legajos/nuevo"])');
  const hasDetail = hasTable && (await detailLinks.count()) > 0;

  if (!hasDetail) {
    skip("Abrir primer legajo disponible", "B. Detalle", "el listado de Legajos no devolvió ningún registro para abrir un detalle real");
  } else {
    const href = (await detailLinks.first().getAttribute("href")) || "/legajos/:id";
    await measure("Abrir primer legajo disponible", "B. Detalle", false, async () => {
      await page.goto(href);
      return { visibleLocator: page.locator(".detail-hero h1").first() };
    });

    if (actions.at(-1)!.covered) {
      // Recorre TODAS las pestañas (item 19) — drill-down (historiales,
      // modales) sólo en las zonas C-I explícitamente pedidas.
      const tabButtons = page.locator(".tabs button");
      const tabCount = await tabButtons.count();
      const tabLabels: string[] = [];
      for (let i = 0; i < tabCount; i += 1) {
        tabLabels.push((await tabButtons.nth(i).textContent())?.trim() || `Pestaña ${i}`);
      }

      for (const label of tabLabels) {
        const zone = ZONE_BY_TAB_LABEL[label] || "Otras pestañas del legajo (fuera de zonas C-I)";
        await measure(`Cambiar a pestaña "${label}"`, zone, false, async () => {
          await page.locator(".tabs button", { hasText: label }).first().click();
          return { visibleLocator: page.locator("section, .section").first(), emptyLocator: page.locator(".empty") };
        });

        if (label === "Datos Laborales") {
          // Etapa 14D.2: antes de esta etapa, esta pestaña disparaba 8
          // GET /field-history en paralelo al montar (16 con React
          // StrictMode en dev) — hallazgo de 14D.1. Se hizo lazy (mismo
          // patrón que Domicilio/Responsables/Transporte/Configuración):
          // ahora esta acción sólo debería mostrar `GET .../position-
          // validation` (SalaryRangeValidationCard, con select liviano
          // desde esta etapa) — cero field-history hasta que el usuario
          // abra alguno explícitamente (ver acciones "Abrir historial de
          // ..." más abajo).
          actions.at(-1)!.notes.push(
            "desde la Etapa 14D.2 esta pestaña ya no dispara field-history al montar (antes disparaba 8 en paralelo, 16 con StrictMode) — el único request esperable acá es GET .../position-validation",
          );
        }

        if (!DEEP_ZONES.has(label) || !actions.at(-1)!.covered) continue;

        // D. Contacto y domicilio / G. Transporte / H. Configuración —
        // bloques lazy (`.block-card`, "Ver historial" real al click).
        if (["Contacto y Domicilio", "Transporte", "Configuración Horaria"].includes(label)) {
          const cards = page.locator(".block-card");
          const cardCount = await cards.count();
          for (let i = 0; i < cardCount; i += 1) {
            const card = cards.nth(i);
            const cardLabel = (await card.locator("h3").first().textContent().catch(() => null))?.trim() || `bloque ${i + 1}`;
            await measureBlockHistory(zone, card, cardLabel);
          }
          // Edición: primer botón "primary" del bloque (Modificar X).
          for (let i = 0; i < cardCount; i += 1) {
            const card = cards.nth(i);
            const cardLabel = (await card.locator("h3").first().textContent().catch(() => null))?.trim() || `bloque ${i + 1}`;
            const editButton = card.locator(".tracked-actions button.primary, .tracked-actions button:not(:has-text('Ver historial'))").last();
            await measureModalOpenAndClose(`Abrir edición de ${cardLabel}`, zone, editButton);
          }
        }

        // F. Responsables/Asignaciones — igual patrón lazy que arriba, 2
        // bloques (Encargado directo, Responsable de carga horaria).
        if (label === "Responsables / Asignaciones") {
          const cards = page.locator(".block-card");
          const cardCount = await cards.count();
          for (let i = 0; i < cardCount; i += 1) {
            const card = cards.nth(i);
            const cardLabel = (await card.locator("h3").first().textContent().catch(() => null))?.trim() || `responsable ${i + 1}`;
            await measureBlockHistory(zone, card, cardLabel);
          }
          for (let i = 0; i < cardCount; i += 1) {
            const card = cards.nth(i);
            const cardLabel = (await card.locator("h3").first().textContent().catch(() => null))?.trim() || `responsable ${i + 1}`;
            const editButton = card.locator(".tracked-actions button.primary, .tracked-actions button:not(:has-text('Ver historial'))").last();
            await measureModalOpenAndClose(`Abrir edición de ${cardLabel}`, zone, editButton);
          }
        }

        // E. Datos laborales — Etapa 14D.2: patrón lazy desde esta etapa
        // (antes era eager, medido/diagnosticado en 14D.1) — cada campo
        // trackeado (`.tracked-field` con botón "Historial") sólo dispara
        // su field-history al abrirse, igual que los bloques lazy de
        // Domicilio/Responsables/Transporte/Configuración. Los campos
        // derivados sin historial (Unidad de negocio/Establecimiento) no
        // tienen botón "Historial" y se saltean solos.
        if (label === "Datos Laborales") {
          const trackedFields = page.locator(".tracked-field");
          const trackedCount = await trackedFields.count();
          for (let i = 0; i < trackedCount; i += 1) {
            const fieldCard = trackedFields.nth(i);
            const toggle = fieldCard.getByRole("button", { name: "Historial" });
            if ((await toggle.count()) === 0) continue; // campo derivado, sin historial (Unidad de negocio/Establecimiento)
            const fieldLabel = (await fieldCard.locator(".tracked-main small").first().textContent().catch(() => null))?.trim() || `campo ${i + 1}`;
            await measure(`Abrir historial de ${fieldLabel}`, zone, false, async () => {
              await toggle.first().click();
              return {
                visibleLocator: fieldCard.locator(".timeline, .empty-compact"),
                emptyLocator: fieldCard.locator(".empty-compact"),
                notes: ["loading localizado: el spinner de esta acción queda contenido dentro del campo, no bloquea el resto de la pestaña"],
              };
            });
            await measure(`Cerrar historial de ${fieldLabel}`, zone, false, async () => {
              await toggle.first().click();
              return { hiddenLocator: fieldCard.locator(".timeline, .empty-compact") };
            });
          }

          // Etapa 14D.2.1 (Parte 3, ítem 9 del pedido): confirma que
          // revisitar la pestaña no vuelve a disparar position-validation —
          // SalaryRangeValidationCard se remonta al volver a la pestaña, y
          // el caché de sesión (services/cache, misma combinación
          // employeeId+positionId+sector+internalCategory) debe servir el
          // resultado ya conocido sin una request nueva.
          await measure("Salir de Datos Laborales (a Contacto y Domicilio)", zone, false, async () => {
            await page.locator(".tabs button", { hasText: "Contacto y Domicilio" }).first().click();
            return { visibleLocator: page.locator("section, .section").first() };
          });
          await measure("Volver a entrar a Datos Laborales (debería servir position-validation desde caché)", zone, false, async () => {
            await page.locator(".tabs button", { hasText: "Datos Laborales" }).first().click();
            return {
              visibleLocator: page.locator("section, .section").first(),
              notes: ["si aparece un GET .../position-validation acá, la caché de sesión no está funcionando — no debería haber ninguno en una revisita sin cambios"],
            };
          });
        }

        // I. Adjuntos/Documentos — carga de la lista + abrir modal de carga
        // sin subir ningún archivo (sin fixture seguro documentado, ver
        // matriz).
        if (label === "Gestión Documental") {
          const addButton = page.getByRole("button", { name: "Agregar documento" });
          await measureModalOpenAndClose("Abrir modal 'Agregar documento' (sin subir archivo)", zone, addButton);
        }
      }
    }

    // Volver al listado (Parte 4, ítem 15 — caso mínimo obligatorio).
    await measure("Volver al listado", "A. Listado", false, async () => {
      await page.locator(".back-link, a[href='/legajos']").first().click();
      return { visibleLocator: page.locator("h1").first() };
    });
  }

  // ---------------------------------------------------------------------
  // Reporte final.
  // ---------------------------------------------------------------------
  run.generatedAt = new Date().toISOString();

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdownReport(run), "utf-8");
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(buildJsonReport(run), null, 2)}\n`, "utf-8");
});
