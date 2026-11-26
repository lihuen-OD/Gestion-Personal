/**
 * Versiones de rotación (ciclo, ancla, vigencia y grilla) — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * - Las versiones de una rotación son CONTIGUAS: crear una desde X cierra la
 *   anterior en X−1 en la misma transacción.
 * - Una versión que ya rigió (rotación ACTIVA y `effectiveFrom ≤ hoy`) es
 *   inmutable: los cambios se hacen con una versión nueva desde mañana.
 * - La grilla va completa en un solo cuerpo y se valida con
 *   `validateRotationGrid` (R4.2) antes de escribir: sin errores y sin días
 *   faltantes para equipos ACTIVOS (una grilla incompleta no puede regir).
 * - Sólo plantillas ACTIVAS del mismo grupo que la rotación.
 * - Borrar o editar una versión futura guarda antes su snapshot completo en el
 *   AuditLog (misma transacción).
 */
import { previousCalendarDateKey, nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { auditService, type AuditContext } from "../audit/audit.service";
import { auditNoveltyCoverageRecalculationWithin } from "../novelties/noveltyCoverageRecalculation";
import { lockEmployeeCoverage } from "../novelties/noveltyCoverage.service";
import { rotationWeekLabel, type RotationConfiguration, type RotationVersionSnapshot } from "./rotationPlan";
import { validateRotationGrid } from "./rotationValidation";
import { shiftRotationRepository, type RotationFullRow, type RotationVersionRow, type VersionDayData } from "./shiftRotation.repository";
import type { CreateVersionInput, UpdateVersionInput, VersionDayInput } from "./shiftRotation.schemas";
import { assessRotationRow } from "./shiftRotation.service";
import {
  allMembers,
  assertNoNewBlockingIssues,
  assertNotBefore,
  describeCrew,
  describeRotation,
  isVersionLocked,
  keyOf,
  keyOrNull,
  membershipFacts,
  minimumVersionStart,
  notFound,
  rangeLabel,
  recalculateRotationCoverage,
  ROTATION_TRANSACTION_OPTIONS,
  rotationSnapshot,
  templateRef,
  todayAndTomorrow,
  versionAuditSnapshot,
  versionSnapshot,
  type TemplateRefWithGroup,
} from "./shiftRotation.support";
import { withRotationErrors } from "./shiftRotationErrors";
import { canAccessShiftGroup, type ShiftGroupScope } from "./shiftGroupAccess";
import { canSeeEmployee } from "./shiftRotationVisibility";
import { assertEmployeesWritable, canManageShiftGroup, isGlobalActor, rotationViewerForActor, withShiftActorErrors, type ShiftActor } from "./shiftWriteAccess";
import { formatDateKey, rangesOverlap } from "./shiftRotationReadiness";
import { transitionIssuesForEntry } from "./shiftRotationTransitions";

type Db = PrismaTransactionClient;

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function versionResponse(rotation: RotationFullRow, version: RotationVersionRow, today: string) {
  const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
  const snapshot = versionSnapshot(version);
  const templates = new Map(snapshot.days.flatMap((day) => day.blocks.map((block) => [block.template.id, block.template] as const)));
  return {
    id: version.id,
    rotationId: rotation.id,
    effectiveFrom: keyOf(version.effectiveFrom),
    effectiveTo: keyOrNull(version.effectiveTo),
    cycleLengthWeeks: version.cycleLengthWeeks,
    anchorWeekStart: keyOf(version.anchorWeekStart),
    locked: isVersionLocked(rotation, version, today),
    updatedAt: version.updatedAt,
    days: version.days.map((day) => ({
      id: day.id,
      crewId: day.crewId,
      crew: crewNames.get(day.crewId) ?? null,
      cycleWeekIndex: day.cycleWeekIndex,
      weekLabel: rotationWeekLabel(day.cycleWeekIndex),
      weekday: day.weekday,
      weekdayName: WEEKDAY_NAMES[day.weekday] ?? null,
      kind: day.kind,
      blocks: day.blocks.map((block) => ({ blockIndex: block.blockIndex, shiftTemplateId: block.shiftTemplateId, template: { code: block.shiftTemplate.code, name: block.shiftTemplate.name, startTime: block.shiftTemplate.startTime, endTime: block.shiftTemplate.endTime } })),
    })),
    issues: validateRotationGrid({ rotation: rotationSnapshot(rotation), version: snapshot, templates }),
  };
}

async function requireRotation(id: string, db: Db) {
  const rotation = await shiftRotationRepository.findFull(id, db);
  if (!rotation) throw notFound();
  return rotation;
}

function requireVersion(rotation: RotationFullRow, versionId: string) {
  const version = rotation.versions.find((candidate) => candidate.id === versionId);
  if (!version) throw notFound("la versión solicitada");
  return version;
}

/** Valida la grilla propuesta (borrador) contra la rotación y sus plantillas. */
async function validateDraft(db: Db, rotation: RotationFullRow, input: { cycleLengthWeeks: number; anchorWeekStart: string; effectiveFrom: string; days: VersionDayInput[] }, actor: ShiftActor) {
  const templateIds = [...new Set(input.days.flatMap((day) => day.blocks.map((block) => block.shiftTemplateId)))];
  const rows = await shiftRotationRepository.templatesByIds(templateIds, db);
  const templates = new Map<string, TemplateRefWithGroup>(rows.map((row) => [row.id, templateRef(row)]));
  const foreign = rows.filter((row) => row.shiftGroupId !== rotation.shiftGroupId);
  if (foreign.length && !isGlobalActor(actor)) {
    // R8.3: sin códigos ni grupos ajenos para quien no administra todo.
    throw new AppError("La grilla usa turnos que no pertenecen al grupo de la rotación. Una rotación sólo usa turnos activos de su grupo.", 422, "ROTATION_TEMPLATE_OTHER_GROUP");
  }
  if (foreign.length) {
    throw new AppError(`La grilla usa turnos de otro grupo: ${foreign.map((row) => row.code).join(", ")}. Una rotación sólo usa turnos activos de su grupo (${rotation.shiftGroup.code}).`, 422, "ROTATION_TEMPLATE_OTHER_GROUP", { templates: foreign.map((row) => row.code) });
  }
  const draft: RotationVersionSnapshot<TemplateRefWithGroup> = {
    id: "draft",
    rotationId: rotation.id,
    cycleLengthWeeks: input.cycleLengthWeeks,
    anchorWeekStart: input.anchorWeekStart,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    days: input.days.map((day, index) => ({
      id: `draft-${index}`,
      crewId: day.crewId,
      cycleWeekIndex: day.cycleWeekIndex,
      weekday: day.weekday,
      kind: day.kind,
      blocks: day.blocks.map((block) => ({ blockIndex: block.blockIndex, template: templates.get(block.shiftTemplateId) ?? { id: block.shiftTemplateId, code: "?", name: "?", startTime: "00:00", endTime: "00:00", crossesMidnight: false, status: "INACTIVO", shiftGroupId: null } })),
    })),
  };
  const issues = validateRotationGrid({ rotation: rotationSnapshot(rotation), version: draft, templates });
  const blocking = issues.filter((issue) => issue.severity === "ERROR" || issue.code === "DAY_MISSING");
  if (blocking.length) {
    throw new AppError("La grilla tiene errores o está incompleta: cada equipo activo necesita los 7 días de cada semana del ciclo, sin superposiciones.", 422, "ROTATION_GRID_INVALID", { issues: blocking });
  }
  return draft;
}

const toDayData = (days: VersionDayInput[]): VersionDayData[] => days.map((day) => ({ crewId: day.crewId, cycleWeekIndex: day.cycleWeekIndex, weekday: day.weekday, kind: day.kind, blocks: day.kind === "SHIFT" ? day.blocks : [] }));

/** Configuración propuesta: la guardada con las versiones reemplazadas por `versions`. */
function proposedConfiguration(rotation: RotationFullRow, versions: RotationVersionSnapshot<TemplateRefWithGroup>[]): RotationConfiguration {
  const snapshot = rotationSnapshot(rotation);
  return {
    memberships: allMembers(rotation).map((member) => ({ employeeId: member.employeeId, rotationId: rotation.id, crewId: member.crewId, effectiveFrom: keyOf(member.effectiveFrom), effectiveTo: keyOrNull(member.effectiveTo) })),
    rotations: [{ ...snapshot, status: "ACTIVO", versions }],
  };
}

/** Garantía 2 en el borde de versiones: último día de la versión saliente frente al primero de la entrante. */
async function assertVersionBoundary(db: Db, rotation: RotationFullRow, versions: RotationVersionSnapshot<TemplateRefWithGroup>[], firstDay: string) {
  const previous = previousCalendarDateKey(firstDay);
  const entries = allMembers(rotation)
    .map(membershipFacts)
    .filter((member) => rangesOverlap(member.effectiveFrom, member.effectiveTo, previous, firstDay) && member.effectiveFrom <= previous)
    .map((member) => ({ employeeId: member.employeeId, employee: member.employeeLabel, firstDay }));
  const result = await transitionIssuesForEntry(db, { rotationId: rotation.id, proposed: proposedConfiguration(rotation, versions), entries, previousFromProposed: true });
  if (result.overlaps.length) {
    throw new AppError(`El cambio de versión del ${formatDateKey(firstDay)} superpone el último turno de la versión anterior con el primero de la nueva.`, 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: result.overlaps });
  }
  return result.restsAtTransition;
}

