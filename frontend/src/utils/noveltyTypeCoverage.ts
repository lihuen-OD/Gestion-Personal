import type {
  NoveltyCoverageDayOffPolicy,
  NoveltyCoverageDayRule,
  NoveltyCoverageHolidayPolicy,
  NoveltyCoverageMode,
  NoveltyRealWorkCompatibility,
  NoveltyType,
  NoveltyTypeCoverage,
} from "../types/noveltyType.types";
import { formatDurationMinutes } from "./hours";

// Etapa 7 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §4 y §14): traducción a
// lenguaje de negocio de la configuración de cobertura de un Tipo de
// Novedad, más las transiciones que mantienen la configuración coherente
// mientras se edita. La regla de coherencia vive en el backend
// (noveltyTypes.service.ts::assertCoverageConfigCoherent + CHECK en la base):
// acá no se reimplementa; las transiciones sólo hacen inalcanzables las
// combinaciones que el backend rechaza, y la validación previa al envío se
// limita a los datos que la persona todavía no completó.

type Option<T extends string> = { value: T; label: string; description: string };

export const coverageModeOptions: Option<NoveltyCoverageMode>[] = [
  { value: "NONE", label: "No registra horas", description: "Sólo deja constancia de la situación. Ej.: falta sin aviso, suspensión." },
  { value: "FIXED_MINUTES", label: "Cantidad fija", description: "Cubre siempre la misma cantidad de horas por día. Ej.: trámite bancario, 04:00." },
  { value: "MANUAL_MINUTES", label: "Cantidad indicada al cargar la novedad", description: "La persona que cargue la novedad deberá indicar la duración. Ej.: llegada tarde." },
  { value: "EXPECTED_SCHEDULE", label: "Según la jornada que debía cumplir", description: "El sistema calculará las horas según el turno o la obligación laboral de la persona para cada día." },
];

export const coverageDayRuleOptions: Option<NoveltyCoverageDayRule>[] = [
  { value: "EVERY_DAY", label: "Todos los días del rango", description: "Cuenta cada día entre la fecha desde y la fecha hasta." },
  { value: "SELECTED_WEEKDAYS", label: "Sólo determinados días de la semana", description: "Cuenta únicamente los días de la semana que elijas." },
  { value: "WORK_OBLIGATION", label: "Sólo días en los que debía trabajar", description: "La novedad cubrirá únicamente los días en los que la persona tenía obligación de trabajar." },
];

export const coverageDayOffOptions: Option<NoveltyCoverageDayOffPolicy>[] = [
  { value: "NO_COVERAGE", label: "No cuenta", description: "Si la persona tiene un franco registrado ese día, la novedad queda en 0 h." },
  { value: "COVER", label: "Cuenta igual", description: "Cubre la cantidad configurada aunque la persona tenga franco." },
];

export const coverageHolidayOptions: Option<NoveltyCoverageHolidayPolicy>[] = [
  { value: "NO_COVERAGE", label: "No cuenta", description: "Si el día es feriado, la novedad queda en 0 h." },
  { value: "COVER", label: "Cuenta igual", description: "Cubre la cantidad configurada aunque sea feriado." },
  { value: "ONLY_IF_CONVOKED", label: "Cuenta sólo si la persona estaba convocada a trabajar", description: "Cubre el feriado únicamente si la persona tenía una convocatoria activa para ese día." },
];

export const realWorkCompatibilityOptions: Option<NoveltyRealWorkCompatibility>[] = [
  { value: "COMPATIBLE", label: "Sí, puede coexistir", description: "Puede haber horas trabajadas el mismo día. Ej.: llegada tarde." },
  { value: "INCOMPATIBLE", label: "No puede coexistir con horas trabajadas", description: "Si se registra trabajo real ese día, el sistema lo marcará para revisión. Ej.: vacaciones, trámite bancario." },
];

/** Orden de lectura lunes a domingo; el valor sigue el criterio del backend (0 = domingo). */
export const coverageWeekdayOptions: { value: number; short: string; long: string }[] = [
  { value: 1, short: "Lun", long: "Lunes" },
  { value: 2, short: "Mar", long: "Martes" },
  { value: 3, short: "Mié", long: "Miércoles" },
  { value: 4, short: "Jue", long: "Jueves" },
  { value: 5, short: "Vie", long: "Viernes" },
  { value: 6, short: "Sáb", long: "Sábado" },
  { value: 0, short: "Dom", long: "Domingo" },
];

