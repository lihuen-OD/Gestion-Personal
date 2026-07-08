import { apiRequest } from "./apiClient";
import { cachePolicies, cachedData } from "../cache";
import type { SalaryGroup } from "../salaryRangeMockService";

type ApiSalaryCategory = {
  id: string;
  name: string;
  family?: string | null;
  order: number;
  status: "ACTIVO" | "INACTIVO";
};

type ApiListResponse = {
  data: ApiSalaryCategory[];
  meta?: { total: number; page: number; pageSize: number; hasMore: boolean };
};

function toGroups(items: ApiSalaryCategory[]): SalaryGroup[] {
  const active = items.filter((item) => item.status === "ACTIVO");
  const families = Array.from(new Set(active.map((item) => item.family || "Otros")));
  return families.map((family) => ({
    id: family.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-"),
    label: family,
    description: `Categorias ${family.toLowerCase()}.`,
    categories: active
      .filter((item) => (item.family || "Otros") === family)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "es"))
      .map((item) => item.name),
  })).filter((group) => group.categories.length);
}

function isSalaryCategoryList(value: ApiSalaryCategory[]) {
  return Array.isArray(value) && value.every((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.order === "number");
}

export const salaryCategoryApiService = {
  async getAll() {
    return cachedData({
      requestKey: "GET:/salary-categories?take=300",
      policy: cachePolicies.salaryCategoriesCatalog,
      fetcher: () => apiRequest<ApiListResponse>("/salary-categories?take=300", { apiCache: false }).then((response) => response.data),
      validate: isSalaryCategoryList,
    });
  },

  async getGroups() {
    return toGroups(await salaryCategoryApiService.getAll());
  },
};
