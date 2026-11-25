/**
 * Diagnóstico de configuración y transiciones de rotaciones — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9). Puro: sin Prisma ni HTTP.
 *
 * - `assessRotation`: problemas que impedirían que la rotación rija bien
 *   (grilla inválida o incompleta, membresías sin versión o sin grilla de su
 *   equipo, equipos inactivos con miembros, turnos fijos o SIN_TURNO
 *   superpuestos). Lo usan la activación, el alta y el detalle (`issues`).
 *   Reutiliza `validateRotationGrid` (R4.2); no hay un validador paralelo.
 * - `transitionCheck`: superposición entre los bloques del último día de un
 *   régimen y los del primer día del siguiente (garantía 2). Un bloque
 *   nocturno que empieza el último día de vigencia termina al día siguiente
 *   y se compara con instantes reales, nunca con fechas.
 */
import { argentinaCalendarDate, formatArgentinaDate, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { applicableFixedAssignments, type FixedAssignment } from "./expectedShiftResolver";
import { buildExpectedBlock, resolveRotationDayPlan, type RotationConfiguration, type RotationSnapshot, type RotationTemplateRef } from "./rotationPlan";
import { validateRotationGrid, type RotationGridIssue } from "./rotationValidation";

export type ReadinessIssueCode =
  | "GRID_INVALID"
  | "GRID_INCOMPLETE"
  | "TEMPLATE_OTHER_GROUP"
  | "MEMBERSHIP_WITHOUT_VERSION"
  | "CREW_WITHOUT_GRID"
  | "CREW_INACTIVE_WITH_MEMBERS"
  | "FIXED_ASSIGNMENT_OVERLAP"
  | "SIN_TURNO_OVERLAP"
  | "EMPLOYEE_INACTIVE";

export type ReadinessIssue = {
  code: ReadinessIssueCode;
  severity: "ERROR" | "WARNING";
  message: string;
  versionId?: string;
  crewId?: string;
  employeeId?: string;
  grid?: RotationGridIssue;
};

export type MembershipFacts = {
  id: string;
  employeeId: string;
  crewId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** "Apellido, Nombre · Legajo N" (texto humano, nunca el id). */
  employeeLabel: string;
  employeeActive: boolean;
};

export type FixedAssignmentFacts = { employeeId: string; templateCode: string; status: "HABILITADO" | "DESHABILITADO"; effectiveFrom: string; effectiveTo: string | null };
export type RegimeFacts = { employeeId: string; kind: string; effectiveFrom: string; effectiveTo: string | null };

/** Rangos de fechas calendario inclusivos ("YYYY-MM-DD"; `null` = abierto). */
export function rangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return (bTo === null || aFrom <= bTo) && (aTo === null || bFrom <= aTo);
}

export const isOpenOnOrAfter = (to: string | null, dateKey: string) => to === null || to >= dateKey;

/** Tramos de [from, to] no cubiertos por ninguna versión (las versiones de una rotación no se superponen). */
export function uncoveredRanges(from: string, to: string | null, versions: Array<{ effectiveFrom: string; effectiveTo: string | null }>): Array<{ from: string; to: string | null }> {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const gaps: Array<{ from: string; to: string | null }> = [];
  let cursor: string | null = from;
  for (const version of sorted) {
    if (cursor === null) break;
    if (to !== null && cursor > to) break;
    if (version.effectiveTo !== null && version.effectiveTo < cursor) continue;
    if (version.effectiveFrom > cursor) {
      const gapEnd = previousCalendarDateKey(version.effectiveFrom);
      gaps.push({ from: cursor, to: to !== null && to < gapEnd ? to : gapEnd });
      if (to !== null && version.effectiveFrom > to) { cursor = null; break; }
    }
    cursor = version.effectiveTo === null ? null : nextCalendarDateKey(version.effectiveTo);
  }
  if (cursor !== null && (to === null || cursor <= to)) gaps.push({ from: cursor, to });
  return gaps;
}

export const formatDateKey = (dateKey: string) => formatArgentinaDate(dateKey);

const rangeText = (from: string, to: string | null) => (to === null ? `desde el ${formatDateKey(from)}` : from === to ? `el ${formatDateKey(from)}` : `del ${formatDateKey(from)} al ${formatDateKey(to)}`);

