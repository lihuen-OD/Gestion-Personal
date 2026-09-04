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
  | "work-regimes";

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
} satisfies Record<string, CachePolicy>;
