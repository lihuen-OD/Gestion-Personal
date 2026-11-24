/**
 * Modelo de presentación de la grilla de una versión de rotación (R4.8B1).
 * Lógica pura: no valida reglas de negocio (eso lo hace `validateRotationGrid`
 * en el backend y llega en `version.issues`); sólo ordena y describe lo que
 * la API devuelve para mostrarlo sin ambigüedades.
 */
import type {
  ShiftRotationBlock,
  ShiftRotationCrew,
  ShiftRotationDay,
  ShiftRotationGridIssue,
  ShiftRotationVersion,
  ShiftRotationVersionSummary,
} from "../services/api/shiftRotationApiService";
import { formatCalendarDate } from "./date";
import { humanizeRotationMessage, rotationWeekLabel } from "./shiftRotation";

/**
 * Mensaje de un problema de grilla: el backend numera los bloques desde 0
 * ("el bloque 0"); RRHH los ve desde 1, igual que en el editor ("Bloque 1").
 */
export function humanizeGridIssueMessage(message: string) {
  return humanizeRotationMessage(message.replace(/\bbloque (\d+)\b/g, (_match, index: string) => `bloque ${Number(index) + 1}`));
}

/** Columnas de lunes a domingo, con el `weekday` del backend (0 = domingo). */
export const GRID_WEEKDAYS: Array<{ weekday: number; short: string; long: string }> = [
  { weekday: 1, short: "Lun", long: "lunes" },
  { weekday: 2, short: "Mar", long: "martes" },
  { weekday: 3, short: "Mié", long: "miércoles" },
  { weekday: 4, short: "Jue", long: "jueves" },
  { weekday: 5, short: "Vie", long: "viernes" },
  { weekday: 6, short: "Sáb", long: "sábado" },
  { weekday: 0, short: "Dom", long: "domingo" },
];

/** Mismo criterio que el backend al guardar un turno: termina al día siguiente si `endTime <= startTime`. */
export function blockCrossesMidnight(template: Pick<ShiftRotationBlock["template"], "startTime" | "endTime">) {
  return template.endTime <= template.startTime;
}

/** Texto accesible y completo de un bloque, sin abreviaturas ambiguas. */
export function blockDescription(block: ShiftRotationBlock, position: { index: number; total: number }) {
  const { template } = block;
  const prefix = position.total > 1 ? `Bloque ${position.index + 1} de ${position.total}: ` : "";
  const end = blockCrossesMidnight(template) ? `${template.endTime} del día siguiente` : template.endTime;
  return `${prefix}${template.name} (${template.code}), de ${template.startTime} a ${end}`;
}

/** Resumen en texto de una celda (etiqueta accesible del botón de edición). */
export function cellDescription(cell: GridCell) {
  if (cell.kind === "REST") return "Descanso";
  if (cell.kind === "MISSING") return "Sin configurar";
  return cell.blocks.map((block, index) => blockDescription(block, { index, total: cell.blocks.length })).join("; ");
}

export type GridCell =
  | { kind: "SHIFT"; blocks: ShiftRotationBlock[]; issues: string[] }
  | { kind: "REST"; issues: string[] }
  | { kind: "MISSING"; issues: string[] };

export type GridWeekRow = { cycleWeekIndex: number; label: string; cells: Array<{ weekday: number; cell: GridCell }> };

export type GridCrewSection = {
  crewId: string;
  name: string;
  /** Código del equipo; vacío si el equipo ya no existe en la rotación. */
  code: string;
  inactive: boolean;
  /** Equipo que ya no existe en la rotación (dato inconsistente, nunca debería ocurrir). */
  unknown: boolean;
  weeks: GridWeekRow[];
};

function cellKey(crewId: string, cycleWeekIndex: number, weekday: number) {
  return `${crewId}|${cycleWeekIndex}|${weekday}`;
}

/**
 * Filas por equipo (orden del equipo) y por semana del ciclo. Se muestran los
 * equipos activos (todos sus días deben existir) y los inactivos que todavía
 * tienen días en esta versión. Un día sin fila es "sin configurar".
 */
export function buildGridModel(version: Pick<ShiftRotationVersion, "cycleLengthWeeks" | "days" | "issues">, crews: ShiftRotationCrew[]): GridCrewSection[] {
  const days = new Map<string, ShiftRotationDay>();
  for (const day of version.days) days.set(cellKey(day.crewId, day.cycleWeekIndex, day.weekday), day);
  const cellIssues = new Map<string, string[]>();
  for (const issue of version.issues) {
    // Un día faltante ya se muestra como "Sin configurar" en su celda.
    if (issue.code === "DAY_MISSING") continue;
    if (issue.crewId === undefined || issue.cycleWeekIndex === undefined || issue.weekday === undefined) continue;
    const key = cellKey(issue.crewId, issue.cycleWeekIndex, issue.weekday);
    cellIssues.set(key, [...(cellIssues.get(key) ?? []), humanizeGridIssueMessage(issue.message)]);
  }
  const crewsWithDays = new Set(version.days.map((day) => day.crewId));
  const known = new Set(crews.map((crew) => crew.id));
  const ordered = [...crews].sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
  const sections: GridCrewSection[] = ordered
    .filter((crew) => crew.status === "ACTIVO" || crewsWithDays.has(crew.id))
    .map((crew) => ({ crewId: crew.id, name: crew.name, code: crew.code, inactive: crew.status !== "ACTIVO", unknown: false, weeks: [] }));
  for (const crewId of crewsWithDays) {
    if (!known.has(crewId)) {
      const sample = version.days.find((day) => day.crewId === crewId);
      sections.push({ crewId, name: sample?.crew ?? "Equipo sin datos", code: "", inactive: false, unknown: true, weeks: [] });
    }
  }
  for (const section of sections) {
    for (let week = 0; week < version.cycleLengthWeeks; week += 1) {
      section.weeks.push({
        cycleWeekIndex: week,
        label: rotationWeekLabel(week),
        cells: GRID_WEEKDAYS.map(({ weekday }) => {
          const key = cellKey(section.crewId, week, weekday);
          const day = days.get(key);
          const issues = cellIssues.get(key) ?? [];
          const cell: GridCell = !day ? { kind: "MISSING", issues } : day.kind === "REST" ? { kind: "REST", issues } : { kind: "SHIFT", blocks: [...day.blocks].sort((a, b) => a.blockIndex - b.blockIndex), issues };
          return { weekday, cell };
        }),
      });
    }
  }
  return sections;
}

