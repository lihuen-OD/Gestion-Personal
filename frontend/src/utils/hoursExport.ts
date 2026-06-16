import * as XLSX from "xlsx";

export type HoursExportRow = {
  cuil: string;
  apellido: string;
  nombre: string;
  legajo: string;
  empresa: string;
  centroCosto: string;
  horasNormales: number;
  horasEspeciales: number;
  horasTotales: number;
  estado: string;
};

export function buildHoursExportWorkbook(rows: HoursExportRow[], period: string) {
  const headers = ["CUIL", "Apellido", "Nombre", "Legajo", "Empresa", "Centro de costo", "Horas normales", "Horas especiales", "Horas trabajadas totales", "Estado"];
  const sheetRows = [
    headers,
    ...rows.map((row) => [row.cuil, row.apellido, row.nombre, row.legajo, row.empresa, row.centroCosto, row.horasNormales, row.horasEspeciales, row.horasTotales, row.estado]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 24 },
    { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  XLSX.writeFile(workbook, `horas_trabajadas_${period}.xlsx`, { compression: true });
}