export function defaultNoveltyTypeCoverage(): NoveltyTypeCoverage {
  return {
    mode: "NONE",
    fixedMinutes: null,
    dayRule: "EVERY_DAY",
    weekdays: [],
    onDayOff: null,
    onHoliday: null,
    appliesSpecialHours: false,
    countsTowardTotal: false,
    realWorkCompatibility: "COMPATIBLE",
  };
}

export function coverageRegistersTime(coverage: NoveltyTypeCoverage) {
  return coverage.mode !== "NONE";
}

/** La configuración de días (regla, francos y feriados) sólo existe para cantidad fija o jornada esperada. */
export function coverageHasDayRules(coverage: NoveltyTypeCoverage) {
  return coverage.mode === "FIXED_MINUTES" || coverage.mode === "EXPECTED_SCHEDULE";
}

/** Francos y feriados se configuran sólo con reglas por calendario: con "días que debía trabajar" los decide la jornada. */
export function coverageUsesCalendarPolicies(coverage: NoveltyTypeCoverage) {
  return coverage.mode === "FIXED_MINUTES" && coverage.dayRule !== "WORK_OBLIGATION";
}

/**
 * Forma canónica que espera el backend: los campos que el modo o la regla de
 * días no usan viajan vacíos (null / [] / EVERY_DAY), nunca con un valor
 * viejo oculto. Una configuración ya válida queda idéntica (round-trip).
 */
export function canonicalCoverage(coverage: NoveltyTypeCoverage): NoveltyTypeCoverage {
  if (coverage.mode === "NONE") return { ...defaultNoveltyTypeCoverage(), realWorkCompatibility: coverage.realWorkCompatibility };
  const dayRule: NoveltyCoverageDayRule = coverage.mode === "MANUAL_MINUTES" ? "EVERY_DAY" : coverage.mode === "EXPECTED_SCHEDULE" ? "WORK_OBLIGATION" : coverage.dayRule;
  const calendar = coverage.mode === "FIXED_MINUTES" && dayRule !== "WORK_OBLIGATION";
  return {
    ...coverage,
    fixedMinutes: coverage.mode === "FIXED_MINUTES" ? coverage.fixedMinutes : null,
    dayRule,
    weekdays: dayRule === "SELECTED_WEEKDAYS" ? Array.from(new Set(coverage.weekdays)).sort((left, right) => left - right) : [],
    onDayOff: calendar ? coverage.onDayOff : null,
    onHoliday: calendar ? coverage.onHoliday : null,
  };
}

/** Rótulo corto para listados: "4 h fijas", "Según jornada", "Cantidad al cargar", "Sin horas". */
export function coverageShortLabel(coverage: NoveltyTypeCoverage) {
  if (coverage.mode === "NONE") return "Sin horas";
  if (coverage.mode === "MANUAL_MINUTES") return "Cantidad al cargar";
  if (coverage.mode === "EXPECTED_SCHEDULE") return "Según jornada";
  return coverage.fixedMinutes ? `${formatDurationMinutes(coverage.fixedMinutes)} fijas` : "Cantidad fija";
}

/**
 * Cambia "¿Esta novedad representa tiempo?" dejando la configuración en un
 * estado que el backend acepta: limpia lo que el modo nuevo no admite y
 * nunca inventa una política de franco/feriado (no tienen default funcional).
 */
export function applyCoverageMode(item: NoveltyType, mode: NoveltyCoverageMode): NoveltyType {
  const current = item.coverage;
  const leavingManual = current.mode === "MANUAL_MINUTES" && mode !== "MANUAL_MINUTES";
  const rules = leavingManual ? { ...item.rules, allowsHours: false } : item.rules;

  if (mode === "NONE") {
    return { ...item, rules, coverage: { ...defaultNoveltyTypeCoverage(), realWorkCompatibility: current.realWorkCompatibility } };
  }
  const cleared = { ...current, mode, fixedMinutes: null, weekdays: [] as number[], onDayOff: null, onHoliday: null };
  if (mode === "MANUAL_MINUTES") {
    // Una cantidad indicada al cargar vale para un único día y se carga como horas.
    return { ...item, rules: { ...rules, allowsDateRange: false, allowsHours: true }, coverage: { ...cleared, dayRule: "EVERY_DAY" } };
  }
  if (mode === "EXPECTED_SCHEDULE") {
    return { ...item, rules, coverage: { ...cleared, dayRule: "WORK_OBLIGATION" } };
  }
  // Cantidad fija: conserva lo que ya era válido para este modo.
  const keepsDayConfig = current.mode === "FIXED_MINUTES" || current.mode === "EXPECTED_SCHEDULE";
  return {
    ...item,
    rules,
    coverage: keepsDayConfig
      ? { ...current, mode, fixedMinutes: current.mode === "FIXED_MINUTES" ? current.fixedMinutes : null }
      : { ...cleared, dayRule: "EVERY_DAY" },
  };
}

