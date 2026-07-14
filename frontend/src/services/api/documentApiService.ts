import { apiDownload, apiRequest } from "./apiClient";
import { invalidateCacheFamily } from "../cache";
import type { DocumentMock } from "../../types";

type ApiDocumentStatus = "PENDIENTE" | "VIGENTE" | "POR_VENCER" | "VENCIDO" | "RECHAZADO";

type ApiEmployeeDocument = {
  id: string;
  employeeId: string;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  storageKey: string;
  notes?: string | null;
  status: ApiDocumentStatus;
  issuedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  category?: {
    id: string;
    code: string;
    name: string;
  };
  employee?: {
    id: string;
    legajo: string;
    firstName: string;
    lastName: string;
  };
};

type ApiEmployeeDetail = {
  id: string;
  documents?: ApiEmployeeDocument[];
};

type ApiEmployeeDetailResponse = { data: ApiEmployeeDetail };
type ApiListMeta = { total: number; page: number; pageSize: number; hasMore: boolean };
type ApiDocumentsListResponse = { data: ApiEmployeeDocument[]; meta: ApiListMeta };

export type DocumentListFilters = {
  page?: number;
  take?: number;
  search?: string;
  employeeId?: string;
  categoryId?: string;
  status?: ApiDocumentStatus;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toFrontendStatus(status: ApiDocumentStatus) {
  const map: Record<ApiDocumentStatus, string> = {
    PENDIENTE: "Pendiente",
    VIGENTE: "Vigente",
    POR_VENCER: "Por vencer",
    VENCIDO: "Vencido",
    RECHAZADO: "Rechazado",
  };
  return map[status] || status;
}

function toApiStatus(status: string): ApiDocumentStatus {
  if (status === "Vigente") return "VIGENTE";
  if (status === "Por vencer") return "POR_VENCER";
  if (status === "Vencido") return "VENCIDO";
  if (status === "Rechazado") return "RECHAZADO";
  return "PENDIENTE";
}

function mapFromApi(item: ApiEmployeeDocument): DocumentMock {
  return {
    id: item.id,
    employeeId: item.employeeId,
    category: item.category?.name || "Sin categoría",
    categoryId: item.category?.id,
    fileName: item.fileName,
    uploadedAt: dateOnly(item.createdAt),
    expiresAt: dateOnly(item.expiresAt) || undefined,
    status: toFrontendStatus(item.status),
    notes: item.notes || undefined,
    employeeLegajo: item.employee?.legajo,
    employeeName: item.employee ? `${item.employee.lastName}, ${item.employee.firstName}` : undefined,
  };
}

async function getEmployeeDocuments(employeeId: string) {
  const response = await apiRequest<ApiDocumentsListResponse>(`/documents?employeeId=${employeeId}&page=1&take=100`);
  return response.data.map(mapFromApi);
}

export const documentApiService = {
  getByEmployee: getEmployeeDocuments,

  async list(filters: DocumentListFilters = {}) {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("take", String(filters.take || 25));
    if (filters.search?.trim()) params.set("search", filters.search.trim());
    if (filters.employeeId) params.set("employeeId", filters.employeeId);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.status) params.set("status", filters.status);
    const response = await apiRequest<ApiDocumentsListResponse>(`/documents?${params.toString()}`);
    return {
      items: response.data.map(mapFromApi),
      meta: response.meta,
    };
  },

  async getAll() {
    const response = await this.list({ take: 100 });
    return response.items;
  },

  async create(input: {
    employeeId: string;
    categoryId: string;
    noveltyId?: string;
    fileName: string;
    fileMimeType: string;
    fileSizeBytes: number;
    fileBase64?: string;
    status: string;
    expiresAt?: string;
    issuedAt?: string;
    notes?: string;
  }) {
    if (!uuidPattern.test(input.categoryId)) {
      throw new Error("DOCUMENT_CATEGORY_NOT_BACKEND_READY");
    }

    const response = await apiRequest<ApiEmployeeDetailResponse>(`/employees/${input.employeeId}/documents`, {
      method: "POST",
      body: {
        categoryId: input.categoryId,
        noveltyId: input.noveltyId || null,
        fileName: input.fileName,
        fileMimeType: input.fileMimeType || "application/octet-stream",
        fileSizeBytes: input.fileSizeBytes || 1,
        fileBase64: input.fileBase64 || null,
        status: toApiStatus(input.status),
        notes: input.notes || null,
        issuedAt: input.issuedAt || null,
        expiresAt: input.expiresAt || null,
      },
    });

    await Promise.all([
      invalidateCacheFamily("dashboard", "employee document created"),
      invalidateCacheFamily("employees", "employee document created"),
    ]);
    return (response.data.documents || []).map(mapFromApi);
  },

  async download(document: Pick<DocumentMock, "id" | "fileName">) {
    const result = await apiDownload(`/documents/${document.id}/download`);
    const url = URL.createObjectURL(result.blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = result.fileName || document.fileName;
    link.rel = "noopener";
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
