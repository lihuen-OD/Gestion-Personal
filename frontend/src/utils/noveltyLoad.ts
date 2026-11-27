import type { NoveltyCoveragePreview, NoveltyCoveragePreviewDay, NoveltyCoveragePreviewInput } from "../services/api/noveltyApiService";
import type { NoveltyType } from "../types/noveltyType.types";
import type { NoveltyCoverageReviewReason } from "../types/workedTimeAccounting.types";
import { documentFileProblem } from "./documentFile";
import { formatDayDurationInput, parseDayDurationInput } from "./hours";
import { coverageTimeDescription } from "./noveltyTypeCoverage";

// Etapa 8 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §15): carga de una
// Novedad guiada por la configuración de su Tipo. Nada de esto decide
// cobertura: qué cubre cada día lo calcula el backend (vista previa y alta).
// Acá sólo se decide qué se le pide a la persona y qué se envía.
//
// Qué propiedad lleva cada cantidad:
//   - Cantidad indicada al cargar (MANUAL_MINUTES): "Duración" HH:mm → se
//     envía `quantityHours` = minutos / 60 y el backend deriva
//     `quantityMinutes` (la cobertura real). No hay otro campo de horas.
//   - Otros modos con `allowsHours` (registro heredado): "Cantidad de horas
//     informativa" → `quantityHours`, sólo dato (Finnegans en horas); nunca
//     cobertura.
//   - Resto: no se envía ninguna cantidad (`quantityDays` la calcula el backend).

export const MAX_PREVIEW_EMPLOYEES = 50;
/** Máximo general por alta (schema del backend). */
export const MAX_EMPLOYEES_PER_LOAD = 250;
/**
 * Con documento, hasta 25 personas por alta (backend: noveltyDocuments.ts,
 * MAX_EMPLOYEES_WITH_DOCUMENT; ADR §15.1): se guarda una copia por legajo.
 */
export const MAX_EMPLOYEES_WITH_DOCUMENT = 25;

/** Límite de personas según haya documento en la carga. */
export function noveltyEmployeeLimit(type: NoveltyType | undefined, values: Pick<NoveltyLoadValues, "file">) {
  const withDocument = Boolean(values.file) || Boolean(type?.rules.requiresDocumentation);
  return withDocument ? MAX_EMPLOYEES_WITH_DOCUMENT : MAX_EMPLOYEES_PER_LOAD;
}

export type NoveltyLoadValues = {
  fromDate: string;
  /** Vacío = un solo día (fromDate). Nunca un rango abierto. */
  toDate: string;
  /** HH:mm, sólo cantidad indicada al cargar. */
  duration: string;
  /** Horas decimales, sólo registro heredado (`allowsHours` fuera de MANUAL_MINUTES). */
  legacyHours: string;
  observation: string;
  file: File | null;
};

export type NoveltyLoadLayout = {
  dateMode: "single" | "range";
  /** El tipo exige fecha hasta (vigencia para Finnegans): regla del backend. */
  toDateRequired: boolean;
  quantity: "NONE" | "FIXED" | "MANUAL" | "EXPECTED";
  fixedMinutes: number | null;
  legacyHours: boolean;
  observationRequired: boolean;
  documentationRequired: boolean;
  countsTowardTotal: boolean;
};

export function noveltyLoadLayout(type: NoveltyType): NoveltyLoadLayout {
  const mode = type.coverage.mode;
  return {
    dateMode: type.rules.allowsDateRange ? "range" : "single",
    toDateRequired: type.rules.allowsDateRange && type.rules.finnegansRequiresValidity,
    quantity: mode === "FIXED_MINUTES" ? "FIXED" : mode === "MANUAL_MINUTES" ? "MANUAL" : mode === "EXPECTED_SCHEDULE" ? "EXPECTED" : "NONE",
    fixedMinutes: mode === "FIXED_MINUTES" ? type.coverage.fixedMinutes : null,
    legacyHours: type.rules.allowsHours && mode !== "MANUAL_MINUTES",
    observationRequired: type.rules.requiresObservation,
    documentationRequired: type.rules.requiresDocumentation,
    countsTowardTotal: mode !== "NONE" && type.coverage.countsTowardTotal,
  };
}

