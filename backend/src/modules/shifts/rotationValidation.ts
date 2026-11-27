/**
 * Validación PURA de la grilla de una versión de rotación — R4.2
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3).
 *
 * Capas: la base (R4.1/R4.1A) ya garantiza unicidad de celdas y de bloques,
 * rangos de semana y día, FKs y que un día REST no tenga bloques; las
 * membresías y versiones superpuestas, con EXCLUDE. Esta función cubre lo que
 * necesita horarios o cruzar datos (superposición entre bloques en la línea de
 * tiempo del ciclo, equipo de otra rotación, semana fuera del ciclo, plantilla
 * inválida, día SHIFT sin bloques, grilla incompleta) y repite las defensas de
 * la base para snapshots armados a mano. El servicio de R4.6 la llamará al
 * guardar/activar y traducirá los problemas a errores de la API.
 */
import { MAX_ROTATION_CYCLE_WEEKS, isMondayKey, isValidCycleLength, rotationWeekLabel, templateSchedule, type RotationSnapshot, type RotationTemplateRef, type RotationVersionSnapshot } from "./rotationPlan";

export type RotationGridIssueCode =
  | "INVALID_CYCLE_LENGTH"
  | "INVALID_ANCHOR"
  | "WEEK_OUT_OF_CYCLE"
  | "INVALID_WEEKDAY"
  | "CREW_NOT_IN_ROTATION"
  | "DUPLICATE_DAY"
  | "SHIFT_DAY_WITHOUT_BLOCKS"
  | "REST_DAY_WITH_BLOCKS"
  | "BLOCK_INDEX_DUPLICATED"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_INACTIVE"
  | "TEMPLATE_INVALID_TIMES"
  | "BLOCKS_OVERLAP"
  | "DAY_MISSING";

export type BlockOverlapRelation = "SAME_DAY" | "NEXT_DAY" | "WEEK_BOUNDARY" | "CYCLE_WRAP";

export type RotationGridIssue = {
  code: RotationGridIssueCode;
  severity: "ERROR" | "WARNING";
  crewId?: string;
  cycleWeekIndex?: number;
  weekday?: number;
  blockIndex?: number;
  relation?: BlockOverlapRelation;
  /** Para superposiciones: la otra celda/bloque involucrado. */
  related?: { cycleWeekIndex: number; weekday: number; blockIndex: number };
  message: string;
};

const DAY_MINUTES = 24 * 60;
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Posición del día dentro de la semana lunes→domingo (lunes = 0 … domingo = 6). */
const mondayPosition = (weekday: number) => (weekday + 6) % 7;
const cellLabel = (week: number, weekday: number) => `semana ${rotationWeekLabel(week)}, ${WEEKDAY_NAMES[weekday] ?? `día ${weekday}`}`;

type TimelineBlock = { start: number; end: number; week: number; weekday: number; blockIndex: number; dayPosition: number };

function overlapRelation(earlier: TimelineBlock, later: TimelineBlock, wrapped: boolean): BlockOverlapRelation {
  if (wrapped) return "CYCLE_WRAP";
  if (earlier.dayPosition === later.dayPosition) return "SAME_DAY";
  return earlier.week === later.week ? "NEXT_DAY" : "WEEK_BOUNDARY";
}

