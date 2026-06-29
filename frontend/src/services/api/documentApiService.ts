import { apiDownload, apiRequest } from "./apiClient";
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
type ApiDocumentsListResponse = { data: ApiEmployeeDocument[] };

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
  };
}

async function getEmployeeDocuments(employeeId: string) {
  const response = await apiRequest<ApiEmployeeDetailResponse>(`/employees/${employeeId}`);
  return (response.data.documents || []).map(mapFromApi);
}

export const documentApiService = {
  getByEmployee: getEmployeeDocuments,

  async getAll() {
    const response = await apiRequest<ApiDocumentsListResponse>("/documents?take=500");
    return response.data.map(mapFromApi);
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
