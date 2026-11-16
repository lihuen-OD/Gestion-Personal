import { apiRequest } from "./apiClient";
import { collectAllPages } from "./listQuery";
import { cachePolicies, cachedData, invalidateCacheFamily, NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES } from "../cache";
import type {
  FinnegansValueUnit,
  NoveltyCoverageDayOffPolicy,
  NoveltyCoverageDayRule,
  NoveltyCoverageHolidayPolicy,
  NoveltyCoverageMode,
  NoveltyRealWorkCompatibility,
  NoveltyTimeEntryBehavior,
  NoveltyType,
  NoveltyTypeFilters,
  NoveltyTypeKind,
  NoveltyTypeStatus,
  NoveltyUiColor,
} from "../../types/noveltyType.types";
import type { Role } from "../../types";
import { resolveNoveltyUiColor } from "../../utils/noveltyColor";
import { canonicalCoverage } from "../../utils/noveltyTypeCoverage";

// Etapa 5 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.7): este cambio puede reinterpretar la cobertura de novedades.
function invalidateNoveltyCoverageDerivedCaches(reason: string) {
  return Promise.all(NOVELTY_COVERAGE_DERIVED_CACHE_FAMILIES.map((family) => invalidateCacheFamily(family, reason)));
}

export type ApiNoveltyType = {
  id: string;
  code: string;
  name: string;
  // Etapa 15L.2B: catálogo único de colores (docs/decisions/
  // NOVELTY_TYPE_FRONTEND_REDESIGN_15L2B.md) -- backend y frontend ya usan
  // exactamente el mismo enum, sin ningún mapeo especial.
  uiColor: NoveltyUiColor;
  kind: NoveltyTypeKind;
  status: NoveltyTypeStatus;
  description?: string | null;
  notes?: string | null;
  exportsToFinnegans: boolean;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  allowsHours: boolean;
  timeEntryBehavior: NoveltyTimeEntryBehavior;
  allowsDateRange: boolean;
  finnegansValueUnit: FinnegansValueUnit | null;
  finnegansRequiresValidity: boolean;
  // Etapa 15L.6: reemplaza FinnegansNoveltyLink (1:N) -- 1:1 físico.
  finnegansCode?: string | null;
  finnegansName?: string | null;
  allowedLoadRoles?: Role[];
  approvalRoles?: Role[];
  // Motor de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §4).
  coverageMode: NoveltyCoverageMode;
  coverageFixedMinutes: number | null;
  coverageDayRule: NoveltyCoverageDayRule;
  coverageWeekdays: number[];
  coverageOnDayOff: NoveltyCoverageDayOffPolicy | null;
  coverageOnHoliday: NoveltyCoverageHolidayPolicy | null;
  coverageAppliesSpecialHours: boolean;
  coverageCountsTowardTotal: boolean;
  realWorkCompatibility: NoveltyRealWorkCompatibility;
  requiresObservation: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiListResponse = { data: ApiNoveltyType[] };
type ApiItemResponse = { data: ApiNoveltyType };

const fallbackApprovalRoles: Role[] = ["Nivel 1 - RRHH"];
const fallbackAllowedLoadRoles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const validRoles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];

function normalizeRoles(value: unknown, fallback: Role[]): Role[] {
  if (!Array.isArray(value)) return fallback;
  const roles = value.filter((item): item is Role => validRoles.includes(item as Role));
  return roles.length ? roles : fallback;
}

export function mapNoveltyTypeFromApi(item: ApiNoveltyType): NoveltyType {
  const allowedLoadRoles = normalizeRoles(item.allowedLoadRoles, fallbackAllowedLoadRoles);
  const approvalRoles = normalizeRoles(item.approvalRoles, fallbackApprovalRoles);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    uiColor: resolveNoveltyUiColor(item.uiColor, item.id || item.name || item.code),
    kind: item.kind,
    description: item.description || "",
    status: item.status,
    rules: {
      exportsToFinnegans: item.exportsToFinnegans,
      requiresApproval: item.requiresApproval,
      requiresDocumentation: item.requiresDocumentation,
      allowsHours: item.allowsHours,
      timeEntryBehavior: item.timeEntryBehavior,
      allowsDateRange: item.allowsDateRange,
      finnegansValueUnit: item.finnegansValueUnit,
      finnegansRequiresValidity: item.finnegansRequiresValidity,
      requiresObservation: Boolean(item.requiresObservation),
    },
    coverage: {
      mode: item.coverageMode ?? "NONE",
      fixedMinutes: item.coverageFixedMinutes ?? null,
      dayRule: item.coverageDayRule ?? "EVERY_DAY",
      weekdays: Array.isArray(item.coverageWeekdays) ? [...item.coverageWeekdays].sort((left, right) => left - right) : [],
      onDayOff: item.coverageOnDayOff ?? null,
      onHoliday: item.coverageOnHoliday ?? null,
      appliesSpecialHours: Boolean(item.coverageAppliesSpecialHours),
      countsTowardTotal: Boolean(item.coverageCountsTowardTotal),
      realWorkCompatibility: item.realWorkCompatibility ?? "COMPATIBLE",
    },
    allowedLoadRoles,
    approvalRoles,
    finnegansCode: item.finnegansCode || null,
    finnegansName: item.finnegansName || null,
    // Etapa 15L.2A: antes se hardcodeaba "" y el texto editado se perdía
    // siempre al guardar -- el backend ahora persiste notes de verdad.
    notes: item.notes || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: "Sistema",
    updatedBy: "Sistema",
  };
}

