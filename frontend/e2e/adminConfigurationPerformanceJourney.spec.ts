import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator } from "@playwright/test";
import {
  buildJsonReport,
  buildMarkdownReport,
  type ActionResult,
  type AdminConfigJourneyRun,
  type CapturedRequest,
} from "./support/adminConfigurationJourney";
import { sanitizeRequestPath } from "./support/sanitizePath";

/**
 * Etapa 14H.1 — Diagnóstico macro de performance de Configuración + Puestos.
 * Ver docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md para el
 * mapa completo (Matriz 1: inventario de submódulos, Matriz 2: cobertura) y
 * docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md (generado
 * por este mismo spec) para los resultados.
 *
 * Precondición: backend y frontend ya corriendo localmente (`npm run dev` en
 * cada uno — ver docs/LOCAL_DEVELOPMENT.md). Este spec no los levanta ni los
 * apaga (mismo criterio que `workforceManagementPerformanceJourney.spec.ts`).
 *
 * Modo lectura exclusivo: nunca crea/edita/elimina/activa/inactiva ningún
 * turno, feriado, regla de horas especiales, régimen laboral, entidad de
 * estructura organizacional, tipo de novedad, concepto horario, categoría
 * documental, parámetro de auditoría o puesto. Cada una de esas acciones
 * queda como `skip(...)` con `isWrite: true` y su motivo documentado — ver
 * §14 del reporte generado. Los editores inline (Section, no el componente
 * Modal compartido) tampoco se abren en esta etapa por una política única de
 * alcance — ver §14 del reporte y el doc de decisión.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "../../docs/performance");
const MD_REPORT_PATH = path.join(REPORT_DIR, "ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md");
const JSON_REPORT_PATH = path.join(REPORT_DIR, "ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.json");

const BASE_URL = (process.env.PERF_JOURNEY_BASE_URL || "http://localhost:5174").replace(/\/$/, "");
const API_BASE_URL = (process.env.PERF_JOURNEY_API_URL || "http://localhost:4002/api").replace(/\/$/, "");
const OK_THRESHOLD_MS = Number(process.env.ADMIN_CONFIG_PERF_OK_MS || 1000);
const MEDIUM_THRESHOLD_MS = Number(process.env.ADMIN_CONFIG_PERF_MEDIUM_MS || 2000);
const SLOW_THRESHOLD_MS = Number(process.env.ADMIN_CONFIG_PERF_SLOW_MS || 3000);
const ACTION_TIMEOUT_MS = 15_000;
const SETTLE_GRACE_MS = 250;

// Zonas A-N de esta etapa — mismo orden en que las tarjetas aparecen en
// SettingsPage.tsx, más Puestos al final (listado/detalle/creación).
// Centralizado acá para que nunca haya un typo entre acciones de la misma
// zona (mismo criterio que ZONE en workforceManagementPerformanceJourney).
const ZONE = {
  login: "Login",
  landing: "A. Configuración (landing)",
  turnos: "B. Turnos",
  feriados: "C. Asignaciones de feriados",
  horasEspeciales: "D. Horas especiales",
  regimenes: "E. Regímenes laborales",
  estructura: "F. Empresas y estructura",
  tiposNovedades: "G. Tipos de novedades",
  conceptosHorarios: "H. Conceptos horarios",
  exportacionFinnegans: "I. Exportación Finnegans",
  categoriasDocumentales: "J. Categorías documentales",
  parametrosAuditoria: "K. Parámetros de auditoría",
  puestosListado: "L. Puestos (listado)",
  puestoDetalle: "M. Puesto (detalle)",
  puestoCreacion: "N. Puesto (creación, sólo navegación)",
  noveltyTypeDetalle: "O. Tipo de novedad (detalle)",
  noveltyTypeCreacion: "P. Tipo de novedad (creación, sólo navegación)",
} as const;

test.describe.configure({ mode: "serial" });

test("admin configuration performance journey — recorrido macro de Configuración + Puestos (Etapa 14H.1)", async ({ page }) => {
  // ~50 acciones sobre 12 rutas reales contra Neon staging (no una SPA con
  // datos mockeados) — mismo perfil que el journey de Gestión horaria
  // (14G.1), que tardó más de 10 minutos en una corrida real sin que eso
  // implicara un bug de selectores.
  test.setTimeout(1_800_000);

  // `playwright.config.ts` no fija `use.actionTimeout` (compartido con el
  // resto de los journeys, no se toca acá para no afectarlos) — sin esto,
  // una acción no-accionable puede colgar el test para siempre sin lanzar
  // nada (confirmado dos veces en una corrida real de 14G.1). `setDefaultTimeout`
  // acota esto SÓLO para el `page` de este test.
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);

  const actions: ActionResult[] = [];
  const allCaptured: (CapturedRequest & { capturedAt: number })[] = [];
  const allConsoleErrors: { message: string; capturedAt: number }[] = [];

  page.on("requestfinished", (request) => {
    const url = request.url();
    if (!url.startsWith(API_BASE_URL)) return;
    // Capturado ACÁ, al entrar al handler — no dentro del `.then()` de más
    // abajo (mismo motivo que 14G.1: el request ya terminó cuando Playwright
    // emite "requestfinished"; resolver `response()` es async y puede
    // desplazar el request a la ventana de la PRÓXIMA acción si se usara
    // `Date.now()` ahí adentro).
    const capturedAt = Date.now();
    request
      .response()
      .then((response) => {
        if (!response) return;
        const timing = request.timing();
        const durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : 0;
        // Sanitizado ACÁ, al capturar — nunca se guarda la URL cruda.
        // `buildJsonReport`/`buildMarkdownReport` vuelven a sanitizar como
        // red de seguridad, pero no dependen de que este paso lo haga bien.
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

      // Margen antes de chequear "networkidle" — mismo criterio que
      // 14D.1/14G.1: el `visibleLocator` suele resolver antes de que el
      // efecto de React que dispara el fetch llegue a ejecutarse.
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
      // link), así que la ruta correcta a reportar es la de destino.
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

  /** Abre un modal (click en `trigger`), lo mide, y lo mide de nuevo al cerrarlo con el ícono "Cerrar" del Modal compartido — nunca toca un botón de guardar. Único submódulo de esta etapa que usa el componente Modal compartido: Regímenes laborales. */
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

  const run: AdminConfigJourneyRun = {
    generatedAt: "",
    environment:
      "Frontend y backend locales (`npm run dev`), backend conectado a la base real de staging (ver docs/LOCAL_DEVELOPMENT.md) — no es un ambiente de producción ni un ambiente aislado de test.",
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
    user: "Nivel 1 - RRHH (acceso rápido demo — credenciales en docs/LOCAL_DEVELOPMENT.md, no se repiten en este reporte)",
    command: "npm run perf:journey:admin-config (desde frontend/)",
    mode: "read-only",
    actions,
    okThresholdMs: OK_THRESHOLD_MS,
    mediumThresholdMs: MEDIUM_THRESHOLD_MS,
    slowThresholdMs: SLOW_THRESHOLD_MS,
  };

  // -------------------------------------------------------------------
  // Login — Nivel 1 (RRHH), el único rol con acceso simultáneo a
  // /configuracion y /puestos (navigation.tsx). Mismo mecanismo que
  // 14D.1/14F.1/14G.1.
  // -------------------------------------------------------------------
  await measure("Login (acceso rápido RRHH)", ZONE.login, false, async () => {
    await page.goto("/");
    await page.getByRole("button", { name: /Nivel 1 - RRHH/ }).click();
    return { visibleLocator: page.locator("h1").first() };
  });
  expect(actions.at(-1)!.covered, "El login con el acceso rápido demo debe dejar ver el shell de la app").toBe(true);

  // -------------------------------------------------------------------
  // A. Configuración (landing) — página estática, sin llamadas API.
  // -------------------------------------------------------------------
  await measure("Entrar a Configuración", ZONE.landing, false, async () => {
    await page.goto("/configuracion");
    return { visibleLocator: page.locator("h1").first(), notes: ["página estática sin llamadas API — 10 tarjetas de submódulos, todas con <Link> real sin efectos colaterales"] };
  });

  const settingCards = page.locator(".setting-card");
  if (actions.at(-1)!.covered) {
    await measure("Ver tarjetas de submódulos", ZONE.landing, false, async () => {
      const count = await settingCards.count();
      return { visibleLocator: settingCards.first(), notes: [`se detectaron ${count} tarjetas (se esperan 10)`] };
    });
  } else {
    skip("Ver tarjetas de submódulos", ZONE.landing, "la landing de Configuración no cargó en el entorno actual");
  }

  // -------------------------------------------------------------------
  // B. Turnos — único submódulo (junto con Horas especiales) sin ningún
  // cache frontend en sus endpoints de mount.
  // -------------------------------------------------------------------
  await measure("Entrar a Turnos", ZONE.turnos, false, async () => {
    await page.goto("/configuracion/turnos");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const shiftName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (shiftName?.trim()) {
    await measure("Buscar en Turnos", ZONE.turnos, false, async () => {
      await page.getByPlaceholder("Código, nombre o categoría").fill(shiftName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de un turno real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Turnos", ZONE.turnos, "no hay ningún turno en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Turnos por Estado", ZONE.turnos, false, async () => {
    await page.getByLabel("Estado").selectOption("ACTIVO");
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  skip("Crear turno", ZONE.turnos, "Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click.", true);

  const shiftDetailLink = page.getByRole("link", { name: /Ver detalle de/ }).first();
  if (await shiftDetailLink.count()) {
    const shiftDetailHref = await shiftDetailLink.getAttribute("href");
    if (shiftDetailHref) {
      await measure("Ver detalle de turno", ZONE.turnos, false, async () => {
        await page.goto(shiftDetailHref);
        return { visibleLocator: page.locator("h1").first() };
      });
    } else {
      skip("Ver detalle de turno", ZONE.turnos, "el link 'Ver detalle de...' no tenía un href real en el entorno actual");
    }
  } else {
    skip("Ver detalle de turno", ZONE.turnos, "no hay ningún turno en el entorno actual para abrir su detalle");
  }

  skip("Inactivar/Activar turno", ZONE.turnos, "Prohibido por defecto — acción de escritura (PATCH /workforce/shift-templates/:id).", true);

  // -------------------------------------------------------------------
  // C. Asignaciones de feriados
  // -------------------------------------------------------------------
  await measure("Entrar a Asignaciones de feriados", ZONE.feriados, false, async () => {
    await page.goto("/configuracion/turnos-asignaciones-feriados");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const holidayChip = page.locator(".holiday-work-date-chip").first();
  if (await holidayChip.count()) {
    await measure("Seleccionar fecha de feriado", ZONE.feriados, false, async () => {
      await holidayChip.click();
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Seleccionar fecha de feriado", ZONE.feriados, "no hay ninguna fecha de feriado disponible para el mes actual en el entorno actual");
  }

  skip("Guardar cambios (convocatoria de feriado)", ZONE.feriados, "Prohibido por defecto — asignaría feriados reales a empleados reales (PUT /shifts/holiday-work/assignments).", true);

  // -------------------------------------------------------------------
  // D. Horas especiales — 4 GETs en el montaje, el mayor conteo de todas
  // las tarjetas de Configuración.
  // -------------------------------------------------------------------
  await measure("Entrar a Horas especiales", ZONE.horasEspeciales, false, async () => {
    await page.goto("/configuracion/turnos-horas-especiales");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const kindFilter = page.getByLabel("Filtrar por clasificación");
  if (await kindFilter.count()) {
    await measure("Filtrar Horas especiales por clasificación", ZONE.horasEspeciales, false, async () => {
      await kindFilter.selectOption("FERIADO");
      return { visibleLocator: page.locator("table tbody tr, .empty").first() };
    });
  } else {
    skip("Filtrar Horas especiales por clasificación", ZONE.horasEspeciales, "no hay ninguna regla de horas especiales en el entorno actual — el filtro sólo se renderiza si rules.length > 0");
  }

  skip(
    "Abrir edición de regla / Crear regla",
    ZONE.horasEspeciales,
    "El formulario 'Nueva regla'/'Editar' es un editor inline siempre presente en la página (no el componente Modal compartido) — esta etapa sólo abre y cierra modales del componente Modal compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey.",
  );
  skip("Activar/Inactivar/Eliminar regla", ZONE.horasEspeciales, "Prohibido por defecto — acciones de escritura (PATCH/DELETE /workforce/double-hour-rules/:id).", true);

  // -------------------------------------------------------------------
  // E. Regímenes laborales — único submódulo de esta etapa con modales
  // del componente Modal compartido (ver WORK_REGIME_ASSIGNMENT_
  // CONSISTENCY_13J.md para el detalle de este flujo).
  // -------------------------------------------------------------------
  await measure("Entrar a Regímenes laborales", ZONE.regimenes, false, async () => {
    await page.goto("/configuracion/regimenes-laborales");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const regimeName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (regimeName?.trim()) {
    await measure("Buscar en Regímenes laborales", ZONE.regimenes, false, async () => {
      await page.getByPlaceholder("Buscar por código o nombre").fill(regimeName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de un régimen real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Regímenes laborales", ZONE.regimenes, "no hay ningún régimen laboral en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Regímenes laborales por Estado", ZONE.regimenes, false, async () => {
    await page.getByLabel("Estado").selectOption("ACTIVO");
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  await measureModalOpenAndCancel("Abrir modal Crear régimen", "Cerrar modal Crear régimen", ZONE.regimenes, page.getByRole("button", { name: "Crear régimen" }));

  const viewAssociatedButton = page.getByRole("button", { name: "Ver empleados asociados" });
  if (await viewAssociatedButton.count()) {
    await measure("Ver empleados asociados a un régimen", ZONE.regimenes, false, async () => {
      await viewAssociatedButton.first().click();
      return { visibleLocator: page.locator(".modal").first() };
    });

    if (actions.at(-1)!.covered) {
      const vigencyFilter = page.getByLabel(/[Vv]igencia/);
      if (await vigencyFilter.count()) {
        await measure("Filtrar vigencia de empleados asociados", ZONE.regimenes, false, async () => {
          await vigencyFilter.first().selectOption("all");
          return { visibleLocator: page.locator(".modal table tbody tr, .modal .empty").first() };
        });
      } else {
        skip("Filtrar vigencia de empleados asociados", ZONE.regimenes, "no se encontró el selector de vigencia dentro del modal en el entorno actual");
      }

      const closeAssociatedButton = page.getByRole("button", { name: "Cerrar" });
      await measure("Cerrar modal Empleados asociados", ZONE.regimenes, false, async () => {
        await closeAssociatedButton.first().click();
        return { hiddenLocator: page.locator(".modal") };
      });
    } else {
      skip("Filtrar vigencia de empleados asociados", ZONE.regimenes, "depende de la acción anterior, que no llegó a abrir el modal");
      skip("Cerrar modal Empleados asociados", ZONE.regimenes, "depende de la acción anterior, que no llegó a abrir el modal");
    }
  } else {
    skip("Ver empleados asociados a un régimen", ZONE.regimenes, "no se encontró el botón 'Ver empleados asociados' en el entorno actual");
    skip("Filtrar vigencia de empleados asociados", ZONE.regimenes, "depende de la acción anterior, salteada");
    skip("Cerrar modal Empleados asociados", ZONE.regimenes, "depende de la acción anterior, salteada");
  }

  skip("Agregar empleados / Finalizar asignación", ZONE.regimenes, "Prohibido por defecto — acciones de escritura (POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close).", true);
  skip("Editar régimen / Activar-Inactivar régimen", ZONE.regimenes, "Prohibido por defecto — acciones de escritura (POST/PATCH /work-regimes[/:id][/status]).", true);

  // -------------------------------------------------------------------
  // F. Empresas y estructura
  // -------------------------------------------------------------------
  await measure("Entrar a Empresas y estructura", ZONE.estructura, false, async () => {
    await page.goto("/configuracion/empresas-estructura");
    return { visibleLocator: page.locator("h1").first() };
  });

  const sectoresTab = page.getByRole("button", { name: "Sectores" });
  if (await sectoresTab.count()) {
    await measure("Cambiar de pestaña en Empresas y estructura", ZONE.estructura, false, async () => {
      await sectoresTab.click();
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), preNetworkIdleWaitMs: 200 };
    });
  } else {
    skip("Cambiar de pestaña en Empresas y estructura", ZONE.estructura, "no se encontró la pestaña 'Sectores' en el entorno actual");
  }

  skip(
    "Nuevo registro / Editar / Guardar estructura",
    ZONE.estructura,
    "Etapa 14H.6: evaluado y descartado ampliar el alcance acá (a diferencia de Categorías documentales/Parámetros de auditoría, arriba/abajo) — el editor inline no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña, un efecto colateral del onChange de las Tabs, no un control pensado para esto), y a diferencia de Conceptos horarios (14H.5) abrirlo no revelaría ningún request nuevo (el catálogo completo ya se cargó una sola vez vía getCatalog(), editar es 100% local) — sin valor diagnóstico que justifique salirse de la política de sólo abrir editores con un cierre limpio. No se abre esta etapa, ni se llega al submit real (POST/PATCH /org-structure/...).",
    true,
  );

  // -------------------------------------------------------------------
  // G. Tipos de novedades
  // -------------------------------------------------------------------
  await measure("Entrar a Tipos de novedades", ZONE.tiposNovedades, false, async () => {
    await page.goto("/configuracion/tipos-novedades");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const noveltyTypeName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (noveltyTypeName?.trim()) {
    await measure("Buscar en Tipos de novedades", ZONE.tiposNovedades, false, async () => {
      await page.getByPlaceholder("Nombre, codigo interno o Finnegans").fill(noveltyTypeName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de un tipo de novedad real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Tipos de novedades", ZONE.tiposNovedades, "no hay ningún tipo de novedad en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Tipos de novedades por Finnegans", ZONE.tiposNovedades, false, async () => {
    await page.getByLabel("Finnegans").selectOption("true");
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  skip("Crear tipo de novedad", ZONE.tiposNovedades, "Prohibido por defecto — navegación a un formulario de alta (POST /novelty-types), no se hace click.", true);
  skip("Activar/Inactivar tipo de novedad", ZONE.tiposNovedades, "Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).", true);
  // "Ver detalle de tipo de novedad" pasó a medirse en la zona O (ver más
  // abajo, Etapa 14H.8) — ya no se saltea acá.

  // -------------------------------------------------------------------
  // H. Conceptos horarios — el submódulo con más profundidad potencial
  // (reglas + empleados asociados anidados al editar uno existente).
  // -------------------------------------------------------------------
  await measure("Entrar a Conceptos horarios", ZONE.conceptosHorarios, false, async () => {
    await page.goto("/configuracion/conceptos-horarios");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const hourConceptName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (hourConceptName?.trim()) {
    await measure("Buscar en Conceptos horarios", ZONE.conceptosHorarios, false, async () => {
      await page.getByPlaceholder("Buscar por codigo, nombre o tipo").fill(hourConceptName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de un concepto horario real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Conceptos horarios", ZONE.conceptosHorarios, "no hay ningún concepto horario en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Conceptos horarios por Tipo", ZONE.conceptosHorarios, false, async () => {
    await page.getByLabel("Tipo").selectOption({ index: 1 });
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  // Limpieza silenciosa (fuera de measure(), no cuenta como acción medida —
  // mismo criterio que resetPeriodQuietly() en el journey de Gestión horaria)
  // de la búsqueda y el filtro de Tipo aplicados arriba: ambos son 100%
  // client-side, así que sin este reset la tabla podría quedar acotada a
  // "Todas protegidas" o "sin filas" y la acción de abrir detalle de abajo
  // saltearía siempre por un motivo ajeno a lo que mide.
  await page.getByPlaceholder("Buscar por codigo, nombre o tipo").fill("", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  await page.getByLabel("Tipo").selectOption("").catch(() => undefined);
  await page.waitForTimeout(150);

  // Etapa 14H.5: único editor inline de Configuración que este journey abre
  // (en modo lectura) — abrir "Editar" es 100% local (sin request propio,
  // confirmado leyendo HourConceptsPage.tsx), sólo los paneles hijos que
  // monta (HourConceptRulesPanel + AssociatedEmployeesPanel embedded)
  // disparan red real. Nunca se toca "Guardar"/"Guardar regla"/"Guardar
  // cambios". Se busca la primera fila NO protegida (systemRole !==
  // NORMAL_BASE no tiene botón "Editar", muestra el badge "Protegido" en su
  // lugar) — .first() ya cae ahí porque las filas protegidas no tienen ese
  // botón en absoluto.
  const hourConceptEditButton = page.getByRole("button", { name: "Editar" }).first();
  if (await hourConceptEditButton.count()) {
    await measure("Abrir detalle de concepto horario (Editar)", ZONE.conceptosHorarios, false, async () => {
      await hourConceptEditButton.click();
      // Sin visibleLocator a propósito: "Empleados habilitados" (el título del
      // panel embebido) es estático y se renderiza de inmediato al montar,
      // ANTES de que la data llegue — no sirve para confirmar que
      // getHourConceptEmployees/listByConcept ya resolvieron. El estado
      // final (loading/error/empty/con filas) varía según el concepto real
      // que haya en el entorno, así que se confía en preNetworkIdleWaitMs +
      // el chequeo de networkidle de más abajo para capturar ambos requests.
      return { preNetworkIdleWaitMs: 400 };
    });

    if (actions.at(-1)!.covered) {
      await measureModalOpenAndCancel(
        "Abrir modal Nueva regla horaria",
        "Cerrar modal Nueva regla horaria",
        ZONE.conceptosHorarios,
        page.getByRole("button", { name: "Nueva regla" }),
      );

      await measure("Cerrar detalle de concepto horario sin guardar", ZONE.conceptosHorarios, false, async () => {
        await page.getByRole("button", { name: "Cancelar" }).first().click();
        return { hiddenLocator: page.getByText("Empleados habilitados") };
      });
    } else {
      skip("Abrir modal Nueva regla horaria", ZONE.conceptosHorarios, "depende de la acción anterior, que falló");
      skip("Cerrar modal Nueva regla horaria", ZONE.conceptosHorarios, "depende de la acción anterior, salteada");
      skip("Cerrar detalle de concepto horario sin guardar", ZONE.conceptosHorarios, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Abrir detalle de concepto horario (Editar)", ZONE.conceptosHorarios, "no se encontró ningún concepto horario editable (no protegido) en el entorno actual");
    skip("Abrir modal Nueva regla horaria", ZONE.conceptosHorarios, "depende de la acción anterior, salteada");
    skip("Cerrar modal Nueva regla horaria", ZONE.conceptosHorarios, "depende de la acción anterior, salteada");
    skip("Cerrar detalle de concepto horario sin guardar", ZONE.conceptosHorarios, "depende de la acción anterior, salteada");
  }

  skip("Crear concepto horario / Guardar cambios del concepto", ZONE.conceptosHorarios, "Prohibido por defecto — acción de escritura (POST/PATCH /hour-concepts[/:id]).", true);
  skip("Crear/Editar regla horaria (Guardar)", ZONE.conceptosHorarios, "Prohibido por defecto — el modal se abre y se cierra sin tocar este botón (POST/PATCH /hour-concept-rules[/:id]).", true);
  skip("Activar/Inactivar regla horaria", ZONE.conceptosHorarios, "Prohibido por defecto — acción de escritura (PATCH /hour-concept-rules/:id/status).", true);
  skip("Agregar/Quitar empleados habilitados", ZONE.conceptosHorarios, "Prohibido por defecto — acciones de escritura (POST /hour-concepts/:id/employees, DELETE /hour-concepts/:id/employees/:employeeId).", true);
  skip("Deshabilitar/Eliminar concepto horario", ZONE.conceptosHorarios, "Prohibido por defecto — acciones de escritura (PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id).", true);

  // -------------------------------------------------------------------
  // I. Exportación Finnegans — ya cubierto en detalle por 14G.1, no se
  // remide para no duplicar esfuerzo entre journeys.
  // -------------------------------------------------------------------
  skip(
    "Entrar a Exportación Finnegans",
    ZONE.exportacionFinnegans,
    "Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones incl. cambio de período y búsqueda) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md. Ruta real confirmada: /configuracion/liquidacion → FinnegansExportPage.tsx.",
  );

  // -------------------------------------------------------------------
  // J. Categorías documentales
  // -------------------------------------------------------------------
  await measure("Entrar a Categorías documentales", ZONE.categoriasDocumentales, false, async () => {
    await page.goto("/configuracion/categorias-documentales");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const documentCategoryName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (documentCategoryName?.trim()) {
    await measure("Buscar en Categorías documentales", ZONE.categoriasDocumentales, false, async () => {
      await page.getByPlaceholder("Buscar por codigo, nombre o vinculo externo").fill(documentCategoryName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de una categoría documental real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Categorías documentales", ZONE.categoriasDocumentales, "no hay ninguna categoría documental en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Categorías documentales por Tipo", ZONE.categoriasDocumentales, false, async () => {
    await page.getByLabel("Tipo").selectOption({ index: 1 });
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  // Etapa 14H.6: alcance ampliado por pedido explícito (cubrir detalle de
  // este submódulo, que hasta 14H.5 sólo entraba a la tarjeta) — mismo
  // criterio de riesgo que Conceptos horarios en 14H.5: abrir "Editar" es
  // 100% local (setEditing(item), confirmado leyendo
  // DocumentCategoriesPage.tsx), y este editor SÍ tiene un botón "Cerrar"
  // explícito (a diferencia de Empresas y estructura, que no lo tiene y por
  // eso no se abre esta etapa — ver más abajo). A diferencia de Conceptos
  // horarios, este editor no anida ningún panel con fetch propio (sin reglas
  // ni empleados asociados) — no se espera ningún request nuevo al abrirlo,
  // sólo confirma que abrir/cerrar sigue siendo de sólo lectura.
  const documentCategoryEditButton = page.getByRole("button", { name: "Editar" }).first();
  if (await documentCategoryEditButton.count()) {
    await measure("Abrir detalle de categoría documental (Editar)", ZONE.categoriasDocumentales, false, async () => {
      await documentCategoryEditButton.click();
      return { visibleLocator: page.getByRole("button", { name: "Cerrar" }) };
    });

    if (actions.at(-1)!.covered) {
      await measure("Cerrar detalle de categoría documental sin guardar", ZONE.categoriasDocumentales, false, async () => {
        await page.getByRole("button", { name: "Cerrar" }).first().click();
        return { hiddenLocator: page.getByRole("button", { name: "Cerrar" }) };
      });
    } else {
      skip("Cerrar detalle de categoría documental sin guardar", ZONE.categoriasDocumentales, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Abrir detalle de categoría documental (Editar)", ZONE.categoriasDocumentales, "no se encontró ninguna categoría documental editable en el entorno actual");
    skip("Cerrar detalle de categoría documental sin guardar", ZONE.categoriasDocumentales, "depende de la acción anterior, salteada");
  }

  skip(
    "Crear categoría documental / Guardar cambios de categoría",
    ZONE.categoriasDocumentales,
    "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar categoria' (POST/PATCH /document-categories[/:id]).",
    true,
  );

  // -------------------------------------------------------------------
  // K. Parámetros de auditoría
  // -------------------------------------------------------------------
  await measure("Entrar a Parámetros de auditoría", ZONE.parametrosAuditoria, false, async () => {
    await page.goto("/configuracion/parametros-auditoria");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const auditParamName = await page.locator("table tbody tr td").first().textContent().catch(() => null);
  if (auditParamName?.trim()) {
    await measure("Buscar en Parámetros de auditoría", ZONE.parametrosAuditoria, false, async () => {
      await page.getByPlaceholder("Buscar por codigo, nombre o modulo").fill(auditParamName.trim());
      return { visibleLocator: page.locator("table tbody tr, .empty").first(), notes: ["término tomado de un parámetro de auditoría real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Parámetros de auditoría", ZONE.parametrosAuditoria, "no hay ningún parámetro de auditoría en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Parámetros de auditoría por Módulo", ZONE.parametrosAuditoria, false, async () => {
    await page.getByLabel("Modulo").selectOption({ index: 1 });
    return { visibleLocator: page.locator("table tbody tr, .empty").first() };
  });

  // Etapa 14H.6: mismo criterio que Categorías documentales arriba — botón
  // "Cerrar" explícito confirmado en AuditParametersPage.tsx, editor 100%
  // local sin paneles anidados con fetch propio.
  const auditParamEditButton = page.getByRole("button", { name: "Editar" }).first();
  if (await auditParamEditButton.count()) {
    await measure("Abrir detalle de parámetro de auditoría (Editar)", ZONE.parametrosAuditoria, false, async () => {
      await auditParamEditButton.click();
      return { visibleLocator: page.getByRole("button", { name: "Cerrar" }) };
    });

    if (actions.at(-1)!.covered) {
      await measure("Cerrar detalle de parámetro de auditoría sin guardar", ZONE.parametrosAuditoria, false, async () => {
        await page.getByRole("button", { name: "Cerrar" }).first().click();
        return { hiddenLocator: page.getByRole("button", { name: "Cerrar" }) };
      });
    } else {
      skip("Cerrar detalle de parámetro de auditoría sin guardar", ZONE.parametrosAuditoria, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Abrir detalle de parámetro de auditoría (Editar)", ZONE.parametrosAuditoria, "no se encontró ningún parámetro de auditoría editable en el entorno actual");
    skip("Cerrar detalle de parámetro de auditoría sin guardar", ZONE.parametrosAuditoria, "depende de la acción anterior, salteada");
  }

  skip(
    "Crear parámetro de auditoría / Guardar cambios de parámetro",
    ZONE.parametrosAuditoria,
    "Prohibido por defecto — el editor se abre y se cierra sin tocar 'Guardar parametro' (POST/PATCH /audit-parameters[/:id]).",
    true,
  );

  // -------------------------------------------------------------------
  // L. Puestos (listado) — único submódulo de este journey con un botón
  // "Limpiar" filtros real; 3 GETs en el montaje.
  // -------------------------------------------------------------------
  await measure("Entrar a Puestos", ZONE.puestosListado, false, async () => {
    await page.goto("/puestos");
    return { visibleLocator: page.locator("h1").first(), emptyLocator: page.locator(".empty") };
  });

  const positionName = await page.locator("table.position-table tbody tr td").first().textContent().catch(() => null);
  if (positionName?.trim()) {
    await measure("Buscar en Puestos", ZONE.puestosListado, false, async () => {
      await page.getByPlaceholder("Buscar por nombre o codigo de puesto").fill(positionName.trim());
      return { visibleLocator: page.locator("table.position-table tbody tr, .empty").first(), notes: ["término tomado de un puesto real — no se registra el valor buscado en este reporte"], preNetworkIdleWaitMs: 400 };
    });
  } else {
    skip("Buscar en Puestos", ZONE.puestosListado, "no hay ningún puesto en el entorno actual para tomar un término real de búsqueda");
  }

  await measure("Filtrar Puestos por Sector", ZONE.puestosListado, false, async () => {
    await page.getByLabel("Sector").selectOption({ index: 1 });
    return { visibleLocator: page.locator("table.position-table tbody tr, .empty").first() };
  });

  const clearPuestoFilters = page.getByRole("button", { name: "Limpiar" });
  if (await clearPuestoFilters.count()) {
    await measure("Limpiar filtros en Puestos", ZONE.puestosListado, false, async () => {
      await clearPuestoFilters.first().click();
      return { visibleLocator: page.locator("table.position-table tbody tr, .empty").first() };
    });
  } else {
    skip("Limpiar filtros en Puestos", ZONE.puestosListado, "no se encontró el botón 'Limpiar' en el entorno actual");
  }

  const nextPageButton = page.getByRole("button", { name: "Siguiente" });
  const canPaginate = (await nextPageButton.count()) > 0 && (await nextPageButton.first().isEnabled().catch(() => false));
  if (canPaginate) {
    await measure("Paginar Puestos", ZONE.puestosListado, false, async () => {
      await nextPageButton.first().click();
      return { visibleLocator: page.locator("table.position-table tbody tr, .empty").first() };
    });
  } else {
    skip("Paginar Puestos", ZONE.puestosListado, "no hay una segunda página de puestos en el entorno actual (botón 'Siguiente' ausente o deshabilitado)");
  }

  skip("Crear puesto", ZONE.puestosListado, "Prohibido por defecto — es la puerta de entrada a un alta real (POST /positions), no se hace click.", true);
  skip("Inactivar/Activar/Eliminar puesto", ZONE.puestosListado, "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).", true);

  // -------------------------------------------------------------------
  // M. Puesto (detalle) — 2 GETs secuenciales (getById → getAssignedEmployees).
  // Volvemos a /puestos primero para partir de un estado limpio de filtros.
  // -------------------------------------------------------------------
  await page.goto("/puestos");
  await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);

  const positionDetailLink = page.getByRole("link", { name: "Ver detalle" }).first();
  const positionDetailHref = (await positionDetailLink.count()) ? await positionDetailLink.getAttribute("href") : null;
  if (positionDetailHref) {
    await measure("Ver detalle de puesto", ZONE.puestoDetalle, false, async () => {
      await page.goto(positionDetailHref);
      return { visibleLocator: page.locator("h1").first() };
    });

    if (actions.at(-1)!.covered) {
      const assignedTab = page.getByRole("button", { name: /Personas Asignadas/ });
      if (await assignedTab.count()) {
        await measure("Cambiar de pestaña en detalle de Puesto", ZONE.puestoDetalle, false, async () => {
          await assignedTab.click();
          return {
            visibleLocator: page.locator("h1").first(),
            preNetworkIdleWaitMs: 200,
            notes: ["cambio de pestaña 100% client-side — empleados asignados ya se cargó al entrar al detalle, no debería disparar un request nuevo"],
          };
        });
      } else {
        skip("Cambiar de pestaña en detalle de Puesto", ZONE.puestoDetalle, "no se encontró la pestaña 'Personas Asignadas' en el entorno actual");
      }
    } else {
      skip("Cambiar de pestaña en detalle de Puesto", ZONE.puestoDetalle, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Ver detalle de puesto", ZONE.puestoDetalle, "no se encontró ningún link 'Ver detalle' en el listado de Puestos en el entorno actual");
    skip("Cambiar de pestaña en detalle de Puesto", ZONE.puestoDetalle, "depende de la acción anterior, salteada");
  }

  skip("Guardar cambios en Puesto", ZONE.puestoDetalle, "Prohibido por defecto — acción de escritura (PATCH /positions/:id).", true);
  skip("Inactivar/Eliminar puesto (detalle)", ZONE.puestoDetalle, "Prohibido por defecto — acciones de escritura (PATCH /positions/:id, DELETE /positions/:id).", true);

  // -------------------------------------------------------------------
  // N. Puesto (creación, sólo navegación) — nunca se toca "Guardar puesto"
  // ni se usa .fill() en ningún campo del formulario.
  // -------------------------------------------------------------------
  await measure("Entrar a Crear puesto (sólo navegación, sin guardar)", ZONE.puestoCreacion, false, async () => {
    await page.goto("/puestos/nuevo");
    return {
      visibleLocator: page.locator("h1").first(),
      notes: ["visitar esta ruta dispara GET /positions (cálculo del próximo código correlativo) — es de sólo lectura, no persiste nada; probable cache hit si Puestos ya se visitó antes en este mismo recorrido (misma cachePolicies.positionsCatalog)"],
    };
  });

  const cancelLink = page.getByRole("link", { name: "Cancelar" });
  if (await cancelLink.count()) {
    await measure("Salir de Crear puesto sin guardar", ZONE.puestoCreacion, false, async () => {
      await cancelLink.first().click();
      return { visibleLocator: page.locator("h1").first() };
    });
  } else {
    skip("Salir de Crear puesto sin guardar", ZONE.puestoCreacion, "no se encontró el link 'Cancelar' en el entorno actual");
  }

  skip("Guardar puesto", ZONE.puestoCreacion, "Prohibido por defecto — crearía un puesto real (POST /positions). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente.", true);

  // -------------------------------------------------------------------
  // O. Tipo de novedad (detalle) — Etapa 14H.8: primera medición de esta
  // ruta (14H.1 la había dejado fuera del alcance macro). Único GET, sin
  // segundo fetch encadenado (a diferencia de Puesto/detalle). Volvemos a
  // /configuracion/tipos-novedades primero para partir de un estado limpio
  // de filtros (mismo criterio que Puesto/detalle, línea ~753).
  // -------------------------------------------------------------------
  await page.goto("/configuracion/tipos-novedades");
  await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);

  const noveltyTypeDetailLink = page.getByRole("link", { name: "Ver detalle" }).first();
  const noveltyTypeDetailHref = (await noveltyTypeDetailLink.count()) ? await noveltyTypeDetailLink.getAttribute("href") : null;
  if (noveltyTypeDetailHref) {
    await measure("Ver detalle de tipo de novedad", ZONE.noveltyTypeDetalle, false, async () => {
      await page.goto(noveltyTypeDetailHref);
      return { visibleLocator: page.locator("h1").first() };
    });

    if (actions.at(-1)!.covered) {
      const rulesTab = page.getByRole("button", { name: /Reglas operativas/ });
      if (await rulesTab.count()) {
        await measure("Cambiar de pestaña en detalle de Tipo de novedad", ZONE.noveltyTypeDetalle, false, async () => {
          await rulesTab.click();
          return {
            visibleLocator: page.locator("h1").first(),
            preNetworkIdleWaitMs: 200,
            notes: ["cambio de pestaña 100% client-side — el tipo de novedad ya se cargó al entrar al detalle (único fetch), no debería disparar un request nuevo"],
          };
        });
      } else {
        skip("Cambiar de pestaña en detalle de Tipo de novedad", ZONE.noveltyTypeDetalle, "no se encontró la pestaña 'Reglas operativas' en el entorno actual");
      }
    } else {
      skip("Cambiar de pestaña en detalle de Tipo de novedad", ZONE.noveltyTypeDetalle, "depende de la acción anterior, que falló");
    }
  } else {
    skip("Ver detalle de tipo de novedad", ZONE.noveltyTypeDetalle, "no se encontró ningún link 'Ver detalle' en el listado de Tipos de novedades en el entorno actual");
    skip("Cambiar de pestaña en detalle de Tipo de novedad", ZONE.noveltyTypeDetalle, "depende de la acción anterior, salteada");
  }

  skip("Guardar cambios en Tipo de novedad", ZONE.noveltyTypeDetalle, "Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).", true);
  skip("Activar/Inactivar/Ocultar tipo de novedad (detalle)", ZONE.noveltyTypeDetalle, "Prohibido por defecto — acción de escritura (PATCH /novelty-types/:id).", true);

  // -------------------------------------------------------------------
  // P. Tipo de novedad (creación, sólo navegación) — Etapa 14H.8: primera
  // medición de esta ruta. Nunca se toca "Guardar tipo" ni se usa .fill()
  // en ningún campo del formulario (mismo criterio que Puesto/creación).
  // -------------------------------------------------------------------
  await measure("Entrar a Crear tipo de novedad (sólo navegación, sin guardar)", ZONE.noveltyTypeCreacion, false, async () => {
    await page.goto("/configuracion/tipos-novedades/nuevo");
    return {
      visibleLocator: page.locator("h1").first(),
      notes: ["visitar esta ruta dispara GET /novelty-types (cálculo del próximo código correlativo) — es de sólo lectura, no persiste nada; probable cache hit si Tipos de novedades ya se visitó antes en este mismo recorrido (misma cachePolicies.noveltyTypesCatalog)"],
    };
  });

  const noveltyTypeCancelLink = page.getByRole("link", { name: "Cancelar" });
  if (await noveltyTypeCancelLink.count()) {
    await measure("Salir de Crear tipo de novedad sin guardar", ZONE.noveltyTypeCreacion, false, async () => {
      await noveltyTypeCancelLink.first().click();
      return { visibleLocator: page.locator("h1").first() };
    });
  } else {
    skip("Salir de Crear tipo de novedad sin guardar", ZONE.noveltyTypeCreacion, "no se encontró el link 'Cancelar' en el entorno actual");
  }

  skip("Guardar tipo de novedad", ZONE.noveltyTypeCreacion, "Prohibido por defecto — crearía un tipo de novedad real (POST /novelty-types). Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente.", true);

  // -------------------------------------------------------------------
  // Reporte final + asserts de seguridad/cobertura.
  // -------------------------------------------------------------------
  run.generatedAt = new Date().toISOString();

  // Se computa una sola vez y se reusa tanto para escribir el JSON como para
  // los asserts de abajo — evita recalcular la misma agregación dos veces.
  const report = buildJsonReport(run);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(MD_REPORT_PATH, buildMarkdownReport(run), "utf-8");
  fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  // Este journey es de sólo lectura por diseño — si algo lo rompe (una
  // escritura que se coló, un HTTP error real, un error de consola) el test
  // debe fallar de forma visible, no quedar como un reporte "verde" silencioso.
  expect(report.summary.httpErrors, "el journey no debe registrar HTTP errors").toBe(0);
  expect(report.summary.consoleErrors, "el journey no debe registrar console errors").toBe(0);
  expect(report.summary.coveredActions, "el journey debe cubrir acciones reales").toBeGreaterThan(0);
  expect(
    report.actions.filter((action) => action.isWrite && action.covered),
    "el journey no debe ejecutar acciones de escritura",
  ).toEqual([]);
});
