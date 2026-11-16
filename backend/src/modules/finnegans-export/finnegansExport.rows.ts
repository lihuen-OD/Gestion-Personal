import type { Prisma } from "@prisma/client";
import { calendarDateKey } from "../../shared/datetime/argentinaTime";
import type { NoveltyExportCoverageDay } from "../novelties/noveltyCoverageAccounting";
import type { FinnegansExportNovelty } from "./finnegansExport.repository";
import { evaluateNoveltyReadiness, type FinnegansReadinessReasonCode, type FinnegansRowStatus } from "./finnegansExport.readiness";

export type FinnegansExportRow = {
  Legajo: string;
  Novedad: string;
  "Centro de costo": string;
  "Valor 1": string;
  "Fecha Aplicación": string;
  "Fecha desde": string;
  "Fecha hasta": string;
  sourceId?: string;
  employeeId?: string;
  employeeName?: string;
  detail?: string;
  // Etapa 15L.3A §30: sólo para la tabla de preview del frontend — nunca se
  // incluye en las columnas de CSV/XLSX.
  estado?: FinnegansRowStatus;
};

export interface DatasetRow {
  employeeId: string;
  row: FinnegansExportRow;
  ready: boolean;
  hasNonClosureBlocker: boolean;
  reasonCodes: FinnegansReadinessReasonCode[];
  /** Días de cobertura en revisión dentro del período (0 si no aplica). */
  reviewDays: number;
}

const DAY_MS = 86_400_000;

function formatDate(value: Date | null | undefined) {
  if (!value) return "";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const year = value.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function decimalToString(value: Prisma.Decimal | null | undefined) {
  if (!value) return "";
  return value.toString();
}

/** Minutos → horas con hasta 2 decimales, mismo formato que un quantityHours guardado (240 → "4", 90 → "1.5"). */
export function minutesToHoursValue(minutes: number) {
  return String(Number((minutes / 60).toFixed(2)));
}

function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(year!, month! - 1, 1)), end: new Date(Date.UTC(year!, month!, 0)) };
}

