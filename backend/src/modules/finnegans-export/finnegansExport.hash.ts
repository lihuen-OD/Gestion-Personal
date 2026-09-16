import { createHash } from "node:crypto";

// Etapa 15L.4 (docs/decisions/FINNEGANS_EXPORT_HISTORY_IDEMPOTENCY_15L4.md
// §13): hash determinista del dataset definitivo — sólo sobre las 7
// columnas que realmente se exportan (nunca ids, nunca employeeName/detail,
// que son ayudas de presentación, no lo que Finnegans recibe). Cada fila se
// serializa de forma estable y el conjunto se ordena ANTES de unir, así que
// el mismo contenido en distinto orden de filas da el mismo hash (test H) y
// cualquier cambio real en algún campo da un hash distinto (test I).
export interface HashableExportRow {
  legajo: string;
  noveltyCode: string;
  costCenter: string;
  value1: string;
  applicationDate: string;
  validFrom: string;
  validTo: string;
}

function rowKey(row: HashableExportRow): string {
  return [row.legajo, row.noveltyCode, row.costCenter, row.value1, row.applicationDate, row.validFrom, row.validTo].join("|");
}

export function computeExportHash(rows: readonly HashableExportRow[]): string {
  const canonical = rows.map(rowKey).sort().join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
