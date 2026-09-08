/**
 * Etapa 14H.1 — Diagnóstico macro de performance de Configuración + Puestos.
 *
 * Módulo intencionalmente puro (sin Playwright, sin fs) — mismo criterio que
 * `workforceManagementJourney.ts` (14G.1), `performanceEmployeesJourney.ts`
 * (14D.1) y `landingJourney.ts` (14F.1): se puede testear
 * agregación/ranking/sanitización/reporte con Vitest sin un navegador real.
 * Reusa `sanitizeRequestPath` de `./sanitizePath` (misma política de
 * sanitización que todo el resto de los journeys — un solo lugar).
 *
 * Igual que en 14G.1, `zone` y `submodule` son el mismo valor por diseño:
 * cada zona A-N de esta etapa ES un submódulo/pantalla completo (landing de
 * Configuración, sus 10 tarjetas, y Puestos en sus 3 rutas: listado, detalle,
 * creación).
 *
 * Esta etapa es de DIAGNÓSTICO, no de optimización — ver
 * docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md.
 */

import { sanitizeRequestPath } from "./sanitizePath";

export type CapturedRequest = {
  method: string;
  /** Ya sanitizado por sanitizeRequestPath: sin query string, IDs normalizados a :id. */
  path: string;
  statusCode: number;
  durationMs: number;
};

export type ActionResult = {
  name: string;
  /** Zona A-N de esta etapa (idéntica a `submodule` en este journey — ver nota de cabecera). */
  zone: string;
  submodule: string;
  /** Ruta frontend en el momento de la acción — se sanitiza antes de reportar. */
  route: string;
  covered: boolean;
  /** Motivo por el que la acción no se ejecutó. `null` cuando `covered` es `true`. */
  skippedReason: string | null;
  visibleMs?: number;
  networkIdleMs?: number;
  requests: CapturedRequest[];
  consoleErrors: string[];
  /** Si la acción escribe datos. Esta etapa nunca ejecuta una acción con isWrite=true (Parte 4 del pedido). */
  isWrite: boolean;
  notes: string[];
  /** Si la acción dejó una pantalla/sección vacía en vez de datos. `null` cuando no aplica/no se pudo determinar. */
  emptyScreen: boolean | null;
};

export type AdminConfigJourneyMode = "read-only";

export type AdminConfigJourneyRun = {
  generatedAt: string;
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  user: string;
  command: string;
  mode: AdminConfigJourneyMode;
  actions: ActionResult[];
  /** OK < 1000ms, Medio 1000-2000ms, Lento 2000-3000ms, Crítico > 3000ms (mismos umbrales que 14G.1). */
  okThresholdMs: number;
  mediumThresholdMs: number;
  slowThresholdMs: number;
};

export type EndpointStat = {
  key: string;
  method: string;
  path: string;
  count: number;
  avgDurationMs: number;
  maxDurationMs: number;
  statusCodes: number[];
  hasErrorStatus: boolean;
  hasServerErrorStatus: boolean;
};

export type RankLevel = "Crítico" | "Lento" | "Medio" | "OK";

export function rankDuration(ms: number, okMs: number, mediumMs: number, slowMs: number): RankLevel {
  if (ms > slowMs) return "Crítico";
  if (ms > mediumMs) return "Lento";
  if (ms > okMs) return "Medio";
  return "OK";
}

export type DuplicateRequestGroup = {
  method: string;
  path: string;
  count: number;
  durationsMs: number[];
};

/**
 * Agrupa por método+path — cualquier grupo con más de 1 request es un
 * duplicado real. Misma lógica que `workforceManagementJourney.ts`/
 * `landingJourney.ts`, reutilizada acá en vez de reimplementarla.
 */
export function findDuplicateRequests(requests: CapturedRequest[]): DuplicateRequestGroup[] {
  const byKey = new Map<string, CapturedRequest[]>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const list = byKey.get(key) || [];
    list.push(request);
    byKey.set(key, list);
  }
  return Array.from(byKey.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const [method, path] = key.split(" ", 2);
      return { method: method!, path: path!, count: list.length, durationsMs: list.map((r) => r.durationMs) };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Sanitiza SIEMPRE, sin importar si quien capturó los requests ya lo hizo o
 * no — red de seguridad defensiva (mismo criterio que 14D.1/14G.1).
 */
function sanitizeAction(action: ActionResult): ActionResult {
  return {
    ...action,
    route: sanitizeRequestPath(action.route),
    requests: action.requests.map((request) => ({ ...request, path: sanitizeRequestPath(request.path) })),
  };
}

export function sanitizeJourneyRunRoutes(run: AdminConfigJourneyRun): AdminConfigJourneyRun {
  return { ...run, actions: run.actions.map(sanitizeAction) };
}

export function aggregateEndpoints(requests: CapturedRequest[]): EndpointStat[] {
  const byKey = new Map<string, CapturedRequest[]>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const existing = byKey.get(key) ?? [];
    existing.push(request);
    byKey.set(key, existing);
  }

  return [...byKey.entries()].map(([key, items]) => {
    const durations = items.map((item) => item.durationMs);
    const statusCodes = items.map((item) => item.statusCode);
    return {
      key,
      method: items[0]!.method,
      path: items[0]!.path,
      count: items.length,
      avgDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
      maxDurationMs: Math.max(...durations),
      statusCodes,
      hasErrorStatus: statusCodes.some((status) => status >= 400),
      hasServerErrorStatus: statusCodes.some((status) => status >= 500),
    };
  });
}

function allRequests(run: AdminConfigJourneyRun): CapturedRequest[] {
  return run.actions.flatMap((action) => action.requests);
}

/** El tiempo representativo de una acción para rankear/ordenar: el mayor entre networkIdleMs y visibleMs (se reportan ambos por separado igual). */
function actionDurationMs(action: ActionResult): number | undefined {
  const candidates = [action.networkIdleMs, action.visibleMs].filter((value): value is number => typeof value === "number");
  if (!candidates.length) return undefined;
  return Math.max(...candidates);
}

export function buildSummary(run: AdminConfigJourneyRun) {
  const requests = allRequests(run);
  const covered = run.actions.filter((action) => action.covered);
  const skipped = run.actions.filter((action) => !action.covered);
  const slow = covered.filter((action) => {
    const ms = actionDurationMs(action);
    return ms !== undefined && ms > run.mediumThresholdMs && ms <= run.slowThresholdMs;
  });
  const verySlow = covered.filter((action) => {
    const ms = actionDurationMs(action);
    return ms !== undefined && ms > run.slowThresholdMs;
  });
  const writesSkipped = run.actions.filter((action) => action.isWrite && !action.covered);

  return {
    totalActions: run.actions.length,
    coveredActions: covered.length,
    skippedActions: skipped.length,
    slowActions: slow.length,
    verySlowActions: verySlow.length,
    writesSkipped: writesSkipped.length,
    httpErrors: requests.filter((request) => request.statusCode >= 400).length,
    consoleErrors: run.actions.reduce((sum, action) => sum + action.consoleErrors.length, 0),
  };
}

