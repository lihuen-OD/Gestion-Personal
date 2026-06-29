import { apiRequest } from "./apiClient";

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
};

type ApiResponse = { data: { total: number; rows: ApiFinnegansRow[] } };

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
  };
}

export const finnegansExportApiService = {
  async getNoveltyRows(period: string) {
    const params = new URLSearchParams({ period });
    const response = await apiRequest<ApiResponse>(`/finnegans-export/novelties?${params.toString()}`);
    return response.data.rows.map(mapFromApi);
  },
};