export function applyCoverageDayRule(item: NoveltyType, dayRule: NoveltyCoverageDayRule): NoveltyType {
  const coverage = item.coverage;
  if (dayRule === "WORK_OBLIGATION") return { ...item, coverage: { ...coverage, dayRule, weekdays: [], onDayOff: null, onHoliday: null } };
  if (dayRule === "EVERY_DAY") return { ...item, coverage: { ...coverage, dayRule, weekdays: [] } };
  return { ...item, coverage: { ...coverage, dayRule } };
}

export function toggleCoverageWeekday(item: NoveltyType, weekday: number): NoveltyType {
  const current = item.coverage.weekdays;
  const weekdays = current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday];
  // Mismo orden que normaliza el backend: así un PATCH sin cambios reales no recalcula.
  return { ...item, coverage: { ...item.coverage, weekdays: [...weekdays].sort((left, right) => left - right) } };
}

export type NoveltyTypeIssueField =
  | "name"
  | "description"
  | "fixedMinutes"
  | "weekdays"
  | "onDayOff"
  | "onHoliday"
  | "finnegansLink"
  | "finnegansValueUnit";

export type NoveltyTypeIssue = { field: NoveltyTypeIssueField; message: string };

/**
 * Datos que faltan completar antes de guardar, en el orden del formulario.
 * No reemplaza la validación del backend: la coherencia entre campos la
 * garantizan las transiciones de arriba y, en última instancia, el servidor.
 */
export function noveltyTypeIssues(item: NoveltyType): NoveltyTypeIssue[] {
  const issues: NoveltyTypeIssue[] = [];
  if (!item.name.trim()) issues.push({ field: "name", message: "Completá el nombre de la novedad." });
  if (!item.description.trim()) issues.push({ field: "description", message: "Completá la descripción funcional." });

  const coverage = item.coverage;
  if (coverage.mode === "FIXED_MINUTES" && (coverage.fixedMinutes == null || coverage.fixedMinutes < 1 || coverage.fixedMinutes > 1440)) {
    issues.push({ field: "fixedMinutes", message: "Indicá la cantidad de horas en formato HH:mm, entre 00:01 y 24:00." });
  }
  if (coverageHasDayRules(coverage) && coverage.dayRule === "SELECTED_WEEKDAYS" && coverage.weekdays.length === 0) {
    issues.push({ field: "weekdays", message: "Elegí al menos un día de la semana." });
  }
  if (coverageUsesCalendarPolicies(coverage)) {
    if (!coverage.onDayOff) issues.push({ field: "onDayOff", message: "Indicá qué sucede si la persona tiene franco ese día." });
    if (!coverage.onHoliday) issues.push({ field: "onHoliday", message: "Indicá qué sucede si el día es feriado." });
  }

  if (item.rules.exportsToFinnegans) {
    if (!item.finnegansCode?.trim() || !item.finnegansName?.trim()) {
      issues.push({ field: "finnegansLink", message: "Para exportar a Finnegans completá el código y el nombre Finnegans." });
    } else if (!item.rules.finnegansValueUnit) {
      issues.push({ field: "finnegansValueUnit", message: "Para exportar a Finnegans elegí la unidad de Valor 1." });
    }
  }
  if (item.rules.allowsHours && item.rules.finnegansValueUnit === "DAYS") {
    issues.push({ field: "finnegansValueUnit", message: "Si al cargar la novedad se indican horas, la unidad de Valor 1 no puede ser \"Días\": nunca habría una cantidad de días para exportar." });
  }
  return issues;
}