/** Resumen breve del tipo elegido, generado desde su configuración. */
export function noveltyTypeLoadSummary(type: NoveltyType): string[] {
  const layout = noveltyLoadLayout(type);
  const lines = [coverageTimeDescription(type.coverage)];
  if (type.coverage.mode !== "NONE") lines.push(layout.countsTowardTotal ? "Suma al total computable." : "Es informativa: no suma al total.");
  lines.push(layout.dateMode === "range" ? "Puede cargarse por varios días." : "Se carga para un solo día.");
  return lines;
}

export function initialNoveltyLoadValues(type: NoveltyType | undefined, defaults: { fromDate: string; quantityHours?: number; observation?: string }): NoveltyLoadValues {
  const base: NoveltyLoadValues = { fromDate: defaults.fromDate, toDate: "", duration: "", legacyHours: "", observation: defaults.observation ?? "", file: null };
  if (!type || defaults.quantityHours == null) return base;
  // Una cantidad sugerida (p. ej. desde una alerta) va al único campo de horas que el tipo usa.
  const layout = noveltyLoadLayout(type);
  if (layout.quantity === "MANUAL") return { ...base, duration: formatDayDurationInput(Math.round(defaults.quantityHours * 60)) };
  if (layout.legacyHours) return { ...base, legacyHours: String(defaults.quantityHours) };
  return base;
}

/** Al cambiar de tipo se limpian los valores que el tipo nuevo no usa. */
export function adaptNoveltyLoadValues(values: NoveltyLoadValues, type: NoveltyType): NoveltyLoadValues {
  const layout = noveltyLoadLayout(type);
  return {
    ...values,
    toDate: layout.dateMode === "range" ? values.toDate : "",
    duration: layout.quantity === "MANUAL" ? values.duration : "",
    legacyHours: layout.legacyHours ? values.legacyHours : "",
    file: layout.documentationRequired ? values.file : null,
  };
}

function parseLegacyHours(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 744 ? parsed : Number.NaN;
}

export type NoveltyLoadIssueField = "employees" | "type" | "fromDate" | "toDate" | "duration" | "legacyHours" | "observation" | "file";
export type NoveltyLoadIssue = { field: NoveltyLoadIssueField; message: string };

/** Datos faltantes o mal escritos antes de enviar. Las reglas de negocio las valida el backend al crear. */
export function noveltyLoadIssues(type: NoveltyType | undefined, values: NoveltyLoadValues, employeeCount: number): NoveltyLoadIssue[] {
  const issues: NoveltyLoadIssue[] = [];
  if (employeeCount < 1) issues.push({ field: "employees", message: "Seleccioná al menos una persona." });
  const limit = noveltyEmployeeLimit(type, values);
  if (employeeCount > limit) {
    issues.push({
      field: "employees",
      message: limit === MAX_EMPLOYEES_WITH_DOCUMENT
        ? `Con documentación podés cargar la novedad para hasta ${MAX_EMPLOYEES_WITH_DOCUMENT} personas por vez. Dividí la carga en grupos más pequeños.`
        : `Podés cargar la novedad para hasta ${MAX_EMPLOYEES_PER_LOAD} personas por vez.`,
    });
  }
  if (!type) {
    issues.push({ field: "type", message: "Elegí el tipo de novedad." });
    return issues;
  }
  const layout = noveltyLoadLayout(type);
  if (!values.fromDate) issues.push({ field: "fromDate", message: layout.dateMode === "range" ? "Indicá la fecha desde." : "Indicá la fecha." });
  if (layout.dateMode === "range") {
    if (values.toDate && values.fromDate && values.toDate < values.fromDate) issues.push({ field: "toDate", message: "La fecha hasta no puede ser anterior a la fecha desde." });
    else if (!values.toDate && layout.toDateRequired) issues.push({ field: "toDate", message: "Este tipo de novedad exige indicar la fecha hasta." });
  }
  if (layout.quantity === "MANUAL" && parseDayDurationInput(values.duration) == null) {
    issues.push({ field: "duration", message: "Indicá la duración en formato HH:mm, entre 00:01 y 24:00." });
  }
  if (layout.legacyHours && Number.isNaN(parseLegacyHours(values.legacyHours))) {
    issues.push({ field: "legacyHours", message: "Indicá una cantidad de horas mayor a 0." });
  }
  if (layout.observationRequired && !values.observation.trim()) {
    issues.push({ field: "observation", message: "Escribí la observación: este tipo de novedad la exige." });
  }
  if (layout.documentationRequired) {
    if (!values.file) issues.push({ field: "file", message: "Adjuntá la documentación: este tipo de novedad la exige." });
    else {
      const problem = documentFileProblem(values.file);
      if (problem) issues.push({ field: "file", message: problem });
    }
  }
  return issues;
}

