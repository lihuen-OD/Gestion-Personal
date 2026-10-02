import * as XLSX from "xlsx";

// Export de horas (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md): el backend
// define columnas y valores (Horas base, Horas normales, cada concepto en
// horas reales y para liquidación, Total trabajado, Equivalencia para
// liquidación). Este archivo sólo los escribe: no calcula ni agrega columnas.
export type HoursExportColumn = { key: string; kind: "text" | "hours" };
export type HoursExportRow = Record<string, string>;

function cellValue(column: HoursExportColumn, row: HoursExportRow) {
  const raw = row[column.key] ?? "";
  if (column.kind !== "hours") return raw;
  const numeric = Number(raw);
  return raw !== "" && Number.isFinite(numeric) ? numeric : raw;
}

export function buildHoursExportSheetRows(columns: HoursExportColumn[], rows: HoursExportRow[]) {
  return [columns.map((column) => column.key), ...rows.map((row) => columns.map((column) => cellValue(column, row)))];
}

export function buildHoursExportWorkbook(columns: HoursExportColumn[], rows: HoursExportRow[], period: string) {
  const worksheet = XLSX.utils.aoa_to_sheet(buildHoursExportSheetRows(columns, rows));
  worksheet["!cols"] = columns.map((column) => ({ wch: Math.min(Math.max(column.key.length + 2, column.kind === "hours" ? 12 : 16), 40) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  XLSX.writeFile(workbook, `horas_trabajadas_${period}.xlsx`, { compression: true });
}