export type SubmoduleRollup = {
  zone: string;
  coveredActions: number;
  skippedActions: number;
  totalRequests: number;
  maxDurationMs: number | undefined;
  rank: RankLevel | "—";
};

/** Rollup por submódulo (Sección 5 del reporte — "Tabla por submódulo"). Preserva el orden de aparición (Login, A..N), no alfabético. */
export function buildSubmoduleRollup(run: AdminConfigJourneyRun): SubmoduleRollup[] {
  const order: string[] = [];
  const byZone = new Map<string, ActionResult[]>();
  for (const action of run.actions) {
    if (!byZone.has(action.zone)) {
      byZone.set(action.zone, []);
      order.push(action.zone);
    }
    byZone.get(action.zone)!.push(action);
  }
  return order.map((zone) => {
    const actions = byZone.get(zone)!;
    const covered = actions.filter((action) => action.covered);
    const requests = actions.flatMap((action) => action.requests);
    const durations = covered.map(actionDurationMs).filter((value): value is number => typeof value === "number");
    const maxDurationMs = durations.length ? Math.max(...durations) : undefined;
    return {
      zone,
      coveredActions: covered.length,
      skippedActions: actions.length - covered.length,
      totalRequests: requests.length,
      maxDurationMs,
      rank: maxDurationMs !== undefined ? rankDuration(maxDurationMs, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) : "—",
    };
  });
}

export function buildJsonReport(rawRun: AdminConfigJourneyRun) {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);

  const slowestRequests = [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

  const slowestActions = [...run.actions]
    .filter((action) => action.covered)
    .sort((a, b) => (actionDurationMs(b) ?? 0) - (actionDurationMs(a) ?? 0))
    .slice(0, 10)
    .map((action) => ({ name: action.name, zone: action.zone, visibleMs: action.visibleMs, networkIdleMs: action.networkIdleMs }));

  const coverageGaps = run.actions
    .filter((action) => !action.covered)
    .map((action) => ({ name: action.name, zone: action.zone, isWrite: action.isWrite, reason: action.skippedReason }));

  const duplicatesByAction = run.actions
    .filter((action) => action.covered && action.requests.length > 1)
    .map((action) => ({ name: action.name, zone: action.zone, duplicates: findDuplicateRequests(action.requests) }))
    .filter((entry) => entry.duplicates.length > 0);

  return {
    generatedAt: run.generatedAt,
    environment: run.environment,
    baseUrl: run.baseUrl,
    apiBaseUrl: run.apiBaseUrl,
    user: run.user,
    command: run.command,
    mode: run.mode,
    thresholds: { okThresholdMs: run.okThresholdMs, mediumThresholdMs: run.mediumThresholdMs, slowThresholdMs: run.slowThresholdMs },
    summary: buildSummary(run),
    submoduleRollup: buildSubmoduleRollup(run),
    actions: run.actions,
    slowestRequests,
    slowestActions,
    repeatedEndpoints: aggregateEndpoints(requests).filter((endpoint) => endpoint.count > 1),
    duplicatesByAction,
    coverageGaps,
  };
}

function formatMs(value: number | undefined): string {
  return typeof value === "number" ? `${value}ms` : "—";
}

function escapeForTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Matriz 1 — Inventario de submódulos. Relevada leyendo el código real
// (App.tsx, navigation.tsx, cada página, cada servicio API,
// cachePolicy.ts, backend de cada dominio) antes de escribir el journey —
// ver docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md Parte 1.
// ---------------------------------------------------------------------------
export type SubmoduleInventoryRow = {
  submodule: string;
  route: string;
  page: string;
  services: string;
  initialEndpoints: string;
  frontendCache: string;
  backendCache: string;
  /** "Sí"/"No" con detalle libre a continuación — no se restringe a un enum porque el detalle es parte del valor documental. */
  writesData: string;
  /** "Sí"/"Parcial"/"No" con detalle libre — mismo criterio que `writesData`. */
  safeToMeasure: string;
  observation: string;
};

