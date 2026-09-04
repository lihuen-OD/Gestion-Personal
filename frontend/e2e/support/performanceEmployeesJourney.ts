/**
 * Etapa 14D.1 — Performance Journey específico del módulo Legajos.
 *
 * Módulo intencionalmente puro (sin Playwright, sin fs) para poder testear la
 * agregación, el ranking y la sanitización con Vitest — mismo criterio que
 * `reportBuilder.ts` (Etapa 14B.3). Reusa `sanitizeRequestPath` de
 * `./sanitizePath` (misma política de sanitización, un solo lugar).
 *
 * A diferencia del journey general (14B.3, por PANTALLA), este journey mide
 * por ACCIÓN — una pantalla puede disparar varias acciones (entrar, abrir un
 * historial, cerrarlo, abrir un modal de edición) y cada una se reporta por
 * separado, con su propia ventana de captura de requests/errores.
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
  zone: string;
  /** Ruta frontend en el momento de la acción — se sanitiza antes de reportar (mismo criterio que los requests). */
  route: string;
  covered: boolean;
  /** Motivo por el que la acción no se pudo/debió ejercitar. `null` cuando `covered` es `true`. */
  skippedReason: string | null;
  /** Tiempo hasta que el elemento principal de la acción quedó visible (proxy de "la UI ya muestra algo útil"). */
  visibleMs?: number;
  /** Tiempo hasta que la red quedó inactiva tras la acción — puede ser mayor a `visibleMs` si hay datos secundarios/precarga cargando de fondo (ver notes). */
  networkIdleMs?: number;
  requests: CapturedRequest[];
  consoleErrors: string[];
  notes: string[];
  /** Parte 2, ítem 15: si la acción fue de lectura o de escritura. Esta etapa es de medición — ver Parte 3 del pedido — así que hoy siempre es `false` salvo que se documente lo contrario. */
  isWrite: boolean;
  /** Parte 2, ítem 14: si hubo un refetch completo disparado por esta acción (además de la carga inicial esperada). `null` cuando no aplica/no se pudo determinar. */
  hadRefetch: boolean | null;
  /** Parte 2, ítem 12: si la acción dejó una pantalla/sección vacía (EmptyState) en vez de datos. `null` cuando no aplica. */
  emptyScreen: boolean | null;
};

export type EmployeesJourneyMode = "read-only" | "write-safe";

