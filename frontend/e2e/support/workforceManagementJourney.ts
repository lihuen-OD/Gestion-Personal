/**
 * Etapa 14G.1 — Diagnóstico macro de performance del módulo Gestión horaria.
 *
 * Módulo intencionalmente puro (sin Playwright, sin fs) — mismo criterio que
 * `performanceEmployeesJourney.ts` (14D.1) y `landingJourney.ts` (14F.1): se
 * puede testear agregación/ranking/sanitización/reporte con Vitest sin un
 * navegador real. Reusa `sanitizeRequestPath` de `./sanitizePath` (misma
 * política de sanitización que todo el resto de los journeys — un solo
 * lugar).
 *
 * A diferencia de 14D.1 (un módulo, varias pestañas), Gestión horaria son 10
 * submódulos con rutas propias — acá `zone` y `submodule` son el mismo valor
 * por diseño (cada zona A-J del pedido ES un submódulo completo, no una
 * subsección de uno solo). Se mantienen ambos campos porque la Parte 5 del
 * pedido los pide explícitamente por separado.
 *
 * Esta etapa es de MEDICIÓN, no de optimización — ver
 * docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md.
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
  /** Zona A-J del pedido (idéntica a `submodule` en este journey — ver nota de cabecera). */
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

export type WorkforceJourneyMode = "read-only";

