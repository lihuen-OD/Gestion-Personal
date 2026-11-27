/**
 * Núcleo PURO de rotaciones — R4.2 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.3).
 *
 * Sin Prisma ni HTTP: recibe un snapshot de la configuración (lo armará el
 * cargador en lote de R4.3 a partir de las tablas de R4.1/R4.1A) y responde,
 * para un empleado y una fecha operativa, su plan del día:
 *
 *   REST     — descanso programado (día REST explícito).
 *   MISSING  — configuración inexistente o incompleta (nunca descanso).
 *   CONFLICT — configuración contradictoria (varias membresías o versiones
 *              vigentes, días o bloques duplicados, bloques superpuestos).
 *              Nunca se elige "la primera": no genera obligación y conserva
 *              el motivo y los ids para diagnóstico.
 *   SHIFTS   — uno o varios bloques con instantes concretos.
 *   null     — no es miembro vigente de una rotación ACTIVA: rige el legacy.
 *
 * Calendario: fechas "YYYY-MM-DD" de Argentina; semana lunes → domingo; la
 * semana del ciclo se cuenta desde el lunes ancla de la versión (sin semana
 * ISO ni par/impar). Un bloque pertenece a la fecha en que empieza.
 */
import {
  argentinaDayRange,
  calendarDaysBetweenKeys,
  calendarWeekdayOfKey,
  mondayOfCalendarDateKey,
  scheduledInstantForShiftTime,
} from "../../shared/datetime/argentinaTime";
import { computeExpectedMinutes, parseShiftTime } from "./shiftTemplateTime";

// ── Snapshot de configuración ───────────────────────────────────────────────

export type RotationRecordStatus = "ACTIVO" | "INACTIVO";

export type RotationTemplateRef = {
  id: string;
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  status: RotationRecordStatus;
};

export type RotationBlockSnapshot<T extends RotationTemplateRef = RotationTemplateRef> = { blockIndex: number; template: T };

export type RotationDaySnapshot<T extends RotationTemplateRef = RotationTemplateRef> = {
  id: string;
  crewId: string;
  cycleWeekIndex: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  kind: "REST" | "SHIFT";
  blocks: RotationBlockSnapshot<T>[];
};

export type RotationVersionSnapshot<T extends RotationTemplateRef = RotationTemplateRef> = {
  id: string;
  rotationId: string;
  cycleLengthWeeks: number;
  /** Lunes "YYYY-MM-DD" que es la semana 0 (A) del ciclo. */
  anchorWeekStart: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  days: RotationDaySnapshot<T>[];
};

export type RotationCrewSnapshot = { id: string; code: string; status: RotationRecordStatus };

export type RotationSnapshot<T extends RotationTemplateRef = RotationTemplateRef> = {
  id: string;
  code: string;
  status: RotationRecordStatus;
  crews: RotationCrewSnapshot[];
  versions: RotationVersionSnapshot<T>[];
};

export type RotationMembershipSnapshot = { employeeId: string; rotationId: string; crewId: string; effectiveFrom: string; effectiveTo: string | null };

export type RotationConfiguration<T extends RotationTemplateRef = RotationTemplateRef> = {
  memberships: RotationMembershipSnapshot[];
  rotations: RotationSnapshot<T>[];
};

// ── Contrato ExpectedDayPlan / ExpectedBlock ────────────────────────────────

export type RotationOrigin = { rotationId: string; versionId: string; crewId: string; cycleWeekIndex: number; weekday: number; dayId: string | null };

export type ExpectedBlockSource = "ROTATION" | "HOLIDAY_CONVOCATION";

export type ExpectedBlock<T extends RotationTemplateRef = RotationTemplateRef> = {
  /** `${employeeId}|${scheduledStartAt ISO}`: estable y único por persona (los bloques de una persona no se superponen). */
  obligationKey: string;
  employeeId: string;
  /** Fecha operativa = fecha en que empieza el bloque. */
  operationalDate: string;
  blockIndex: number;
  source: ExpectedBlockSource;
  template: T;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  durationMinutes: number;
  /** null para un bloque de convocatoria a feriado. */
  origin: RotationOrigin | null;
};

export type ExpectedDayPlanMissingReason =
  | "ROTATION_NOT_FOUND"
  | "CREW_NOT_IN_ROTATION"
  | "CREW_INACTIVE"
  | "NO_VERSION_IN_EFFECT"
  | "INVALID_VERSION"
  | "NO_DAY_ROW"
  | "SHIFT_DAY_WITHOUT_BLOCKS"
  | "TEMPLATE_UNAVAILABLE";

export type ExpectedDayPlanConflictReason =
  | "MULTIPLE_MEMBERSHIPS"
  | "MULTIPLE_VERSIONS"
  | "DUPLICATE_DAY_ROWS"
  | "REST_DAY_WITH_BLOCKS"
  | "DUPLICATE_BLOCK_INDEX"
  | "OVERLAPPING_BLOCKS";