/** R8.3: requireRotation + el grupo de la rotación tiene que ser administrable (si no, 404). */
async function requireActorRotation(id: string, actor: ShiftActor, db: Db) {
  const rotation = await requireRotation(id, db);
  if (!canManageShiftGroup(actor, rotation.shiftGroupId)) throw notFound();
  return rotation;
}

/** Descansos en la transición: sólo de personas que el actor puede ver. */
async function restsForActor<T extends { employeeId: string }>(rests: T[], actor: ShiftActor): Promise<T[]> {
  if (isGlobalActor(actor) || !rests.length) return rests;
  const viewer = await rotationViewerForActor(actor, rests.map((rest) => rest.employeeId));
  return rests.filter((rest) => canSeeEmployee(viewer, rest.employeeId));
}

function membersFrom(rotation: RotationFullRow, from: string) {
  return allMembers(rotation).filter((member) => keyOrNull(member.effectiveTo) === null || keyOrNull(member.effectiveTo)! >= from).map((member) => member.employeeId);
}

/**
 * R8.3 (§26): en una rotación ACTIVA, una versión nueva, editada o borrada
 * cambia lo que rige desde `from` para sus miembros de ahí en adelante (los
 * mismos que recalcula la cobertura): todos tienen que estar en el alcance.
 * Una rotación INACTIVA no rige (legacy): sólo exige el grupo.
 */
