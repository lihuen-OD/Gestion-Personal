/**
 * Presentación de la vista previa de rotaciones (R4.8D, `GET /shifts/expected`
 * de R4.7). No recalcula nada: el plan, la obligación operativa, la jornada
 * esperada, la semana del ciclo y las advertencias llegan resueltos del
 * backend; acá sólo se eligen el rango, se arman los encabezados y se traducen
 * los valores del contrato a textos para RRHH.
 */
import type { PreviewBlock, PreviewCell, PreviewRow } from "../services/api/shiftRotationApiService";
import { workRegimeKindLabel } from "../components/work-regimes/workRegimeLabels";
import type { WorkRegimeKind } from "../types/workRegime.types";
import { formatCalendarDate, formatInstantDate, formatInstantTime } from "./date";
import { addDaysKey, mondayOnOrBefore } from "./shiftRotationDraft";
import { humanizeRotationMessage } from "./shiftRotation";

/** Períodos ofrecidos (el backend admite hasta 42 días = 6 semanas). */
export const PREVIEW_PERIOD_WEEKS = [1, 2, 4, 6] as const;
export const PREVIEW_DEFAULT_WEEKS = 2;
export const PREVIEW_MAX_DAYS = 42;
export const PREVIEW_PAGE_SIZE = 25;

export function previewRange(start: string, weeks: number) {
  const days = Math.min(weeks * 7, PREVIEW_MAX_DAYS);
  return { from: start, to: addDaysKey(start, days - 1), days };
}

/** Por defecto la vista arranca el lunes de la semana actual: las semanas del ciclo empiezan en lunes. */
export function defaultPreviewStart(todayKey: string) {
  return mondayOnOrBefore(todayKey);
}

