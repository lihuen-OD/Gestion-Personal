import type { FinnegansValueUnit } from "@prisma/client";

// Etapa 15L.3A (docs/decisions/FINNEGANS_EXPORT_NORMALIZED_15L3A.md): motivos
// por los que una novedad candidata todavía no puede exportarse en forma
// definitiva. No incluye nada de negocio inventado — cada código corresponde
// a una regla explícita del pedido de esta etapa (§9, §11, §12, §18).
export type FinnegansReadinessReasonCode =
  | "MISSING_LINK"
  | "MISSING_VALUE_UNIT"
  | "MISSING_HOURS_QUANTITY"
  | "MISSING_DAYS_QUANTITY"
  | "MISSING_VALIDITY_TO_DATE"
  | "CLOSURE_NOT_APPROVED";

// Estado visible en la tabla de preview (Etapa 15L.3A §30). "Falta
// configuración" agrupa todo lo que depende del catálogo (vínculo, unidad de
// Valor 1, vigencia incompleta); "Falta cantidad" es específico de
// quantityHours/quantityDays; "Cierre pendiente" es el único estado que
// depende del empleado, no del tipo de novedad.
export type FinnegansRowStatus = "LISTO" | "FALTA_CANTIDAD" | "FALTA_CONFIGURACION" | "CIERRE_PENDIENTE";

export interface NoveltyReadinessInput {
  quantityHours: { toString(): string } | null;
  quantityDays: { toString(): string } | null;
  toDate: Date | null;
  finnegansValueUnit: FinnegansValueUnit | null;
  finnegansRequiresValidity: boolean;
  hasFinnegansCode: boolean;
  closureApproved: boolean;
}

export interface NoveltyReadiness {
  ready: boolean;
  estado: FinnegansRowStatus;
  reasonCodes: FinnegansReadinessReasonCode[];
}

// Etapa 15L.3A §8/§9/§11: Valor 1 depende exclusivamente de
// finnegansValueUnit — sin fallback quantityHours→quantityDays→"1". Un tipo
// con finnegansValueUnit=null queda "sin determinar" (MISSING_VALUE_UNIT);
// HOURS/DAYS exigen la cantidad correspondiente, sin inventar 0 ni tomar la
// otra cantidad; UNIT nunca exige ninguna cantidad.
export function evaluateNoveltyReadiness(input: NoveltyReadinessInput): NoveltyReadiness {
  const reasonCodes: FinnegansReadinessReasonCode[] = [];

  if (!input.hasFinnegansCode) reasonCodes.push("MISSING_LINK");

  const unit = input.finnegansValueUnit;
  if (!unit) {
    reasonCodes.push("MISSING_VALUE_UNIT");
  } else if (unit === "HOURS" && input.quantityHours == null) {
    reasonCodes.push("MISSING_HOURS_QUANTITY");
  } else if (unit === "DAYS" && input.quantityDays == null) {
    reasonCodes.push("MISSING_DAYS_QUANTITY");
  }

  if (input.finnegansRequiresValidity && !input.toDate) {
    reasonCodes.push("MISSING_VALIDITY_TO_DATE");
  }

  if (!input.closureApproved) reasonCodes.push("CLOSURE_NOT_APPROVED");

  return { ready: reasonCodes.length === 0, estado: resolveRowStatus(reasonCodes), reasonCodes };
}

function resolveRowStatus(reasonCodes: FinnegansReadinessReasonCode[]): FinnegansRowStatus {
  if (reasonCodes.includes("MISSING_LINK") || reasonCodes.includes("MISSING_VALUE_UNIT") || reasonCodes.includes("MISSING_VALIDITY_TO_DATE")) {
    return "FALTA_CONFIGURACION";
  }
  if (reasonCodes.includes("MISSING_HOURS_QUANTITY") || reasonCodes.includes("MISSING_DAYS_QUANTITY")) {
    return "FALTA_CANTIDAD";
  }
  if (reasonCodes.includes("CLOSURE_NOT_APPROVED")) return "CIERRE_PENDIENTE";
  return "LISTO";
}

export interface FinnegansReadinessSummary {
  ready: boolean;
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  reasons: string[];
}

const REASON_ORDER: FinnegansReadinessReasonCode[] = [
  "MISSING_LINK",
  "MISSING_VALUE_UNIT",
  "MISSING_HOURS_QUANTITY",
  "MISSING_DAYS_QUANTITY",
  "MISSING_VALIDITY_TO_DATE",
  "CLOSURE_NOT_APPROVED",
];

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const REASON_LABELS: Record<FinnegansReadinessReasonCode, (count: number) => string> = {
  MISSING_LINK: (count) => pluralize(count, "novedad sin código Finnegans configurado", "novedades sin código Finnegans configurado"),
  MISSING_VALUE_UNIT: (count) => pluralize(count, "novedad sin unidad de Valor 1 configurada", "novedades sin unidad de Valor 1 configurada"),
  MISSING_HOURS_QUANTITY: (count) => pluralize(count, "novedad sin cantidad de horas", "novedades sin cantidad de horas"),
  MISSING_DAYS_QUANTITY: (count) => pluralize(count, "novedad sin cantidad de días", "novedades sin cantidad de días"),
  MISSING_VALIDITY_TO_DATE: (count) => pluralize(count, "novedad sin fecha hasta (vigencia requerida)", "novedades sin fecha hasta (vigencia requerida)"),
  CLOSURE_NOT_APPROVED: (count) => pluralize(count, "persona con cierre mensual pendiente", "personas con cierre mensual pendiente"),
};

// Etapa 15L.3A §16/§17/§29: agrega los blockers de todas las filas en un
// resumen legible por RRHH, sin exponer ningún id técnico. CLOSURE_NOT_APPROVED
// cuenta personas distintas (no filas) — el resto cuenta novedades (filas).
export function buildReadinessSummary(rows: readonly { employeeId: string; readiness: NoveltyReadiness }[]): FinnegansReadinessSummary {
  const totalRows = rows.length;
  const readyRows = rows.filter((row) => row.readiness.ready).length;
  const blockedRows = totalRows - readyRows;

  const rowReasonCounts = new Map<FinnegansReadinessReasonCode, number>();
  const closureEmployeeIds = new Set<string>();

  for (const row of rows) {
    for (const code of row.readiness.reasonCodes) {
      if (code === "CLOSURE_NOT_APPROVED") {
        closureEmployeeIds.add(row.employeeId);
        continue;
      }
      rowReasonCounts.set(code, (rowReasonCounts.get(code) ?? 0) + 1);
    }
  }

  const reasons: string[] = [];
  for (const code of REASON_ORDER) {
    if (code === "CLOSURE_NOT_APPROVED") {
      if (closureEmployeeIds.size) reasons.push(REASON_LABELS.CLOSURE_NOT_APPROVED(closureEmployeeIds.size));
      continue;
    }
    const count = rowReasonCounts.get(code) ?? 0;
    if (count) reasons.push(REASON_LABELS[code](count));
  }

  return { ready: blockedRows === 0, totalRows, readyRows, blockedRows, reasons };
}