/** Cantidades a enviar según el tipo (ver encabezado). */
function quantities(type: NoveltyType, values: NoveltyLoadValues) {
  const layout = noveltyLoadLayout(type);
  if (layout.quantity === "MANUAL") {
    const minutes = parseDayDurationInput(values.duration);
    return { quantityHours: minutes == null ? null : minutes / 60 };
  }
  if (layout.legacyHours) {
    const hours = parseLegacyHours(values.legacyHours);
    return { quantityHours: hours == null || Number.isNaN(hours) ? null : hours };
  }
  return { quantityHours: null };
}

export function buildNoveltyCreateInput(
  type: NoveltyType,
  values: NoveltyLoadValues,
  employeeIds: string[],
  extra: { targetHourConceptId?: string | null } = {},
) {
  const layout = noveltyLoadLayout(type);
  return {
    employeeIds,
    noveltyTypeId: type.id,
    fromDate: values.fromDate,
    toDate: layout.dateMode === "range" ? values.toDate || null : null,
    ...quantities(type, values),
    // El backend es la única autoridad de quantityDays (etapa 15L.5).
    quantityDays: null,
    observation: values.observation.trim() || null,
    targetHourConceptId: extra.targetHourConceptId ?? null,
  };
}

/** Pedido de vista previa, o null si todavía faltan datos para calcularla. */
export function buildNoveltyPreviewInput(type: NoveltyType | undefined, values: NoveltyLoadValues, employeeIds: string[]): NoveltyCoveragePreviewInput | null {
  if (!type || !employeeIds.length || employeeIds.length > MAX_PREVIEW_EMPLOYEES || !/^\d{4}-\d{2}-\d{2}$/.test(values.fromDate)) return null;
  const layout = noveltyLoadLayout(type);
  const toDate = layout.dateMode === "range" && values.toDate ? values.toDate : null;
  if (toDate && (!/^\d{4}-\d{2}-\d{2}$/.test(toDate) || toDate < values.fromDate)) return null;
  const minutes = layout.quantity === "MANUAL" ? parseDayDurationInput(values.duration) : null;
  if (layout.quantity === "MANUAL" && minutes == null) return null;
  return { employeeIds, noveltyTypeId: type.id, fromDate: values.fromDate, toDate, quantityHours: minutes == null ? null : minutes / 60 };
}

// ── Vista previa: traducción de cada día ────────────────────────────────────

const weekdayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function previewDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return `${weekdayNames[weekday]} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

const outcomeTitles: Record<NoveltyCoveragePreviewDay["outcome"], string> = {
  COVERED: "Cubre",
  NO_COVERAGE: "Sin horas",
  WEEKDAY_NOT_INCLUDED: "Día no incluido",
  NO_WORK_OBLIGATION: "No tenía que trabajar",
  HOLIDAY_NOT_CONVOKED: "Feriado · No convocado",
  HOLIDAY_EXCLUDED: "Feriado · No cuenta",
  DAY_OFF: "Franco",
  SCHEDULE_UNRESOLVED: "Requiere revisión",
  OUTSIDE_EMPLOYMENT: "Fuera de la relación laboral",
};

const scheduleReviewDetails: Record<string, string> = {
  SCHEDULE_MISSING: "La persona no tiene turno configurado para esta fecha.",
  FLEXIBLE_REGIME_NO_ASSIGNMENT: "Régimen flexible sin turno asignado ese día.",
  REGIME_WITHOUT_SCHEDULE: "El régimen de la persona no tiene turno.",
  EXPECTED_MINUTES_UNKNOWN: "No se pudo determinar la jornada.",
  SHIFT_ASSIGNMENTS_OVERLAP: "La persona tiene turnos superpuestos ese día.",
  EMPLOYMENT_HISTORY_UNRESOLVED: "Falta registrar la fecha de alta del legajo.",
};

const realWorkMessages: Partial<Record<NoveltyCoverageReviewReason, string>> = {
  REAL_WORK_ON_INCOMPATIBLE: "Existe trabajo registrado en este día y este tipo de novedad no puede coexistir con horas trabajadas. La novedad podrá guardarse, pero quedará marcada para revisión.",
  REAL_WORK_EXCEEDS_EXPECTED: "El trabajo registrado más la novedad superan la jornada esperada. Podrá guardarse, pero quedará para revisión.",
  REAL_WORK_WITHOUT_EXPECTED: "Hay trabajo registrado y no se conoce la jornada esperada para validarlo. Podrá guardarse, pero quedará para revisión.",
};

export type NoveltyPreviewDayView = {
  date: string;
  dateLabel: string;
  title: string;
  detail: string | null;
  tone: "covered" | "informative" | "zero" | "review";
  baseMinutes: number;
  multiplier: number;
  /** Sólo si suma: lo que vale para liquidación (base × multiplicador del backend). */
  settlementMinutes: number | null;
  informative: boolean;
  provisional: boolean;
  /** Novedad que no registra tiempo: no hay cantidades que mostrar. */
  noHours: boolean;
  workedMinutes: number;
  messages: string[];
};

export function previewDayView(day: NoveltyCoveragePreviewDay): NoveltyPreviewDayView {
  const provisional = day.outcome === "SCHEDULE_UNRESOLVED";
  const review = day.stateWhenApproved === "REVIEW_REQUIRED";
  const informative = day.stateWhenApproved === "INFORMATIVE" && day.effectiveBaseMinutes > 0;
  const detail = provisional
    ? (day.scheduleReviewReason && scheduleReviewDetails[day.scheduleReviewReason]) || "No se pudo determinar la jornada."
    : null;
  const messages = day.reviewReasons.flatMap((reason) => (realWorkMessages[reason] ? [realWorkMessages[reason]!] : []));
  return {
    date: day.date,
    dateLabel: previewDateLabel(day.date),
    title: informative ? "Informativa" : review && day.outcome === "COVERED" ? "Cubre · Requiere revisión" : outcomeTitles[day.outcome] ?? day.label,
    detail,
    tone: review ? "review" : informative ? "informative" : day.effectiveBaseMinutes > 0 ? "covered" : "zero",
    baseMinutes: day.effectiveBaseMinutes,
    multiplier: day.multiplier,
    settlementMinutes: day.stateWhenApproved === "COUNTED" ? day.computedMinutes : null,
    informative,
    provisional,
    noHours: day.outcome === "NO_COVERAGE",
    workedMinutes: day.workedMinutes,
    messages,
  };
}

export type NoveltyPreviewSummary = {
  days: number;
  /** Lo que la novedad representa (cuente o no). */
  coveredMinutes: number;
  /** Lo que suma al total computable al guardarla. */
  computableMinutes: number;
  settlementMinutes: number;
  informativeMinutes: number;
  reviewDays: number;
  conflictDays: number;
};

/** Agrega sólo valores ya calculados por el backend (sin recalcular reglas). */
export function summarizeNoveltyPreview(preview: NoveltyCoveragePreview): NoveltyPreviewSummary {
  const summary: NoveltyPreviewSummary = { days: 0, coveredMinutes: 0, computableMinutes: 0, settlementMinutes: 0, informativeMinutes: 0, reviewDays: 0, conflictDays: 0 };
  for (const employee of preview.employees) {
    for (const day of employee.days) {
      summary.days += 1;
      summary.coveredMinutes += day.effectiveBaseMinutes;
      if (day.stateWhenApproved === "COUNTED") {
        summary.computableMinutes += day.effectiveBaseMinutes;
        summary.settlementMinutes += day.computedMinutes;
      } else if (day.stateWhenApproved === "INFORMATIVE") summary.informativeMinutes += day.effectiveBaseMinutes;
      else summary.reviewDays += 1;
      if (day.reviewReasons.some((reason) => realWorkMessages[reason])) summary.conflictDays += 1;
    }
  }
  return summary;
}