export function assessRotation<T extends RotationTemplateRef>(input: {
  rotation: RotationSnapshot<T> & { shiftGroupId: string };
  crewNames: ReadonlyMap<string, string>;
  memberships: MembershipFacts[];
  fixedAssignments: FixedAssignmentFacts[];
  regimes: RegimeFacts[];
  templates: ReadonlyMap<string, RotationTemplateRef & { shiftGroupId: string | null }>;
  todayKey: string;
}): ReadinessIssue[] {
  const { rotation, memberships, todayKey } = input;
  const issues: ReadinessIssue[] = [];
  const crewName = (crewId: string) => input.crewNames.get(crewId) ?? "sin nombre";
  const relevantMembers = memberships.filter((membership) => isOpenOnOrAfter(membership.effectiveTo, todayKey));
  const crewsWithMembers = new Set(relevantMembers.map((membership) => membership.crewId));

  for (const version of rotation.versions.filter((candidate) => isOpenOnOrAfter(candidate.effectiveTo, todayKey))) {
    const versionLabel = `versión ${rangeText(version.effectiveFrom, version.effectiveTo)}`;
    for (const issue of validateRotationGrid({ rotation, version, templates: input.templates })) {
      if (issue.severity === "ERROR") {
        issues.push({ code: "GRID_INVALID", severity: "ERROR", versionId: version.id, crewId: issue.crewId, message: `${versionLabel}: ${issue.message}`, grid: issue });
      } else if (issue.code === "DAY_MISSING" && issue.crewId) {
        const blocking = crewsWithMembers.has(issue.crewId);
        issues.push({ code: "GRID_INCOMPLETE", severity: blocking ? "ERROR" : "WARNING", versionId: version.id, crewId: issue.crewId, message: `${versionLabel}: ${issue.message}`, grid: issue });
      }
    }
    for (const day of version.days) {
      for (const block of day.blocks) {
        const template = input.templates.get(block.template.id);
        if (template && template.shiftGroupId !== rotation.shiftGroupId) {
          issues.push({ code: "TEMPLATE_OTHER_GROUP", severity: "ERROR", versionId: version.id, crewId: day.crewId, message: `${versionLabel}: el turno ${template.code} no pertenece al grupo de la rotación.` });
        }
      }
    }
  }

  const crewStatus = new Map(rotation.crews.map((crew) => [crew.id, crew.status]));
  for (const membership of relevantMembers) {
    const who = membership.employeeLabel;
    if (crewStatus.get(membership.crewId) !== "ACTIVO") {
      issues.push({ code: "CREW_INACTIVE_WITH_MEMBERS", severity: "ERROR", crewId: membership.crewId, employeeId: membership.employeeId, message: `${who} pertenece al equipo inactivo ${crewName(membership.crewId)}.` });
    }
    for (const gap of uncoveredRanges(membership.effectiveFrom, membership.effectiveTo, rotation.versions)) {
      issues.push({ code: "MEMBERSHIP_WITHOUT_VERSION", severity: "ERROR", crewId: membership.crewId, employeeId: membership.employeeId, message: `${who} no tiene una versión de la rotación que rija ${rangeText(gap.from, gap.to)}.` });
    }
    for (const version of rotation.versions) {
      if (!rangesOverlap(membership.effectiveFrom, membership.effectiveTo, version.effectiveFrom, version.effectiveTo)) continue;
      if (!version.days.some((day) => day.crewId === membership.crewId)) {
        issues.push({ code: "CREW_WITHOUT_GRID", severity: "ERROR", versionId: version.id, crewId: membership.crewId, employeeId: membership.employeeId, message: `La versión ${rangeText(version.effectiveFrom, version.effectiveTo)} no tiene grilla para el equipo ${crewName(membership.crewId)} de ${who}.` });
      }
    }
    for (const fixed of input.fixedAssignments) {
      if (fixed.employeeId !== membership.employeeId || fixed.status !== "HABILITADO") continue;
      if (rangesOverlap(membership.effectiveFrom, membership.effectiveTo, fixed.effectiveFrom, fixed.effectiveTo)) {
        issues.push({ code: "FIXED_ASSIGNMENT_OVERLAP", severity: "ERROR", employeeId: membership.employeeId, message: `${who} tiene el turno fijo ${fixed.templateCode} ${rangeText(fixed.effectiveFrom, fixed.effectiveTo)}, superpuesto con su membresía.` });
      }
    }
    for (const regime of input.regimes) {
      if (regime.employeeId !== membership.employeeId || regime.kind !== "SIN_TURNO") continue;
      if (rangesOverlap(membership.effectiveFrom, membership.effectiveTo, regime.effectiveFrom, regime.effectiveTo)) {
        issues.push({ code: "SIN_TURNO_OVERLAP", severity: "ERROR", employeeId: membership.employeeId, message: `${who} tiene régimen SIN_TURNO ${rangeText(regime.effectiveFrom, regime.effectiveTo)}, incompatible con una rotación.` });
      }
    }
    if (!membership.employeeActive) {
      issues.push({ code: "EMPLOYEE_INACTIVE", severity: "WARNING", employeeId: membership.employeeId, message: `${who} está inactivo y conserva una membresía vigente o futura.` });
    }
  }
  return issues;
}