function inclusiveDays(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

// Etapa 15L.3A §8/§9/§10: novedades SIN cobertura — Valor 1 depende sólo de
// finnegansValueUnit, sin fallback entre cantidades (comportamiento previo).
function legacyValue1(item: FinnegansExportNovelty): string {
  const unit = item.noveltyType.finnegansValueUnit;
  if (unit === "HOURS") return decimalToString(item.quantityHours);
  if (unit === "DAYS") return decimalToString(item.quantityDays);
  if (unit === "UNIT") return "1";
  return "";
}

function baseRow(item: FinnegansExportNovelty, applicationDate: Date, validFrom: Date, validTo: Date | null, value1: string, estado: FinnegansRowStatus): FinnegansExportRow {
  const requiresValidity = item.noveltyType.finnegansRequiresValidity;
  return {
    Legajo: item.employee.legajoFinnegans || item.employee.legajo,
    Novedad: item.noveltyType.finnegansCode || "",
    // Etapa 15L.3A §14: vacío — "Si queda vacío, Finnegans toma el del legajo".
    "Centro de costo": "",
    "Valor 1": value1,
    "Fecha Aplicación": formatDate(applicationDate),
    // Etapa 15L.3A §11/§12: vigencia sólo si el tipo la exige; sin toDate no se inventa.
    "Fecha desde": requiresValidity ? formatDate(validFrom) : "",
    "Fecha hasta": requiresValidity ? formatDate(validTo) : "",
    sourceId: item.id,
    employeeId: item.employeeId,
    employeeName: `${item.employee.lastName}, ${item.employee.firstName}`,
    detail: item.noveltyType.name,
    estado,
  };
}

function reviewDaysOf(days: NoveltyExportCoverageDay[] | undefined) {
  return (days ?? []).filter((day) => day.state === "REVIEW_REQUIRED").length;
}

function legacyRow(item: FinnegansExportNovelty, closureApproved: boolean, days: NoveltyExportCoverageDay[] | undefined): DatasetRow {
  // Sin cobertura no hay horas que leer, pero un día en revisión (p. ej. Falta
  // sin aviso incompatible con trabajo real) igual bloquea, como en el cierre.
  const reviewDays = reviewDaysOf(days);
  const readiness = evaluateNoveltyReadiness({
    quantityHours: item.quantityHours,
    quantityDays: item.quantityDays,
    toDate: item.toDate,
    finnegansValueUnit: item.noveltyType.finnegansValueUnit,
    finnegansRequiresValidity: item.noveltyType.finnegansRequiresValidity,
    hasFinnegansCode: !!item.noveltyType.finnegansCode,
    closureApproved,
    reviewDays,
  });
  return {
    employeeId: item.employeeId,
    row: baseRow(item, item.fromDate, item.fromDate, item.toDate, legacyValue1(item), readiness.estado),
    ready: readiness.ready,
    hasNonClosureBlocker: readiness.reasonCodes.some((code) => code !== "CLOSURE_NOT_APPROVED"),
    reasonCodes: readiness.reasonCodes,
    reviewDays,
  };
}

/**
 * Etapa 9 de cobertura (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §16).
 * Novedad CON cobertura: la fila del período representa sólo los días de su
 * rango dentro del período (decisión del usuario: se divide por mes).
 *   - HOURS: suma de la base efectiva de los días que cuentan o son
 *     informativos (resolución manual incluida), SIN multiplicador: el
 *     multiplicador lo aplica Finnegans con su concepto (P2). Nunca
 *     quantityHours.
 *   - DAYS: días corridos de la porción del período (mismo criterio que antes).
 *   - UNIT: "1", sólo en el mes de inicio (una novedad es una unidad).
 * Un día en revisión bloquea la fila; sin horas que exportar no hay fila.
 * Devuelve null cuando no corresponde ninguna fila en este período.
 */
function coverageRow(item: FinnegansExportNovelty, period: string, days: NoveltyExportCoverageDay[] | undefined, closureApproved: boolean): DatasetRow | null {
  const unit = item.noveltyType.finnegansValueUnit;
  const bounds = periodBounds(period);
  const portionFrom = item.fromDate < bounds.start ? bounds.start : item.fromDate;
  const rangeTo = item.toDate ?? item.fromDate;
  const portionTo = rangeTo > bounds.end ? bounds.end : rangeTo;
  const startsInPeriod = calendarDateKey(item.fromDate).slice(0, 7) === period;
  if (unit === "UNIT" && !startsInPeriod) return null;

  const periodDays = days ?? [];
  const reviewDays = reviewDaysOf(days);
  const exportedMinutes = periodDays
    .filter((day) => day.state === "COUNTED" || day.state === "INFORMATIVE")
    .reduce((sum, day) => sum + day.baseMinutes, 0);
  const missing = periodDays.length === 0;

  // Nada que exportar en horas (p. ej. vacaciones sólo en francos de este mes).
  if (unit === "HOURS" && !missing && reviewDays === 0 && exportedMinutes === 0) return null;

  const readiness = evaluateNoveltyReadiness({
    quantityHours: null,
    quantityDays: null,
    toDate: item.toDate,
    finnegansValueUnit: unit,
    finnegansRequiresValidity: item.noveltyType.finnegansRequiresValidity,
    hasFinnegansCode: !!item.noveltyType.finnegansCode,
    closureApproved,
    coverage: { missing },
    reviewDays,
  });
  const value1 = !readiness.ready && (missing || reviewDays > 0)
    ? ""
    : unit === "HOURS"
      ? minutesToHoursValue(exportedMinutes)
      : unit === "DAYS"
        ? String(inclusiveDays(portionFrom, portionTo))
        : unit === "UNIT"
          ? "1"
          : "";
  return {
    employeeId: item.employeeId,
    row: baseRow(item, portionFrom, portionFrom, item.toDate ? portionTo : null, value1, readiness.estado),
    ready: readiness.ready,
    hasNonClosureBlocker: readiness.reasonCodes.some((code) => code !== "CLOSURE_NOT_APPROVED"),
    reasonCodes: readiness.reasonCodes,
    reviewDays,
  };
}

/**
 * Filas de la exportación de novedades a Finnegans para un período: una por
 * novedad y período (nunca por día; los días se agregan después de calcular
 * cada uno). Única implementación compartida por preview y exportación
 * definitiva.
 */
export function buildFinnegansNoveltyExportRows(input: {
  period: string;
  novelties: FinnegansExportNovelty[];
  coverageByNovelty: ReadonlyMap<string, NoveltyExportCoverageDay[]>;
  isClosureApproved: (employeeId: string) => boolean;
}): DatasetRow[] {
  const rows: DatasetRow[] = [];
  for (const item of input.novelties) {
    const closureApproved = input.isClosureApproved(item.employeeId);
    if (item.noveltyType.coverageMode === "NONE") {
      rows.push(legacyRow(item, closureApproved, input.coverageByNovelty.get(item.id)));
      continue;
    }
    const row = coverageRow(item, input.period, input.coverageByNovelty.get(item.id), closureApproved);
    if (row) rows.push(row);
  }
  return rows;
}
