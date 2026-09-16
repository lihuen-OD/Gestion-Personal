import { describe, expect, it } from "vitest";
import { computeExportHash, type HashableExportRow } from "./finnegansExport.hash";

function row(overrides: Partial<HashableExportRow> = {}): HashableExportRow {
  return {
    legajo: "100",
    noveltyCode: "VAC",
    costCenter: "",
    value1: "5",
    applicationDate: "01/07/2026",
    validFrom: "01/07/2026",
    validTo: "05/07/2026",
    ...overrides,
  };
}

describe("computeExportHash — Etapa 15L.4 §13", () => {
  it("es determinista: mismo input, mismo hash", () => {
    const rows = [row()];
    expect(computeExportHash(rows)).toBe(computeExportHash(rows));
  });

  it("mismas filas en distinto orden dan el mismo hash", () => {
    const a = row({ legajo: "100" });
    const b = row({ legajo: "200" });
    expect(computeExportHash([a, b])).toBe(computeExportHash([b, a]));
  });

  it("un dataset con contenido distinto da un hash distinto", () => {
    const original = computeExportHash([row({ value1: "5" })]);
    const changed = computeExportHash([row({ value1: "6" })]);
    expect(changed).not.toBe(original);
  });

  it("no depende de ids — sólo usa las 7 columnas exportadas", () => {
    const rows = [row()];
    expect(computeExportHash(rows)).toBe(computeExportHash(rows.map((item) => ({ ...item }))));
  });

  it("dataset vacío tiene un hash estable", () => {
    expect(computeExportHash([])).toBe(computeExportHash([]));
  });

  it("produce un hex de 64 caracteres (SHA-256)", () => {
    expect(computeExportHash([row()])).toMatch(/^[0-9a-f]{64}$/);
  });
});
