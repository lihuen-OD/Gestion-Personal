/**
 * Borrador de una versión de grilla en edición (R4.8B2). Lógica pura y sin
 * reglas de negocio propias: arma el cuerpo de `POST/PATCH /versions` (grilla
 * completa en un solo envío), cuenta los días sin configurar para no ofrecer
 * un guardado que el backend rechazaría y traduce los errores 422/409 que
 * devuelve la API. Superposiciones, turnos inactivos o de otro grupo y bordes
 * entre versiones los valida el backend.
 */
import { ApiError, getUserErrorMessage } from "../services/api/apiClient";
import type { ShiftTemplate } from "../services/api/workforceApiService";
import type {
  ShiftRotationCrew,
  ShiftRotationDay,
  ShiftRotationGridIssue,
  ShiftRotationVersion,
  ShiftRotationVersionSummary,
} from "../services/api/shiftRotationApiService";
import { gridIssueSummary } from "./shiftRotationGrid";
import { humanizeRotationMessage } from "./shiftRotation";

/** Máximo de semanas del ciclo y de bloques por día del contrato (MAX_ROTATION_CYCLE_WEEKS, blocks.max(10)). */
export const MAX_CYCLE_WEEKS = 12;
export const MAX_BLOCKS_PER_DAY = 10;

export type DraftTemplate = { code: string; name: string; startTime: string; endTime: string };
export type DraftBlock = { shiftTemplateId: string; template: DraftTemplate };
export type DraftCell = { kind: "SHIFT"; blocks: DraftBlock[] } | { kind: "REST" };

export type VersionDraft = {
  effectiveFrom: string;
  cycleLengthWeeks: number;
  anchorWeekStart: string;
  /** Clave `equipo|semana|día`; un día ausente está "sin configurar". */
  cells: Record<string, DraftCell>;
};

export function draftCellKey(crewId: string, cycleWeekIndex: number, weekday: number) {
  return `${crewId}|${cycleWeekIndex}|${weekday}`;
}

export function draftFromVersion(version: Pick<ShiftRotationVersion, "days" | "cycleLengthWeeks" | "anchorWeekStart" | "effectiveFrom">, overrides: Partial<Omit<VersionDraft, "cells">> = {}): VersionDraft {
  const cells: Record<string, DraftCell> = {};
  for (const day of version.days) {
    cells[draftCellKey(day.crewId, day.cycleWeekIndex, day.weekday)] = day.kind === "REST"
      ? { kind: "REST" }
      : { kind: "SHIFT", blocks: [...day.blocks].sort((a, b) => a.blockIndex - b.blockIndex).map((block) => ({ shiftTemplateId: block.shiftTemplateId, template: block.template })) };
  }
  return { effectiveFrom: version.effectiveFrom, cycleLengthWeeks: version.cycleLengthWeeks, anchorWeekStart: version.anchorWeekStart, cells, ...overrides };
}

export function emptyDraft(effectiveFrom: string, cycleLengthWeeks = 1): VersionDraft {
  return { effectiveFrom, cycleLengthWeeks, anchorWeekStart: mondayOnOrBefore(effectiveFrom), cells: {} };
}

export function setDraftCell(draft: VersionDraft, key: string, cell: DraftCell | null): VersionDraft {
  const cells = { ...draft.cells };
  if (cell) cells[key] = cell;
  else delete cells[key];
  return { ...draft, cells };
}

/** Días configurados que se perderían al acortar el ciclo a `weeks` semanas. */
export function cellsBeyondCycle(draft: VersionDraft, weeks: number) {
  return Object.keys(draft.cells).filter((key) => Number(key.split("|")[1]) >= weeks).length;
}

export function resizeDraftCycle(draft: VersionDraft, weeks: number): VersionDraft {
  const cells = Object.fromEntries(Object.entries(draft.cells).filter(([key]) => Number(key.split("|")[1]) < weeks));
  return { ...draft, cycleLengthWeeks: weeks, cells };
}

/** Días del borrador con la forma de la API, para reutilizar `buildGridModel` de la grilla de lectura. */
export function draftDays(draft: VersionDraft): ShiftRotationDay[] {
  return Object.entries(draft.cells).map(([key, cell]) => {
    const [crewId, week, weekday] = key.split("|");
    return {
      id: key,
      crewId: crewId!,
      crew: null,
      cycleWeekIndex: Number(week),
      weekLabel: "",
      weekday: Number(weekday),
      weekdayName: null,
      kind: cell.kind,
      blocks: cell.kind === "SHIFT" ? cell.blocks.map((block, blockIndex) => ({ blockIndex, shiftTemplateId: block.shiftTemplateId, template: block.template })) : [],
    };
  });
}

/** Cuerpo de `POST /versions` y `PATCH /versions/:id` (sin `expectedUpdatedAt`). */
export function draftPayload(draft: VersionDraft) {
  return {
    effectiveFrom: draft.effectiveFrom,
    cycleLengthWeeks: draft.cycleLengthWeeks,
    anchorWeekStart: draft.anchorWeekStart,
    days: draftDays(draft)
      .sort((a, b) => a.crewId.localeCompare(b.crewId) || a.cycleWeekIndex - b.cycleWeekIndex || a.weekday - b.weekday)
      .map((day) => ({ crewId: day.crewId, cycleWeekIndex: day.cycleWeekIndex, weekday: day.weekday, kind: day.kind, blocks: day.blocks.map(({ blockIndex, shiftTemplateId }) => ({ blockIndex, shiftTemplateId })) })),
  };
}