export const hasBlockingIssues = (issues: ReadinessIssue[]) => issues.some((issue) => issue.severity === "ERROR");

export function healthOf(issues: ReadinessIssue[]): "OK" | "WARNING" | "ERROR" {
  if (hasBlockingIssues(issues)) return "ERROR";
  return issues.length ? "WARNING" : "OK";
}

// ── Transiciones (garantía 2) ───────────────────────────────────────────────

export type ScheduledInterval = { start: Date; end: Date; label: string };

const hhmm = (template: { startTime: string; endTime: string }) => `${template.startTime}–${template.endTime}`;

/** Bloques programados de la rotación para una persona y fecha (sólo días con bloques). */
export function rotationIntervalsOn<T extends RotationTemplateRef>(config: RotationConfiguration<T>, employeeId: string, dateKey: string): ScheduledInterval[] {
  const plan = resolveRotationDayPlan(employeeId, dateKey, config);
  if (!plan || plan.kind !== "SHIFTS") return [];
  return plan.blocks.map((block) => ({ start: block.scheduledStartAt, end: block.scheduledEndAt, label: `rotación ${block.template.code} ${hhmm(block.template)} del ${formatDateKey(dateKey)}` }));
}

/** Bloques de los turnos fijos aplicables a la fecha (HABILITADOS, vigentes, día de semana). */
export function fixedIntervalsOn<T extends RotationTemplateRef>(assignments: FixedAssignment<T>[], employeeId: string, dateKey: string): ScheduledInterval[] {
  const reference = argentinaCalendarDate(dateKey);
  return applicableFixedAssignments(assignments, reference).flatMap((assignment) => {
    const block = buildExpectedBlock({ employeeId, dateKey, blockIndex: 0, template: assignment.template, source: "ROTATION", origin: null });
    return block ? [{ start: block.scheduledStartAt, end: block.scheduledEndAt, label: `turno fijo ${assignment.template.code} ${hhmm(assignment.template)} del ${formatDateKey(dateKey)}` }] : [];
  });
}

export type TransitionResult = {
  overlaps: Array<{ outgoing: string; incoming: string }>;
  /** Menor descanso (minutos) entre el fin de un bloque saliente y el inicio de uno entrante; null si falta alguno. */
  restMinutes: number | null;
};

/** Superposición real (instantes) entre los bloques salientes y entrantes; tocarse no es superponerse. */
export function transitionCheck(outgoing: ScheduledInterval[], incoming: ScheduledInterval[]): TransitionResult {
  const overlaps: TransitionResult["overlaps"] = [];
  let restMinutes: number | null = null;
  for (const before of outgoing) {
    for (const after of incoming) {
      if (before.start.getTime() < after.end.getTime() && after.start.getTime() < before.end.getTime()) {
        overlaps.push({ outgoing: before.label, incoming: after.label });
        continue;
      }
      if (after.start.getTime() >= before.end.getTime()) {
        const rest = Math.round((after.start.getTime() - before.end.getTime()) / 60_000);
        restMinutes = restMinutes === null ? rest : Math.min(restMinutes, rest);
      }
    }
  }
  return { overlaps, restMinutes };
}
