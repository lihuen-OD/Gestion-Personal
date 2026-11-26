/**
 * Piezas compartidas de los servicios de administración de rotaciones — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * Reglas transversales (decisiones del usuario, 2026-11-24):
 * - Fecha mínima = MAÑANA para todo lo que rige sobre personas; una rotación
 *   INACTIVA (nunca rigió) admite versiones desde HOY.
 * - "Ya rigió" = rotación ACTIVA con alguna membresía que empezó ≤ hoy. Lo que
 *   rigió no se edita ni se borra; el estado INACTIVO no tiene fecha (el
 *   núcleo lo aplica también al pasado), por eso sólo se permite si nunca rigió.
 * - Versión bloqueada = rotación ACTIVA y `effectiveFrom ≤ hoy`.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { argentinaCalendarDate, calendarDateKey, nextCalendarDateKey, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { AppError } from "../../shared/errors/AppError";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import { coverageWindowOf, recalculateNoveltyCoverage, type NoveltyCoverageRecalculation } from "../novelties/noveltyCoverageRecalculation";
import type { RotationSnapshot, RotationTemplateRef, RotationVersionSnapshot } from "./rotationPlan";
import type { RotationFullRow, RotationMemberRow, RotationVersionRow } from "./shiftRotation.repository";
import { formatDateKey, toPublicIssues, type MembershipFacts, type ReadinessIssue } from "./shiftRotationReadiness";
import { withErrorScope } from "./shiftErrorScope";

export const ROTATION_TRANSACTION_OPTIONS = { timeout: 30_000 };

export type TemplateRefWithGroup = RotationTemplateRef & { name: string; shiftGroupId: string | null };

export const keyOf = (date: Date) => calendarDateKey(date);
export const keyOrNull = (date: Date | null) => (date ? calendarDateKey(date) : null);

export function todayAndTomorrow(now: Date = new Date()) {
  const today = todayArgentinaDateKey(now);
  return { today, tomorrow: nextCalendarDateKey(today) };
}

export function describeRotation(rotation: { code: string; name: string }) {
  return `${rotation.code} - ${rotation.name}`;
}

export function describeCrew(crew: { code: string; name: string }) {
  return `${crew.code} - ${crew.name}`;
}

export const employeeLabel = formatEmployeeReference;

/** Rotación ACTIVA con alguna membresía que ya empezó (≤ hoy). */
export function rotationHasRuled(rotation: Pick<RotationFullRow, "status" | "crews">, today: string): boolean {
  if (rotation.status !== "ACTIVO") return false;
  return rotation.crews.some((crew) => crew.members.some((member) => keyOf(member.effectiveFrom) <= today));
}

export function isVersionLocked(rotation: { status: "ACTIVO" | "INACTIVO" }, version: { effectiveFrom: Date }, today: string): boolean {
  return rotation.status === "ACTIVO" && keyOf(version.effectiveFrom) <= today;
}

/** Fecha mínima de inicio de una versión: hoy si la rotación está INACTIVA, si no mañana. */
export function minimumVersionStart(rotation: { status: "ACTIVO" | "INACTIVO" }, now: Date = new Date()) {
  const { today, tomorrow } = todayAndTomorrow(now);
  return rotation.status === "INACTIVO" ? today : tomorrow;
}

export function assertNotBefore(dateKey: string, minimum: string, what: string) {
  if (dateKey < minimum) {
    throw new AppError(`${what} debe ser desde el ${formatDateKey(minimum)} o posterior: un cambio de rotación nunca rige sobre fechas pasadas ni sobre hoy si ya pudo haber fichadas.`, 422, "ROTATION_DATE_TOO_EARLY");
  }
}

export function notFound(what = "la rotación solicitada") {
  return new AppError(`No encontramos ${what}`, 404, "ROTATION_NOT_FOUND");
}

// ── Snapshots (filas → núcleo puro) ─────────────────────────────────────────

export function templateRef(row: { id: string; code: string; name: string; startTime: string; endTime: string; crossesMidnight: boolean; status: "ACTIVO" | "INACTIVO"; shiftGroupId: string | null }): TemplateRefWithGroup {
  return { id: row.id, code: row.code, name: row.name, startTime: row.startTime, endTime: row.endTime, crossesMidnight: row.crossesMidnight, status: row.status, shiftGroupId: row.shiftGroupId };
}

export function versionSnapshot(version: RotationVersionRow): RotationVersionSnapshot<TemplateRefWithGroup> {
  return {
    id: version.id,
    rotationId: version.rotationId,
    cycleLengthWeeks: version.cycleLengthWeeks,
    anchorWeekStart: keyOf(version.anchorWeekStart),
    effectiveFrom: keyOf(version.effectiveFrom),
    effectiveTo: keyOrNull(version.effectiveTo),
    days: version.days.map((day) => ({
      id: day.id,
      crewId: day.crewId,
      cycleWeekIndex: day.cycleWeekIndex,
      weekday: day.weekday,
      kind: day.kind,
      blocks: day.blocks.map((block) => ({ blockIndex: block.blockIndex, template: templateRef(block.shiftTemplate) })),
    })),
  };
}

