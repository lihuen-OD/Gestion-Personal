import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData, invalidateCacheFamily } from "../cache";
import type { Role } from "../../types";
import type {
  DocumentCategory,
  DocumentCategoryFilters,
  DocumentCategoryKind,
  DocumentCategoryScope,
  DocumentCategoryStatus,
  ExternalDocumentLink,
} from "../../types/documentCategory.types";

type ApiDocumentCategory = {
  id: string;
  code: string;
  name: string;
  kind: DocumentCategoryKind;
  status: DocumentCategoryStatus;
  description?: string | null;
  scopes?: unknown;
  rules?: unknown;
  uploadRoles?: unknown;
  viewRoles?: unknown;
  approvalRoles?: unknown;
  externalLinks?: unknown;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiListResponse = { data: ApiDocumentCategory[] };
type ApiItemResponse = { data: ApiDocumentCategory };

const defaultRules = {
  expires: false,
  alertBeforeDays: 0,
  mandatory: false,
  requiresApproval: false,
  allowMultipleFiles: true,
};

function asStringArray<T extends string>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => typeof item === "string") : [];
}

function asExternalLinks(value: unknown): ExternalDocumentLink[] {
  return Array.isArray(value) ? (value as ExternalDocumentLink[]) : [];
}

function asRules(value: unknown): DocumentCategory["rules"] {
  return value && typeof value === "object" ? { ...defaultRules, ...(value as DocumentCategory["rules"]) } : defaultRules;
}

function mapFromApi(item: ApiDocumentCategory): DocumentCategory {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    kind: item.kind || "PERSONAL",
    status: item.status,
    description: item.description || "",
    scopes: asStringArray<DocumentCategoryScope>(item.scopes).length ? asStringArray<DocumentCategoryScope>(item.scopes) : ["LEGAJO"],
    rules: asRules(item.rules),
    uploadRoles: asStringArray<Role>(item.uploadRoles).length ? asStringArray<Role>(item.uploadRoles) : ["Nivel 1 - RRHH"],
    viewRoles: asStringArray<Role>(item.viewRoles).length ? asStringArray<Role>(item.viewRoles) : ["Nivel 1 - RRHH"],
    approvalRoles: asStringArray<Role>(item.approvalRoles).length ? asStringArray<Role>(item.approvalRoles) : ["Nivel 1 - RRHH"],
    externalLinks: asExternalLinks(item.externalLinks),
    notes: item.notes || "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: "Backend",
    updatedBy: "Backend",
    history: [],
  };
}

function mapToApi(item: DocumentCategory) {
  return {
    code: item.code,
    name: item.name,
    kind: item.kind,
    status: item.status,
    description: item.description,
    scopes: item.scopes,
    rules: item.rules,
    uploadRoles: item.uploadRoles,
    viewRoles: item.viewRoles,
    approvalRoles: item.approvalRoles,
    externalLinks: item.externalLinks,
    notes: item.notes || null,
  };
}

function toQuery(filters?: Partial<DocumentCategoryFilters>) {
  const params = new URLSearchParams();
  params.set("take", "300");
  if (filters?.search?.trim()) params.set("search", filters.search.trim());
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.scope) params.set("scope", filters.scope);
  if (filters?.mandatory) params.set("mandatory", filters.mandatory);
  if (filters?.expires) params.set("expires", filters.expires);
  if (filters?.status) params.set("status", filters.status);
  return `?${params.toString()}`;
}

function nextCode(items: DocumentCategory[]) {
  const max = items.reduce((value, item) => Math.max(value, Number(item.code.replace(/\D/g, "")) || 0), 0);
  return `DOC-${String(max + 1).padStart(3, "0")}`;
}

function matchesFilters(item: DocumentCategory, filters: DocumentCategoryFilters) {
  const search = filters.search.trim().toLowerCase();
  const text = `${item.code} ${item.name} ${item.description} ${item.kind} ${item.scopes.join(" ")} ${item.externalLinks.map((link) => `${link.provider} ${link.code} ${link.name}`).join(" ")}`.toLowerCase();
  if (search && !text.includes(search)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.scope && !item.scopes.includes(filters.scope as DocumentCategoryScope)) return false;
  if (filters.mandatory && String(item.rules.mandatory) !== filters.mandatory) return false;
  if (filters.expires && String(item.rules.expires) !== filters.expires) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

function isDocumentCategoryList(value: DocumentCategory[]) {
  return Array.isArray(value) && value.every((item) => typeof item.id === "string" && typeof item.code === "string" && typeof item.name === "string");
}

export const documentCategoryApiService = {
  async getAll(filters?: Partial<DocumentCategoryFilters>) {
    const query = toQuery(filters);
    const key = `/document-categories${query}`;
    return cachedData({
      requestKey: `GET:${key}`,
      policy: cachePolicies.documentCategoriesCatalog,
      fetcher: () => apiRequest<ApiListResponse>(key, { apiCache: false }).then((response) => response.data.map(mapFromApi)),
      validate: isDocumentCategoryList,
    });
  },
  async create(item: DocumentCategory) {
    const response = await apiRequest<ApiItemResponse>("/document-categories", {
      method: "POST",
      body: mapToApi(item),
    });
    await invalidateCacheFamily("document-categories", "document category created");
    return mapFromApi(response.data);
  },
  async update(id: string, item: DocumentCategory) {
    const response = await apiRequest<ApiItemResponse>(`/document-categories/${id}`, {
      method: "PATCH",
      body: mapToApi(item),
    });
    await invalidateCacheFamily("document-categories", "document category updated");
    return mapFromApi(response.data);
  },
  getEmptyFilters: (): DocumentCategoryFilters => ({ search: "", kind: "", scope: "", mandatory: "", expires: "", status: "ACTIVO" }),
  getFiltered: (items: DocumentCategory[], filters: DocumentCategoryFilters) => items.filter((item) => matchesFilters(item, filters)),
  getFilterOptions: (items: DocumentCategory[]) => ({
    kinds: Array.from(new Set(items.map((item) => item.kind))).sort(),
    scopes: Array.from(new Set(items.flatMap((item) => item.scopes))).sort(),
    statuses: ["ACTIVO", "INACTIVO"],
  }),
  getNextCode: nextCode,
};