export type WorkforceJourneyRun = {
  generatedAt: string;
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  user: string;
  command: string;
  mode: WorkforceJourneyMode;
  actions: ActionResult[];
  /** OK < 1000ms, Medio 1000-2000ms, Lento 2000-3000ms, Crítico > 3000ms (Parte 5 del pedido). */
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
 * duplicado real. Portado de `landingJourney.ts` (14F.1): misma lógica,
 * reutilizada acá en vez de reimplementarla (Parte 6, ítem 1 del pedido —
 * duplicados por StrictMode/remount son uno de los hallazgos explícitamente
 * pedidos).
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
 * no — red de seguridad defensiva (mismo criterio que 14D.1, donde una
 * corrida real filtró un UUID 47 veces porque sólo se sanitizaba `route`).
 */
function sanitizeAction(action: ActionResult): ActionResult {
  return {
    ...action,
    route: sanitizeRequestPath(action.route),
    requests: action.requests.map((request) => ({ ...request, path: sanitizeRequestPath(request.path) })),
  };
}

export function sanitizeJourneyRunRoutes(run: WorkforceJourneyRun): WorkforceJourneyRun {
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

function allRequests(run: WorkforceJourneyRun): CapturedRequest[] {
  return run.actions.flatMap((action) => action.requests);
}

/** El tiempo representativo de una acción para rankear/ordenar: el mayor entre networkIdleMs y visibleMs (se reportan ambos por separado igual). */
function actionDurationMs(action: ActionResult): number | undefined {
  const candidates = [action.networkIdleMs, action.visibleMs].filter((value): value is number => typeof value === "number");
  if (!candidates.length) return undefined;
  return Math.max(...candidates);
}

export function buildSummary(run: WorkforceJourneyRun) {
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

/** Rollup por submódulo (Sección 5 del reporte — "Tabla por submódulo"). Preserva el orden de aparición (Login, A..J), no alfabético. */
export function buildSubmoduleRollup(run: WorkforceJourneyRun): SubmoduleRollup[] {
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

export function buildJsonReport(rawRun: WorkforceJourneyRun) {
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
// Matriz 1 — Inventario de submódulos (Parte 2 del pedido).
// Relevada leyendo el código real (router, navegación, cada página, cada
// servicio API, backend de cada dominio) antes de escribir el journey — ver
// docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md Parte 1.
// ---------------------------------------------------------------------------
export type SubmoduleInventoryRow = {
  submodule: string;
  route: string;
  page: string;
  services: string;
  initialEndpoints: string;
  frontendCache: string;
  backendCache: string;
  /** "Sí"/"No" con detalle libre a continuación (ej. "Sí (aprobar cierre) — no ejecutado esta etapa") — no se restringe a un enum porque el detalle es parte del valor documental. */
  writesData: string;
  /** "Sí"/"Parcial"/"No" con detalle libre — mismo criterio que `writesData`. */
  safeToMeasure: string;
  observation: string;
};

export const SUBMODULE_INVENTORY: SubmoduleInventoryRow[] = [
  {
    submodule: "A. Inicio",
    route: "/gestion-horaria",
    page: "HourlyManagementHomePage.tsx",
    services: "timeEntryApiService.ts",
    initialEndpoints: "GET /time-entries/home-summary",
    frontendCache: "No",
    backendCache: "No",
    writesData: "No",
    safeToMeasure: "Sí",
    observation: "KPIs son <Link> sin fetch propio — no disparan requests adicionales.",
  },
  {
    submodule: "B. Asistencia",
    route: "/asistencia",
    page: "AttendancePage.tsx",
    services: "attendanceApiService.ts",
    initialEndpoints: "GET /time-entries/attendance?date=..., GET /time-entries/attendance/observations?...",
    frontendCache: "No (apiCache:false en ambos)",
    backendCache: "Sí — attendanceSummaryCache TTL 10s (sólo /attendance; /observations no tiene cache backend)",
    writesData: "Sí (cerrar jornada, olvido de salida, observar, resolver) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Poll silencioso cada 60s sin blanquear tablas (Etapa 9B); debounce 300ms en búsqueda de observaciones.",
  },
  {
    submodule: "C. Alertas de turnos",
    route: "/asistencia/alertas",
    page: "ShiftAlertsPage.tsx",
    services: "shiftAlertApiService.ts",
    initialEndpoints: "GET /shifts/alerts?...",
    frontendCache: "No",
    backendCache: "No (módulo shifts no tiene shifts.cache.ts)",
    writesData: "Sí (resolver alerta) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "Agrupación por workShiftId 100% client-side (13H). El journey 14B.3 midió este endpoint en 3906ms (Crítico) y nunca se revisó después — candidato fuerte para 14G.2+.",
  },
  {
    submodule: "D. Carga de horas",
    route: "/horas, /horas/:id",
    page: "HoursPage.tsx, EmployeeHoursPage.tsx",
    services: "timeEntryApiService.ts, orgStructureApiService.ts, employeeApiService.ts, noveltyApiService.ts",
    initialEndpoints: "GET /time-entries/period-employees, /time-entries/summary, /org-structure (grilla); GET /employees/:id/time-grid, /novelties?employeeId= (detalle)",
    frontendCache: "Sí — cachePolicies.timeEntriesAggregates 30s (period-employees/summary)",
    backendCache: "Sí — TTL 20s (period-employees, summary), 15s (list)",
    writesData: "Sí (guardar hora, desglose manual, submit) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "period-employees ya optimizado en 14C.2 (6447→4138ms) pero sigue en rango Crítico. Silent refresh ya implementado (Etapa 9F).",
  },
  {
    submodule: "E. Cierres mensuales",
    route: "/cierres",
    page: "MonthlyClosuresPage.tsx",
    services: "workforceApiService.ts, employeeApiService.ts",
    initialEndpoints: "GET /workforce/closures?period=..., /workforce/corrections, /employees/options",
    frontendCache: "No",
    backendCache: "No",
    writesData: "Sí (aprobar/enviar/devolver cierre, aprobar/rechazar corrección) — no ejecutado esta etapa",
    safeToMeasure: "Sí",
    observation: "closures sin paginación (trae todo el período); corrections con take:500 hardcodeado sin skip real — nunca medido por ningún journey previo (14B.3 no lo incluye).",
  },
  {
    submodule: "F. Bandeja de revisión",
    route: "/pendientes",
    page: "HoursPage.tsx (prop pendingOnly)",
    services: "timeEntryApiService.ts, pendingApiService.ts, noveltyApiService.ts, employeeApiService.ts, orgStructureApiService.ts",
    initialEndpoints: "GET /time-entries?status=EN_REVISION&view=..., /time-entries/summary, /pending, /org-structure",
    frontendCache: "Sí — cachePolicies.pendingQueue 30s (sólo /pending)",
    backendCache: "No",
    writesData: "Sí (aprobar/rechazar/devolver registro, novedad y desglose manual — 3 flujos distintos) — no ejecutado esta etapa",
    safeToMeasure: "Sí, con cuidado: los botones Aprobar/Rechazar/Devolver comparten aria-label genérico entre registro/novedad/desglose — el journey nunca usa un locator de rol sin scope (ver hallazgo en el reporte).",
    observation: "findManyByEmployeeGrouped (vista \"Por persona\") documentado 2 veces en 14C.2 como pendiente de optimizar ($transaction antipattern) — nunca corregido.",
  },
  {
    submodule: "G. Novedades",
    route: "/novedades",
    page: "NoveltiesPage.tsx",
    services: "noveltyApiService.ts (+ noveltyTypeApiService.ts, hourConceptApiService.ts en el modal de creación)",
    initialEndpoints: "GET /novelties?page=&take=&search=",
    frontendCache: "No (mutaciones invalidan family \"novelties\")",
    backendCache: "Sí — noveltiesListCache TTL 15s",
    writesData: "Sí (crear, aprobar, aprobar en lote, rechazar, eliminar) — no ejecutado esta etapa",
    safeToMeasure: "Sí (modal de creación se abre y cierra sin guardar)",
    observation: "bulk-approve tiene N+1 secuencial explícito en backend (novelties.service.ts) — no medible por este journey porque no se ejecuta.",
  },
  {
    submodule: "H. Notificaciones",
    route: "/notificaciones",
    page: "NotificationsPage.tsx",
    services: "workforceApiService.ts",
    initialEndpoints: "GET /workforce/notifications?page=&take=&status=",
    frontendCache: "No en el listado (el contador de AppShell sí cachea 20s, endpoint distinto)",
    backendCache: "No",
    writesData: "Sí (marcar como leída)",
    safeToMeasure: "Parcial",
    observation: "HALLAZGO: el link \"Ver detalle\" de cada fila dispara markRead() (POST /workforce/notifications/:id/read) como efecto colateral de un click de navegación — el journey evita TODO click de fila, sólo toca el filtro de Estado y \"Cargar más\".",
  },
  {
    submodule: "I. Fichador",
    route: "/fichador",
    page: "TimeClockPage.tsx",
    services: "timeClockApiService.ts",
    initialEndpoints: "Ninguno al montar — sólo reloj en vivo (setInterval de UI, sin red)",
    frontendCache: "No",
    backendCache: "No",
    writesData: "Sí (marcar ingreso/salida, foto-punch)",
    safeToMeasure: "Parcial (sólo carga inicial)",
    observation: "Categoría D de PERFORMANCE_STANDARDS.md — crítica, nunca cachear/optimizar sin etapa dedicada. Ruta pública protegida por x-clock-device-token + rate limit (30/5min); el journey no busca empleados para no arriesgar ese límite compartido con uso real.",
  },
  {
    submodule: "J. Exportación",
    route: "/configuracion/liquidacion",
    page: "FinnegansExportPage.tsx",
    services: "finnegansExportApiService.ts",
    initialEndpoints: "GET /finnegans-export/novelties?period=...",
    frontendCache: "No",
    backendCache: "No",
    writesData: "No (el endpoint es de sólo lectura — el .xlsx se arma 100% client-side)",
    safeToMeasure: "Sí (navegación/filtros); no descargar por defecto",
    observation: "Backend con take:10000 hardcodeado sin paginación (finnegansExport.repository.ts) — riesgo de over-fetch en organizaciones grandes, no medible por volumen real de datos de un solo usuario.",
  },
];

// ---------------------------------------------------------------------------
// Matriz 2 — Cobertura del journey (Parte 2 del pedido). Debe mantenerse en
// sincronía manual con las acciones reales del spec
// (workforceManagementPerformanceJourney.spec.ts) — si se agrega/saca una
// acción del spec, esta tabla es lo primero que hay que actualizar (mismo
// criterio que EMPLOYEES_MODULE_MATRIX en 14D.1).
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
  { zone: "Login", submodule: "Login", action: "Login (acceso rápido RRHH)", route: "/", component: "LoginPage.tsx", expectedEndpoint: "POST /auth/login (vía loginAs)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Mismo mecanismo que 14D.1/14F.1 — acceso rápido demo Nivel 1, sin credenciales reales." },

  { zone: "A. Inicio", submodule: "A. Inicio", action: "Entrar a Inicio (Gestión horaria)", route: "/gestion-horaria", component: "HourlyManagementHomePage.tsx", expectedEndpoint: "GET /time-entries/home-summary", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "A. Inicio", submodule: "A. Inicio", action: "Ver KPIs/resumen de Inicio", route: "/gestion-horaria", component: "HourlyManagementHomePage.tsx (.stat-grid)", expectedEndpoint: "sin endpoint propio", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Los StatLink son <Link>, no disparan un request nuevo — se confirma que no hay una llamada extra oculta." },

  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Entrar a Asistencia (carga inicial del día)", route: "/asistencia", component: "AttendancePage.tsx", expectedEndpoint: "GET /time-entries/attendance?date=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Cambiar fecha del día", route: "/asistencia", component: "AttendancePage.tsx (input date)", expectedEndpoint: "GET /time-entries/attendance?date=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Buscar en problemas de fichada", route: "/asistencia", component: "AttendancePage.tsx (observedQuery)", expectedEndpoint: "GET /time-entries/attendance/observations?search=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Debounce 300ms — término tomado en runtime, nunca inventado ni logueado." },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Filtrar problemas de fichada por tipo", route: "/asistencia", component: "AttendancePage.tsx (select observedType)", expectedEndpoint: "GET /time-entries/attendance/observations?type=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Limpiar filtros de problemas de fichada", route: "/asistencia", component: "AttendancePage.tsx (botón Limpiar)", expectedEndpoint: "GET /time-entries/attendance/observations", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Botón sólo aparece si hay algún filtro activo." },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Abrir detalle de tramos de una jornada cerrada", route: "/asistencia", component: "AttendancePage.tsx → Modal (WorkShiftSegmentsPanel)", expectedEndpoint: "sin endpoint propio (datos ya incluidos en el summary)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si el entorno no tiene ninguna jornada cerrada con tramos el día consultado.", risk: "Bajo", observation: "—" },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Cerrar detalle de tramos", route: "/asistencia", component: "AttendancePage.tsx (Modal close)", expectedEndpoint: "—", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior.", risk: "Bajo", observation: "—" },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Cerrar jornada manualmente / Marcar olvido de salida / Observar jornada", route: "/asistencia", component: "AttendancePage.tsx (Modal shiftAction)", expectedEndpoint: "POST /time-entries/work-shifts/:id/close-manual | missing-out | observe", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto (Parte 4 del pedido) — modifica jornadas reales de asistencia.", risk: "Alto si se ejecutara", observation: "Se agrupan las 3 acciones en una sola fila de matriz — comparten el mismo modal/mecanismo." },
  { zone: "B. Asistencia", submodule: "B. Asistencia", action: "Resolver problema de fichada", route: "/asistencia", component: "AttendancePage.tsx (Modal reviewAction)", expectedEndpoint: "POST /time-entries/attendance/observations/:kind/:id/resolve", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — cierra un caso de revisión real.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Entrar a Alertas de turnos", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx", expectedEndpoint: "GET /shifts/alerts?status=PENDIENTE&take=20", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Medido una vez en 14B.3 (3906ms, Crítico) y nunca revisitado — este journey vuelve a medirlo con datos frescos." },
  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Buscar alerta por texto", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx (FilterPanel search)", expectedEndpoint: "GET /shifts/alerts?search=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Debounce 300ms." },
  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Filtrar alertas por tipo", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx (select type)", expectedEndpoint: "GET /shifts/alerts?type=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Limpiar filtros de alertas", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx (FilterPanel onClear)", expectedEndpoint: "GET /shifts/alerts?status=PENDIENTE", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Expandir hallazgos asociados de un grupo", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx (toggle client-side)", expectedEndpoint: "sin endpoint propio (agrupación 100% client-side, Etapa 13H)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si ningún grupo tiene más de 1 alerta en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "C. Alertas de turnos", submodule: "C. Alertas de turnos", action: "Resolver alerta de turno", route: "/asistencia/alertas", component: "ShiftAlertsPage.tsx (Modal resolveTarget)", expectedEndpoint: "POST /shifts/alerts/:id/resolve", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — cierra una alerta real.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Entrar a Carga de horas (período actual)", route: "/horas", component: "HoursPage.tsx", expectedEndpoint: "GET /time-entries/period-employees, /time-entries/summary, /org-structure", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "period-employees es Crítico desde 14C.2 (4138ms tras optimizar) — candidato fuerte." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Cambiar período", route: "/horas", component: "HoursPage.tsx (input month)", expectedEndpoint: "GET /time-entries/period-employees?period=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Buscar empleado", route: "/horas", component: "HoursPage.tsx (SearchInput)", expectedEndpoint: "GET /time-entries/period-employees?search=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Término tomado de la primera fila real, nunca inventado ni logueado." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Limpiar búsqueda", route: "/horas", component: "HoursPage.tsx (SearchInput)", expectedEndpoint: "GET /time-entries/period-employees", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Abrir edición de horas de un empleado (navega a /horas/:id)", route: "/horas → /horas/:id", component: "HoursPage.tsx (link \"Cargar / Ver\") → EmployeeHoursPage.tsx", expectedEndpoint: "GET /employees/:id/time-grid?period=..., /novelties?employeeId=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Se usa el primer link real de la grilla, nunca un id inventado." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Ver total real/liquidable", route: "/horas/:id", component: "EmployeeHoursPage.tsx (StatCard)", expectedEndpoint: "sin endpoint propio (ya incluido en time-grid)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "La card \"Valor liquidable\" sólo aparece si el empleado tiene horas especiales adicionales el período consultado.", risk: "Bajo", observation: "\"Horas trabajadas\" (total real) siempre está presente." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Abrir edición de hora sin guardar", route: "/horas/:id", component: "EmployeeHoursPage.tsx (Modal día)", expectedEndpoint: "sin endpoint propio (modal usa datos ya cargados)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Se abre y se cierra sin tocar \"Guardar\"." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Cancelar edición de hora", route: "/horas/:id", component: "EmployeeHoursPage.tsx (botón Cancelar)", expectedEndpoint: "—", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Abrir conceptos adicionales (desglose manual) sin guardar", route: "/horas/:id", component: "EmployeeHoursPage.tsx (Modal desglose)", expectedEndpoint: "sin endpoint propio", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si el empleado/período no tiene ninguna fila de concepto editable manualmente.", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Cancelar conceptos adicionales", route: "/horas/:id", component: "EmployeeHoursPage.tsx (botón Cancelar)", expectedEndpoint: "—", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior.", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Volver a Carga de horas", route: "/horas/:id → /horas", component: "EmployeeHoursPage.tsx (back-link)", expectedEndpoint: "GET /time-entries/period-employees (revisita)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Guardar hora / Guardar desglose manual / Enviar a revisión", route: "/horas/:id", component: "EmployeeHoursPage.tsx (botones Guardar*)", expectedEndpoint: "POST/PATCH /time-entries, PUT /employees/:id/hour-concept-breakdowns/manual", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — cargaría horas reales, posiblemente asociadas a liquidación.", risk: "Alto si se ejecutara", observation: "3 endpoints agrupados en una fila — comparten el mismo criterio de exclusión." },
  { zone: "D. Carga de horas", submodule: "D. Carga de horas", action: "Exportar horas", route: "/horas", component: "HoursPage.tsx (botón \"Exportar horas\")", expectedEndpoint: "GET /time-entries/export?period=... (sólo lectura)", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "El endpoint es GET, pero el click dispara una descarga de archivo con datos de horas — prohibido por defecto (Parte 4: \"no generar exportación sensible\"/\"no descarga por defecto\").", risk: "Medio (descarga de datos, no persiste nada)", observation: "Se documenta como candidato para una etapa futura detrás de un flag explícito, no implementado acá." },

  { zone: "E. Cierres mensuales", submodule: "E. Cierres mensuales", action: "Entrar a Cierres mensuales (período actual)", route: "/cierres", component: "MonthlyClosuresPage.tsx", expectedEndpoint: "GET /workforce/closures?period=..., /workforce/corrections, /employees/options", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Nunca medido por ningún journey previo — closures no pagina (trae todo el período)." },
  { zone: "E. Cierres mensuales", submodule: "E. Cierres mensuales", action: "Cambiar período", route: "/cierres", component: "MonthlyClosuresPage.tsx (input month)", expectedEndpoint: "GET /workforce/closures?period=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "corrections y employees/options no dependen del período elegido — se re-piden igual (over-fetch potencial, ver reporte)." },
  { zone: "E. Cierres mensuales", submodule: "E. Cierres mensuales", action: "Aprobar seleccionados / Enviar cierre a RH / Devolver cierre", route: "/cierres", component: "MonthlyClosuresPage.tsx", expectedEndpoint: "POST /workforce/closures/approve | submit | :id/return", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — cierra/reabre un período real de liquidación.", risk: "Alto si se ejecutara", observation: "3 endpoints agrupados en una fila." },
  { zone: "E. Cierres mensuales", submodule: "E. Cierres mensuales", action: "Aprobar/Rechazar corrección", route: "/cierres", component: "MonthlyClosuresPage.tsx", expectedEndpoint: "POST /workforce/corrections/:id/approve | reject", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Entrar a Bandeja de revisión (Por registro)", route: "/pendientes", component: "HoursPage.tsx (pendingOnly)", expectedEndpoint: "GET /time-entries?status=EN_REVISION&view=byEmployee, /time-entries/summary, /pending, /org-structure", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Cambiar a pestaña \"Por persona\"", route: "/pendientes", component: "HoursPage.tsx (Tabs)", expectedEndpoint: "GET /time-entries?view=byEmployee (findManyByEmployeeGrouped)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Vista con el $transaction antipattern documentado 2 veces en 14C.2, nunca corregido — candidato fuerte." },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Buscar en Bandeja de revisión", route: "/pendientes", component: "HoursPage.tsx (SearchInput)", expectedEndpoint: "GET /time-entries?search=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Cambiar período", route: "/pendientes", component: "HoursPage.tsx (input month)", expectedEndpoint: "GET /time-entries?period=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Abrir detalle (Ver detalle, Por persona)", route: "/pendientes → /horas/:id", component: "HoursPage.tsx (link \"Ver detalle\") → EmployeeHoursPage.tsx", expectedEndpoint: "GET /employees/:id/time-grid?period=...", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "El link \"Ver detalle\" sólo existe en la pestaña \"Por persona\" y sólo si hay al menos una fila.", risk: "Bajo", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Volver a Bandeja de revisión", route: "/horas/:id → /pendientes", component: "EmployeeHoursPage.tsx (back-link)", expectedEndpoint: "GET /time-entries?view=byEmployee (revisita)", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Depende de la acción anterior.", risk: "Bajo", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Aprobar/Rechazar/Devolver registro", route: "/pendientes", component: "HoursPage.tsx (aria-label=\"Aprobar\"/\"Rechazar\"/\"Devolver\")", expectedEndpoint: "POST /time-entries/:id/approve | reject | return", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "HALLAZGO: aria-label genérico compartido entre filas de registro/novedad/desglose — el journey nunca usa un locator de rol sin scope explícito para evitar clicks accidentales." },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Aprobar/Rechazar novedad (desde Bandeja)", route: "/pendientes", component: "HoursPage.tsx (aria-label=\"Aprobar novedad\"/\"Rechazar novedad\")", expectedEndpoint: "POST /novelties/:id/approve | reject", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "F. Bandeja de revisión", submodule: "F. Bandeja de revisión", action: "Aprobar/Rechazar/Devolver desglose manual", route: "/pendientes", component: "HoursPage.tsx (aria-label=\"...desglose\")", expectedEndpoint: "POST /employees/:employeeId/hour-concept-breakdowns/manual/:id/approve | reject | return", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },

  { zone: "G. Novedades", submodule: "G. Novedades", action: "Entrar a Novedades", route: "/novedades", component: "NoveltiesPage.tsx", expectedEndpoint: "GET /novelties?page=1&take=25", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Buscar en Novedades", route: "/novedades", component: "NoveltiesPage.tsx (FilterPanel search)", expectedEndpoint: "GET /novelties?search=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Debounce por defecto (useDebouncedValue)." },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Abrir modal \"Nueva novedad\" sin guardar", route: "/novedades", component: "NoveltiesPage.tsx → NoveltyModal.tsx", expectedEndpoint: "GET /novelty-types, /hour-concepts (catálogos del modal)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Catálogos se piden recién al abrir el modal (lazy)." },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Cancelar \"Nueva novedad\"", route: "/novedades", component: "NoveltyModal.tsx (Modal close)", expectedEndpoint: "—", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Se cierra sin tocar ningún campo obligatorio ni el botón de guardar." },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Guardar nueva novedad", route: "/novedades", component: "NoveltyModal.tsx", expectedEndpoint: "POST /novelties", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — crearía una novedad real (licencia/ausencia) para un empleado real.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Aprobar/Rechazar/Eliminar novedad", route: "/novedades", component: "NoveltyTable.tsx", expectedEndpoint: "POST /novelties/:id/approve | reject, DELETE /novelties/:id", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "3 endpoints agrupados en una fila." },
  { zone: "G. Novedades", submodule: "G. Novedades", action: "Aprobar pendientes visibles (bulk)", route: "/novedades", component: "NoveltiesPage.tsx (botón bulk)", expectedEndpoint: "POST /novelties/bulk-approve", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "Backend hace N+1 secuencial (novelties.service.ts) — no medible sin ejecutarlo, documentado como candidato." },

  { zone: "H. Notificaciones", submodule: "H. Notificaciones", action: "Entrar a Notificaciones (Todas)", route: "/notificaciones", component: "NotificationsPage.tsx", expectedEndpoint: "GET /workforce/notifications?page=1&take=20", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "H. Notificaciones", submodule: "H. Notificaciones", action: "Filtrar por \"No leídas\"", route: "/notificaciones", component: "NotificationsPage.tsx (select Estado)", expectedEndpoint: "GET /workforce/notifications?status=NO_LEIDA", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "H. Notificaciones", submodule: "H. Notificaciones", action: "Cargar más notificaciones", route: "/notificaciones", component: "NotificationsPage.tsx (botón \"Cargar X más\")", expectedEndpoint: "GET /workforce/notifications?page=2", type: "Lectura", measurable: "Sí", measured: "Parcial", reasonIfNot: "Se saltea si no hay una segunda página en el entorno actual.", risk: "Bajo", observation: "—" },
  { zone: "H. Notificaciones", submodule: "H. Notificaciones", action: "Marcar como leída / Ver detalle", route: "/notificaciones", component: "NotificationsPage.tsx (botón \"Marcar leída\" y link \"Ver detalle\")", expectedEndpoint: "POST /workforce/notifications/:id/read", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "HALLAZGO CRÍTICO PARA EL JOURNEY: \"Ver detalle\" es un <Link> de navegación cuyo onClick también llama markRead() — parece lectura pero escribe. El journey no hace click en NINGUNA fila de esta pantalla, sólo en el filtro y en \"Cargar más\"." },

  { zone: "I. Fichador", submodule: "I. Fichador", action: "Entrar a Fichador (carga inicial)", route: "/fichador", component: "TimeClockPage.tsx", expectedEndpoint: "ninguno al montar", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "I. Fichador", submodule: "I. Fichador", action: "Buscar empleado en Fichador", route: "/fichador", component: "TimeClockPage.tsx (input búsqueda)", expectedEndpoint: "GET /time-entries/clock/employees?search=...", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "Fuera del alcance mínimo pedido para Fichador (Parte 6, Zona I sólo pide \"entrar\" y \"medir carga inicial\", dado el perfil de riesgo del kiosco: sin auth de usuario, cámara, rate-limit compartido con uso real de 30/5min).", risk: "Bajo si se ejecutara, pero fuera de alcance", observation: "—" },
  { zone: "I. Fichador", submodule: "I. Fichador", action: "Marcar ingreso", route: "/fichador", component: "TimeClockPage.tsx", expectedEndpoint: "POST /time-entries/clock/photo-punch (vía FaceCaptureModal)", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — fichada real de un empleado real.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "I. Fichador", submodule: "I. Fichador", action: "Marcar salida", route: "/fichador", component: "TimeClockPage.tsx", expectedEndpoint: "POST /time-entries/clock/photo-punch (vía FaceCaptureModal)", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto.", risk: "Alto si se ejecutara", observation: "—" },
  { zone: "I. Fichador", submodule: "I. Fichador", action: "Capturar foto / enviar punch", route: "/fichador", component: "FaceCaptureModal.tsx", expectedEndpoint: "POST /time-entries/clock/photo-punch", type: "Escritura", measurable: "Sí", measured: "No", reasonIfNot: "Prohibido por defecto — el pedido explícitamente prohíbe aceptar permisos de cámara o ejecutar la acción.", risk: "Alto si se ejecutara", observation: "El journey nunca hace click en \"Marcar ingreso\"/\"Marcar salida\", por lo que este modal nunca llega a abrirse." },

  { zone: "J. Exportación", submodule: "J. Exportación", action: "Entrar a Exportación (período actual)", route: "/configuracion/liquidacion", component: "FinnegansExportPage.tsx", expectedEndpoint: "GET /finnegans-export/novelties?period=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "Sólo accesible para Nivel 1 (RRHH) — coincide con el usuario del journey." },
  { zone: "J. Exportación", submodule: "J. Exportación", action: "Cambiar período", route: "/configuracion/liquidacion", component: "FinnegansExportPage.tsx (input month)", expectedEndpoint: "GET /finnegans-export/novelties?period=...", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "J. Exportación", submodule: "J. Exportación", action: "Buscar en Exportación", route: "/configuracion/liquidacion", component: "FinnegansExportPage.tsx (FilterPanel search)", expectedEndpoint: "sin endpoint propio (filtra en memoria sobre las filas ya cargadas)", type: "Lectura", measurable: "Sí", measured: "Sí", reasonIfNot: "—", risk: "Bajo", observation: "—" },
  { zone: "J. Exportación", submodule: "J. Exportación", action: "Exportar Excel Finnegans", route: "/configuracion/liquidacion", component: "FinnegansExportPage.tsx (botón)", expectedEndpoint: "sin request — build 100% client-side con xlsx", type: "Lectura", measurable: "Sí", measured: "No", reasonIfNot: "No es una escritura de API, pero genera y descarga un archivo con datos de novedades reales — prohibido por defecto (Parte 4: \"no generar exportación sensible\"/\"no descarga por defecto\").", risk: "Medio (descarga de datos, no persiste nada en el servidor)", observation: "—" },
];

export function buildMarkdownReport(rawRun: WorkforceJourneyRun): string {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);
  const endpoints = aggregateEndpoints(requests);
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

  lines.push("# Performance Journey — Gestión horaria (Etapa 14G.1)");
  lines.push("");
  lines.push("Reporte generado automáticamente por `npm run perf:journey:workforce`. No editar a mano — se sobreescribe en cada corrida.");
  lines.push("");
  lines.push("**Etapa de diagnóstico/medición — no de optimización.** Ningún hallazgo de este reporte se corrigió en esta etapa; ver §15 para el orden recomendado de 14G.2 en adelante.");
  lines.push("");

  lines.push("## 1. Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Recorrido macro de los 10 submódulos de Gestión horaria: ${summary.coveredActions}/${summary.totalActions} acciones cubiertas, ${summary.skippedActions} salteadas (${summary.writesSkipped} de ellas por ser de escritura, con motivo documentado cada una), ${summary.httpErrors} respuestas HTTP >= 400, ${summary.consoleErrors} errores de consola. ${summary.verySlowActions} acción(es) en rango Crítico (> ${run.slowThresholdMs}ms) y ${summary.slowActions} en rango Lento (${run.mediumThresholdMs}-${run.slowThresholdMs}ms). Cero escrituras ejecutadas — modo \`${run.mode}\` en todo el recorrido.`,
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
  lines.push("Relevada leyendo el código real (router, navegación, cada página y sus servicios API) antes de escribir el journey — ver Matriz 1 (Inventario de submódulos) en `docs/decisions/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.md`.");
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
  lines.push("Mismo endpoint (método+path) pedido más de una vez a lo largo de TODO el recorrido, sin importar desde qué submódulo — detecta catálogos/endpoints compartidos entre submódulos (ítem 13 de la Parte 6 del pedido).");
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
  lines.push("Mismo endpoint pedido más de una vez DENTRO de la ventana de una sola acción — señal de StrictMode (double-invoke en dev) o de un remount/refetch inesperado (ítems 1-2 de la Parte 6 del pedido).");
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
  lines.push(`- Loading global detectado: ${globalLoadingActions.length === 0 ? "ninguno — cada submódulo usa su propio LoadingState/skeleton local, sin bloquear el resto de la app (Suspense de code-splitting entre rutas aparte)" : globalLoadingActions.map((a) => escapeForTable(a.name)).join(", ")}.`);
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
  lines.push("Hallazgo de seguridad adicional: en Notificaciones, el link \"Ver detalle\" dispara `POST /workforce/notifications/:id/read` como efecto colateral de un click de navegación — no es sólo un botón explícito de \"Marcar leída\" lo que escribe. El journey evita todo click de fila en esa pantalla (ver Matriz 1, fila H).");
  lines.push("");

  lines.push("## 15. Recomendación de orden para 14G.2+");
  lines.push("");
  if (zoneSeverity.length === 0 || zoneSeverity.every((z) => z.criticalCount === 0 && z.slowCount === 0)) {
    lines.push("Ningún submódulo mostró endpoints en rango Crítico/Lento en esta corrida puntual — no hay evidencia suficiente para priorizar. Repetir la corrida antes de decidir 14G.2.");
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
  lines.push("Contexto histórico relevante para esta priorización (no medido por este journey, ya documentado en etapas previas):");
  lines.push("- `GET /shifts/alerts` (Alertas de turnos) fue medido en 3906ms (Crítico) por el journey general 14B.3 y nunca se revisó desde entonces.");
  lines.push("- `findManyByEmployeeGrouped` (Bandeja de revisión, vista \"Por persona\") usa el mismo antipatrón `$transaction` ya corregido en otros endpoints por 14C.2 — documentado 2 veces como pendiente, nunca corregido.");
  lines.push("- `GET /workforce/closures` y `GET /workforce/corrections` (Cierres mensuales) nunca fueron medidos por ningún journey anterior a 14G.1.");
  lines.push("- Fichador queda deliberadamente fuera de cualquier ranking de optimización — ver `docs/PERFORMANCE_STANDARDS.md` §10 (categoría crítica D, no optimizar sin etapa dedicada).");
  lines.push("");

  lines.push("## 16. Raw sanitized JSON");
  lines.push("");
  lines.push("Idéntico al archivo `docs/performance/WORKFORCE_MANAGEMENT_PERFORMANCE_JOURNEY_14G1.json` generado en esta misma corrida.");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(jsonReport, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