async function assertVersionEffectWritable(actor: ShiftActor, rotation: RotationFullRow, from: string, db: Db) {
  if (rotation.status !== "ACTIVO") return;
  await assertEmployeesWritable(actor, membersFrom(rotation, from), db);
}

export const shiftRotationVersionService = {
  /** R8: versión de una rotación de un grupo no administrable → 404 (igual que inexistente). */
  async get(rotationId: string, versionId: string, scope: ShiftGroupScope) {
    const rotation = await requireRotation(rotationId, prisma);
    if (!canAccessShiftGroup(scope, rotation.shiftGroupId)) throw notFound();
    return versionResponse(rotation, requireVersion(rotation, versionId), todayAndTomorrow().today);
  },

  async create(rotationId: string, input: CreateVersionInput, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireActorRotation(rotationId, actor, tx);
      await assertVersionEffectWritable(actor, rotation, input.effectiveFrom, tx);
      const { today } = todayAndTomorrow();
      assertNotBefore(input.effectiveFrom, minimumVersionStart(rotation), "La nueva versión");
      const sorted = [...rotation.versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      const later = sorted.find((version) => keyOf(version.effectiveFrom) >= input.effectiveFrom);
      if (later) {
        throw new AppError(`Ya hay una versión que empieza el ${formatDateKey(keyOf(later.effectiveFrom))}. Editá esa versión futura o elegí una fecha posterior.`, 409, "ROTATION_VERSION_EXISTS_AFTER");
      }
      const draft = await validateDraft(tx, rotation, input, actor);
      const previous = sorted.at(-1);
      const previousEnd = previous && (previous.effectiveTo === null || keyOf(previous.effectiveTo) >= input.effectiveFrom) ? previousCalendarDateKey(input.effectiveFrom) : null;
      const versions = rotationSnapshot(rotation).versions.map((version) => (previous && version.id === previous.id && previousEnd ? { ...version, effectiveTo: previousEnd } : version));
      const rests = await assertVersionBoundary(tx, rotation, [...versions, draft], input.effectiveFrom);
      const before = await assessRotationRow(rotation, tx);

      const userId = audit?.userId ?? null;
      const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
      const affected = membersFrom(rotation, input.effectiveFrom);
      await lockEmployeeCoverage(tx, affected);
      if (previous && previousEnd) {
        await shiftRotationRepository.setVersionEnd(previous.id, previousEnd, userId, tx);
        await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationVersion", entityId: previous.id, description: `Se cerró la versión de la rotación ${describeRotation(rotation)} con último día ${formatDateKey(previousEnd)} por una versión nueva.`, before: { effectiveTo: keyOrNull(previous.effectiveTo) }, after: { effectiveTo: previousEnd } });
      }
      const created = await shiftRotationRepository.createVersion({ rotationId, cycleLengthWeeks: input.cycleLengthWeeks, anchorWeekStart: input.anchorWeekStart, effectiveFrom: input.effectiveFrom, effectiveTo: null, days: toDayData(input.days) }, userId, tx);
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "crear la versión");
      const createdRow = requireVersion(after, created.id);
      await auditService.registerWithin(tx, { ...audit, action: "CREATE", entity: "ShiftRotationVersion", entityId: created.id, description: `Se creó una versión de la rotación ${describeRotation(rotation)} ${rangeLabel(input.effectiveFrom, null)} (ciclo de ${input.cycleLengthWeeks} semana(s)).`, after: versionAuditSnapshot(createdRow, crewNames) });
      const coverage = await recalculateRotationCoverage(tx, affected, [{ from: input.effectiveFrom, to: null }], `versión nueva de la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      return { ...versionResponse(after, createdRow, today), restsAtTransition: await restsForActor(rests, actor) };
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async update(rotationId: string, versionId: string, input: UpdateVersionInput, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireActorRotation(rotationId, actor, tx);
      const version = requireVersion(rotation, versionId);
      await assertVersionEffectWritable(actor, rotation, [keyOf(version.effectiveFrom), input.effectiveFrom].sort()[0]!, tx);
      const { today } = todayAndTomorrow();
      if (isVersionLocked(rotation, version, today)) {
        throw new AppError(`La versión ${rangeLabel(keyOf(version.effectiveFrom), keyOrNull(version.effectiveTo))} ya rigió y no se puede modificar. Creá una versión nueva desde mañana.`, 409, "ROTATION_VERSION_LOCKED");
      }
      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== version.updatedAt.getTime()) {
        throw new AppError("Otra persona modificó esta versión mientras la editabas. Recargala y volvé a aplicar tus cambios.", 409, "ROTATION_VERSION_STALE");
      }
      assertNotBefore(input.effectiveFrom, minimumVersionStart(rotation), "La versión");
      const sorted = [...rotation.versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      const index = sorted.findIndex((candidate) => candidate.id === versionId);
      const previous = index > 0 ? sorted[index - 1] : undefined;
      const next = sorted[index + 1];
      if (previous && keyOf(previous.effectiveFrom) >= input.effectiveFrom) throw new AppError(`La versión no puede empezar antes del ${formatDateKey(nextCalendarDateKey(keyOf(previous.effectiveFrom)))} (la anterior empieza el ${formatDateKey(keyOf(previous.effectiveFrom))}).`, 409, "ROTATION_VERSION_ORDER");
      if (next && keyOf(next.effectiveFrom) <= input.effectiveFrom) throw new AppError(`La versión debe empezar antes del ${formatDateKey(keyOf(next.effectiveFrom))}, cuando empieza la siguiente.`, 409, "ROTATION_VERSION_ORDER");
      const draft = await validateDraft(tx, rotation, input, actor);
      const previousEnd = previous ? previousCalendarDateKey(input.effectiveFrom) : null;
      const snapshotVersions = rotationSnapshot(rotation).versions.map((candidate) => {
        if (candidate.id === versionId) return { ...draft, id: versionId, effectiveTo: keyOrNull(version.effectiveTo) };
        if (previous && candidate.id === previous.id && previousEnd) return { ...candidate, effectiveTo: previousEnd };
        return candidate;
      });
      const rests = await assertVersionBoundary(tx, rotation, snapshotVersions, input.effectiveFrom);
      const before = await assessRotationRow(rotation, tx);

      const userId = audit?.userId ?? null;
      const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
      const from = [keyOf(version.effectiveFrom), input.effectiveFrom].sort()[0]!;
      const affected = membersFrom(rotation, from);
      await lockEmployeeCoverage(tx, affected);
      const beforeSnapshot = versionAuditSnapshot(version, crewNames);
      if (previous && previousEnd && keyOrNull(previous.effectiveTo) !== previousEnd) await shiftRotationRepository.setVersionEnd(previous.id, previousEnd, userId, tx);
      await shiftRotationRepository.replaceVersion(versionId, { cycleLengthWeeks: input.cycleLengthWeeks, anchorWeekStart: input.anchorWeekStart, effectiveFrom: input.effectiveFrom, days: toDayData(input.days) }, userId, tx);
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "modificar la versión");
      const updatedRow = requireVersion(after, versionId);
      await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationVersion", entityId: versionId, description: `Se modificó la versión futura de la rotación ${describeRotation(rotation)}; rige ${rangeLabel(input.effectiveFrom, keyOrNull(version.effectiveTo))}.`, before: beforeSnapshot, after: versionAuditSnapshot(updatedRow, crewNames) });
      const coverage = await recalculateRotationCoverage(tx, affected, [{ from, to: keyOrNull(version.effectiveTo) }], `cambio de versión de la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      return { ...versionResponse(after, updatedRow, today), restsAtTransition: await restsForActor(rests, actor) };
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async remove(rotationId: string, versionId: string, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireActorRotation(rotationId, actor, tx);
      const version = requireVersion(rotation, versionId);
      await assertVersionEffectWritable(actor, rotation, keyOf(version.effectiveFrom), tx);
      const { today } = todayAndTomorrow();
      if (isVersionLocked(rotation, version, today)) {
        throw new AppError(`La versión ${rangeLabel(keyOf(version.effectiveFrom), keyOrNull(version.effectiveTo))} ya rigió y no se puede eliminar.`, 409, "ROTATION_VERSION_LOCKED");
      }
      const sorted = [...rotation.versions].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      const index = sorted.findIndex((candidate) => candidate.id === versionId);
      const previous = index > 0 ? sorted[index - 1] : undefined;
      const next = sorted[index + 1];
      const reopenTo = next ? previousCalendarDateKey(keyOf(next.effectiveFrom)) : keyOrNull(version.effectiveTo);
      const before = await assessRotationRow(rotation, tx);
      const userId = audit?.userId ?? null;
      const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
      const from = keyOf(version.effectiveFrom);
      const affected = membersFrom(rotation, from);
      await lockEmployeeCoverage(tx, affected);

      // Garantía 3: snapshot completo en el AuditLog antes de borrar (nunca rigió).
      await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftRotationVersion", entityId: versionId, description: `Se eliminó la versión futura ${rangeLabel(from, keyOrNull(version.effectiveTo))} de la rotación ${describeRotation(rotation)} (nunca rigió).`, before: versionAuditSnapshot(version, crewNames) });
      await shiftRotationRepository.deleteVersion(versionId, tx);
      if (previous) {
        await shiftRotationRepository.setVersionEnd(previous.id, reopenTo, userId, tx);
        await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationVersion", entityId: previous.id, description: `Se extendió la versión anterior de la rotación ${describeRotation(rotation)} ${reopenTo ? `hasta el ${formatDateKey(reopenTo)}` : "sin fecha de fin"} al eliminar la versión futura.`, before: { effectiveTo: keyOrNull(previous.effectiveTo) }, after: { effectiveTo: reopenTo } });
      }
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "eliminar la versión");
      const coverage = await recalculateRotationCoverage(tx, affected, [{ from, to: keyOrNull(version.effectiveTo) }], `eliminación de una versión futura de la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      return { id: versionId };
    }, ROTATION_TRANSACTION_OPTIONS)));
  },
};