export type EmployeesJourneyRun = {
  generatedAt: string;
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  user: string;
  command: string;
  mode: EmployeesJourneyMode;
  actions: ActionResult[];
  /** Parte 7: OK < 1000ms, Medio 1000-2000ms, Lento 2000-3000ms, Crítico > 3000ms. */
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
const RANK_ORDER: RankLevel[] = ["Crítico", "Lento", "Medio", "OK"];

/**
 * Parte 7 del pedido — umbrales propios de esta etapa (distintos de los de
 * 14B.2/14B.3, que usan sólo 2 cortes). Documentado tal cual acá para que el
 * reporte y este helper nunca queden desincronizados.
 */
export function rankDuration(ms: number, okMs: number, mediumMs: number, slowMs: number): RankLevel {
  if (ms > slowMs) return "Crítico";
  if (ms > mediumMs) return "Lento";
  if (ms > okMs) return "Medio";
  return "OK";
}

/**
 * Sanitiza SIEMPRE, sin importar si quien capturó los requests ya lo hizo o
 * no — mismo criterio defensivo que `sanitizeJourneyRunRoutes` en
 * `reportBuilder.ts` (14B.3): la sanitización real vive acá, un solo lugar,
 * para que nunca dependa de que cada call site del spec se acuerde de
 * aplicarla. `request.path` normalmente ya llega sanitizado desde el spec,
 * pero un `path` con un UUID real (ej. `/employees/:id/field-history`) es
 * exactamente el caso que la Parte 2 del pedido prohíbe explícitamente
 * guardar — se vuelve a sanitizar acá como red de seguridad.
 */
function sanitizeAction(action: ActionResult): ActionResult {
  return {
    ...action,
    route: sanitizeRequestPath(action.route),
    requests: action.requests.map((request) => ({ ...request, path: sanitizeRequestPath(request.path) })),
  };
}

export function sanitizeJourneyRunRoutes(run: EmployeesJourneyRun): EmployeesJourneyRun {
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

function allRequests(run: EmployeesJourneyRun): CapturedRequest[] {
  return run.actions.flatMap((action) => action.requests);
}

/** El "tiempo" representativo de una acción para rankear/ordenar: networkIdleMs si existe, si no visibleMs (Parte 7: "visibleMs importa más que networkIdleMs si hay prefetch de fondo", pero para clasificar severidad se usa el mayor de los dos disponibles — igual se reportan ambos por separado). */
function actionDurationMs(action: ActionResult): number | undefined {
  const candidates = [action.networkIdleMs, action.visibleMs].filter((value): value is number => typeof value === "number");
  if (!candidates.length) return undefined;
  return Math.max(...candidates);
}

export function buildSummary(run: EmployeesJourneyRun) {
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

  return {
    totalActions: run.actions.length,
    coveredActions: covered.length,
    skippedActions: skipped.length,
    slowActions: slow.length,
    verySlowActions: verySlow.length,
    httpErrors: requests.filter((request) => request.statusCode >= 400).length,
    consoleErrors: run.actions.reduce((sum, action) => sum + action.consoleErrors.length, 0),
  };
}

export function buildJsonReport(rawRun: EmployeesJourneyRun) {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);

  const slowestRequests = [...requests]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  const slowestActions = [...run.actions]
    .filter((action) => action.covered)
    .sort((a, b) => (actionDurationMs(b) ?? 0) - (actionDurationMs(a) ?? 0))
    .slice(0, 10)
    .map((action) => ({
      name: action.name,
      zone: action.zone,
      visibleMs: action.visibleMs,
      networkIdleMs: action.networkIdleMs,
    }));

  const coverageGaps = run.actions
    .filter((action) => !action.covered)
    .map((action) => ({ name: action.name, zone: action.zone, reason: action.skippedReason }));

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
    actions: run.actions,
    slowestRequests,
    slowestActions,
    coverageGaps,
  };
}

function formatMs(value: number | undefined): string {
  return typeof value === "number" ? `${value}ms` : "—";
}

function escapeForTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export type MatrixRow = {
  zone: string;
  screenAction: string;
  component: string;
  expectedEndpoint: string;
  measurableByJourney: "Sí" | "No" | "Parcial";
  measuredThisStage: "Sí" | "No" | "Parcial";
  reasonIfNot: string;
};

/**
 * Parte 1 del pedido — mapa obligatorio del módulo, relevado leyendo el
 * código real (no documentación desactualizada) antes de escribir una sola
 * línea del journey: `EmployeeDetailPage.tsx`, `EmployeeDetailBlocks.tsx`,
 * `FieldHistoryControls.tsx`, `LaborTrackedFields.tsx`,
 * `EmployeeDocumentsPanel.tsx`, `EmployeesPage.tsx`. Vive acá (no hardcodeado
 * dentro del spec) para que la Sección 4 del reporte Markdown ("Matriz
 * completa del módulo") se reconstruya en cada corrida sin desincronizarse
 * de lo que el spec realmente ejercita — si se agrega/saca una acción del
 * spec, esta tabla es lo primero que hay que actualizar.
 */