export function rotationSnapshot(rotation: RotationFullRow): RotationSnapshot<TemplateRefWithGroup> & { shiftGroupId: string } {
  return {
    id: rotation.id,
    code: rotation.code,
    status: rotation.status,
    shiftGroupId: rotation.shiftGroupId,
    crews: rotation.crews.map((crew) => ({ id: crew.id, code: crew.code, status: crew.status })),
    versions: rotation.versions.map(versionSnapshot),
  };
}

export function allMembers(rotation: RotationFullRow): RotationMemberRow[] {
  return rotation.crews.flatMap((crew) => crew.members);
}

export function membershipFacts(member: RotationMemberRow): MembershipFacts {
  return {
    id: member.id,
    employeeId: member.employeeId,
    crewId: member.crewId,
    effectiveFrom: keyOf(member.effectiveFrom),
    effectiveTo: keyOrNull(member.effectiveTo),
    employeeLabel: employeeLabel(member.employee),
    employeeActive: member.employee.status === "ACTIVO",
  };
}

export function templatesOf(rotation: RotationFullRow): Map<string, TemplateRefWithGroup> {
  const map = new Map<string, TemplateRefWithGroup>();
  for (const version of rotation.versions) for (const day of version.days) for (const block of day.blocks) map.set(block.shiftTemplate.id, templateRef(block.shiftTemplate));
  return map;
}

// ── Auditoría: snapshots sin ids técnicos en el texto ───────────────────────

export function versionAuditSnapshot(version: RotationVersionRow, crewNames: ReadonlyMap<string, string>): Prisma.InputJsonValue {
  return {
    id: version.id,
    cycleLengthWeeks: version.cycleLengthWeeks,
    anchorWeekStart: keyOf(version.anchorWeekStart),
    effectiveFrom: keyOf(version.effectiveFrom),
    effectiveTo: keyOrNull(version.effectiveTo),
    days: version.days.map((day) => ({
      crewId: day.crewId,
      crew: crewNames.get(day.crewId) ?? null,
      cycleWeekIndex: day.cycleWeekIndex,
      weekday: day.weekday,
      kind: day.kind,
      blocks: day.blocks.map((block) => ({ blockIndex: block.blockIndex, shiftTemplateId: block.shiftTemplateId, template: block.shiftTemplate.code, startTime: block.shiftTemplate.startTime, endTime: block.shiftTemplate.endTime })),
    })),
  };
}

export function memberAuditSnapshot(member: { id: string; employeeId: string; crewId: string; effectiveFrom: Date; effectiveTo: Date | null }, extra: { employee?: string; crew?: string } = {}): Prisma.InputJsonValue {
  return { id: member.id, employeeId: member.employeeId, employee: extra.employee ?? null, crewId: member.crewId, crew: extra.crew ?? null, effectiveFrom: keyOf(member.effectiveFrom), effectiveTo: keyOrNull(member.effectiveTo) };
}

export function rangeLabel(from: string, to: string | null) {
  return to === null ? `desde el ${formatDateKey(from)}` : `del ${formatDateKey(from)} al ${formatDateKey(to)}`;
}

// ── Cobertura ───────────────────────────────────────────────────────────────

/** Recálculo de Novedades de las personas afectadas dentro de las vigencias tocadas (misma transacción). */
export async function recalculateRotationCoverage(tx: PrismaTransactionClient, employeeIds: string[], ranges: Array<{ from: string; to: string | null }>, label: string): Promise<NoveltyCoverageRecalculation | null> {
  const ids = [...new Set(employeeIds)];
  const window = coverageWindowOf(ranges.map((range) => ({ from: argentinaCalendarDate(range.from), to: range.to ? argentinaCalendarDate(range.to) : null })));
  if (!ids.length || !window) return null;
  return recalculateNoveltyCoverage(tx, { employeeIds: ids, ...window }, { source: "SHIFT_ROTATION_CHANGED", label });
}

// ── Confirmación en dos pasos (garantía 3) ──────────────────────────────────

/** sha256 del conjunto canónico afectado: detecta cambios entre la vista previa y la confirmación (no es un secreto). */
export function confirmationTokenOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// ── Guarda de configuración: una escritura nunca deja problemas NUEVOS ──────

const issueKey = (issue: ReadinessIssue) => [issue.code, issue.versionId ?? "", issue.crewId ?? "", issue.employeeId ?? "", issue.message].join("|");

/** Problemas bloqueantes que aparecen después de una escritura y no existían antes. */
export function newBlockingIssues(before: ReadinessIssue[], after: ReadinessIssue[]): ReadinessIssue[] {
  const known = new Set(before.filter((issue) => issue.severity === "ERROR").map(issueKey));
  return after.filter((issue) => issue.severity === "ERROR" && !known.has(issueKey(issue)));
}

export function assertNoNewBlockingIssues(before: ReadinessIssue[], after: ReadinessIssue[], action: string) {
  const added = newBlockingIssues(before, after);
  if (added.length) {
    throw withErrorScope(new AppError(`No se puede ${action}: dejaría la rotación con una configuración incompleta o contradictoria.`, 409, "ROTATION_CONFIGURATION_CONFLICT", { issues: toPublicIssues(added) }), { issues: added });
  }
}
