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
  // Etapa 11B: equivalente liquidable de Conceptos Horarios adicionales
  // (Sereno/Colectivo/etc.) cuando caen dentro de una Hora Especial — antes
  // de esta etapa no existía, el export ignoraba por completo que la Hora
  // Especial también alcanza a los conceptos (ver 11A.1, ya corregido en la
  // grilla). "Adicional por horas especiales" y "Total liquidable" ahora
  // incluyen esta parte además de Hora normal.
  conceptosHorariosEquivalentes: number;
  adicionalPorHorasEspeciales: number;
  totalLiquidable: number;
  reglasAplicadas: string;
  conflictoDeReglas: string;
  estado: string;
};

export function buildHoursExportWorkbook(rows: HoursExportRow[], period: string) {
  const headers = [
    "CUIL", "Apellido", "Nombre", "Legajo", "Empresa", "Centro de costo",
    "Horas normales", "Horas especiales", "Horas trabajadas totales",
    "Horas especiales (equivalente liquidable)", "Conceptos horarios (equivalente liquidable)",
    "Adicional por horas especiales", "Total liquidable",
    "Reglas de horas especiales aplicadas", "Conflicto de reglas", "Estado",
  ];
  const sheetRows = [
    headers,
    ...rows.map((row) => [
      row.cuil, row.apellido, row.nombre, row.legajo, row.empresa, row.centroCosto,
      row.horasNormales, row.horasEspeciales, row.horasTotales,
      row.horasEspecialesEquivalentes, row.conceptosHorariosEquivalentes,
      row.adicionalPorHorasEspeciales, row.totalLiquidable,
      row.reglasAplicadas, row.conflictoDeReglas, row.estado,
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 24 },
    { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 28 },
    { wch: 30 }, { wch: 24 }, { wch: 18 },
    { wch: 32 }, { wch: 16 }, { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Horas");
  XLSX.writeFile(workbook, `horas_trabajadas_${period}.xlsx`, { compression: true });
}