export const MISSING_DATA_MESSAGE = "Faltan datos para guardar. Revisá los campos marcados.";

export function issueFor(issues: NoveltyTypeIssue[] | undefined, field: NoveltyTypeIssueField) {
  return issues?.find((issue) => issue.field === field)?.message;
}

function weekdayListLabel(weekdays: number[]) {
  const selected = coverageWeekdayOptions.filter((option) => weekdays.includes(option.value));
  if (!selected.length) return "ningún día elegido todavía";
  return selected.map((option) => option.long.toLowerCase()).join(", ");
}

function timeLine(coverage: NoveltyTypeCoverage) {
  if (coverage.mode === "NONE") return "No registra horas: sólo deja constancia de la situación.";
  if (coverage.mode === "MANUAL_MINUTES") return "Cubre la duración que se indique al cargarla, para un único día.";
  if (coverage.mode === "EXPECTED_SCHEDULE") return "Cubre las horas que la persona debía trabajar cada día.";
  return coverage.fixedMinutes ? `Cubre ${formatDurationMinutes(coverage.fixedMinutes)} por día.` : "Cubre una cantidad fija por día (falta indicarla).";
}

function dayLines(coverage: NoveltyTypeCoverage) {
  if (!coverageHasDayRules(coverage)) return [];
  if (coverage.dayRule === "WORK_OBLIGATION") {
    return ["Sólo cuenta en días con obligación laboral: los francos quedan en 0 h y los feriados cuentan sólo si la persona fue convocada."];
  }
  const days = coverage.dayRule === "EVERY_DAY" ? "Cuenta todos los días del rango." : `Cuenta sólo: ${weekdayListLabel(coverage.weekdays)}.`;
  const dayOff = coverage.onDayOff
    ? `Si la persona tiene franco: ${coverageDayOffOptions.find((option) => option.value === coverage.onDayOff)!.label.toLowerCase()}.`
    : "Falta indicar qué sucede si la persona tiene franco.";
  const holiday = coverage.onHoliday
    ? `Si es feriado: ${coverageHolidayOptions.find((option) => option.value === coverage.onHoliday)!.label.toLowerCase()}.`
    : "Falta indicar qué sucede si es feriado.";
  return [days, dayOff, holiday];
}

/**
 * Resumen legible de la configuración, generado sólo desde los campos (nunca
 * por nombre, código ni categoría del tipo).
 */
export function describeNoveltyTypeConfig(item: NoveltyType): string[] {
  const { coverage, rules } = item;
  const lines = [timeLine(coverage), ...dayLines(coverage)];
  if (coverageRegistersTime(coverage)) {
    lines.push(coverage.appliesSpecialHours
      ? "Aplica reglas de domingos, feriados y Horas Especiales para liquidación."
      : "No aplica multiplicadores de domingos, feriados ni Horas Especiales.");
    lines.push(coverage.countsTowardTotal ? "Suma al total computable." : "Es informativa: se muestra pero no suma al total.");
  }
  lines.push(coverage.realWorkCompatibility === "INCOMPATIBLE"
    ? "No puede coexistir con horas trabajadas: si hay trabajo real ese día, queda para revisión."
    : "Puede coexistir con horas trabajadas el mismo día.");
  lines.push(rules.allowsDateRange ? "Puede cargarse por rango de fechas." : "Se carga para un solo día.");
  if (rules.requiresApproval) {
    lines.push(coverageRegistersTime(coverage) && coverage.countsTowardTotal ? "Requiere aprobación antes de sumar horas." : "Requiere aprobación.");
  }
  if (rules.requiresObservation) lines.push("La observación es obligatoria.");
  if (rules.requiresDocumentation) lines.push("Debe adjuntarse documentación.");
  if (rules.timeEntryBehavior === "BLOQUEA_NUEVA_CARGA") lines.push("Aprobada, bloquea nuevas cargas horarias ese día.");
  if (rules.exportsToFinnegans) lines.push("Se exporta a Finnegans.");
  return lines;
}

/** Campos que, al cambiar en un tipo existente, recalculan la cobertura de sus novedades (backend COVERAGE_FIELDS). */
export function coverageConfigChanged(before: NoveltyTypeCoverage, after: NoveltyTypeCoverage) {
  return JSON.stringify(before) !== JSON.stringify(after);
}