export function draftsEqual(left: VersionDraft, right: VersionDraft) {
  return JSON.stringify(draftPayload(left)) === JSON.stringify(draftPayload(right));
}

/**
 * Días sin configurar por equipo activo: el backend exige los 7 días de cada
 * semana del ciclo para todo equipo activo (DAY_MISSING bloquea el guardado).
 */
export function missingDaysByCrew(draft: VersionDraft, crews: ShiftRotationCrew[]): Array<{ crew: ShiftRotationCrew; count: number }> {
  return crews
    .filter((crew) => crew.status === "ACTIVO")
    .map((crew) => {
      let count = 0;
      for (let week = 0; week < draft.cycleLengthWeeks; week += 1) for (let weekday = 0; weekday < 7; weekday += 1) if (!draft.cells[draftCellKey(crew.id, week, weekday)]) count += 1;
      return { crew, count };
    })
    .filter((entry) => entry.count > 0);
}

/** Un día de trabajo necesita al menos un bloque con turno elegido (forma del contrato). */
export function shiftDaysWithoutBlocks(draft: VersionDraft) {
  return Object.values(draft.cells).filter((cell) => cell.kind === "SHIFT" && (!cell.blocks.length || cell.blocks.some((block) => !block.shiftTemplateId))).length;
}

// ── Fechas calendario (AAAA-MM-DD, sin husos) ───────────────────────────────

function toUtc(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

export function addDaysKey(dateKey: string, days: number) {
  const date = toUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isMondayKey(dateKey: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && toUtc(dateKey).getUTCDay() === 1;
}

export function mondayOnOrBefore(dateKey: string) {
  const day = toUtc(dateKey).getUTCDay();
  return addDaysKey(dateKey, -((day + 6) % 7));
}

/**
 * Primera fecha que el backend acepta para una versión nueva: hoy en una
 * rotación inactiva, mañana en una activa, y siempre después del inicio de la
 * última versión existente (las versiones son contiguas).
 */
export function minimumNewVersionStart(status: "ACTIVO" | "INACTIVO", versions: ShiftRotationVersionSummary[], todayKey: string) {
  const base = status === "INACTIVO" ? todayKey : addDaysKey(todayKey, 1);
  const lastStart = versions.map((version) => version.effectiveFrom).sort().at(-1);
  return lastStart && addDaysKey(lastStart, 1) > base ? addDaysKey(lastStart, 1) : base;
}

// ── Errores del guardado ────────────────────────────────────────────────────

export type DraftSaveError = {
  code: string;
  message: string;
  details: string[];
  /** Problemas con equipo/semana/día para marcar las celdas. */
  cellIssues: ShiftRotationGridIssue[];
  stale: boolean;
};

type ErrorBody = { error?: { code?: string; details?: { issues?: Array<ShiftRotationGridIssue & { message: string }>; overlaps?: Array<{ employee?: string; outgoing?: string; incoming?: string }> } } };

/**
 * Traduce el rechazo del backend: el mensaje de dominio se conserva (limpio de
 * términos técnicos) y los detalles estructurados se listan y se ubican en la
 * grilla. Nunca muestra códigos ni identificadores.
 */
export function describeDraftSaveError(error: unknown, crews: ShiftRotationCrew[]): DraftSaveError {
  const message = humanizeRotationMessage(getUserErrorMessage(error, "No pudimos guardar la versión. Tus cambios siguen en pantalla."));
  if (!(error instanceof ApiError)) return { code: "", message, details: [], cellIssues: [], stale: false };
  const body = (error.payload ?? {}) as ErrorBody;
  const details = body.error?.details ?? {};
  const issues = details.issues ?? [];
  const cellIssues = issues.filter((issue) => issue.crewId !== undefined && issue.cycleWeekIndex !== undefined && issue.weekday !== undefined);
  let lines: string[] = [];
  if (error.code === "ROTATION_GRID_INVALID") {
    const summary = gridIssueSummary(issues, crews);
    lines = [...summary.errors, ...summary.warnings];
  } else if (issues.length) {
    lines = [...new Set(issues.map((issue) => humanizeRotationMessage(issue.message)))];
  }
  for (const overlap of details.overlaps ?? []) {
    if (overlap.employee && overlap.outgoing && overlap.incoming) lines.push(humanizeRotationMessage(`${overlap.employee}: ${overlap.outgoing} se superpone con ${overlap.incoming}.`));
  }
  return { code: error.code, message, details: lines, cellIssues, stale: error.code === "ROTATION_VERSION_STALE" };
}

// ── Turnos elegibles ────────────────────────────────────────────────────────

/** Turnos que se ofrecen en el selector: activos del grupo de la rotación (mismo filtro que valida el backend). */
export function eligibleTemplates(templates: ShiftTemplate[], shiftGroupId: string) {
  return templates
    .filter((template) => template.status === "ACTIVO" && template.shiftGroupId === shiftGroupId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code));
}

export function draftTemplateOf(template: Pick<ShiftTemplate, "code" | "name" | "startTime" | "endTime">): DraftTemplate {
  return { code: template.code, name: template.name, startTime: template.startTime, endTime: template.endTime };
}