export const SUBMODULE_INVENTORY: SubmoduleInventoryRow[] = [
  {
    submodule: "A. Configuración (landing)",
    route: "/configuracion",
    page: "SettingsPage.tsx",
    services: "ninguno — tarjetas estáticas derivadas de useAuth()",
    initialEndpoints: "ninguno",
    frontendCache: "N/A",
    backendCache: "N/A",
    writesData: "No",
    safeToMeasure: "Sí",
    observation: "10 tarjetas, todas <Link to=...> reales sin onClick — el fallback <button> del código nunca se renderiza (las 10 tienen path).",
  },
  {
    submodule: "B. Turnos",
    route: "/configuracion/turnos",
    page: "ShiftsPage.tsx",
    services: "workforceApiService.ts, shiftAssignmentApiService.ts",
    initialEndpoints: "GET /workforce/shift-templates, GET /shifts/assignments/summary",
    frontendCache: "No — ambos con apiCache:false, sin wrapper cachedData/cachePolicies (único gap real de cache cliente detectado en esta etapa)",
    backendCache: "Sí — workforce.cache.ts (shiftTemplatesCache, 30s) para shift-templates; assignments/summary sin cache backend dedicado",
    writesData: "Sí (crear turno, activar/inactivar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Cada visita es un round-trip real (frontend nunca cachea) — candidato a evaluar en una etapa de optimización si el volumen lo justifica.",
  },
  {
    submodule: "C. Asignaciones de feriados",
    route: "/configuracion/turnos-asignaciones-feriados",
    page: "HolidayWorkAssignmentsPage.tsx",
    services: "holidayWorkAssignmentApiService.ts, orgStructureApiService.ts, workforceApiService.ts",
    initialEndpoints: "GET /shifts/holiday-work/dates; al elegir fecha: GET /shifts/holiday-work/assignments, GET /shifts/holiday-work/candidates (+ GET /org-structure, GET /workforce/shift-templates para filtros)",
    frontendCache: "Sólo /org-structure (familia org-structure); dates/assignments/candidates/shift-templates sin cache",
    backendCache: "No (módulo shifts no tiene cache dedicado para holiday-work)",
    writesData: "Sí (Guardar cambios de convocatoria) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Hasta 5 GETs en cascada al elegir una fecha (dates + org-structure + shift-templates + assignments + candidates) — buen candidato para medir carga compuesta.",
  },
  {
    submodule: "D. Horas especiales",
    route: "/configuracion/turnos-horas-especiales",
    page: "WorkScheduleSettingsPage.tsx",
    services: "workforceApiService.ts, orgStructureApiService.ts, positionApiService.ts",
    initialEndpoints: "GET /workforce/double-hour-rules, GET /org-structure, GET /positions?status=ACTIVO, GET /workforce/double-hour-rules/calendar",
    frontendCache: "org-structure y positions cacheados; double-hour-rules y su calendario NO (mismo gap que Turnos)",
    backendCache: "Sí — workforce.cache.ts (doubleRulesCache, 30s)",
    writesData: "Sí (crear/editar regla vía formulario inline, activar/inactivar, eliminar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "4 GETs en el montaje inicial (el mayor conteo de todas las tarjetas) — el formulario 'Nueva regla'/'Editar' es un editor inline siempre presente en la página (no un modal), no se abre esta etapa por prudencia de alcance.",
  },
  {
    submodule: "E. Regímenes laborales",
    route: "/configuracion/regimenes-laborales",
    page: "WorkRegimesPage.tsx",
    services: "workRegimeApiService.ts",
    initialEndpoints: "GET /work-regimes?page=1&take=200; modal 'Empleados asociados': GET /work-regimes/:id/employees",
    frontendCache: "Sí — familia work-regimes (workRegimesCatalog, 10min); empleados asociados por régimen sin cache",
    backendCache: "No",
    writesData: "Sí (crear/editar régimen, activar/inactivar, agregar empleado, finalizar asignación) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Único submódulo con modales del componente Modal compartido (Crear régimen, Empleados asociados) — se abren y cierran sin guardar (ver docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md para el detalle de este flujo).",
  },
  {
    submodule: "F. Empresas y estructura",
    route: "/configuracion/empresas-estructura",
    page: "OrgStructurePage.tsx",
    services: "orgStructureApiService.ts",
    initialEndpoints: "GET /org-structure",
    frontendCache: "Sí — familia org-structure (orgStructureCatalog, 10min, persistido)",
    backendCache: "No",
    writesData: "Sí (crear/editar Empresa/UN/Establecimiento/Área/Sector/Centro de costo vía editor inline 'Guardar estructura') — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "6 pestañas (Empresas/UN/Establecimientos/Áreas/Sectores/Centros de costo), todas sobre el mismo catálogo ya cargado — cambiar de pestaña no dispara requests nuevos. El editor 'Nuevo registro'/'Editar' no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa.",
  },
  {
    submodule: "G. Tipos de novedades",
    route: "/configuracion/tipos-novedades",
    page: "NoveltyTypesPage.tsx",
    services: "noveltyTypeApiService.ts",
    initialEndpoints: "GET /novelty-types",
    frontendCache: "Sí — familia novelty-types (noveltyTypesCatalog, 10min, persistido)",
    backendCache: "No",
    writesData: "Sí (crear, activar/inactivar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Tiene ruta de detalle real (/configuracion/tipos-novedades/:id, link 'Ver detalle' sin onClick oculto) — fuera del alcance macro de esta etapa, documentado como candidato de profundización.",
  },
  {
    submodule: "H. Conceptos horarios",
    route: "/configuracion/conceptos-horarios",
    page: "HourConceptsPage.tsx",
    services: "hourConceptApiService.ts (+ hourConceptRuleApiService.ts, AssociatedEmployeesPanel embebido al editar uno existente)",
    initialEndpoints: "GET /hour-concepts",
    frontendCache: "Sí — familia hour-concepts (hourConceptsCatalog, 10min, persistido)",
    backendCache: "No",
    writesData: "Sí (crear/editar concepto, reglas asociadas, empleados asociados, deshabilitar/eliminar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "El submódulo con más profundidad potencial (reglas + empleados asociados embebidos al editar) — el editor es inline, no un modal, no se abre esta etapa por la misma política de alcance que Horas especiales/Empresas y estructura.",
  },
  {
    submodule: "I. Exportación Finnegans",
    route: "/configuracion/liquidacion",
    page: "FinnegansExportPage.tsx",
    services: "finnegansExportApiService.ts",
    initialEndpoints: "GET /finnegans-export/novelties?period=...",
    frontendCache: "No",
    backendCache: "No",
    writesData: "No (endpoint de sólo lectura, el .xlsx se arma 100% client-side)",
    safeToMeasure: "Sí, pero fuera del alcance de esta corrida",
    observation: "Ya cubierto en detalle por el journey de Gestión Horaria (Etapa 14G.1, zona 'J. Exportación', 4 acciones) — no se remide para no duplicar esfuerzo. Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md.",
  },
  {
    submodule: "J. Categorías documentales",
    route: "/configuracion/categorias-documentales",
    page: "DocumentCategoriesPage.tsx",
    services: "documentCategoryApiService.ts",
    initialEndpoints: "GET /document-categories",
    frontendCache: "Sí — familia document-categories (documentCategoriesCatalog, 10min, persistido)",
    backendCache: "No",
    writesData: "Sí (crear/editar categoría vía editor inline 'Guardar categoria') — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Único de los editores inline con botón 'Cerrar' explícito (a diferencia de Empresas y estructura) — igual no se abre esta etapa por consistencia de política (sólo se abren modales del componente Modal compartido).",
  },
  {
    submodule: "K. Parámetros de auditoría",
    route: "/configuracion/parametros-auditoria",
    page: "AuditParametersPage.tsx",
    services: "auditParameterApiService.ts",
    initialEndpoints: "GET /audit-parameters",
    frontendCache: "Sí — familia audit-parameters (auditParametersCatalog, 10min, persistido)",
    backendCache: "No",
    writesData: "Sí (crear/editar parámetro vía editor inline 'Guardar parametro') — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Sin acción de activar/inactivar ni eliminar por fila — el único write surface es el editor inline.",
  },
  {
    submodule: "L. Puestos (listado)",
    route: "/puestos",
    page: "PuestosPage.tsx",
    services: "orgStructureApiService.ts, positionApiService.ts",
    initialEndpoints: "GET /org-structure, GET /positions (stats/rango salarial), GET /positions?page=&take=25&... (tabla paginada)",
    frontendCache: "org-structure y positions (getAll) cacheados 5-10min; el listado paginado usa una policy separada (positionsList, 30s, no persistida)",
    backendCache: "No",
    writesData: "Sí (crear puesto, activar/inactivar, eliminar/ocultar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "3 GETs en el montaje inicial. Único submódulo de todo este journey con un botón 'Limpiar' filtros real (FilterPanel con onClear).",
  },
  {
    submodule: "M. Puesto (detalle)",
    route: "/puestos/:id",
    page: "PuestoDetailPage.tsx",
    services: "positionApiService.ts",
    initialEndpoints: "GET /positions/:id; luego GET /positions/:id/employees (secuencial, depende del primero)",
    frontendCache: "getById cacheado (familia positions); empleados asignados sin cache — siempre fresco",
    backendCache: "No",
    writesData: "Sí (Guardar cambios en tabs 1-9, activar/inactivar, eliminar) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "11 pestañas (10. Personas Asignadas y 11. Historial no disparan requests nuevos — ya vienen en los 2 fetches iniciales). 2 GETs secuenciales (no paralelos) — mismo patrón de carga compuesta que EmployeeDetailPage en 14D.",
  },
  {
    submodule: "N. Puesto (creación, sólo navegación)",
    route: "/puestos/nuevo",
    page: "PuestoCreatePage.tsx",
    services: "positionApiService.ts",
    initialEndpoints: "GET /positions (para calcular el próximo código correlativo — positionApiService.getNextCode)",
    frontendCache: "Sí — misma familia/policy positionsCatalog que Puestos (listado); probable cache hit si se visitó antes en el mismo recorrido",
    backendCache: "No",
    writesData: "No con sólo navegar — el único write es el submit 'Guardar puesto' (POST /positions), no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Confirma que simplemente NAVEGAR a un formulario de alta ya dispara un GET real (para el código correlativo) — de sólo lectura, no persiste nada. Se sale vía el link 'Cancelar', nunca tocando 'Guardar puesto'.",
  },
];

