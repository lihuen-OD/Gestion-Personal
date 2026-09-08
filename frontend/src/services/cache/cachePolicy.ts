export type CacheFamily =
  | "org-structure"
  | "hour-concepts"
  | "document-categories"
  | "novelty-types"
  | "salary-categories"
  | "audit-parameters"
  | "positions"
  | "dashboard"
  | "employees"
  | "time-entries"
  | "novelties"
  | "pending"
  | "work-regimes"
  | "audit"
  | "notifications"
  | "shift-alerts"
  | "monthly-closures";

export type CachePolicy = {
  family: CacheFamily;
  ttlMs: number;
  persist: boolean;
  sensitive: boolean;
  schemaVersion: number;
};

export const CACHE_SCHEMA_VERSION = 1;

export const cachePolicies = {
  orgStructureCatalog: {
    family: "org-structure",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  hourConceptsCatalog: {
    family: "hour-concepts",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  documentCategoriesCatalog: {
    family: "document-categories",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  noveltyTypesCatalog: {
    family: "novelty-types",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  salaryCategoriesCatalog: {
    family: "salary-categories",
    ttlMs: 5 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  positionsCatalog: {
    family: "positions",
    ttlMs: 5 * 60_000,
    persist: false,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 9E: TTL corto (misma familia "positions", así que un create/update
  // invalida ambas) para la tabla paginada de PuestosPage — a diferencia de
  // positionsCatalog (pensada para selects/catálogo, TTL más largo).
  positionsList: {
    family: "positions",
    ttlMs: 30_000,
    persist: false,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  employeesOptions: {
    family: "employees",
    ttlMs: 60_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  employeesList: {
    family: "employees",
    ttlMs: 30_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14D.2.1: evita repetir GET /employees/:id/position-validation al
  // revisitar la pestaña Datos Laborales con el mismo puesto/sector/categoría
  // (misma familia "employees" que el resto de las cachés de legajo — un
  // guardado que cambie datos laborales ya invalida toda la familia).
  employeePositionValidation: {
    family: "employees",
    ttlMs: 60_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14D.5: overview/overview-details de EmployeeDetailPage no pasaban
  // por `cachedData` (fetch directo) — sin dedupe in-flight, cada invocación
  // (incluido el doble-montaje de React StrictMode en dev) disparaba una
  // llamada de red nueva. Misma familia "employees" que el resto de las
  // cachés de legajo — ya invalidada por los 8 mutadores existentes
  // (`invalidateEmployeeDependentCaches`). TTL corto (no persistido, dato
  // sensible con PII) sólo para reusar al reabrir el mismo legajo poco
  // después, no para esconder datos viejos. Ver docs/decisions/
  // EMPLOYEE_DETAIL_LOAD_DEDUP_14D5.md.
  employeeDetailCore: {
    family: "employees",
    ttlMs: 60_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  dashboardMetrics: {
    family: "dashboard",
    ttlMs: 30_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  timeEntriesAggregates: {
    family: "time-entries",
    ttlMs: 30_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  pendingQueue: {
    family: "pending",
    ttlMs: 30_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  auditParametersCatalog: {
    family: "audit-parameters",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  employeesSummary: {
    family: "employees",
    ttlMs: 60_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  employeesOrgChart: {
    family: "employees",
    ttlMs: 60_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  workRegimesCatalog: {
    family: "work-regimes",
    ttlMs: 10 * 60_000,
    persist: true,
    sensitive: false,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14H.2: getWorkRegimeEmployees() no tenía dedupe in-flight -- el
  // doble-montaje de React StrictMode en dev disparaba requests reales
  // duplicadas a GET /work-regimes/:id/employees cada vez que se abría el
  // modal o se cambiaba el filtro de vigencia (confirmado en el journey
  // 14H.1: 4 requests dentro de la ventana de una sola acción, "Filtrar
  // vigencia de empleados asociados", 2878ms). Misma familia "work-regimes"
  // que el catálogo (mismo criterio que positions/positionsList en 14D.4):
  // create/update/updateStatus del régimen ya invalidan esta familia: se
  // agrega además invalidación explícita en assign/updateAssignment/
  // closeAssignment (los 3 mutadores reales de EmployeeWorkRegime, ver
  // workRegimeApiService.ts). TTL corto (15s, mismo rango que
  // shiftAlertsList/monthlyClosuresList) porque es una lista operativa con
  // escrituras frecuentes, no un catálogo administrado a mano. No
  // persistido (sensitive: true, contiene PII de empleados vía
  // AssociatedEmployee) -- nunca en IndexedDB.
  workRegimeEmployeesList: {
    family: "work-regimes",
    ttlMs: 15_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14F.2: el feed de actividad reciente del Dashboard (`/audit?take=5`)
  // no tenía dedupe frontend — en StrictMode se pedía dos veces por mount.
  // TTL corto (15s, igual al `auditListCache` del backend) porque es lectura
  // de auditoría — no tiene sentido cachear más tiempo que el propio backend.
  // No persistido: nunca guardar auditoría en IndexedDB/localStorage.
  auditList: {
    family: "audit",
    ttlMs: 15_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14F.2: el badge de notificaciones sin leer (`AppShell`) tampoco
  // tenía dedupe frontend — mismo síntoma de StrictMode que auditList. TTL
  // corto (20s): sólo necesita sobrevivir el doble-montaje del effect y
  // remounts rápidos, no el intervalo de refresco de 60s (que siempre va a
  // ser un cache-miss real, TTL < intervalo, por diseño).
  notificationsUnreadCount: {
    family: "notifications",
    ttlMs: 20_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14G.6: `workforceApiService.notifications()` (el listado) no tenía
  // dedupe in-flight -- el doble-montaje de React StrictMode en dev disparaba
  // 2 llamadas de red reales a GET /workforce/notifications (mismo síntoma ya
  // resuelto en el resto de las listas operativas del proyecto). Misma
  // familia "notifications" que `notificationsUnreadCount` a propósito:
  // `readNotification()` ya invalida esa familia completa, así que marcar
  // una notificación como leída invalida el badge Y el listado con la misma
  // llamada, sin código nuevo. TTL corto (10s, más corto que los 20s del
  // badge) porque los write paths de SystemNotification no son un conjunto
  // cerrado (ver workforce.service.ts backend) -- se acota la ventana de
  // "no ver una notificación nueva todavía" al mínimo razonable.
  notificationsList: {
    family: "notifications",
    ttlMs: 10_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14G.5: GET /shifts/alerts no tenía dedupe in-flight -- el
  // doble-montaje de React StrictMode en dev disparaba 2 llamadas de red
  // reales (mismo síntoma ya resuelto en `getSummary`/`getPeriodEmployees`/
  // `list`/`listByEmployee`, ver 14D.5/14F.2/14G.4). TTL corto (15s, mismo
  // rango 10-20s backend / 30s frontend ya usado por el resto de las listas
  // operativas de Gestión horaria) -- sólo para sobrevivir el doble-montaje y
  // remounts rápidos, no para esconder alertas nuevas por mucho tiempo.
  shiftAlertsList: {
    family: "shift-alerts",
    ttlMs: 15_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  // Etapa 14G.8: `closures`/`corrections` (MonthlyClosuresPage.tsx) no tenían
  // dedupe in-flight -- el doble-montaje de StrictMode disparaba 2 llamadas
  // de red reales a cada uno (confirmado en el journey de 14G.6/14G.7,
  // "Entrar a Cierres mensuales"). Misma familia "monthly-closures" para
  // ambas políticas a propósito: `corrections` no depende del período, así
  // que cambiar de período (que sí re-pide `closures`) ya no dispara un
  // nuevo request de `corrections` mientras el TTL siga vigente -- sin tener
  // que reestructurar `MonthlyClosuresPage.tsx` (que sigue pidiendo los 3
  // recursos juntos en su `load()`, sin cambios). TTL 15s, mismo rango
  // 10-20s ya usado por el resto de las listas operativas del proyecto.
  monthlyClosuresList: {
    family: "monthly-closures",
    ttlMs: 15_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
  timeCorrectionsList: {
    family: "monthly-closures",
    ttlMs: 15_000,
    persist: false,
    sensitive: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
  },
} satisfies Record<string, CachePolicy>;