/** Payload de alta/edición. La cobertura viaja en su forma canónica (sin valores ocultos). */
export function mapNoveltyTypeToApi(item: NoveltyType) {
  const coverage = canonicalCoverage(item.coverage);
  return {
    code: item.code,
    name: item.name,
    uiColor: item.uiColor,
    kind: item.kind,
    status: item.status,
    description: item.description || null,
    notes: item.notes?.trim() || null,
    exportsToFinnegans: item.rules.exportsToFinnegans,
    requiresApproval: item.rules.requiresApproval,
    requiresDocumentation: item.rules.requiresDocumentation,
    allowsHours: item.rules.allowsHours,
    timeEntryBehavior: item.rules.timeEntryBehavior,
    allowsDateRange: item.rules.allowsDateRange,
    finnegansValueUnit: item.rules.finnegansValueUnit,
    finnegansRequiresValidity: item.rules.finnegansRequiresValidity,
    finnegansCode: item.finnegansCode?.trim() || null,
    finnegansName: item.finnegansName?.trim() || null,
    allowedLoadRoles: item.allowedLoadRoles,
    approvalRoles: item.approvalRoles,
    requiresObservation: item.rules.requiresObservation,
    // Se envía el estado completo: el backend valida la combinación
    // resultante y sólo recalcula si alguno de estos campos cambió de verdad.
    coverageMode: coverage.mode,
    coverageFixedMinutes: coverage.fixedMinutes,
    coverageDayRule: coverage.dayRule,
    coverageWeekdays: coverage.weekdays,
    coverageOnDayOff: coverage.onDayOff,
    coverageOnHoliday: coverage.onHoliday,
    coverageAppliesSpecialHours: coverage.appliesSpecialHours,
    coverageCountsTowardTotal: coverage.countsTowardTotal,
    realWorkCompatibility: coverage.realWorkCompatibility,
  };
}

function toQuery(filters?: Partial<NoveltyTypeFilters>) {
  const params = new URLSearchParams();
  params.set("take", "200");
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.exportsToFinnegans) params.set("exportsToFinnegans", filters.exportsToFinnegans);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function nextCode(items: NoveltyType[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `NOV-${String(max + 1).padStart(3, "0")}`;
}

function isNoveltyType(value: NoveltyType) {
  return Boolean(value && typeof value.id === "string" && typeof value.code === "string" && typeof value.name === "string");
}

function isNoveltyTypeList(value: NoveltyType[]) {
  return Array.isArray(value) && value.every(isNoveltyType);
}

export const noveltyTypeApiService = {
  async getAll(filters?: Partial<NoveltyTypeFilters>) {
    const query = toQuery(filters);
    const key = `/novelty-types${query}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.noveltyTypesCatalog,
      fetcher: () => collectAllPages(key, (path) => apiRequest<ApiListResponse>(path, { apiCache: false })).then((rows) => rows.map(mapNoveltyTypeFromApi)),
      validate: isNoveltyTypeList,
    });
  },

  async getById(id: string) {
    return cachedData({
      requestKey: `GET:/novelty-types/${id}`,
      policy: cachePolicies.noveltyTypesCatalog,
      fetcher: () => apiRequest<ApiItemResponse>(`/novelty-types/${id}`, { apiCache: false }).then((response) => mapNoveltyTypeFromApi(response.data)),
      validate: isNoveltyType,
    });
  },

  async create(item: NoveltyType) {
    const response = await apiRequest<ApiItemResponse>("/novelty-types", {
      method: "POST",
      body: mapNoveltyTypeToApi(item),
    });
    await invalidateCacheFamily("novelty-types", "novelty type created");
    return mapNoveltyTypeFromApi(response.data);
  },

  async update(id: string, item: NoveltyType) {
    const response = await apiRequest<ApiItemResponse>(`/novelty-types/${id}`, {
      method: "PATCH",
      body: mapNoveltyTypeToApi(item),
    });
    await Promise.all([invalidateCacheFamily("novelty-types", "novelty type updated"), invalidateNoveltyCoverageDerivedCaches("novelty type updated")]);
    return mapNoveltyTypeFromApi(response.data);
  },

  getNextCode: nextCode,
};