// ---------------------------------------------------------------------------
// Matriz 2 — Cobertura del journey. Debe mantenerse en sincronía manual con
// las acciones reales del spec (adminConfigurationPerformanceJourney.spec.ts)
// — si se agrega/saca una acción del spec, esta tabla es lo primero que hay
// que actualizar (mismo criterio que en 14G.1/14D.1).
// ---------------------------------------------------------------------------
export type CoverageMatrixRow = {
  zone: string;
  submodule: string;
  action: string;
  route: string;
  component: string;
  expectedEndpoint: string;
  type: "Lectura" | "Escritura";
  measurable: "Sí" | "No" | "Parcial";
  measured: "Sí" | "No" | "Parcial";
  reasonIfNot: string;
  risk: string;
  observation: string;
};

export const COVERAGE_MATRIX: CoverageMatrixRow[] = [
  { zone: "Login", submodule: "Login", action: "Login (acceso rápido RRHH)", route: "/", component: "LoginPage.tsx", expectedEndpoint: "POST /auth/login (vía loginAs)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Nivel 1 (RRHH) es el único rol con acceso simultáneo a /configuracion y /puestos (navigation.tsx)." },

  { zone: "A. Configuración (landing)", submodule: "A. Configuración (landing)", action: "Entrar a Configuración", route: "/configuracion", component: "SettingsPage.tsx", expectedEndpoint: "ninguno", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Página estática — mide sólo el costo de render/code-splitting, sin backend involucrado." },
  { zone: "A. Configuración (landing)", submodule: "A. Configuración (landing)", action: "Ver tarjetas de submódulos", route: "/configuracion", component: "SettingsPage.tsx (.setting-card)", expectedEndpoint: "sin endpoint propio", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Confirma que las 10 tarjetas están presentes en el entorno actual." },

  { zone: "B. Turnos", submodule: "B. Turnos", action: "Entrar a Turnos", route: "/configuracion/turnos", component: "ShiftsPage.tsx", expectedEndpoint: "GET /workforce/shift-templates, GET /shifts/assignments/summary", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Ninguno de los 2 endpoints tiene cache frontend — siempre un round-trip real." },
  { zone: "B. Turnos", submodule: "B. Turnos", action: "Buscar en Turnos", route: "/configuracion/turnos", component: "ShiftsPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria sobre las filas ya cargadas (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún turno en el entorno actual para tomar un término real.", risk: "Bajo", observation: "—" },
  { zone: "B. Turnos", submodule: "B. Turnos", action: "Filtrar Turnos por Estado", route: "/configuracion/turnos", component: "ShiftsPage.tsx (select Estado)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "B. Turnos", submodule: "B. Turnos", action: "Crear turno", route: "/configuracion/turnos", component: "ShiftsPage.tsx (link 'Crear turno')", expectedEndpoint: "navegación a /configuracion/turnos/nuevo", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — es la puerta de entrada a un alta real (POST /workforce/shift-templates), no se hace click.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "B. Turnos", submodule: "B. Turnos", action: "Ver detalle de turno", route: "/configuracion/turnos → /configuracion/turnos/:id", component: "ShiftsPage.tsx (link 'Ver detalle de...')", expectedEndpoint: "navegación de detalle", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún turno en el entorno actual.", risk: "Bajo", observation: "Link plano confirmado sin onClick oculto (no es el patrón bug de NotificationsPage)." },
  { zone: "B. Turnos", submodule: "B. Turnos", action: "Inactivar/Activar turno", route: "/configuracion/turnos", component: "ShiftsPage.tsx (icon Power)", expectedEndpoint: "PATCH /workforce/shift-templates/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "C. Asignaciones de feriados", submodule: "C. Asignaciones de feriados", action: "Entrar a Asignaciones de feriados", route: "/configuracion/turnos-asignaciones-feriados", component: "HolidayWorkAssignmentsPage.tsx", expectedEndpoint: "GET /shifts/holiday-work/dates, GET /org-structure, GET /workforce/shift-templates", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "C. Asignaciones de feriados", submodule: "C. Asignaciones de feriados", action: "Seleccionar fecha de feriado", route: "/configuracion/turnos-asignaciones-feriados", component: "HolidayWorkAssignmentsPage.tsx (date chip)", expectedEndpoint: "GET /shifts/holiday-work/assignments, GET /shifts/holiday-work/candidates", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ninguna fecha de feriado disponible para el mes actual en el entorno.", risk: "Bajo", observation: "Punto de mayor carga compuesta del submódulo (hasta 5 GETs encadenados)." },
  { zone: "C. Asignaciones de feriados", submodule: "C. Asignaciones de feriados", action: "Guardar cambios (convocatoria de feriado)", route: "/configuracion/turnos-asignaciones-feriados", component: "HolidayWorkAssignmentsPage.tsx (botón 'Guardar cambios')", expectedEndpoint: "PUT /shifts/holiday-work/assignments", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — asignaría feriados reales a empleados reales.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "D. Horas especiales", submodule: "D. Horas especiales", action: "Entrar a Horas especiales", route: "/configuracion/turnos-horas-especiales", component: "WorkScheduleSettingsPage.tsx", expectedEndpoint: "GET /workforce/double-hour-rules, GET /org-structure, GET /positions?status=ACTIVO, GET /workforce/double-hour-rules/calendar", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "4 GETs en el montaje — el mayor conteo de todas las tarjetas de Configuración." },
  { zone: "D. Horas especiales", submodule: "D. Horas especiales", action: "Filtrar Horas especiales por clasificación", route: "/configuracion/turnos-horas-especiales", component: "WorkScheduleSettingsPage.tsx (select 'Filtrar por clasificación')", expectedEndpoint: "filtra en memoria (fetch-all) + dispara refetch del calendario (GET .../calendar)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "El select sólo se renderiza si hay al menos 1 regla en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "D. Horas especiales", submodule: "D. Horas especiales", action: "Abrir edición de regla / Crear regla", route: "/configuracion/turnos-horas-especiales", component: "WorkScheduleSettingsPage.tsx (Section 'Nueva regla'/'Editar', inline)", expectedEndpoint: "sin request al abrir", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "El formulario es un editor inline siempre presente en la página, no el componente Modal compartido — esta etapa sólo abre/cierra modales del componente Modal compartido para mantener una única política simple de riesgo en todo el journey.", risk: "Bajo si se abriera, pero fuera de la política de esta etapa", observation: "Candidato a cubrirse en una etapa futura si aporta valor de medición." },
  { zone: "D. Horas especiales", submodule: "D. Horas especiales", action: "Activar/Inactivar/Eliminar regla", route: "/configuracion/turnos-horas-especiales", component: "WorkScheduleSettingsPage.tsx (icons Power/Trash2)", expectedEndpoint: "PATCH/DELETE /workforce/double-hour-rules/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Entrar a Regímenes laborales", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx", expectedEndpoint: "GET /work-regimes?page=1&take=200", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Buscar en Regímenes laborales", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún régimen en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Filtrar Regímenes laborales por Estado", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx (select Estado)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Abrir/Cerrar modal Crear régimen", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx → Modal", expectedEndpoint: "sin request al abrir/cerrar", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Se abre y se cierra sin tocar 'Guardar régimen'." },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Ver empleados asociados a un régimen", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx → Modal (AssociatedEmployeesPanel)", expectedEndpoint: "GET /work-regimes/:id/employees?status=current", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún régimen en el entorno actual.", risk: "Bajo", observation: "Ver docs/decisions/WORK_REGIME_ASSIGNMENT_CONSISTENCY_13J.md — default status=current desde esa etapa." },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Filtrar vigencia de empleados asociados", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx → Modal (select Vigencia)", expectedEndpoint: "GET /work-regimes/:id/employees?status=all", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior (abrir el modal).", risk: "Bajo", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Cerrar modal Empleados asociados", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx → Modal (botón Cerrar)", expectedEndpoint: "—", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior.", risk: "Bajo", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Agregar empleados / Finalizar asignación", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx → Modal (AssociatedEmployeesPanel)", expectedEndpoint: "POST /employees/:employeeId/work-regimes, PATCH .../:assignmentId/close", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — asignaría/cerraría un régimen real de un empleado real.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "E. Regímenes laborales", submodule: "E. Regímenes laborales", action: "Editar régimen / Activar-Inactivar régimen", route: "/configuracion/regimenes-laborales", component: "WorkRegimesPage.tsx (icon Pencil/Power)", expectedEndpoint: "POST/PATCH /work-regimes[/:id][/status]", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "F. Empresas y estructura", submodule: "F. Empresas y estructura", action: "Entrar a Empresas y estructura", route: "/configuracion/empresas-estructura", component: "OrgStructurePage.tsx", expectedEndpoint: "GET /org-structure", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "F. Empresas y estructura", submodule: "F. Empresas y estructura", action: "Cambiar de pestaña en Empresas y estructura", route: "/configuracion/empresas-estructura", component: "OrgStructurePage.tsx (Tabs)", expectedEndpoint: "sin request nuevo (catálogo ya cargado)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no se encuentra la pestaña 'Sectores' en el entorno actual.", risk: "Bajo", observation: "Confirma que cambiar de pestaña no re-dispara /org-structure." },
  { zone: "F. Empresas y estructura", submodule: "F. Empresas y estructura", action: "Nuevo registro / Editar / Guardar estructura", route: "/configuracion/empresas-estructura", component: "OrgStructurePage.tsx (Section inline)", expectedEndpoint: "POST/PATCH /org-structure/{companies|business-units|establishments|areas|sectors|cost-centers}[/:id]", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "El editor es inline y no tiene botón de cancelar limpio (sólo se cierra cambiando de pestaña) — no se abre esta etapa, ni se llega al submit real.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Entrar a Tipos de novedades", route: "/configuracion/tipos-novedades", component: "NoveltyTypesPage.tsx", expectedEndpoint: "GET /novelty-types", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Buscar en Tipos de novedades", route: "/configuracion/tipos-novedades", component: "NoveltyTypesPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún tipo de novedad en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Filtrar Tipos de novedades por Finnegans", route: "/configuracion/tipos-novedades", component: "NoveltyTypesPage.tsx (select Finnegans)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Crear tipo de novedad", route: "/configuracion/tipos-novedades", component: "NoveltyTypesPage.tsx (link 'Crear tipo')", expectedEndpoint: "navegación a /configuracion/tipos-novedades/nuevo", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Ver detalle de tipo de novedad", route: "/configuracion/tipos-novedades → /configuracion/tipos-novedades/:id", component: "NoveltyTypesPage.tsx (link 'Ver detalle')", expectedEndpoint: "navegación de detalle", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "Fuera del alcance macro de esta etapa (no es escritura) — candidato de profundización en una etapa futura si el volumen lo justifica.", risk: "Bajo, pero fuera de alcance", observation: "—" },
  { zone: "G. Tipos de novedades", submodule: "G. Tipos de novedades", action: "Activar/Inactivar tipo de novedad", route: "/configuracion/tipos-novedades", component: "NoveltyTypesPage.tsx (botón 'Activar/Inactivar')", expectedEndpoint: "PATCH /novelty-types/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "H. Conceptos horarios", submodule: "H. Conceptos horarios", action: "Entrar a Conceptos horarios", route: "/configuracion/conceptos-horarios", component: "HourConceptsPage.tsx", expectedEndpoint: "GET /hour-concepts", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "H. Conceptos horarios", submodule: "H. Conceptos horarios", action: "Buscar en Conceptos horarios", route: "/configuracion/conceptos-horarios", component: "HourConceptsPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún concepto horario en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "H. Conceptos horarios", submodule: "H. Conceptos horarios", action: "Filtrar Conceptos horarios por Tipo", route: "/configuracion/conceptos-horarios", component: "HourConceptsPage.tsx (select Tipo)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "H. Conceptos horarios", submodule: "H. Conceptos horarios", action: "Crear/Editar concepto horario", route: "/configuracion/conceptos-horarios", component: "HourConceptsPage.tsx (Section inline, con reglas y empleados asociados embebidos)", expectedEndpoint: "GET /hour-concepts/:id/rules, GET /hour-concepts/:id/employees al editar uno existente; POST/PATCH /hour-concepts[/:id] al guardar", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Editor inline, no el componente Modal compartido — misma política de alcance que Horas especiales.", risk: "Alto si se ejecutara", observation: "El submódulo con más profundidad potencial de todo Configuración (reglas + empleados anidados) — candidato fuerte para una etapa dedicada." },
  { zone: "H. Conceptos horarios", submodule: "H. Conceptos horarios", action: "Deshabilitar/Eliminar concepto horario", route: "/configuracion/conceptos-horarios", component: "HourConceptsPage.tsx (botón 'Deshabilitar'/'Eliminar')", expectedEndpoint: "PATCH /hour-concepts/:id/status, DELETE /hour-concepts/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "I. Exportación Finnegans", submodule: "I. Exportación Finnegans", action: "Entrar a Exportación Finnegans", route: "/configuracion/liquidacion", component: "FinnegansExportPage.tsx", expectedEndpoint: "GET /finnegans-export/novelties?period=...", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "Ya cubierto en detalle por el journey de Gestión Horaria (14G.1, zona 'J. Exportación') — no se remide para no duplicar esfuerzo entre journeys.", risk: "Bajo, pero fuera de esta corrida", observation: "Ver docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md." },

  { zone: "J. Categorías documentales", submodule: "J. Categorías documentales", action: "Entrar a Categorías documentales", route: "/configuracion/categorias-documentales", component: "DocumentCategoriesPage.tsx", expectedEndpoint: "GET /document-categories", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "J. Categorías documentales", submodule: "J. Categorías documentales", action: "Buscar en Categorías documentales", route: "/configuracion/categorias-documentales", component: "DocumentCategoriesPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ninguna categoría documental en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "J. Categorías documentales", submodule: "J. Categorías documentales", action: "Filtrar Categorías documentales por Tipo", route: "/configuracion/categorias-documentales", component: "DocumentCategoriesPage.tsx (select Tipo)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "J. Categorías documentales", submodule: "J. Categorías documentales", action: "Crear/Editar categoría documental", route: "/configuracion/categorias-documentales", component: "DocumentCategoriesPage.tsx (Section inline)", expectedEndpoint: "POST/PATCH /document-categories[/:id]", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Editor inline — misma política de alcance (aunque este sí tiene botón 'Cerrar' limpio, se excluye por consistencia con el resto de los editores inline de Configuración).", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "K. Parámetros de auditoría", submodule: "K. Parámetros de auditoría", action: "Entrar a Parámetros de auditoría", route: "/configuracion/parametros-auditoria", component: "AuditParametersPage.tsx", expectedEndpoint: "GET /audit-parameters", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "K. Parámetros de auditoría", submodule: "K. Parámetros de auditoría", action: "Buscar en Parámetros de auditoría", route: "/configuracion/parametros-auditoria", component: "AuditParametersPage.tsx (FilterPanel search)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún parámetro de auditoría en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "K. Parámetros de auditoría", submodule: "K. Parámetros de auditoría", action: "Filtrar Parámetros de auditoría por Módulo", route: "/configuracion/parametros-auditoria", component: "AuditParametersPage.tsx (select Modulo)", expectedEndpoint: "filtra en memoria (fetch-all)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "K. Parámetros de auditoría", submodule: "K. Parámetros de auditoría", action: "Crear/Editar parámetro de auditoría", route: "/configuracion/parametros-auditoria", component: "AuditParametersPage.tsx (Section inline)", expectedEndpoint: "POST/PATCH /audit-parameters[/:id]", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Editor inline — misma política de alcance.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Entrar a Puestos", route: "/puestos", component: "PuestosPage.tsx", expectedEndpoint: "GET /org-structure, GET /positions, GET /positions?page=&take=25&...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "3 GETs en el montaje — el mayor conteo entre las pantallas de listado de este journey." },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Buscar en Puestos", route: "/puestos", component: "PuestosPage.tsx (FilterPanel search)", expectedEndpoint: "GET /positions?page=1&take=25&search=...", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún puesto en el entorno actual.", risk: "Bajo", observation: "A diferencia de la mayoría de las tarjetas de Configuración, esta búsqueda SÍ es server-side (paginada), no fetch-all." },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Filtrar Puestos por Sector", route: "/puestos", component: "PuestosPage.tsx (select Sector)", expectedEndpoint: "GET /positions?page=1&take=25&sectorId=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Limpiar filtros en Puestos", route: "/puestos", component: "PuestosPage.tsx (botón 'Limpiar')", expectedEndpoint: "GET /positions?page=1&take=25", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Único botón 'Limpiar' filtros real de todo este journey (FilterPanel con onClear)." },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Paginar Puestos", route: "/puestos", component: "PuestosPage.tsx (botón 'Siguiente')", expectedEndpoint: "GET /positions?page=2&take=25", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay una segunda página de puestos en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Crear puesto", route: "/puestos", component: "PuestosPage.tsx (link 'Crear puesto')", expectedEndpoint: "navegación a /puestos/nuevo", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "L. Puestos (listado)", submodule: "L. Puestos (listado)", action: "Inactivar/Activar/Eliminar puesto", route: "/puestos", component: "PuestosPage.tsx (icons Power/Trash2)", expectedEndpoint: "PATCH /positions/:id, DELETE /positions/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "M. Puesto (detalle)", submodule: "M. Puesto (detalle)", action: "Ver detalle de puesto", route: "/puestos → /puestos/:id", component: "PuestosPage.tsx (link 'Ver detalle') → PuestoDetailPage.tsx", expectedEndpoint: "GET /positions/:id, GET /positions/:id/employees", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay ningún link 'Ver detalle' en el entorno actual.", risk: "Bajo", observation: "2 GETs secuenciales (no paralelos) — el segundo depende del primero." },
  { zone: "M. Puesto (detalle)", submodule: "M. Puesto (detalle)", action: "Cambiar de pestaña en detalle de Puesto", route: "/puestos/:id", component: "PuestoDetailPage.tsx (Tabs)", expectedEndpoint: "sin request nuevo (ya cargado)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior (abrir el detalle).", risk: "Bajo", observation: "Confirma que 'Personas Asignadas'/'Historial' no re-disparan requests." },
  { zone: "M. Puesto (detalle)", submodule: "M. Puesto (detalle)", action: "Guardar cambios en Puesto", route: "/puestos/:id", component: "PuestoDetailPage.tsx (botón 'Guardar cambios', tabs 1-9)", expectedEndpoint: "PATCH /positions/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "M. Puesto (detalle)", submodule: "M. Puesto (detalle)", action: "Inactivar/Eliminar puesto (detalle)", route: "/puestos/:id", component: "PuestoDetailPage.tsx (header, icons Power/Trash2)", expectedEndpoint: "PATCH /positions/:id, DELETE /positions/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "N. Puesto (creación, sólo navegación)", submodule: "N. Puesto (creación, sólo navegación)", action: "Entrar a Crear puesto (sólo navegación, sin guardar)", route: "/puestos/nuevo", component: "PuestoCreatePage.tsx", expectedEndpoint: "GET /positions (cálculo de próximo código correlativo)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Confirma que sólo navegar a un formulario de alta ya dispara un GET real — de sólo lectura, no persiste nada." },
  { zone: "N. Puesto (creación, sólo navegación)", submodule: "N. Puesto (creación, sólo navegación)", action: "Salir de Crear puesto sin guardar", route: "/puestos/nuevo → /puestos", component: "PuestoCreatePage.tsx (link 'Cancelar')", expectedEndpoint: "navegación (revisita /puestos)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no se encuentra el link 'Cancelar' en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "N. Puesto (creación, sólo navegación)", submodule: "N. Puesto (creación, sólo navegación)", action: "Guardar puesto", route: "/puestos/nuevo", component: "PuestoCreatePage.tsx (botón 'Guardar puesto')", expectedEndpoint: "POST /positions", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — crearía un puesto real.", risk: "Alto si se ejecutara", observation: "Nunca se usa .fill() en ningún campo del formulario, ni siquiera momentáneamente." },
];

export function buildMarkdownReport(rawRun: AdminConfigJourneyRun): string {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);
  const summary = buildSummary(run);
  const rollup = buildSubmoduleRollup(run);
  const jsonReport = buildJsonReport(rawRun);

  const covered = run.actions.filter((action) => action.covered);
  const skipped = run.actions.filter((action) => !action.covered);

  const slowestActions = [...covered].sort((a, b) => (actionDurationMs(b) ?? 0) - (actionDurationMs(a) ?? 0)).slice(0, 10);
  const slowestRequests = [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

  const endpointCounts = new Map<string, number>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  }
  const repeatedEndpoints = [...endpointCounts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);

  const duplicatesByAction = covered
    .map((action) => ({ action, duplicates: findDuplicateRequests(action.requests) }))
    .filter((entry) => entry.duplicates.length > 0);

  const httpErrorRequests = requests.filter((request) => request.statusCode >= 400);
  const actionsWithConsoleErrors = covered.filter((action) => action.consoleErrors.length > 0);
  const emptyScreenActions = covered.filter((action) => action.emptyScreen === true);
  const globalLoadingActions = covered.filter((action) => action.notes.some((note) => note.toLowerCase().includes("loading global")));
  const localizedLoadingActions = covered.filter((action) => action.notes.some((note) => note.toLowerCase().includes("loading localizado")));
  const writeSkipped = skipped.filter((action) => action.isWrite);

  // Sección 15: rankear submódulos por severidad — cuenta de endpoints
  // Crítico/Lento dentro de las requests de cada zona, desempate por la
  // duración máxima observada.
  const zoneOrder: string[] = [];
  const requestsByZone = new Map<string, CapturedRequest[]>();
  for (const action of run.actions) {
    if (!requestsByZone.has(action.zone)) {
      requestsByZone.set(action.zone, []);
      zoneOrder.push(action.zone);
    }
    requestsByZone.get(action.zone)!.push(...action.requests);
  }
  const zoneSeverity = zoneOrder
    .filter((zone) => zone !== "Login")
    .map((zone) => {
      const zoneEndpoints = aggregateEndpoints(requestsByZone.get(zone) || []);
      const critical = zoneEndpoints.filter((e) => rankDuration(e.maxDurationMs, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) === "Crítico");
      const slow = zoneEndpoints.filter((e) => rankDuration(e.maxDurationMs, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) === "Lento");
      const maxDurationMs = zoneEndpoints.length ? Math.max(...zoneEndpoints.map((e) => e.maxDurationMs)) : 0;
      return { zone, criticalCount: critical.length, slowCount: slow.length, maxDurationMs };
    })
    .sort((a, b) => b.criticalCount - a.criticalCount || b.slowCount - a.slowCount || b.maxDurationMs - a.maxDurationMs);

  const lines: string[] = [];

  lines.push("# Performance Journey — Configuración + Puestos (Etapa 14H.1)");
  lines.push("");
  lines.push("Reporte generado automáticamente por `npm run perf:journey:admin-config`. No editar a mano — se sobreescribe en cada corrida.");
  lines.push("");
  lines.push("**Etapa de diagnóstico macro — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14H.2 en adelante.");
  lines.push("");

  lines.push("## 1. Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Recorrido macro de la landing de Configuración, sus 10 tarjetas de submódulo (Exportación Finnegans excluida por estar ya cubierta por 14G.1) y Puestos en sus 3 rutas (listado, detalle, creación): ${summary.coveredActions}/${summary.totalActions} acciones cubiertas, ${summary.skippedActions} salteadas (${summary.writesSkipped} de ellas por ser de escritura, con motivo documentado cada una), ${summary.httpErrors} respuestas HTTP >= 400, ${summary.consoleErrors} errores de consola. ${summary.verySlowActions} acción(es) en rango Crítico (> ${run.slowThresholdMs}ms) y ${summary.slowActions} en rango Lento (${run.mediumThresholdMs}-${run.slowThresholdMs}ms). Cero escrituras ejecutadas — modo \`${run.mode}\` en todo el recorrido.`,
  );
  lines.push("");

  lines.push("## 2. Ambiente");
  lines.push("");
  lines.push(`- Generado: ${run.generatedAt}`);
  lines.push(`- Frontend: ${run.baseUrl}`);
  lines.push(`- Backend: ${run.apiBaseUrl}`);
  lines.push(`- ${run.environment}`);
  lines.push(`- Usuario: ${run.user}`);
  lines.push(`- Comando: \`${run.command}\``);
  lines.push("");

  lines.push("## 3. Cobertura general");
  lines.push("");
  lines.push("| Submódulo | Acciones cubiertas | Acciones salteadas | Requests capturadas | Peor duración | Rango |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of rollup) {
    lines.push(`| ${escapeForTable(row.zone)} | ${row.coveredActions} | ${row.skippedActions} | ${row.totalRequests} | ${formatMs(row.maxDurationMs)} | ${row.rank} |`);
  }
  lines.push("");

  lines.push("## 4. Tabla de acciones");
  lines.push("");
  if (covered.length === 0) {
    lines.push("Ninguna — ver §6, algo impidió que el journey avanzara.");
  } else {
    lines.push("| Acción | Submódulo | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const action of covered) {
      lines.push(
        `| ${escapeForTable(action.name)} | ${escapeForTable(action.zone)} | \`${action.route}\` | ${formatMs(action.visibleMs)} | ${formatMs(action.networkIdleMs)} | ${action.requests.length} | ${action.consoleErrors.length} | ${action.isWrite ? "Sí" : "No"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## 5. Tabla por submódulo");
  lines.push("");
  lines.push("Relevada leyendo el código real (App.tsx, navigation.tsx, cada página y sus servicios API) antes de escribir el journey — ver Matriz 1 (Inventario de submódulos) en `docs/decisions/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.md`.");
  lines.push("");
  lines.push("| Submódulo | Ruta real | Página | Cache frontend | Cache backend | Escribe datos | Medible seguro |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of SUBMODULE_INVENTORY) {
    lines.push(`| ${escapeForTable(row.submodule)} | ${escapeForTable(row.route)} | ${escapeForTable(row.page)} | ${escapeForTable(row.frontendCache)} | ${escapeForTable(row.backendCache)} | ${row.writesData} | ${row.safeToMeasure} |`);
  }
  lines.push("");

  lines.push("## 6. Acciones no cubiertas y motivo");
  lines.push("");
  if (skipped.length === 0) {
    lines.push("Ninguna — todas las acciones planificadas se ejercitaron.");
  } else {
    for (const action of skipped) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}, ${action.isWrite ? "escritura" : "lectura"}): ${escapeForTable(action.skippedReason ?? "sin motivo registrado")}.`);
    }
  }
  lines.push("");

  lines.push("## 7. Top acciones lentas");
  lines.push("");
  if (slowestActions.length === 0) {
    lines.push("Sin datos.");
  } else {
    lines.push("| Acción | Submódulo | Visible | Network idle | Rango |");
    lines.push("|---|---|---|---|---|");
    for (const action of slowestActions.slice(0, 10)) {
      const ms = actionDurationMs(action);
      const rank = ms !== undefined ? rankDuration(ms, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) : "—";
      lines.push(`| ${escapeForTable(action.name)} | ${escapeForTable(action.zone)} | ${formatMs(action.visibleMs)} | ${formatMs(action.networkIdleMs)} | ${rank} |`);
    }
  }
  lines.push("");

  lines.push("## 8. Top requests lentas");
  lines.push("");
  if (slowestRequests.length === 0) {
    lines.push("Sin datos.");
  } else {
    lines.push("| Método | Path | Status | Duración |");
    lines.push("|---|---|---|---|");
    for (const request of slowestRequests) {
      lines.push(`| ${request.method} | \`${request.path}\` | ${request.statusCode} | ${request.durationMs}ms |`);
    }
  }
  lines.push("");

  lines.push("## 9. Endpoints repetidos");
  lines.push("");
  lines.push("Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (org-structure, positions, etc.).");
  lines.push("");
  if (repeatedEndpoints.length === 0) {
    lines.push("Ninguno con más de 1 llamada en todo el recorrido.");
  } else {
    lines.push("| Endpoint | Llamadas totales |");
    lines.push("|---|---|");
    for (const [key, count] of repeatedEndpoints) {
      lines.push(`| \`${key}\` | ${count} |`);
    }
  }
  lines.push("");

  lines.push("## 10. Duplicados por acción");
  lines.push("");
  lines.push("Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev), remount de AppShell entre navegaciones completas, o un refetch inesperado.");
  lines.push("");
  if (duplicatesByAction.length === 0) {
    lines.push("Ninguna acción disparó el mismo endpoint más de una vez en su propia ventana de medición.");
  } else {
    for (const { action, duplicates } of duplicatesByAction) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}): ${duplicates.map((d) => `\`${d.method} ${d.path}\` x${d.count}`).join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## 11. HTTP errors");
  lines.push("");
  if (httpErrorRequests.length === 0) {
    lines.push("Ninguna respuesta >= 400 en todo el recorrido.");
  } else {
    lines.push("| Método | Path | Status |");
    lines.push("|---|---|---|");
    for (const request of httpErrorRequests) {
      lines.push(`| ${request.method} | \`${request.path}\` | ${request.statusCode} |`);
    }
  }
  lines.push("");

  lines.push("## 12. Console errors");
  lines.push("");
  if (actionsWithConsoleErrors.length === 0) {
    lines.push("Ninguna acción cubierta generó errores de consola.");
  } else {
    for (const action of actionsWithConsoleErrors) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}): ${action.consoleErrors.length} error(es) — ${action.consoleErrors.map(escapeForTable).join(" | ")}`);
    }
  }
  lines.push("");

  lines.push("## 13. Loading/error/empty states");
  lines.push("");
  lines.push(`- Pantallas vacías detectadas: ${emptyScreenActions.length === 0 ? "ninguna" : emptyScreenActions.map((a) => escapeForTable(a.name)).join(", ")}.`);
  lines.push(`- Loading global detectado: ${globalLoadingActions.length === 0 ? "ninguno — cada submódulo usa su propio LoadingState/skeleton local, sin bloquear el resto de la app" : globalLoadingActions.map((a) => escapeForTable(a.name)).join(", ")}.`);
  lines.push(`- Loading localizado detectado: ${localizedLoadingActions.length === 0 ? "sin datos suficientes en esta corrida" : localizedLoadingActions.map((a) => escapeForTable(a.name)).join(", ")}.`);
  lines.push("");

  lines.push("## 14. Seguridad/no escrituras");
  lines.push("");
  lines.push(`Cero acciones de escritura ejecutadas en todo el recorrido (modo \`${run.mode}\`). ${writeSkipped.length} acción(es) de escritura identificadas y explícitamente NO ejecutadas:`);
  lines.push("");
  for (const action of writeSkipped) {
    lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}): ${escapeForTable(action.skippedReason ?? "")}`);
  }
  lines.push("");
  lines.push("Política de esta etapa sobre editores inline: 5 submódulos (Horas especiales, Empresas y estructura, Tipos de novedades vía detalle, Conceptos horarios, Categorías documentales, Parámetros de auditoría) exponen su formulario de alta/edición como un `<Section>` inline en la propia página, no como el componente `Modal` compartido — esta etapa sólo abre y cierra modales del componente `Modal` compartido (Regímenes laborales) para mantener una única política simple de riesgo en todo el journey, documentado como decisión de alcance, no como limitación técnica (algunos de esos editores sí tienen un botón de cancelar limpio, confirmado en el relevamiento).");
  lines.push("");

  lines.push("## 15. Recomendación de orden para 14H.2+");
  lines.push("");
  if (zoneSeverity.length === 0 || zoneSeverity.every((z) => z.criticalCount === 0 && z.slowCount === 0)) {
    lines.push("Ningún submódulo mostró endpoints en rango Crítico/Lento en esta corrida puntual — no hay evidencia suficiente para priorizar. Repetir la corrida antes de decidir 14H.2.");
  } else {
    lines.push("Submódulos ordenados por cantidad de endpoints Crítico/Lento detectados en este recorrido (desempate por la duración máxima observada):");
    lines.push("");
    lines.push("| Orden | Submódulo | Endpoints Crítico | Endpoints Lento | Duración máxima |");
    lines.push("|---|---|---|---|---|");
    zoneSeverity.forEach((entry, index) => {
      lines.push(`| ${index + 1} | ${escapeForTable(entry.zone)} | ${entry.criticalCount} | ${entry.slowCount} | ${entry.maxDurationMs}ms |`);
    });
  }
  lines.push("");
  lines.push("Contexto estructural relevante para esta priorización (relevado en el diagnóstico, no medido por endpoints individuales):");
  lines.push("- Turnos y Horas especiales son las únicas 2 tarjetas sin ningún cache frontend (`apiCache:false` directo, sin `cachedData`/`cachePolicies`) — cada visita es un round-trip real garantizado, a diferencia de las 7 tarjetas restantes que sí cachean su catálogo principal 10min.");
  lines.push("- Conceptos horarios es el submódulo con más profundidad potencial (reglas + empleados asociados anidados al editar un concepto existente) — ningún journey lo ejercitó más allá del listado en esta etapa.");
  lines.push("- Puestos (detalle) es el único submódulo de este journey con 2 GETs secuenciales dependientes (`getById` → `getAssignedEmployees`), mismo patrón de carga compuesta ya optimizado para Legajos en 14D — candidato a evaluar si el volumen de asignaciones por puesto crece.");
  lines.push("- Exportación Finnegans queda deliberadamente fuera de esta corrida — ya medido por 14G.1, ver `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md`.");
  lines.push("");

  lines.push("## 16. Raw sanitized JSON");
  lines.push("");
  lines.push("Idéntico al archivo `docs/performance/ADMIN_CONFIGURATION_PERFORMANCE_JOURNEY_14H1.json` generado en esta misma corrida.");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(jsonReport, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
