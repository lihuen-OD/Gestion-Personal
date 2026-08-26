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
  // Etapa 8F: valor derivado de una Hora Especial (Domingo, Feriado, …) —
  // nunca forma parte de horasTotales (horas reales trabajadas).
  horasEspecialesEquivalentes: number;
  adicionalPorHorasEspeciales: number;
  reglasAplicadas: string;
  estado: string;
};

export function buildHoursExportWorkbook(rows: HoursExportRow[], period: string) {
  const headers = ["CUIL", "Apellido", "Nombre", "Legajo", "Empresa", "Centro de costo", "Horas normales", "Horas especiales", "Horas trabajadas totales", "Horas especiales (equivalente liquidable)", "Adicional por horas especiales", "Reglas de horas especiales aplicadas", "Estado"];
  const sheetRows = [
    headers,
    ...rows.map((row) => [row.cuil, row.apellido, row.nombre, row.legajo, row.empresa, row.centroCosto, row.horasNormales, row.horasEspeciales, row.horasTotales, row.horasEspecialesEquivalentes, row.adicionalPorHorasEspeciales, row.reglasAplicadas, row.estado]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 24 },
    { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 28 },
    { wch: 24 }, { wch: 32 }, { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  XLSX.writeFile(workbook, `horas_trabajadas_${period}.xlsx`, { compression: true });
}
