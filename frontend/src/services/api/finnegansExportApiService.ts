import { apiRequest } from "./apiClient";

// Etapa 15L.3A (docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md): estado
// de preparación de una fila, calculado en el backend — nunca se infiere en
// el frontend.
export type FinnegansRowStatus = "LISTO" | "FALTA_CANTIDAD" | "FALTA_CONFIGURACION" | "CIERRE_PENDIENTE";

export type FinnegansReadinessSummary = {
  ready: boolean;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  reasons: string[];
};

export type FinnegansExportRow = {
  id: string;
  source: "Novedad";
  employeeName: string;
  legajo: string;
  novedad: string;
  centroCosto: string;
  valor1: string;
  fechaAplicacion: string;
  fechaDesde: string;
  fechaHasta: string;
  detail: string;
  estado: FinnegansRowStatus;
};

export type FinnegansExportFormat = "XLSX" | "CSV";

export type FinnegansExportDiffSummary = {
  added: number;
  removed: number;
  modified: number;
};

// Etapa 15L.4 (docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md):
// `id` viaja sólo como referencia de navegación (para pedir el detalle) —
// nunca se muestra como texto en pantalla.
export type FinnegansExportBatchSummary = {
  id: string;
  version: number;
  format: FinnegansExportFormat;
  createdAt: string;
  createdByName: string | null;
  rowCount: number;
  reason: string | null;
  isReexport: boolean;
  sameAsPrevious: boolean;
};

export type FinnegansExportPreview = {
  period: string;
  rows: FinnegansExportRow[];
  readiness: FinnegansReadinessSummary;
  hash: string;
  lastExport: (FinnegansExportBatchSummary & { sameAsCurrent: boolean }) | null;
};

export type FinnegansExportResult = {
  period: string;
  rows: FinnegansExportRow[];
  readiness: FinnegansReadinessSummary;
  batch: FinnegansExportBatchSummary & { diff: FinnegansExportDiffSummary | null };
};

// Etapa 15L.4 §33: cada versión trae el resumen de diff contra su anterior
// inmediata (null para la primera versión de un período).
export type FinnegansExportHistoryEntry = FinnegansExportBatchSummary & { diff: FinnegansExportDiffSummary | null };

export type FinnegansExportHistory = {
  period: string;
  batches: FinnegansExportHistoryEntry[];
};

export type FinnegansExportHistoryDetail = {
  batch: FinnegansExportBatchSummary;
  rows: FinnegansExportRow[];
  diff: FinnegansExportDiffSummary | null;
};

type ApiFinnegansRow = {
  Legajo: string;
  Novedad: string;
  "Centro de costo": string;
  "Valor 1": string;
  "Fecha Aplicación": string;
  "Fecha desde": string;
  "Fecha hasta": string;
  sourceId?: string;
  employeeName?: string;
  detail?: string;
  estado?: FinnegansRowStatus;
};

type ApiPreviewResponse = {
  data: { period: string; rows: ApiFinnegansRow[]; readiness: FinnegansReadinessSummary; hash: string; lastExport: (FinnegansExportBatchSummary & { sameAsCurrent: boolean }) | null };
};

type ApiExportResponse = {
  data: { period: string; rows: ApiFinnegansRow[]; readiness: FinnegansReadinessSummary; batch: FinnegansExportBatchSummary & { diff: FinnegansExportDiffSummary | null } };
};

type ApiHistoryResponse = { data: FinnegansExportHistory };

type ApiHistoryDetailResponse = { data: { batch: FinnegansExportBatchSummary; rows: ApiFinnegansRow[]; diff: FinnegansExportDiffSummary | null } };

function mapFromApi(row: ApiFinnegansRow, index: number): FinnegansExportRow {
  return {
    id: row.sourceId || `fin-${index}`,
    source: "Novedad",
    employeeName: row.employeeName || "-",
    legajo: row.Legajo,
    novedad: row.Novedad,
    centroCosto: row["Centro de costo"],
    valor1: row["Valor 1"],
    fechaAplicacion: row["Fecha Aplicación"],
    fechaDesde: row["Fecha desde"],
    fechaHasta: row["Fecha hasta"],
    detail: row.detail || "Novedad exportable",
    estado: row.estado || "LISTO",
  };
}

export const finnegansExportApiService = {
  // Etapa 15L.3A §15/§26 / 15L.4 §29: sólo informa — nunca exige cierre
  // mensual aprobado y nunca queda auditada ni crea historial. Además del
  // dataset y el readiness, trae `hash` (para comparar sin exportar) y
  // `lastExport` (resumen de la última exportación definitiva del período,
  // si existe).
  async getPreview(period: string): Promise<FinnegansExportPreview> {
    const params = new URLSearchParams({ period, preview: "true" });
    const response = await apiRequest<ApiPreviewResponse>(`/finnegans-export/novelties?${params.toString()}`);
    return {
      period: response.data.period,
      rows: response.data.rows.map(mapFromApi),
      readiness: response.data.readiness,
      hash: response.data.hash,
      lastExport: response.data.lastExport,
    };
  },

  // Etapa 15L.4 §18/§22/§23: operación definitiva — revalida todo en el
  // backend y, si autoriza, deja un batch persistente. `idempotencyKey` se
  // genera una vez por intento de exportación (crypto.randomUUID()); un
  // reintento con la misma key nunca crea una versión nueva.
  async exportDefinitive(input: { period: string; format: FinnegansExportFormat; reexportReason?: string; idempotencyKey: string }): Promise<FinnegansExportResult> {
    const response = await apiRequest<ApiExportResponse>("/finnegans-export/novelties/export", { method: "POST", body: input });
    return {
      period: response.data.period,
      rows: response.data.rows.map(mapFromApi),
      readiness: response.data.readiness,
      batch: response.data.batch,
    };
  },

  // Etapa 15L.4 §26: historial de exportaciones definitivas de un período,
  // más nueva primero.
  async getHistory(period: string): Promise<FinnegansExportHistory> {
    const params = new URLSearchParams({ period });
    const response = await apiRequest<ApiHistoryResponse>(`/finnegans-export/history?${params.toString()}`);
    return response.data;
  },

  // Etapa 15L.4 §27: detalle de un batch — metadata + snapshot de filas +
  // comparación contra el anterior.
  async getHistoryDetail(batchId: string): Promise<FinnegansExportHistoryDetail> {
    const response = await apiRequest<ApiHistoryDetailResponse>(`/finnegans-export/history/${batchId}`);
    return {
      batch: response.data.batch,
      rows: response.data.rows.map(mapFromApi),
      diff: response.data.diff,
    };
  },
};
