import { describe, expect, it } from "vitest";
import { buildHoursExportSheetRows, type HoursExportColumn } from "./hoursExport";

// docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md — export obligatorio: base 8 +
// Sereno 3 + Colectivo 1 en domingo x2. El frontend escribe exactamente las
// columnas y valores del backend; no calcula ni agrega columnas.
describe("buildHoursExportSheetRows", () => {
  const columns: HoursExportColumn[] = [
    { key: "Legajo", kind: "text" },
    { key: "Horas base", kind: "hours" },
    { key: "Horas normales", kind: "hours" },
    { key: "Sereno (horas reales)", kind: "hours" },
    { key: "Colectivo (horas reales)", kind: "hours" },
    { key: "Total trabajado", kind: "hours" },
    { key: "Horas normales (para liquidación)", kind: "hours" },
    { key: "Sereno (para liquidación)", kind: "hours" },
    { key: "Colectivo (para liquidación)", kind: "hours" },
    { key: "Equivalencia para liquidación", kind: "hours" },
    { key: "Estado", kind: "text" },
  ];
  const row = {
    Legajo: "0001",
    "Horas base": "8",
    "Horas normales": "5",
    "Sereno (horas reales)": "3",
    "Colectivo (horas reales)": "1",
    "Total trabajado": "9",
    "Horas normales (para liquidación)": "10",
    "Sereno (para liquidación)": "6",
    "Colectivo (para liquidación)": "2",
    "Equivalencia para liquidación": "18",
    Estado: "APROBADO",
  };

  it("respeta el orden de columnas del backend y convierte sólo las columnas de horas a número", () => {
    expect(buildHoursExportSheetRows(columns, [row])).toEqual([
      columns.map((column) => column.key),
      ["0001", 8, 5, 3, 1, 9, 10, 6, 2, 18, "APROBADO"],
    ]);
  });

  it("no agrega ninguna columna de 'Total liquidable' propia", () => {
    const [header] = buildHoursExportSheetRows(columns, [row]);
    expect(header).not.toContain("Total liquidable");
  });

  it("deja vacío un valor ausente en vez de inventar un cero", () => {
    const [, values] = buildHoursExportSheetRows(columns, [{ Legajo: "0002" }]);
    expect(values).toEqual(["0002", "", "", "", "", "", "", "", "", "", ""]);
  });
});