export const EMPLOYEES_MODULE_MATRIX: MatrixRow[] = [
  // A. Listado
  { zone: "A. Listado", screenAction: "1-2. Entrar a /legajos, carga inicial de tabla", component: "EmployeesPage.tsx", expectedEndpoint: "GET /employees, GET /employees/summary, GET /org-structure", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "A. Listado", screenAction: "6-7. Paginación siguiente/anterior", component: "Pagination.tsx / EmployeesPage.tsx", expectedEndpoint: "GET /employees?page=N", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se saltea en tiempo de ejecución (con motivo explícito en el reporte) si el entorno actual sólo tiene una página de legajos." },
  { zone: "A. Listado", screenAction: "8-9. Buscar empleado por texto / limpiar búsqueda", component: "FilterPanel.tsx / EmployeesPage.tsx", expectedEndpoint: "GET /employees?search=...", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "El término de búsqueda se toma del primer legajo real de la tabla (no se inventa), y nunca se escribe en el reporte." },
  { zone: "A. Listado", screenAction: "10-11. Aplicar filtro por empresa / limpiar filtro", component: "FilterPanel.tsx / EmployeesPage.tsx", expectedEndpoint: "GET /employees?companyId=...", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se saltea si el catálogo de empresas está vacío en el entorno actual." },
  { zone: "A. Listado", screenAction: "Cambio de tamaño de página", component: "EmployeesPage.tsx", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "No existe selector de tamaño de página en la UI actual (pageSize=25 fijo, confirmado leyendo el componente)." },
  { zone: "A. Listado", screenAction: "12. Confirmar que la tabla no se blanquea durante paginación", component: "EmployeesPage.tsx", expectedEndpoint: "—", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se verifica leyendo el DOM inmediatamente después del click, antes de esperar la respuesta." },
  // B. Detalle
  { zone: "B. Detalle", screenAction: "13. Abrir primer legajo disponible", component: "EmployeesPage.tsx → EmployeeDetailPage.tsx", expectedEndpoint: "navegación a /legajos/:id", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se usa el primer link real de la tabla, igual que el journey general (14B.3)." },
  { zone: "B. Detalle", screenAction: "14-15. GET overview / overview-details", component: "EmployeeDetailPage.tsx", expectedEndpoint: "GET /employees/:id/overview, GET /employees/:id/overview-details", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "B. Detalle", screenAction: "16. GET /audit si se dispara", component: "EmployeeDetailPage.tsx", expectedEndpoint: "GET /audit", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se dispara solo al entrar (pestaña 0 por defecto) porque tabsThatNeedAudit incluye la pestaña inicial — queda capturado en la ventana de apertura del detalle." },
  { zone: "B. Detalle", screenAction: "17-18. Ver cabecera principal / información general", component: "EmployeeDetailPage.tsx", expectedEndpoint: "—", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "B. Detalle", screenAction: "19. Cambiar entre pestañas/secciones", component: "Tabs.tsx / EmployeeDetailPage.tsx", expectedEndpoint: "variable por pestaña", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se recorren TODAS las pestañas visibles (incluidas Novedades/Documental/Historial de Eventos/Turnos/Auditoría/Régimen Laboral, fuera de las zonas C-I) para cubrir el ítem 6 del pedido; sólo se abren historiales/ediciones dentro de las zonas C-I explícitamente pedidas." },
  // C. Información general
  { zone: "C. Información general", screenAction: "20. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 0)", expectedEndpoint: "sin endpoint propio (ya cargado por overview/overview-details)", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "C. Información general", screenAction: "21-23. Historiales visibles de la sección", component: "SectionChangeHistory.tsx", expectedEndpoint: "ninguno (filtra client-side sobre GET /audit ya cargado)", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Confirmado en el código: no hay botón 'abrir historial' individual en esta pestaña, el historial se arma filtrando en el cliente los datos de auditoría ya traídos — no hay una acción nueva de red que medir." },
  { zone: "C. Información general", screenAction: "24. Abrir edición sin guardar", component: "EmployeeDetailPage.tsx (tab 0)", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Esta pestaña es edición inline directa sobre el propio formulario (sin modal separado) — no hay una acción de 'abrir edición' distinta de estar parado en la pestaña." },
  // D. Contacto y domicilio
  { zone: "D. Contacto y domicilio", screenAction: "25. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 1)", expectedEndpoint: "sin endpoint propio", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "D. Contacto y domicilio", screenAction: "26. Historial de contacto", component: "SectionChangeHistory.tsx", expectedEndpoint: "ninguno (mismo mecanismo que Información general)", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Los campos de contacto (teléfono/celular/email/contacto de emergencia) no usan FieldWithHistory — no tienen botón de historial individual, sólo aparecen en la tabla de auditoría pooled de abajo." },
  { zone: "D. Contacto y domicilio", screenAction: "27-29. Historial de domicilio, endpoint y tiempo hasta verlo", component: "BlockHistoryTimeline (EmployeeDetailBlocks.tsx)", expectedEndpoint: "GET /employees/:id/block-history", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "D. Contacto y domicilio", screenAction: "30. Cerrar historial", component: "EmployeeDetailBlocks.tsx", expectedEndpoint: "—", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "D. Contacto y domicilio", screenAction: "31. Abrir edición de domicilio", component: "EmployeeDetailBlocks.tsx (Modal)", expectedEndpoint: "—", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Se abre y se cierra sin guardar (modo lectura)." },
  { zone: "D. Contacto y domicilio", screenAction: "32-33. Guardar contacto/domicilio + refetch", component: "EmployeeDetailBlocks.tsx", expectedEndpoint: "PATCH /employees/:id/address", measurableByJourney: "Sí", measuredThisStage: "No", reasonIfNot: "Ver Parte 3/9 del reporte: ningún guardado de Legajos es reversible sin control (el historial de campo/bloque es de sólo-agregado, por diseño) — escritura segura queda documentada como pendiente, no implementada esta etapa." },
  // E. Datos laborales
  { zone: "E. Datos laborales", screenAction: "34. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 2)", expectedEndpoint: "8 GET /employees/:id/field-history en paralelo + GET /employees/:id/position-validation (SalaryRangeValidationCard) — ver hallazgos en §16", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Hallazgo de esta etapa: a diferencia de los bloques (Domicilio/Responsables/Transporte/Configuración), los 8 campos trackeados de esta pestaña (empresa, sector, centro de costo, puesto, categoría de recibo, categoría interna, convenio, obra social) disparan su field-history automáticamente al entrar a la pestaña, no al abrir 'Historial'. Además, SalaryRangeValidationCard dispara GET position-validation al montar — observado hasta >10s en corridas reales (ver 'Top 10 requests más lentas')." },
  { zone: "E. Datos laborales", screenAction: "35. Historial de empresa", component: "MultiCompanyField (LaborTrackedFields.tsx)", expectedEndpoint: "GET /employees/:id/field-history (field=companies)", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "E. Datos laborales", screenAction: "36. Historial de unidad de negocio", component: "DerivedLaborField (EmployeeDetailPage.tsx)", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Campo derivado de sector (sólo lectura), sin historial propio — confirmado en el código, no es una limitación del journey." },
  { zone: "E. Datos laborales", screenAction: "37. Historial de establecimiento", component: "DerivedLaborField (EmployeeDetailPage.tsx)", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Mismo motivo que unidad de negocio: campo derivado, sin historial propio." },
  { zone: "E. Datos laborales", screenAction: "38. Historial de sector", component: "FieldWithHistory (FieldHistoryControls.tsx)", expectedEndpoint: "GET /employees/:id/field-history (field=sector)", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "E. Datos laborales", screenAction: "39. Historial de puesto", component: "EmployeePositionField (LaborTrackedFields.tsx)", expectedEndpoint: "GET /employees/:id/field-history (field=positionId)", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "E. Datos laborales", screenAction: "40. Historial de jornada/turno", component: "—", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "No existe como campo de Datos Laborales — 'Turnos' es una pestaña aparte del módulo Shifts (fuera de alcance de Legajos), confirmado leyendo EmployeeDetailPage.tsx completo. No se inventó un historial que la UI no tiene." },
  { zone: "E. Datos laborales", screenAction: "41. Resto de field-history (centro de costo, categoría de recibo, categoría interna, convenio, obra social)", component: "FieldWithHistory (FieldHistoryControls.tsx)", expectedEndpoint: "GET /employees/:id/field-history", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  // F. Responsables / Asignaciones
  { zone: "F. Responsables/Asignaciones", screenAction: "43. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 3)", expectedEndpoint: "sin endpoint propio", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "F. Responsables/Asignaciones", screenAction: "44-47. Historial de responsable de carga y de encargado directo, endpoint y tiempo", component: "AssignmentBlock (EmployeeDetailBlocks.tsx) ×2", expectedEndpoint: "GET /employees/:id/block-history", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "A diferencia de Datos Laborales, este patrón SÍ es lazy (fetch real al click 'Ver historial', no al entrar a la pestaña) — confirmado en el código." },
  { zone: "F. Responsables/Asignaciones", screenAction: "48-50. Abrir edición de responsables + guardado + refetch", component: "AssignmentBlock (Modal)", expectedEndpoint: "PUT /employees/:id/assignments", measurableByJourney: "Sí", measuredThisStage: "Parcial", reasonIfNot: "Se mide abrir el modal (sin guardar). El guardado queda sin medir — mismo motivo que Contacto/Domicilio (historial append-only, sin escritura reversible)." },
  // G. Transporte
  { zone: "G. Transporte", screenAction: "51. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 4)", expectedEndpoint: "sin endpoint propio", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "G. Transporte", screenAction: "52-53. Historial de transporte, endpoint y tiempo", component: "TransportBlock (EmployeeDetailBlocks.tsx)", expectedEndpoint: "GET /employees/:id/block-history", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Lazy, mismo patrón que Domicilio/Responsables." },
  { zone: "G. Transporte", screenAction: "54-56. Abrir edición + guardado + refetch", component: "TransportBlock (Modal)", expectedEndpoint: "PATCH /employees/:id/transport", measurableByJourney: "Sí", measuredThisStage: "Parcial", reasonIfNot: "Se mide abrir el modal (sin guardar). Guardado sin medir, mismo motivo de historial append-only." },
  // H. Configuración
  { zone: "H. Configuración", screenAction: "57. Entrar a la pestaña", component: "EmployeeDetailPage.tsx (tab 5)", expectedEndpoint: "sin endpoint propio", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "H. Configuración", screenAction: "58. Historial de configuración/horas especiales", component: "HoursSpecialBlock (EmployeeDetailBlocks.tsx)", expectedEndpoint: "GET /employees/:id/block-history", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "Lazy, mismo patrón que Domicilio/Transporte." },
  { zone: "H. Configuración", screenAction: "59. Conceptos horarios asignados", component: "HoursSpecialBlock (EmployeeDetailBlocks.tsx)", expectedEndpoint: "—", measurableByJourney: "No", measuredThisStage: "No", reasonIfNot: "Vienen incluidos en overview-details (enabledHourConcepts), no hay un endpoint propio de listado en esta pestaña." },
  { zone: "H. Configuración", screenAction: "61-63. Abrir edición + guardado + refetch", component: "HoursSpecialBlock (Modal)", expectedEndpoint: "PUT /employees/:id/hour-concepts", measurableByJourney: "Sí", measuredThisStage: "Parcial", reasonIfNot: "Se mide abrir el modal (sin guardar). Guardado sin medir, mismo motivo de historial append-only." },
  // I. Adjuntos / Documentos
  { zone: "I. Adjuntos/Documentos", screenAction: "64-65. Entrar a Adjuntos, carga de documentos", component: "EmployeeDocumentsPanel.tsx", expectedEndpoint: "GET /documents?employeeId=:id", measurableByJourney: "Sí", measuredThisStage: "Sí", reasonIfNot: "—" },
  { zone: "I. Adjuntos/Documentos", screenAction: "66. Abrir/ver documento existente", component: "EmployeeDocumentsPanel.tsx", expectedEndpoint: "descarga desde storage (Google Drive)", measurableByJourney: "Sí", measuredThisStage: "No", reasonIfNot: "Se saltea a propósito: abre una pestaña/descarga externa fuera del control del journey, sin valor de performance del módulo Legajos en sí." },
  { zone: "I. Adjuntos/Documentos", screenAction: "67-68. Subir documento / createDocument", component: "DocumentUploadModal.tsx", expectedEndpoint: "POST /employees/:id/documents", measurableByJourney: "Sí", measuredThisStage: "Parcial", reasonIfNot: "Se mide abrir el modal 'Agregar documento' (sin subir). No se sube ningún archivo real esta etapa — no existe un fixture de archivo seguro documentado para esto, y subir uno real escribiría un documento permanente en storage + DB. Queda documentado como pendiente para una etapa que defina un fixture explícito." },
  // J. Guardados
  { zone: "J. Guardados", screenAction: "69-75. Todos los botones de guardar del módulo", component: "EmployeeDetailPage.tsx + EmployeeDetailBlocks.tsx + FieldHistoryControls.tsx + LaborTrackedFields.tsx", expectedEndpoint: "PATCH /employees/:id, PATCH /employees/:id/address, PATCH /employees/:id/transport, PUT /employees/:id/assignments, PUT /employees/:id/hour-concepts, POST /employees/:id/field-history, POST /employees/:id/block-history, POST /employees/:id/documents", measurableByJourney: "Sí", measuredThisStage: "No", reasonIfNot: "Ninguno se mide esta etapa por seguridad de datos: cada uno de estos guardados crea una fila NUEVA y permanente en EmployeeFieldHistory/EmployeeBlockHistory/AuditLog (historial de sólo-agregado, protegido explícitamente por las reglas del proyecto) — no existe una forma de 'restaurar el valor original' sin también borrar ese registro de auditoría, lo que violaría la regla de no perder historial. Evaluado y descartado para modo escritura segura (Parte 3 del pedido, cláusula de 'si es riesgoso, dejarlo documentado como pendiente')." },
];

export function buildMarkdownReport(rawRun: EmployeesJourneyRun): string {
  const run = sanitizeJourneyRunRoutes(rawRun);
  const requests = allRequests(run);
  const endpoints = aggregateEndpoints(requests);
  const summary = buildSummary(run);

  const covered = run.actions.filter((action) => action.covered);
  const skipped = run.actions.filter((action) => !action.covered);

  const slowestActions = [...covered]
    .sort((a, b) => (actionDurationMs(b) ?? 0) - (actionDurationMs(a) ?? 0))
    .slice(0, 10);
  const slowestRequests = [...requests].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

  const endpointCounts = new Map<string, number>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  }
  const repeatedEndpoints = [...endpointCounts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);

  const emptyScreenActions = covered.filter((action) => action.emptyScreen === true);
  const globalLoadingActions = covered.filter((action) => action.notes.some((note) => note.toLowerCase().includes("loading global")));
  const localizedLoadingActions = covered.filter((action) => action.notes.some((note) => note.toLowerCase().includes("loading localizado")));
  const historyActions = covered.filter((action) => action.zone.match(/^[D-H]\./) && /historial/i.test(action.name));
  const writeActions = run.actions.filter((action) => action.isWrite);
  const pendingWriteActions = run.actions.filter((action) => !action.isWrite && action.skippedReason && /guarda|escritura|reversible/i.test(action.skippedReason));

  const lines: string[] = [];

  lines.push("# Performance Journey — Legajos (Etapa 14D.1)");
  lines.push("");
  lines.push("Reporte generado automáticamente por `npm run perf:journey:employees`. No editar a mano — se sobreescribe en cada corrida.");
  lines.push("");

  lines.push("## 1. Resumen ejecutivo");
  lines.push("");
  lines.push(
    `Recorrido específico del módulo Legajos: ${summary.coveredActions}/${summary.totalActions} acciones cubiertas, ${summary.skippedActions} salteadas (con motivo documentado cada una), ${summary.httpErrors} respuestas HTTP >= 400, ${summary.consoleErrors} errores de consola. ${summary.verySlowActions} acción(es) en rango Crítico (> ${run.slowThresholdMs}ms) y ${summary.slowActions} en rango Lento (${run.mediumThresholdMs}-${run.slowThresholdMs}ms). Este reporte es de medición, no de optimización — ver docs/decisions/EMPLOYEES_FULL_PERFORMANCE_14C3.md para los cambios ya aplicados y §16 abajo para lo que queda como candidato con evidencia nueva.`,
  );
  lines.push("");

  lines.push("## 2. Alcance");
  lines.push("");
  lines.push("Exclusivamente el módulo Legajos (listado, detalle, las 12 pestañas del legajo, historiales de campo/bloque, apertura de modales de edición sin guardar, Adjuntos/Documentos). No incluye otros módulos ni un recorrido general de la app (eso lo cubre `npm run perf:journey`, Etapa 14B.3).");
  lines.push("");

  lines.push("## 3. Modo usado");
  lines.push("");
  lines.push(
    run.mode === "read-only"
      ? "**read-only** (default). No se guardó ningún dato — sólo navegación, apertura de historiales/modales, búsqueda y paginación. Modo `write-safe` evaluado y no implementado esta etapa: ver §15 y la fila \"J. Guardados\" de la matriz (§4) para el motivo completo."
      : "**write-safe** — ver hallazgos de escritura en las secciones siguientes.",
  );
  lines.push("");

  lines.push("## 4. Matriz completa del módulo");
  lines.push("");
  lines.push("Relevada leyendo el código real (`EmployeeDetailPage.tsx`, `EmployeeDetailBlocks.tsx`, `FieldHistoryControls.tsx`, `LaborTrackedFields.tsx`, `EmployeeDocumentsPanel.tsx`, `EmployeesPage.tsx`) antes de escribir el journey — Parte 1 del pedido.");
  lines.push("");
  lines.push("| Zona | Pantalla/acción | Componente | Endpoint esperado | Medible por journey | Se mide esta etapa | Motivo si no se mide |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of EMPLOYEES_MODULE_MATRIX) {
    lines.push(
      `| ${escapeForTable(row.zone)} | ${escapeForTable(row.screenAction)} | ${escapeForTable(row.component)} | ${escapeForTable(row.expectedEndpoint)} | ${row.measurableByJourney} | ${row.measuredThisStage} | ${escapeForTable(row.reasonIfNot)} |`,
    );
  }
  lines.push("");

  lines.push("## 5. Acciones cubiertas");
  lines.push("");
  if (covered.length === 0) {
    lines.push("Ninguna — ver §6, algo impidió que el journey avanzara.");
  } else {
    lines.push("| Acción | Zona | Ruta | Visible | Network idle | Requests | Errores consola | Escritura |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const action of covered) {
      lines.push(
        `| ${escapeForTable(action.name)} | ${escapeForTable(action.zone)} | \`${action.route}\` | ${formatMs(action.visibleMs)} | ${formatMs(action.networkIdleMs)} | ${action.requests.length} | ${action.consoleErrors.length} | ${action.isWrite ? "Sí" : "No"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## 6. Acciones no cubiertas y motivo");
  lines.push("");
  if (skipped.length === 0) {
    lines.push("Ninguna — todas las acciones planificadas se ejercitaron.");
  } else {
    for (const action of skipped) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}): ${escapeForTable(action.skippedReason ?? "sin motivo registrado")}.`);
    }
  }
  lines.push("");

  lines.push("## 7. Top 10 acciones más lentas");
  lines.push("");
  if (slowestActions.length === 0) {
    lines.push("Sin datos.");
  } else {
    lines.push("| Acción | Zona | Visible | Network idle | Rango |");
    lines.push("|---|---|---|---|---|");
    for (const action of slowestActions) {
      const ms = actionDurationMs(action);
      const rank = ms !== undefined ? rankDuration(ms, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) : "—";
      lines.push(`| ${escapeForTable(action.name)} | ${escapeForTable(action.zone)} | ${formatMs(action.visibleMs)} | ${formatMs(action.networkIdleMs)} | ${rank} |`);
    }
  }
  lines.push("");

  lines.push("## 8. Top 10 requests más lentas");
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

  lines.push("## 9. Endpoints repetidos (misma acción o distintas)");
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

  lines.push("## 10. Dónde se blanquea pantalla");
  lines.push("");
  if (emptyScreenActions.length === 0) {
    lines.push("En ninguna acción cubierta se detectó una pantalla/sección vacía inesperada.");
  } else {
    for (const action of emptyScreenActions) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)})`);
    }
  }
  lines.push("");

  lines.push("## 11. Dónde hay loading global");
  lines.push("");
  lines.push(
    globalLoadingActions.length === 0
      ? "Ninguno detectado — el único loading de página completa del proyecto es el `<Suspense>` de code-splitting entre rutas (`App.tsx`), no algo propio de una acción dentro de Legajos."
      : globalLoadingActions.map((action) => `- **${escapeForTable(action.name)}**`).join("\n"),
  );
  lines.push("");

  lines.push("## 12. Dónde hay loading localizado");
  lines.push("");
  if (localizedLoadingActions.length === 0) {
    lines.push("Sin datos suficientes en esta corrida.");
  } else {
    for (const action of localizedLoadingActions) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)})`);
    }
  }
  lines.push("");

  lines.push("## 13. Qué historiales se midieron");
  lines.push("");
  if (historyActions.length === 0) {
    lines.push("Ninguno — ver §6.");
  } else {
    for (const action of historyActions) {
      lines.push(`- **${escapeForTable(action.name)}** (${escapeForTable(action.zone)}) — visible ${formatMs(action.visibleMs)}, ${action.requests.length} request(s).`);
    }
  }
  lines.push("");

  lines.push("## 14. Qué guardados se pudieron medir");
  lines.push("");
  lines.push(
    writeActions.length === 0
      ? "Ninguno — modo `read-only` (ver §3/§15). Se midió la apertura de los modales de edición (sin guardar) donde existen; ver acciones \"Abrir edición de ...\" en §5."
      : writeActions.map((action) => `- **${escapeForTable(action.name)}**`).join("\n"),
  );
  lines.push("");

  lines.push("## 15. Qué guardados quedaron pendientes");
  lines.push("");
  if (pendingWriteActions.length === 0) {
    lines.push("Ver fila \"J. Guardados\" de la matriz (§4) y el punto 9 de la matriz de este documento — los 8 endpoints de guardado del módulo quedan documentados como pendientes, no medidos esta etapa.");
  } else {
    for (const action of pendingWriteActions) {
      lines.push(`- **${escapeForTable(action.name)}**: ${escapeForTable(action.skippedReason ?? "")}`);
    }
  }
  lines.push("");

  lines.push("## 16. Recomendaciones para próxima etapa de optimización");
  lines.push("");
  const critical = endpoints.filter((endpoint) => rankDuration(endpoint.maxDurationMs, run.okThresholdMs, run.mediumThresholdMs, run.slowThresholdMs) === "Crítico");
  if (critical.length > 0) {
    lines.push(`- ${critical.length} endpoint(s) en rango Crítico detectados en este recorrido, priorizar antes de cualquier otra optimización:`);
    for (const endpoint of [...critical].sort((a, b) => b.maxDurationMs - a.maxDurationMs)) {
      lines.push(`  - \`${endpoint.key}\` — máx ${endpoint.maxDurationMs}ms, promedio ${endpoint.avgDurationMs}ms, ${endpoint.count} llamada(s) en este recorrido.`);
    }
  }
  lines.push(
    "- Hallazgo de esta etapa (no medido antes con esta granularidad): visitar la pestaña \"Datos Laborales\" dispara **8 GET /employees/:id/field-history en paralelo** (empresa, sector, centro de costo, puesto, categoría de recibo, categoría interna, convenio, obra social) de forma automática, sin que el usuario haya pedido ver ningún historial — el botón 'Historial' de cada campo sólo revela un panel ya cargado. Esto es distinto del patrón de Domicilio/Responsables/Transporte/Configuración (lazy, sólo al hacer click en 'Ver historial'). Candidato directo para una etapa de optimización dedicada: evaluar diferir esos 8 fetches a que el usuario abra cada 'Historial' individualmente, como ya funciona en los bloques lazy.",
  );
  lines.push("- Cruzar los endpoints Crítico/Lento de este journey contra los logs reales de la Etapa 14B.2 (`slow:true`/`error:true`) antes de decidir la causa — este es un recorrido puntual de un solo usuario, sin concurrencia.");
  lines.push("");

  lines.push("## 17. Riesgos");
  lines.push("");
  lines.push("- Journey de un solo usuario, sin concurrencia — no reemplaza logs de producción/staging bajo uso real.");
  lines.push("- Datos reales del entorno de staging (Neon): la disponibilidad de una segunda página, catálogo de empresas, legajos con historial no vacío, etc. varía según el estado real de la base — algunas acciones pueden quedar salteadas en una corrida y cubiertas en otra, sin que eso sea un bug del journey.");
  lines.push("- `visibleMs`/`networkIdleMs` son proxies aproximados (mismo criterio que 14B.3), no mediciones exactas de percepción de usuario.");
  lines.push("- Ninguna escritura se ejecutó — los tiempos de guardado reales (Zona J) siguen sin medición en vivo, documentados como pendientes.");
  lines.push("");

  lines.push("## 18. Validaciones ejecutadas");
  lines.push("");
  lines.push("Ver docs/decisions correspondiente a esta etapa para el detalle completo de comandos corridos (`npx prisma validate`, `typecheck`, `test`, `build` en backend y frontend, `git diff --check`).");
  lines.push("");

  lines.push("## Ambiente");
  lines.push("");
  lines.push(`- Generado: ${run.generatedAt}`);
  lines.push(`- Frontend: ${run.baseUrl}`);
  lines.push(`- Backend: ${run.apiBaseUrl}`);
  lines.push(`- ${run.environment}`);
  lines.push(`- Usuario: ${run.user}`);
  lines.push(`- Comando: \`${run.command}\``);
  lines.push("");

  return lines.join("\n");
}