type PlanBase = { dateKey: string; employeeId: string; source: "ROTATION" };

export type ExpectedDayPlan<T extends RotationTemplateRef = RotationTemplateRef> =
  | (PlanBase & { kind: "REST"; origin: RotationOrigin })
  | (PlanBase & { kind: "MISSING"; reason: ExpectedDayPlanMissingReason; origin: Partial<RotationOrigin> & { rotationId: string; crewId: string } })
  | (PlanBase & { kind: "CONFLICT"; reason: ExpectedDayPlanConflictReason; detail: string[] })
  | (PlanBase & { kind: "SHIFTS"; origin: RotationOrigin; blocks: ExpectedBlock<T>[] });

// ── Ciclo ───────────────────────────────────────────────────────────────────

export const MAX_ROTATION_CYCLE_WEEKS = 12;

export function isValidCycleLength(cycleLengthWeeks: number): boolean {
  return Number.isInteger(cycleLengthWeeks) && cycleLengthWeeks >= 1 && cycleLengthWeeks <= MAX_ROTATION_CYCLE_WEEKS;
}

export function isMondayKey(dateKey: string): boolean {
  return calendarWeekdayOfKey(dateKey) === 1;
}

/**
 * Semana del ciclo (0 = A) de una fecha: semanas completas entre el lunes
 * ancla y el lunes de la semana de la fecha, con módulo positivo (fechas
 * anteriores al ancla y cambios de mes/año sin reinicio).
 */
export function rotationWeekIndex(anchorWeekStart: string, cycleLengthWeeks: number, dateKey: string): number {
  if (!isValidCycleLength(cycleLengthWeeks)) throw new RangeError(`rotationWeekIndex: ciclo inválido (${cycleLengthWeeks}).`);
  if (!isMondayKey(anchorWeekStart)) throw new RangeError(`rotationWeekIndex: el ancla ${anchorWeekStart} no es lunes.`);
  const weekOffset = calendarDaysBetweenKeys(anchorWeekStart, mondayOfCalendarDateKey(dateKey)) / 7;
  return ((weekOffset % cycleLengthWeeks) + cycleLengthWeeks) % cycleLengthWeeks;
}

/** Etiqueta visible de la semana del ciclo: 0 → "A", 1 → "B", … */
export function rotationWeekLabel(cycleWeekIndex: number): string {
  return String.fromCharCode(65 + cycleWeekIndex);
}

// ── Bloques ─────────────────────────────────────────────────────────────────

/** Minuto de inicio y duración de una plantilla, o null si su horario no es utilizable. */
export function templateSchedule(template: Pick<RotationTemplateRef, "startTime" | "endTime">): { startMinute: number; durationMinutes: number } | null {
  const startMinute = parseShiftTime(template.startTime);
  const endMinute = parseShiftTime(template.endTime);
  if (startMinute === null || endMinute === null) return null;
  const durationMinutes = computeExpectedMinutes(template.startTime, template.endTime, endMinute <= startMinute);
  return durationMinutes > 0 && durationMinutes <= 24 * 60 ? { startMinute, durationMinutes } : null;
}

export function isTemplateUsable(template: RotationTemplateRef): boolean {
  return template.status === "ACTIVO" && templateSchedule(template) !== null;
}

/** Bloque concreto de una plantilla en una fecha operativa (inicio = 00:00 de la fecha + startTime; fin = inicio + duración). */
export function buildExpectedBlock<T extends RotationTemplateRef>(input: {
  employeeId: string;
  dateKey: string;
  blockIndex: number;
  template: T;
  source: ExpectedBlockSource;
  origin: RotationOrigin | null;
}): ExpectedBlock<T> | null {
  const schedule = templateSchedule(input.template);
  if (!schedule) return null;
  const scheduledStartAt = scheduledInstantForShiftTime(argentinaDayRange(input.dateKey).startAt, input.template.startTime);
  const scheduledEndAt = new Date(scheduledStartAt.getTime() + schedule.durationMinutes * 60_000);
  return {
    obligationKey: `${input.employeeId}|${scheduledStartAt.toISOString()}`,
    employeeId: input.employeeId,
    operationalDate: input.dateKey,
    blockIndex: input.blockIndex,
    source: input.source,
    template: input.template,
    scheduledStartAt,
    scheduledEndAt,
    durationMinutes: schedule.durationMinutes,
    origin: input.origin,
  };
}

// ── Resolución del plan del día ─────────────────────────────────────────────

const isInEffect = (from: string, to: string | null, dateKey: string) => from <= dateKey && (to === null || to >= dateKey);
const range = (from: string, to: string | null) => `[${from}..${to ?? "∞"}]`;

