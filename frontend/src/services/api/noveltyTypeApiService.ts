import { apiRequest } from "./apiClient";
import type {
  FinnegansNoveltyLink,
  NoveltyTimeImpact,
  NoveltyType,
  NoveltyTypeFilters,
  NoveltyTypeKind,
  NoveltyTypeOrigin,
  NoveltyTypeStatus,
  NoveltyUiColor,
} from "../../types/noveltyType.types";
import type { Role } from "../../types";
import { resolveNoveltyUiColor } from "../../utils/noveltyColor";

type ApiNoveltyUiColor = Exclude<NoveltyUiColor, "purple">;

type ApiFinnegansNoveltyLink = {
  id?: string;
  code: string;
  name: string;
  exportConcept: string;
  priority: number;
  status: NoveltyTypeStatus;
  hasValidity: boolean;
  notes?: string | null;
};

type ApiNoveltyType = {
  id: string;
  code: string;
  name: string;
  uiColor: ApiNoveltyUiColor;
  kind: NoveltyTypeKind;
  origin: NoveltyTypeOrigin;
  status: NoveltyTypeStatus;
  description?: string | null;
  exportsToFinnegans: boolean;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  allowsHours: boolean;
  allowsDateTo: boolean;
  hasValidity: boolean;
  blocksTimeEntry: boolean;
  setsWorkedHoursToZero: boolean;
  timeImpact: NoveltyTimeImpact;
  allowedLoadRoles?: Role[];
  approvalRoles?: Role[];
  finnegansLinks: ApiFinnegansNoveltyLink[];
  createdAt: string;
  updatedAt: string;
};

type ApiListResponse = { data: ApiNoveltyType[] };
type ApiItemResponse = { data: ApiNoveltyType };

const listCache = new Map<string, Promise<NoveltyType[]>>();

const fallbackApprovalRoles: Role[] = ["Nivel 1 - RRHH"];
const fallbackAllowedLoadRoles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];
const validRoles: Role[] = ["Nivel 1 - RRHH", "Nivel 2 - Supervisión / Gestión", "Nivel 3 - Administrativo de Carga Horaria"];

function normalizeRoles(value: unknown, fallback: Role[]): Role[] {
  if (!Array.isArray(value)) return fallback;
  const roles = value.filter((item): item is Role => validRoles.includes(item as Role));
  return roles.length ? roles : fallback;
}

function mapColorToApi(color: NoveltyUiColor): ApiNoveltyUiColor {
  return color === "purple" ? "violet" : color;
}

function mapLinkFromApi(link: ApiFinnegansNoveltyLink): FinnegansNoveltyLink {
  return {
    id: link.id || crypto.randomUUID(),
    code: link.code,
    name: link.name,
    exportConcept: link.exportConcept,
    priority: link.priority,
    status: link.status,
    notes: link.notes || "",
    hasValidity: link.hasValidity,
  };
}

function mapLinkToApi(link: FinnegansNoveltyLink): ApiFinnegansNoveltyLink | null {
  if (!link.code.trim()) return null;
  return {
    code: link.code.trim(),
    name: link.name.trim(),
    exportConcept: link.exportConcept.trim(),
    priority: Number(link.priority) || 1,
    status: link.status,
    hasValidity: Boolean(link.hasValidity),
    notes: link.notes?.trim() || null,
  };
}

function mapFromApi(item: ApiNoveltyType): NoveltyType {
  const allowedLoadRoles = normalizeRoles(item.allowedLoadRoles, fallbackAllowedLoadRoles);
  const approvalRoles = normalizeRoles(item.approvalRoles, fallbackApprovalRoles);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    uiColor: resolveNoveltyUiColor(item.uiColor, item.id || item.name || item.code),
    kind: item.kind,
    origin: item.origin,
    description: item.description || "",
    status: item.status,
    rules: {
      exportsToFinnegans: item.exportsToFinnegans,
      requiresApproval: item.requiresApproval,
      requiresDocumentation: item.requiresDocumentation,
      allowsHours: item.allowsHours,
      allowsDateTo: item.allowsDateTo,
      hasValidity: item.hasValidity,
      blocksTimeEntry: item.blocksTimeEntry,
      setsWorkedHoursToZero: item.setsWorkedHoursToZero,
      timeImpact: item.timeImpact,
    },
    allowedLoadRoles,
    approvalRoles,
    finnegansLinks: (item.finnegansLinks || []).map(mapLinkFromApi),
    notes: "",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: "Backend",
    updatedBy: "Backend",
    history: [],
  };
}

function mapToApi(item: NoveltyType) {
  return {
    code: item.code,
    name: item.name,
    uiColor: mapColorToApi(item.uiColor),
    kind: item.kind,
    origin: item.origin,
    status: item.status,
    description: item.description || null,
    exportsToFinnegans: item.rules.exportsToFinnegans,
    requiresApproval: item.rules.requiresApproval,
    requiresDocumentation: item.rules.requiresDocumentation,
    allowsHours: item.rules.allowsHours,
    allowsDateTo: item.rules.allowsDateTo,
    hasValidity: item.rules.hasValidity,
    blocksTimeEntry: item.rules.blocksTimeEntry,
    setsWorkedHoursToZero: item.rules.setsWorkedHoursToZero,
    timeImpact: item.rules.timeImpact,
    allowedLoadRoles: item.allowedLoadRoles,
    approvalRoles: item.approvalRoles,
    finnegansLinks: item.finnegansLinks.map(mapLinkToApi).filter(Boolean),
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

export const noveltyTypeApiService = {
  async getAll(filters?: Partial<NoveltyTypeFilters>) {
    const query = toQuery(filters);
    const key = `/novelty-types${query}`;
    if (!listCache.has(key)) {
      listCache.set(key, apiRequest<ApiListResponse>(key).then((response) => response.data.map(mapFromApi)));
    }
    return listCache.get(key)!;
  },

  async getById(id: string) {
    const response = await apiRequest<ApiItemResponse>(`/novelty-types/${id}`);
    return mapFromApi(response.data);
  },

  async create(item: NoveltyType) {
    const response = await apiRequest<ApiItemResponse>("/novelty-types", {
      method: "POST",
      body: mapToApi(item),
    });
    listCache.clear();
    return mapFromApi(response.data);
  },

  async update(id: string, item: NoveltyType) {
    const response = await apiRequest<ApiItemResponse>(`/novelty-types/${id}`, {
      method: "PATCH",
      body: mapToApi(item),
    });
    listCache.clear();
    return mapFromApi(response.data);
  },

  getNextCode: nextCode,
};