export function previewDates(from: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDaysKey(from, index));
}

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const WEEKDAY_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function weekdayOf(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export function dayHeader(dateKey: string) {
  const weekday = weekdayOf(dateKey);
  return { short: WEEKDAY_SHORT[weekday]!, long: WEEKDAY_LONG[weekday]!, date: formatCalendarDate(dateKey).slice(0, 5), full: `${WEEKDAY_LONG[weekday]} ${formatCalendarDate(dateKey)}` };
}

/**
 * Semana del ciclo por fecha, para el encabezado: cada fecha toma la letra
 * (A, B…) que el backend devolvió para las personas de la página. Si no
 * coinciden (por ejemplo, un cambio de versión) queda "varía"; si nadie de la
 * página pertenece a la rotación ese día, no tiene letra. `start` marca el
 * primer día de cada tramo (cambia la letra o empieza una semana, el lunes).
 */
export function cycleWeekByDate(dates: string[], rows: PreviewRow[]): Array<{ label: string | null; varies: boolean; start: boolean }> {
  const result: Array<{ label: string | null; varies: boolean; start: boolean }> = [];
  dates.forEach((date, index) => {
    const found = new Set(rows.map((row) => row.days[index]?.assignment?.cycleWeekLabel).filter((label): label is string => Boolean(label)));
    const label = found.size === 1 ? [...found][0]! : null;
    const varies = found.size > 1;
    const previous = result[index - 1];
    const start = index === 0 || weekdayOf(date) === 1 || previous!.label !== label || previous!.varies !== varies;
    result.push({ label, varies, start });
  });
  return result;
}

export type PreviewCellKind = "SHIFTS" | "REST" | "MISSING" | "CONFLICT" | "FIXED" | "NONE";

export type PreviewCellView = {
  kind: PreviewCellKind;
  blocks: PreviewBlock[];
  /** Hay bloques programados, pero ese día no hay obligación (franco, feriado…): se muestran atenuados. */
  suppressed: boolean;
  tags: string[];
  errors: number;
  warnings: number;
};

/** Resumen visible de una celda: el plan del backend, sus hechos y la cantidad de advertencias. */
export function previewCellView(cell: PreviewCell): PreviewCellView {
  const kind: PreviewCellKind = cell.planning.kind === "FIXED_ASSIGNMENT" ? "FIXED" : cell.planning.kind;
  const blocks = cell.planning.blocks.length ? cell.planning.blocks : cell.effective.blocks;
  const suppressed = blocks.length > 0 && cell.effective.obligation === "NO_OBLIGATION";
  const tags: string[] = [];
  if (cell.facts.dayOff) tags.push("Franco");
  if (cell.facts.holidayScope === "IN_SCOPE") tags.push(cell.facts.convoked ? "Feriado convocado" : "Feriado");
  if (cell.facts.holidayScope === "SCOPE_HISTORY_MISSING") tags.push("Feriado sin ámbito");
  if (cell.facts.regimeKind === "SIN_TURNO") tags.push("Sin turno obligatorio");
  if (suppressed && !tags.length) tags.push("Sin obligación");
  return {
    kind,
    blocks: [...blocks].sort((a, b) => a.blockIndex - b.blockIndex),
    suppressed,
    tags,
    errors: cell.warnings.filter((warning) => warning.severity === "ERROR").length,
    warnings: cell.warnings.filter((warning) => warning.severity !== "ERROR").length,
  };
}

const KIND_TEXT: Record<PreviewCellKind, string> = {
  SHIFTS: "Turno de rotación",
  REST: "Descanso",
  MISSING: "Sin configurar",
  CONFLICT: "Configuración contradictoria",
  FIXED: "Turno fijo",
  NONE: "Sin programación",
};

export function previewKindText(kind: PreviewCellKind) {
  return KIND_TEXT[kind];
}

/** Código del turno del bloque; uno de otro grupo llega oculto (R8). */
export function blockCodeText(block: PreviewBlock) {
  return block.template.code ?? "Otro grupo";
}

export function blockTimeText(block: PreviewBlock) {
  return `${block.template.startTime}–${block.template.endTime}`;
}

/** "vie 04/12 19:00 → sáb 05/12 07:00": instantes reales del backend, en hora de Argentina. */
export function blockSpanText(block: PreviewBlock) {
  const part = (iso: string) => {
    const dateKey = formatInstantDate(iso).split("/").reverse().join("-");
    return `${WEEKDAY_SHORT[weekdayOf(dateKey)]!.toLowerCase()} ${formatInstantDate(iso).slice(0, 5)} ${formatInstantTime(iso)}`;
  };
  return `${part(block.scheduledStartAt)} → ${part(block.scheduledEndAt)}`;
}

/** Etiqueta accesible completa de la celda (lo mismo que se ve, en palabras). */
export function previewCellLabel(row: PreviewRow, cell: PreviewCell, view: PreviewCellView) {
  const person = `${row.employee.lastName}, ${row.employee.firstName}`;
  const week = cell.assignment?.cycleWeekLabel ? `, semana ${cell.assignment.cycleWeekLabel}` : "";
  const content = view.blocks.length
    ? view.blocks.map((block) => `${blockCodeText(block)} de ${block.template.startTime} a ${block.template.endTime}${block.template.crossesMidnight ? " del día siguiente" : ""}`).join(" y ")
    : KIND_TEXT[view.kind];
  const extra = [view.kind === "FIXED" ? "turno fijo" : "", ...view.tags, view.errors ? `${view.errors} ${view.errors === 1 ? "error" : "errores"}` : "", view.warnings ? `${view.warnings} ${view.warnings === 1 ? "advertencia" : "advertencias"}` : ""].filter(Boolean);
  return `${person}, ${dayHeader(cell.date).full}${week}: ${content}${extra.length ? ` (${extra.join(", ")})` : ""}. Ver detalle.`;
}

// ── Textos para el detalle (valores del contrato → lenguaje de RRHH) ────────

const label = (map: Record<string, string>, value: string | null | undefined, fallback = "Otro motivo") => (value ? map[value] ?? fallback : null);

const OBLIGATION: Record<string, string> = { SHIFT: "Debe trabajar", NO_OBLIGATION: "Sin obligación de trabajar", UNRESOLVED: "No se puede determinar" };
const SOURCE: Record<string, string> = {
  DAY_OFF: "Franco",
  HOLIDAY_NOT_CONVOKED: "Feriado sin convocatoria",
  HOLIDAY_SCOPE: "Ámbito del feriado",
  HOLIDAY_CONVOCATION: "Convocatoria a feriado",
  REGIME: "Régimen laboral",
  FIXED_ASSIGNMENT: "Turno fijo",
  ROTATION: "Rotación",
  NONE: "Sin datos de turno",
};
const REASON: Record<string, string> = {
  DAY_OFF: "Tiene franco ese día.",
  HOLIDAY_NOT_CONVOKED: "Es feriado y no está convocado.",
  HOLIDAY_SCOPE_HISTORY_MISSING: "Falta historial para saber si el feriado le aplica.",
  REGIME_SIN_TURNO: "Su régimen laboral no exige turno.",
  FLEXIBLE_REGIME_NO_ASSIGNMENT: "Régimen flexible sin turno asignado.",
  NO_APPLICABLE_ASSIGNMENT: "No tiene un turno aplicable ese día.",
  SCHEDULE_MISSING: "Falta el horario del turno.",
  PLAN_EXCLUDES_DAY: "Su turno no incluye ese día de la semana.",
  ROTATION_REST_DAY: "Descanso según la grilla.",
  ROTATION_DAY_MISSING: "El día no está configurado en la grilla.",
  ROTATION_CONFIG_CONFLICT: "La configuración de la rotación es contradictoria.",
  HOLIDAY_CONVOCATION_WITHOUT_SCHEDULE: "Está convocado al feriado sin horario definido.",
};
const WORKDAY: Record<string, string> = { WORKDAY: "Jornada laboral", NO_WORK_OBLIGATION: "Sin obligación", HOLIDAY_NOT_CONVOKED: "Feriado sin convocatoria", DAY_OFF: "Franco", UNRESOLVED: "Sin resolver" };
const UNRESOLVED: Record<string, string> = {
  SCHEDULE_MISSING: "Falta el horario.",
  FLEXIBLE_REGIME_NO_ASSIGNMENT: "Régimen flexible sin turno asignado.",
  REGIME_WITHOUT_SCHEDULE: "Régimen sin horario.",
  EXPECTED_MINUTES_UNKNOWN: "No se conocen las horas esperadas.",
  SHIFT_ASSIGNMENTS_OVERLAP: "Tiene turnos fijos superpuestos.",
  HOLIDAY_SCOPE_HISTORY_MISSING: "Falta historial para saber si el feriado le aplica.",
};
const PLAN_ISSUE: Record<string, string> = {
  ROTATION_NOT_FOUND: "La rotación no existe.",
  CREW_NOT_IN_ROTATION: "El equipo no pertenece a la rotación.",
  CREW_INACTIVE: "El equipo está inactivo.",
  NO_VERSION_IN_EFFECT: "Ninguna versión de la grilla rige en esa fecha.",
  INVALID_VERSION: "La versión de la grilla es inválida.",
  NO_DAY_ROW: "El día no está configurado en la grilla.",
  SHIFT_DAY_WITHOUT_BLOCKS: "Día de trabajo sin bloques.",
  TEMPLATE_UNAVAILABLE: "Un turno de la grilla no está disponible.",
  MULTIPLE_MEMBERSHIPS: "La persona tiene más de una pertenencia a rotaciones ese día.",
  MULTIPLE_VERSIONS: "Más de una versión de la grilla rige ese día.",
  DUPLICATE_DAY_ROWS: "El día está cargado más de una vez en la grilla.",
  REST_DAY_WITH_BLOCKS: "Un descanso tiene bloques de turno.",
  DUPLICATE_BLOCK_INDEX: "El día repite el orden de un bloque.",
  OVERLAPPING_BLOCKS: "Los bloques del día se superponen.",
};
const HOLIDAY: Record<string, string> = { IN_SCOPE: "Feriado que le aplica", OUT_OF_SCOPE: "Feriado de otro ámbito (no le aplica)", SCOPE_HISTORY_MISSING: "Feriado sin historial de ámbito" };
const BLOCK_SOURCE: Record<string, string> = { ROTATION: "Rotación", FIXED_ASSIGNMENT: "Turno fijo", HOLIDAY_CONVOCATION: "Convocatoria a feriado" };

export const previewLabels = {
  obligation: (value: string) => label(OBLIGATION, value, "No se puede determinar")!,
  source: (value: string) => label(SOURCE, value, "Otro origen")!,
  reason: (value: string | null) => label(REASON, value),
  workday: (value: string) => label(WORKDAY, value, "Sin resolver")!,
  unresolved: (value: string | null) => label(UNRESOLVED, value),
  planIssue: (value: string | null) => label(PLAN_ISSUE, value),
  holiday: (value: string | null) => (value ? HOLIDAY[value] ?? "Feriado" : "No es feriado"),
  regime: (value: string | null) => (value ? workRegimeKindLabel(value as WorkRegimeKind) : "Sin régimen asignado"),
  blockSource: (value: string) => BLOCK_SOURCE[value] ?? "Otro origen",
  warning: (message: string) => humanizeRotationMessage(message),
};