export function validateRotationGrid<T extends RotationTemplateRef>(input: {
  rotation: Pick<RotationSnapshot<T>, "id" | "crews">;
  version: RotationVersionSnapshot<T>;
  /** Plantillas conocidas por id (para detectar referencias inexistentes). */
  templates: ReadonlyMap<string, RotationTemplateRef>;
}): RotationGridIssue[] {
  const { rotation, version, templates } = input;
  const issues: RotationGridIssue[] = [];
  const error = (issue: Omit<RotationGridIssue, "severity">) => issues.push({ severity: "ERROR", ...issue });

  const cycleValid = isValidCycleLength(version.cycleLengthWeeks);
  if (!cycleValid) error({ code: "INVALID_CYCLE_LENGTH", message: `El ciclo debe tener entre 1 y ${MAX_ROTATION_CYCLE_WEEKS} semanas (tiene ${version.cycleLengthWeeks}).` });
  if (!isMondayKey(version.anchorWeekStart)) error({ code: "INVALID_ANCHOR", message: `La semana ancla ${version.anchorWeekStart} no empieza un lunes.` });

  const crewIds = new Set(rotation.crews.map((crew) => crew.id));
  const seenCells = new Set<string>();
  const timelines = new Map<string, TimelineBlock[]>();

  for (const day of version.days) {
    const at = { crewId: day.crewId, cycleWeekIndex: day.cycleWeekIndex, weekday: day.weekday };
    const where = cellLabel(day.cycleWeekIndex, day.weekday);
    if (!crewIds.has(day.crewId)) error({ ...at, code: "CREW_NOT_IN_ROTATION", message: `El día (${where}) es de un equipo que no pertenece a la rotación.` });
    if (cycleValid && (day.cycleWeekIndex < 0 || day.cycleWeekIndex >= version.cycleLengthWeeks)) {
      error({ ...at, code: "WEEK_OUT_OF_CYCLE", message: `La semana ${day.cycleWeekIndex} está fuera de un ciclo de ${version.cycleLengthWeeks} semana(s).` });
    }
    if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) error({ ...at, code: "INVALID_WEEKDAY", message: `Día de semana inválido (${day.weekday}).` });
    const cellKey = `${day.crewId}|${day.cycleWeekIndex}|${day.weekday}`;
    if (seenCells.has(cellKey)) error({ ...at, code: "DUPLICATE_DAY", message: `El ${where} está configurado más de una vez para el mismo equipo.` });
    seenCells.add(cellKey);

    if (day.kind === "REST") {
      if (day.blocks.length) error({ ...at, code: "REST_DAY_WITH_BLOCKS", message: `El ${where} es descanso y no puede tener bloques.` });
      continue;
    }
    if (!day.blocks.length) {
      error({ ...at, code: "SHIFT_DAY_WITHOUT_BLOCKS", message: `El ${where} es de trabajo pero no tiene ningún bloque.` });
      continue;
    }
    const seenIndexes = new Set<number>();
    for (const block of day.blocks) {
      const blockAt = { ...at, blockIndex: block.blockIndex };
      if (seenIndexes.has(block.blockIndex)) error({ ...blockAt, code: "BLOCK_INDEX_DUPLICATED", message: `El ${where} repite el orden de bloque ${block.blockIndex}.` });
      seenIndexes.add(block.blockIndex);
      const template = templates.get(block.template.id);
      if (!template) {
        error({ ...blockAt, code: "TEMPLATE_NOT_FOUND", message: `El bloque ${block.blockIndex} del ${where} usa un turno que no existe.` });
        continue;
      }
      if (template.status !== "ACTIVO") error({ ...blockAt, code: "TEMPLATE_INACTIVE", message: `El turno ${template.code} del ${where} está inactivo.` });
      const schedule = templateSchedule(template);
      if (!schedule) {
        error({ ...blockAt, code: "TEMPLATE_INVALID_TIMES", message: `El turno ${template.code} del ${where} no tiene un horario válido.` });
        continue;
      }
      if (!cycleValid || day.weekday < 0 || day.weekday > 6) continue;
      const dayPosition = day.cycleWeekIndex * 7 + mondayPosition(day.weekday);
      const start = dayPosition * DAY_MINUTES + schedule.startMinute;
      const list = timelines.get(day.crewId) ?? [];
      list.push({ start, end: start + schedule.durationMinutes, week: day.cycleWeekIndex, weekday: day.weekday, blockIndex: block.blockIndex, dayPosition });
      timelines.set(day.crewId, list);
    }
  }

  // Superposición en la línea de tiempo del ciclo de cada equipo: bloques
  // consecutivos, y el último contra el primero del ciclo siguiente (wrap).
  if (cycleValid) {
    const cycleMinutes = version.cycleLengthWeeks * 7 * DAY_MINUTES;
    for (const [crewId, blocks] of timelines) {
      const sorted = [...blocks].sort((left, right) => left.start - right.start || left.blockIndex - right.blockIndex);
      const report = (earlier: TimelineBlock, later: TimelineBlock, wrapped: boolean) => {
        const relation = overlapRelation(earlier, later, wrapped);
        error({
          crewId,
          code: "BLOCKS_OVERLAP",
          cycleWeekIndex: later.week,
          weekday: later.weekday,
          blockIndex: later.blockIndex,
          relation,
          related: { cycleWeekIndex: earlier.week, weekday: earlier.weekday, blockIndex: earlier.blockIndex },
          message: `El bloque ${later.blockIndex} del ${cellLabel(later.week, later.weekday)} empieza antes de que termine el bloque ${earlier.blockIndex} del ${cellLabel(earlier.week, earlier.weekday)}${wrapped ? " (al reiniciar el ciclo)" : ""}.`,
        });
      };
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index]!.start < sorted[index - 1]!.end) report(sorted[index - 1]!, sorted[index]!, false);
      }
      // Un bloque dura como máximo 24 h, menos que cualquier ciclo: con un solo
      // bloque no hay wrap posible.
      if (sorted.length > 1) {
        const last = sorted[sorted.length - 1]!;
        const first = sorted[0]!;
        if (last.end > first.start + cycleMinutes) report(last, first, true);
      }
    }

    // Grilla incompleta: cada equipo ACTIVO necesita las semanas × 7 celdas.
    for (const crew of rotation.crews.filter((item) => item.status === "ACTIVO")) {
      for (let week = 0; week < version.cycleLengthWeeks; week += 1) {
        for (let weekday = 0; weekday < 7; weekday += 1) {
          if (!seenCells.has(`${crew.id}|${week}|${weekday}`)) {
            issues.push({ severity: "WARNING", code: "DAY_MISSING", crewId: crew.id, cycleWeekIndex: week, weekday, message: `Falta configurar el ${cellLabel(week, weekday)} del equipo ${crew.code}.` });
          }
        }
      }
    }
  }
  return issues;
}