export function resolveRotationDayPlan<T extends RotationTemplateRef>(employeeId: string, dateKey: string, config: RotationConfiguration<T>): ExpectedDayPlan<T> | null {
  const base: PlanBase = { dateKey, employeeId, source: "ROTATION" };
  const conflict = (reason: ExpectedDayPlanConflictReason, detail: string[]): ExpectedDayPlan<T> => ({ ...base, kind: "CONFLICT", reason, detail });

  // 1. Membresía vigente (la base la hace única por persona y fecha en TODAS las rotaciones).
  const memberships = config.memberships.filter((item) => item.employeeId === employeeId && isInEffect(item.effectiveFrom, item.effectiveTo, dateKey));
  if (!memberships.length) return null;
  if (memberships.length > 1) {
    return conflict("MULTIPLE_MEMBERSHIPS", memberships.map((item) => `membership:${item.rotationId}/${item.crewId}${range(item.effectiveFrom, item.effectiveTo)}`));
  }
  const membership = memberships[0]!;
  const missing = (reason: ExpectedDayPlanMissingReason, origin: Partial<RotationOrigin> = {}): ExpectedDayPlan<T> => ({
    ...base,
    kind: "MISSING",
    reason,
    origin: { rotationId: membership.rotationId, crewId: membership.crewId, ...origin },
  });

  // 2. Rotación ACTIVA (INACTIVA = deja de resolver: rige el legacy) y equipo propio y ACTIVO.
  const rotation = config.rotations.find((item) => item.id === membership.rotationId);
  if (!rotation) return missing("ROTATION_NOT_FOUND");
  if (rotation.status !== "ACTIVO") return null;
  const crew = rotation.crews.find((item) => item.id === membership.crewId);
  if (!crew) return missing("CREW_NOT_IN_ROTATION");
  if (crew.status !== "ACTIVO") return missing("CREW_INACTIVE");

  // 3. Versión vigente (única por rotación y fecha).
  const versions = rotation.versions.filter((item) => isInEffect(item.effectiveFrom, item.effectiveTo, dateKey));
  if (!versions.length) return missing("NO_VERSION_IN_EFFECT");
  if (versions.length > 1) return conflict("MULTIPLE_VERSIONS", versions.map((item) => `version:${item.id}${range(item.effectiveFrom, item.effectiveTo)}`));
  const version = versions[0]!;
  if (!isValidCycleLength(version.cycleLengthWeeks) || !isMondayKey(version.anchorWeekStart)) return missing("INVALID_VERSION", { versionId: version.id });

  // 4. Celda (equipo, semana del ciclo, día de semana).
  const cycleWeekIndex = rotationWeekIndex(version.anchorWeekStart, version.cycleLengthWeeks, dateKey);
  const weekday = calendarWeekdayOfKey(dateKey);
  const cell = { versionId: version.id, cycleWeekIndex, weekday };
  const days = version.days.filter((item) => item.crewId === crew.id && item.cycleWeekIndex === cycleWeekIndex && item.weekday === weekday);
  if (!days.length) return missing("NO_DAY_ROW", cell);
  if (days.length > 1) return conflict("DUPLICATE_DAY_ROWS", days.map((item) => `day:${item.id}`));
  const day = days[0]!;
  const origin: RotationOrigin = { rotationId: rotation.id, crewId: crew.id, ...cell, dayId: day.id };

  if (day.kind === "REST") {
    if (day.blocks.length) return conflict("REST_DAY_WITH_BLOCKS", [`day:${day.id}`, ...day.blocks.map((block) => `block:${day.id}#${block.blockIndex}`)]);
    return { ...base, kind: "REST", origin };
  }

  // 5. Día SHIFT: 1..N bloques, en orden, sin duplicados ni superposición.
  if (!day.blocks.length) return missing("SHIFT_DAY_WITHOUT_BLOCKS", { ...cell, dayId: day.id });
  const indexes = day.blocks.map((block) => block.blockIndex);
  const duplicated = indexes.filter((index, position) => indexes.indexOf(index) !== position);
  if (duplicated.length) return conflict("DUPLICATE_BLOCK_INDEX", [...new Set(duplicated)].map((index) => `block:${day.id}#${index}`));
  if (day.blocks.some((block) => !isTemplateUsable(block.template))) return missing("TEMPLATE_UNAVAILABLE", { ...cell, dayId: day.id });

  const blocks = [...day.blocks]
    .sort((left, right) => left.blockIndex - right.blockIndex)
    .map((block) => buildExpectedBlock({ employeeId, dateKey, blockIndex: block.blockIndex, template: block.template, source: "ROTATION", origin })!);
  const byStart = [...blocks].sort((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime());
  for (let index = 1; index < byStart.length; index += 1) {
    const previous = byStart[index - 1]!;
    const current = byStart[index]!;
    if (current.scheduledStartAt < previous.scheduledEndAt) {
      return conflict("OVERLAPPING_BLOCKS", [`block:${day.id}#${previous.blockIndex}`, `block:${day.id}#${current.blockIndex}`]);
    }
  }
  return { ...base, kind: "SHIFTS", origin, blocks };
}