/**
 * Problemas de la grilla para la lista bajo la tabla: los días faltantes se
 * resumen por equipo (ya se ven en cada celda); el resto se lista con su
 * mensaje de dominio.
 */
export function gridIssueSummary(issues: ShiftRotationGridIssue[], crews: ShiftRotationCrew[]): { errors: string[]; warnings: string[] } {
  const crewName = new Map(crews.map((crew) => [crew.id, crewLabel(crew)]));
  const missingByCrew = new Map<string, number>();
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const issue of issues) {
    if (issue.code === "DAY_MISSING" && issue.crewId) {
      missingByCrew.set(issue.crewId, (missingByCrew.get(issue.crewId) ?? 0) + 1);
      continue;
    }
    const text = humanizeGridIssueMessage(issue.message);
    const target = issue.severity === "ERROR" ? errors : warnings;
    if (!target.includes(text)) target.push(text);
  }
  for (const [crewId, count] of missingByCrew) {
    warnings.push(`${crewName.get(crewId) ?? "Equipo sin nombre"}: ${count} ${count === 1 ? "día sin configurar" : "días sin configurar"}.`);
  }
  return { errors, warnings };
}

/** "Mañana (equipo A)": el nombre que eligió RRHH y el código que lo identifica en la grilla. */
export function crewLabel(crew: Pick<ShiftRotationCrew, "code" | "name">) {
  return `${crew.name} (equipo ${crew.code})`;
}

export type VersionTimeline = "CURRENT" | "FUTURE" | "PAST";

export function versionTimeline(version: Pick<ShiftRotationVersionSummary, "effectiveFrom" | "inEffectToday">, todayKey: string): VersionTimeline {
  if (version.inEffectToday) return "CURRENT";
  return version.effectiveFrom > todayKey ? "FUTURE" : "PAST";
}

const TIMELINE_LABEL: Record<VersionTimeline, string> = { CURRENT: "Vigente", FUTURE: "Futura", PAST: "Anterior" };

export function versionRangeText(version: Pick<ShiftRotationVersionSummary, "effectiveFrom" | "effectiveTo">) {
  return version.effectiveTo ? `del ${formatCalendarDate(version.effectiveFrom)} al ${formatCalendarDate(version.effectiveTo)}` : `desde el ${formatCalendarDate(version.effectiveFrom)}`;
}

export function versionOptionLabel(version: ShiftRotationVersionSummary, todayKey: string) {
  return `${TIMELINE_LABEL[versionTimeline(version, todayKey)]} · ${versionRangeText(version)}`;
}

export function versionTimelineLabel(timeline: VersionTimeline) {
  return TIMELINE_LABEL[timeline];
}

/** La que rige hoy; si no hay, la próxima; si no, la más reciente. */
export function defaultVersionId(versions: ShiftRotationVersionSummary[], todayKey: string): string | null {
  const current = versions.find((version) => version.inEffectToday);
  if (current) return current.id;
  const next = [...versions].filter((version) => version.effectiveFrom > todayKey).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  if (next) return next.id;
  const latest = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return latest?.id ?? null;
}

/** Más reciente primero, para el selector. */
export function sortVersionsForSelect(versions: ShiftRotationVersionSummary[]) {
  return [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

export type CrewFormValue = { code: string; name: string; sortOrder: string };
export type CrewFormErrors = Partial<Record<keyof CrewFormValue, string>>;

/** Formato y longitudes del contrato de equipos (código hasta 20, nombre 2–80, orden 0–9999). */
export function validateCrewForm(value: CrewFormValue, { creating }: { creating: boolean }): CrewFormErrors {
  const errors: CrewFormErrors = {};
  const code = value.code.trim().replace(/\s+/g, " ");
  const name = value.name.trim().replace(/\s+/g, " ");
  if (creating) {
    if (!code) errors.code = "Ingresá un código.";
    else if (code.length > 20) errors.code = "El código no puede superar los 20 caracteres.";
  }
  if (name.length < 2) errors.name = "Ingresá un nombre de al menos 2 caracteres.";
  else if (name.length > 80) errors.name = "El nombre no puede superar los 80 caracteres.";
  const order = Number(value.sortOrder);
  if (value.sortOrder.trim() === "" || !Number.isInteger(order) || order < 0 || order > 9999) errors.sortOrder = "Ingresá un número entero entre 0 y 9999.";
  return errors;
}
