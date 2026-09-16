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

export type FinnegansExportPreview = {
  period: string;
  rows: FinnegansExportRow[];
  readiness: FinnegansReadinessSummary;
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

type ApiResponse = { data: { period: string; rows: ApiFinnegansRow[]; readiness: FinnegansReadinessSummary } };

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

function mapPreview(response: ApiResponse): FinnegansExportPreview {
  return { period: response.data.period, rows: response.data.rows.map(mapFromApi), readiness: response.data.readiness };
}

export const finnegansExportApiService = {
  // Etapa 15L.3A §15/§26: sólo informa — nunca exige cierre mensual
  // aprobado y nunca queda auditada como una exportación realizada. El
  // botón "Exportar Excel" nunca genera el archivo con estas filas.
  async getPreview(period: string) {
    const params = new URLSearchParams({ period, preview: "true" });
    const response = await apiRequest<ApiResponse>(`/finnegans-export/novelties?${params.toString()}`);
    return mapPreview(response);
  },

  // Etapa 15L.3A §15/§18/§26: operación definitiva — revalida todo en el
  // backend (readiness + cierre mensual aprobado de cada empleado incluido).
  // Sólo el resultado de esta llamada puede usarse para generar el .xlsx.
  async getDefinitive(period: string) {
    const params = new URLSearchParams({ period });
    const response = await apiRequest<ApiResponse>(`/finnegans-export/novelties?${params.toString()}`);
    return mapPreview(response);
  },
};
