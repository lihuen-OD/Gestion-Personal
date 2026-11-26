/**
 * Rotaciones y equipos — R4.6 (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * - Una rotación nace INACTIVA: se configura (equipos, versión, altas futuras)
 *   y se ACTIVA antes de que empiece a regir. Activar nunca tiene efecto
 *   retroactivo: se rechaza si alguna membresía empieza hoy o antes.
 * - INACTIVO (rotación o equipo) sólo si nunca rigió: el estado no tiene fecha
 *   y el núcleo lo aplica también al pasado. Una rotación que ya rigió se
 *   FINALIZA con fecha (cierra versión y membresías en el último día).
 * - Finalizar es en dos pasos (vista previa con token → confirmación) y
 *   conserva el historial: lo que rigió no se toca; lo futuro se borra recién
 *   después de guardar su snapshot completo en el AuditLog (misma transacción).
 */
import type { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { auditService, type AuditContext } from "../audit/audit.service";
import { auditNoveltyCoverageRecalculationWithin } from "../novelties/noveltyCoverageRecalculation";
import { lockEmployeeCoverage } from "../novelties/noveltyCoverage.service";
import { assertShiftGroupAssignable } from "./shiftGroup.service";
import { shiftRotationRepository, type RotationFullRow, type RotationMembershipCoverage } from "./shiftRotation.repository";
import type { CreateCrewInput, CreateRotationInput, ListRotationsQuery, UpdateCrewInput, UpdateRotationInput } from "./shiftRotation.schemas";
import {
  allMembers,
  assertNotBefore,
  confirmationTokenOf,
  describeCrew,
  describeRotation,
  employeeLabel,
  keyOf,
  keyOrNull,
  memberAuditSnapshot,
  membershipFacts,
  notFound,
  rangeLabel,
  recalculateRotationCoverage,
  ROTATION_TRANSACTION_OPTIONS,
  rotationHasRuled,
  rotationSnapshot,
  templatesOf,
  todayAndTomorrow,
  versionAuditSnapshot,
} from "./shiftRotation.support";
import { withRotationErrors } from "./shiftRotationErrors";
import { withErrorScope } from "./shiftErrorScope";
import { canAccessShiftGroup, shiftRotationWhereForScope, type ShiftGroupScope } from "./shiftGroupAccess";
import { canSeeEmployee, rotationViewerFor, UNRESTRICTED_ROTATION_VIEWER, visibleIssues, type RotationViewer } from "./shiftRotationVisibility";
import { assertEmployeesWritable, assertShiftGroupWritable, canManageShiftGroup, isGlobalActor, rotationViewerForActor, withShiftActorErrors, type ShiftActor } from "./shiftWriteAccess";
import { assessRotation, formatDateKey, hasBlockingIssues, healthOf, isOpenOnOrAfter, toPublicIssues, type ReadinessIssue } from "./shiftRotationReadiness";
import { transitionIssuesForExit } from "./shiftRotationTransitions";

// ── Lectura ─────────────────────────────────────────────────────────────────

async function loadAssessmentFacts(rotation: RotationFullRow, db: PrismaTransactionClient = prisma) {
  const employeeIds = [...new Set(allMembers(rotation).map((member) => member.employeeId))];
  const [fixed, regimes] = employeeIds.length
    ? await Promise.all([shiftRotationRepository.fixedAssignmentsOf(employeeIds, db), shiftRotationRepository.regimesOf(employeeIds, db)])
    : [[], []];
  return {
    fixedAssignments: fixed.map((row) => ({ employeeId: row.employeeId, templateCode: row.shiftTemplate.code, templateShiftGroupId: row.shiftTemplate.shiftGroupId, status: row.status, effectiveFrom: keyOf(row.effectiveFrom), effectiveTo: keyOrNull(row.effectiveTo) })),
    regimes: regimes.map((row) => ({ employeeId: row.employeeId, kind: row.workRegime.kind, effectiveFrom: keyOf(row.effectiveFrom), effectiveTo: keyOrNull(row.effectiveTo) })),
  };
}

export async function assessRotationRow(rotation: RotationFullRow, db: PrismaTransactionClient = prisma, now: Date = new Date()): Promise<ReadinessIssue[]> {
  const { today } = todayAndTomorrow(now);
  const facts = await loadAssessmentFacts(rotation, db);
  return assessRotation({
    rotation: rotationSnapshot(rotation),
    crewNames: new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)])),
    memberships: allMembers(rotation).map(membershipFacts),
    fixedAssignments: facts.fixedAssignments,
    regimes: facts.regimes,
    templates: templatesOf(rotation),
    todayKey: today,
  });
}

/**
 * T-R4-CONC: una cobertura nueva nunca puede reinterpretar una decisión
 * humana tomada sobre el incidente diario legacy. El llamador ya tomó el
 * lock de cobertura de todos los legajos y sólo aporta identidades que el
 * actor está autorizado a administrar.
 */
export async function assertNoAttendanceHistoryConflicts(
  coverages: RotationMembershipCoverage[],
  employeeLabels: ReadonlyMap<string, string>,
  db: PrismaTransactionClient,
) {
  const conflicts = await shiftRotationRepository.reviewedDailyIncidentConflicts(coverages, db);
  if (!conflicts.length) return;
  throw new AppError(
    "No se puede aplicar la rotación: hay decisiones de asistencia ya revisadas dentro de la vigencia solicitada.",
    409,
    "ROTATION_ATTENDANCE_HISTORY_CONFLICT",
    {
      total: conflicts.length,
      conflicts: conflicts.map((conflict) => ({
        // R8.3: permite ocultar a quien esté fuera del alcance del actor.
        employeeId: conflict.employeeId,
        employee: employeeLabels.get(conflict.employeeId) ?? "Persona autorizada",
        operationalDate: keyOf(conflict.operationalDate),
      })),
    },
  );
}

function versionSummary(rotation: RotationFullRow, today: string) {
  return rotation.versions.map((version) => ({
    id: version.id,
    effectiveFrom: keyOf(version.effectiveFrom),
    effectiveTo: keyOrNull(version.effectiveTo),
    cycleLengthWeeks: version.cycleLengthWeeks,
    anchorWeekStart: keyOf(version.anchorWeekStart),
    locked: rotation.status === "ACTIVO" && keyOf(version.effectiveFrom) <= today,
    inEffectToday: keyOf(version.effectiveFrom) <= today && isOpenOnOrAfter(keyOrNull(version.effectiveTo), today),
    dayCount: version.days.length,
    updatedAt: version.updatedAt,
  }));
}

function memberResponse(member: ReturnType<typeof allMembers>[number], crew: { code: string; name: string }) {
  return {
    id: member.id,
    crewId: member.crewId,
    crew: describeCrew(crew),
    employeeId: member.employeeId,
    legajo: member.employee.legajo,
    employee: employeeLabel(member.employee),
    employeeStatus: member.employee.status,
    effectiveFrom: keyOf(member.effectiveFrom),
    effectiveTo: keyOrNull(member.effectiveTo),
  };
}

/**
 * R8: `viewer` decide qué personas y avisos se exponen
 * (`shiftRotationVisibility.ts`). Los conteos (`openMemberCount`, salud) siguen
 * contando a todos: no identifican a nadie.
 */
function toResponse(rotation: RotationFullRow, issues: ReadinessIssue[], viewer: RotationViewer, now: Date = new Date()) {
  const { today } = todayAndTomorrow(now);
  const allOpenMembers = rotation.crews.flatMap((crew) => crew.members.filter((member) => isOpenOnOrAfter(keyOrNull(member.effectiveTo), today)).map((member) => memberResponse(member, crew)));
  const openMembers = allOpenMembers.filter((member) => canSeeEmployee(viewer, member.employeeId));
  const hasRuled = rotationHasRuled(rotation, today);
  const hasOpenVersion = rotation.versions.some((version) => isOpenOnOrAfter(keyOrNull(version.effectiveTo), today));
  return {
    id: rotation.id,
    code: rotation.code,
    name: rotation.name,
    status: rotation.status,
    observation: rotation.observation,
    shiftGroup: rotation.shiftGroup,
    hasRuled,
    /** Estado derivado: ACTIVA que ya rigió y no tiene versión ni membresías desde hoy. */
    finalized: rotation.status === "ACTIVO" && hasRuled && !hasOpenVersion && allOpenMembers.length === 0,
    health: healthOf(issues),
    issues: visibleIssues(issues, viewer),
    crews: rotation.crews.map((crew) => ({
      id: crew.id,
      code: crew.code,
      name: crew.name,
      sortOrder: crew.sortOrder,
      status: crew.status,
      openMemberCount: crew.members.filter((member) => isOpenOnOrAfter(keyOrNull(member.effectiveTo), today)).length,
      everHadMembers: crew.members.length > 0,
    })),
    versions: versionSummary(rotation, today),
    members: openMembers,
    /** R8: miembros vigentes o futuros fuera del alcance de legajos de quien consulta. */
    hiddenMemberCount: allOpenMembers.length - openMembers.length,
    createdAt: rotation.createdAt,
    updatedAt: rotation.updatedAt,
  };
}

export type RotationResponse = ReturnType<typeof toResponse>;

/**
 * R8.3: rotación cargada para una escritura del actor. Una de un grupo no
 * administrable responde igual que una inexistente (404).
 */
async function requireActorRotation(id: string, actor: ShiftActor, db: PrismaTransactionClient = prisma) {
  const rotation = await requireRotation(id, db);
  if (!canManageShiftGroup(actor, rotation.shiftGroupId)) throw notFound();
  return rotation;
}

/** Respuesta de una escritura tal como la puede ver el actor (personas y avisos). */
async function responseForActor(rotation: RotationFullRow, issues: ReadinessIssue[], actor: ShiftActor) {
  const viewer = isGlobalActor(actor) ? UNRESTRICTED_ROTATION_VIEWER : await rotationViewerForActor(actor, allMembers(rotation).map((member) => member.employeeId));
  return toResponse(rotation, issues, viewer);
}

/** R8.3: legajos con membresía vigente o futura (los que un cambio de la rotación afecta de verdad). */
function openMemberIds(rotation: RotationFullRow, crewId?: string) {
  const { today } = todayAndTomorrow();
  return allMembers(rotation)
    .filter((member) => (crewId === undefined || member.crewId === crewId) && isOpenOnOrAfter(keyOrNull(member.effectiveTo), today))
    .map((member) => member.employeeId);
}

/** Rótulos del turno siguiente: pueden ser de otra planificación (R-6). */
function overlapsForActor<T extends { incoming: string }>(overlaps: T[], actor: ShiftActor): T[] {
  return isGlobalActor(actor) ? overlaps : overlaps.map((overlap) => ({ ...overlap, incoming: "el turno siguiente de la persona" }));
}

async function requireRotation(id: string, db: PrismaTransactionClient = prisma) {
  const rotation = await shiftRotationRepository.findFull(id, db);
  if (!rotation) throw notFound();
  return rotation;
}

function rotationAuditSnapshot(rotation: { id: string; code: string; name: string; status: string; shiftGroupId: string; observation: string | null }): Prisma.InputJsonValue {
  const { id, code, name, status, shiftGroupId, observation } = rotation;
  return { id, code, name, status, shiftGroupId, observation };
}

// ── Finalización (garantías 2 y 3) ──────────────────────────────────────────

type FinalizePlan = {
  lastDay: string;
  closeVersions: Array<{ id: string; effectiveFrom: string; effectiveTo: string | null }>;
  deleteVersions: Array<{ id: string; effectiveFrom: string; effectiveTo: string | null; dayCount: number }>;
  closeMembers: Array<{ id: string; employeeId: string; employee: string; crew: string; effectiveFrom: string; effectiveTo: string | null }>;
  cancelMembers: Array<{ id: string; employeeId: string; employee: string; crew: string; effectiveFrom: string; effectiveTo: string | null }>;
};

function finalizePlan(rotation: RotationFullRow, lastDay: string): FinalizePlan {
  const crewLabel = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
  const plan: FinalizePlan = { lastDay, closeVersions: [], deleteVersions: [], closeMembers: [], cancelMembers: [] };
  for (const version of rotation.versions) {
    const from = keyOf(version.effectiveFrom);
    const to = keyOrNull(version.effectiveTo);
    if (from > lastDay) plan.deleteVersions.push({ id: version.id, effectiveFrom: from, effectiveTo: to, dayCount: version.days.length });
    else if (to === null || to > lastDay) plan.closeVersions.push({ id: version.id, effectiveFrom: from, effectiveTo: to });
  }
  for (const member of allMembers(rotation)) {
    const from = keyOf(member.effectiveFrom);
    const to = keyOrNull(member.effectiveTo);
    const row = { id: member.id, employeeId: member.employeeId, employee: employeeLabel(member.employee), crew: crewLabel.get(member.crewId) ?? "", effectiveFrom: from, effectiveTo: to };
    if (from > lastDay) plan.cancelMembers.push(row);
    else if (to === null || to > lastDay) plan.closeMembers.push(row);
  }
  return plan;
}

/** R8.3: legajos cuyas membresías cerraría o cancelaría finalizar en `lastDay`. */
function finalizeAffectedEmployees(rotation: RotationFullRow, lastDay: string) {
  const plan = finalizePlan(rotation, lastDay);
  return [...plan.closeMembers, ...plan.cancelMembers].map((member) => member.employeeId);
}

function tokenFor(rotation: RotationFullRow, plan: FinalizePlan) {
  const touched = new Set([...plan.closeVersions, ...plan.deleteVersions].map((version) => version.id));
  const versionStamps = rotation.versions.filter((version) => touched.has(version.id)).map((version) => [version.id, version.updatedAt.toISOString()]);
  const memberStamps = allMembers(rotation).filter((member) => plan.closeMembers.some((row) => row.id === member.id) || plan.cancelMembers.some((row) => row.id === member.id)).map((member) => [member.id, member.updatedAt.toISOString()]);
  return confirmationTokenOf({ rotationId: rotation.id, rotationUpdatedAt: rotation.updatedAt.toISOString(), plan, versionStamps, memberStamps });
}

async function finalizePreviewOf(rotation: RotationFullRow, lastDay: string, db: PrismaTransactionClient, now: Date) {
  const { today } = todayAndTomorrow(now);
  if (rotation.status !== "ACTIVO") throw new AppError("Sólo se finaliza una rotación ACTIVA. Una rotación inactiva nunca rigió: se puede eliminar o reconfigurar.", 409, "ROTATION_NOT_ACTIVE");
  assertNotBefore(lastDay, today, "El último día de vigencia");
  const plan = finalizePlan(rotation, lastDay);
  const transitions = await transitionIssuesForExit(db, rotation, plan.closeMembers.map((member) => ({ employeeId: member.employeeId, lastDay })));
  return {
    lastDay,
    closeVersions: plan.closeVersions,
    deleteVersions: plan.deleteVersions,
    closeMembers: plan.closeMembers,
    cancelMembers: plan.cancelMembers,
    withoutFixedShiftAfter: transitions.withoutFixedShift,
    transitionOverlaps: transitions.overlaps,
    restsAtTransition: transitions.restsAtTransition,
    requiresConfirmation: true as const,
    confirmationToken: tokenFor(rotation, plan),
    plan,
  };
}

// ── Servicio ────────────────────────────────────────────────────────────────

export const shiftRotationService = {
  /** R8: sólo rotaciones de grupos administrables; personas según el alcance de legajos. */
  async list(query: ListRotationsQuery, user: Express.AuthUser, scope: ShiftGroupScope) {
    const rows = await shiftRotationRepository.list(query, shiftRotationWhereForScope(scope));
    const viewer = await rotationViewerFor(user, scope, rows.flatMap((row) => allMembers(row).map((member) => member.employeeId)));
    return Promise.all(rows.map(async (row) => toResponse(row, await assessRotationRow(row), viewer)));
  },

  /** R8: una rotación de un grupo no administrable responde igual que una inexistente (404). */
  async detail(id: string, user: Express.AuthUser, scope: ShiftGroupScope) {
    const rotation = await requireRotation(id);
    if (!canAccessShiftGroup(scope, rotation.shiftGroupId)) throw notFound();
    const viewer = await rotationViewerFor(user, scope, allMembers(rotation).map((member) => member.employeeId));
    return toResponse(rotation, await assessRotationRow(rotation), viewer);
  },

  async create(input: CreateRotationInput, actor: ShiftActor, audit?: AuditContext) {
    assertShiftGroupWritable(actor, input.shiftGroupId);
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await assertShiftGroupAssignable(input.shiftGroupId, null, tx);
      const created = await shiftRotationRepository.createRotation(input, audit?.userId ?? null, tx);
      await auditService.registerWithin(tx, { ...audit, action: "CREATE", entity: "ShiftRotation", entityId: created.id, description: `Se creó la rotación ${describeRotation(created)} (inactiva hasta configurarla y activarla).`, after: rotationAuditSnapshot(created) });
      const full = await requireRotation(created.id, tx);
      return await responseForActor(full, [], actor);
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async update(id: string, input: UpdateRotationInput, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, id);
      const before = await requireActorRotation(id, actor, tx);
      const { today } = todayAndTomorrow();
      const ruled = rotationHasRuled(before, today);
      if (input.code !== undefined && input.code !== before.code && ruled) throw new AppError("El código de una rotación que ya rigió no se puede cambiar.", 409, "ROTATION_CODE_LOCKED");
      if (input.shiftGroupId !== undefined && input.shiftGroupId !== before.shiftGroupId) {
        assertShiftGroupWritable(actor, input.shiftGroupId);
        if (before.versions.length) throw new AppError("El grupo de una rotación con versiones no se puede cambiar: sus turnos pertenecen al grupo actual.", 409, "ROTATION_GROUP_LOCKED");
        await assertShiftGroupAssignable(input.shiftGroupId, before.shiftGroupId, tx);
      }
      const updated = await shiftRotationRepository.updateRotation(id, { ...input, updatedByUserId: audit?.userId ?? null }, tx);
      await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotation", entityId: id, description: `Se actualizó la rotación ${describeRotation(updated)}.`, before: rotationAuditSnapshot(before), after: rotationAuditSnapshot(updated) });
      const full = await requireRotation(id, tx);
      return await responseForActor(full, await assessRotationRow(full, tx), actor);
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async remove(id: string, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, id);
      const rotation = await requireActorRotation(id, actor, tx);
      if (rotation.status !== "INACTIVO") throw new AppError(`La rotación ${describeRotation(rotation)} está activa. Una rotación que rigió no se elimina: se finaliza con fecha.`, 409, "ROTATION_ACTIVE");
      if (allMembers(rotation).length) throw new AppError(`La rotación ${describeRotation(rotation)} tiene membresías. Cancelalas antes de eliminarla.`, 409, "ROTATION_HAS_MEMBERS");
      const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
      await auditService.registerWithin(tx, {
        ...audit,
        action: "DELETE",
        entity: "ShiftRotation",
        entityId: id,
        description: `Se eliminó la rotación sin uso ${describeRotation(rotation)}, con ${rotation.crews.length} equipo(s) y ${rotation.versions.length} versión(es).`,
        before: { rotation: rotationAuditSnapshot(rotation), crews: rotation.crews.map((crew) => ({ id: crew.id, code: crew.code, name: crew.name, status: crew.status })), versions: rotation.versions.map((version) => versionAuditSnapshot(version, crewNames)) },
      });
      await shiftRotationRepository.deleteRotation(id, tx);
      return { id };
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async activate(id: string, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, id);
      const rotation = await requireActorRotation(id, actor, tx);
      // R8.3: activar hace regir la rotación para sus membresías vigentes o
      // futuras (ninguna puede haber empezado: ROTATION_ACTIVATION_RETROACTIVE).
      await assertEmployeesWritable(actor, openMemberIds(rotation), tx);
      if (rotation.status === "ACTIVO") throw new AppError(`La rotación ${describeRotation(rotation)} ya está activa.`, 409, "ROTATION_ALREADY_ACTIVE");
      const { today, tomorrow } = todayAndTomorrow();
      const started = allMembers(rotation).filter((member) => keyOf(member.effectiveFrom) <= today);
      if (started.length) {
        const who = started.slice(0, 5).map((member) => `${employeeLabel(member.employee)} (${formatDateKey(keyOf(member.effectiveFrom))})`).join("; ");
        throw withErrorScope(new AppError(
          `No se puede activar: la rotación ya tendría efecto sobre fechas pasadas o de hoy. Estas membresías empiezan antes del ${formatDateKey(tomorrow)}: ${who}. Cancelalas y volvé a darlas de alta desde el ${formatDateKey(tomorrow)} o después.`,
          409,
          "ROTATION_ACTIVATION_RETROACTIVE",
          { members: started.map((member) => ({ id: member.id, employee: employeeLabel(member.employee), effectiveFrom: keyOf(member.effectiveFrom) })) },
        ), { shiftGroupIds: [rotation.shiftGroupId], employeeIds: started.map((member) => member.employeeId) });
      }
      const members = allMembers(rotation);
      const employeeIds = [...new Set(members.map((member) => member.employeeId))];
      // Orden compatible con los escritores por día: ellos toman día →
      // cobertura; este flujo nunca toma día, por lo que no introduce el
      // orden inverso ni un ciclo de espera.
      await lockEmployeeCoverage(tx, employeeIds);
      await assertNoAttendanceHistoryConflicts(
        members.map((member) => ({ employeeId: member.employeeId, effectiveFrom: keyOf(member.effectiveFrom), effectiveTo: keyOrNull(member.effectiveTo) })),
        new Map(members.map((member) => [member.employeeId, employeeLabel(member.employee)])),
        tx,
      );
      const issues = await assessRotationRow(rotation, tx);
      if (hasBlockingIssues(issues)) {
        const blocking = issues.filter((issue) => issue.severity === "ERROR");
        throw withErrorScope(new AppError("No se puede activar: la configuración tiene problemas que impedirían resolver los turnos. Corregilos y volvé a intentar.", 409, "ROTATION_NOT_READY", { issues: toPublicIssues(blocking) }), { issues: blocking });
      }
      const updated = await shiftRotationRepository.updateRotation(id, { status: "ACTIVO", updatedByUserId: audit?.userId ?? null }, tx);
      const firstStart = members.map((member) => keyOf(member.effectiveFrom)).sort()[0];
      const coverage = firstStart ? await recalculateRotationCoverage(tx, members.map((member) => member.employeeId), [{ from: firstStart, to: null }], `activación de la rotación ${describeRotation(rotation)}`) : null;
      await auditService.registerWithin(tx, { ...audit, action: "ACTIVATE", entity: "ShiftRotation", entityId: id, description: `Se activó la rotación ${describeRotation(rotation)}${firstStart ? `; rige desde el ${formatDateKey(firstStart)} para ${new Set(members.map((member) => member.employeeId)).size} persona(s)` : " (todavía sin membresías)"}.`, before: rotationAuditSnapshot(rotation), after: rotationAuditSnapshot(updated) });
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      const full = await requireRotation(id, tx);
      return await responseForActor(full, await assessRotationRow(full, tx), actor);
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async deactivate(id: string, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, id);
      const rotation = await requireActorRotation(id, actor, tx);
      // R8.3: sólo se desactiva lo que no rigió; sus membresías vigentes o
      // futuras vuelven al legacy.
      await assertEmployeesWritable(actor, openMemberIds(rotation), tx);
      if (rotation.status === "INACTIVO") throw new AppError(`La rotación ${describeRotation(rotation)} ya está inactiva.`, 409, "ROTATION_ALREADY_INACTIVE");
      const { today } = todayAndTomorrow();
      if (rotationHasRuled(rotation, today)) {
        throw new AppError(`La rotación ${describeRotation(rotation)} ya rigió: desactivarla cambiaría también los días pasados. Usá "Finalizar" con un último día de vigencia.`, 409, "ROTATION_HAS_RULED");
      }
      const updated = await shiftRotationRepository.updateRotation(id, { status: "INACTIVO", updatedByUserId: audit?.userId ?? null }, tx);
      const members = allMembers(rotation);
      await lockEmployeeCoverage(tx, members.map((member) => member.employeeId));
      const firstStart = members.map((member) => keyOf(member.effectiveFrom)).sort()[0];
      const coverage = firstStart ? await recalculateRotationCoverage(tx, members.map((member) => member.employeeId), [{ from: firstStart, to: null }], `desactivación de la rotación ${describeRotation(rotation)}`) : null;
      await auditService.registerWithin(tx, { ...audit, action: "DEACTIVATE", entity: "ShiftRotation", entityId: id, description: `Se desactivó la rotación ${describeRotation(rotation)} antes de que empezara a regir.`, before: rotationAuditSnapshot(rotation), after: rotationAuditSnapshot(updated) });
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      const full = await requireRotation(id, tx);
      return await responseForActor(full, await assessRotationRow(full, tx), actor);
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  /**
   * R8.3: finalizar cierra o cancela membresías (escritura sobre personas):
   * si afecta a alguien fuera del alcance de legajos, `403` ya en la vista
   * previa, sin nombrarlo.
   */
  async finalizePreview(id: string, lastDay: string, actor: ShiftActor) {
    return withShiftActorErrors(actor, async () => {
      const rotation = await requireActorRotation(id, actor);
      await assertEmployeesWritable(actor, finalizeAffectedEmployees(rotation, lastDay));
      const { plan: _plan, ...preview } = await finalizePreviewOf(rotation, lastDay, prisma, new Date());
      return { ...preview, transitionOverlaps: overlapsForActor(preview.transitionOverlaps, actor) };
    });
  },

  async finalize(id: string, input: { lastDay: string; confirmationToken: string }, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, id);
      const rotation = await requireActorRotation(id, actor, tx);
      await assertEmployeesWritable(actor, finalizeAffectedEmployees(rotation, input.lastDay), tx);
      const preview = await finalizePreviewOf(rotation, input.lastDay, tx, new Date());
      const { plan: _plan, ...visible } = preview;
      if (preview.confirmationToken !== input.confirmationToken) {
        throw new AppError("La rotación cambió desde la vista previa. Revisá la lista actualizada de cambios y confirmá de nuevo.", 409, "ROTATION_FINALIZE_STALE", { preview: visible });
      }
      if (preview.transitionOverlaps.length) {
        throw new AppError("No se puede finalizar: el último turno de la rotación se superpone con el turno siguiente de la persona.", 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: preview.transitionOverlaps });
      }
      const { plan } = preview;
      const userId = audit?.userId ?? null;
      const crewNames = new Map(rotation.crews.map((crew) => [crew.id, describeCrew(crew)]));
      const affected = [...plan.closeMembers, ...plan.cancelMembers].map((member) => member.employeeId);
      await lockEmployeeCoverage(tx, affected);

      // Garantía 3: snapshot completo en el AuditLog ANTES de borrar (misma transacción).
      for (const deleted of plan.deleteVersions) {
        const row = rotation.versions.find((version) => version.id === deleted.id)!;
        await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftRotationVersion", entityId: row.id, description: `Se canceló la versión futura ${rangeLabel(deleted.effectiveFrom, deleted.effectiveTo)} de la rotación ${describeRotation(rotation)} al finalizarla (nunca rigió).`, before: versionAuditSnapshot(row, crewNames) });
        await shiftRotationRepository.deleteVersion(row.id, tx);
      }
      for (const cancelled of plan.cancelMembers) {
        const row = allMembers(rotation).find((member) => member.id === cancelled.id)!;
        await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftRotationCrewMember", entityId: row.employeeId, description: `Se canceló el alta futura de ${cancelled.employee} en el equipo ${cancelled.crew} de la rotación ${describeRotation(rotation)} (${rangeLabel(cancelled.effectiveFrom, cancelled.effectiveTo)}) al finalizarla; nunca rigió.`, before: memberAuditSnapshot(row, { employee: cancelled.employee, crew: cancelled.crew }) });
        await shiftRotationRepository.deleteMember(row.id, tx);
      }
      for (const closed of plan.closeVersions) {
        const row = rotation.versions.find((version) => version.id === closed.id)!;
        const after = await shiftRotationRepository.setVersionEnd(row.id, input.lastDay, userId, tx);
        await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationVersion", entityId: row.id, description: `Se cerró la versión de la rotación ${describeRotation(rotation)} con último día ${formatDateKey(input.lastDay)} al finalizarla.`, before: { effectiveTo: closed.effectiveTo }, after: { effectiveTo: keyOrNull(after.effectiveTo) } });
      }
      for (const closed of plan.closeMembers) {
        const row = allMembers(rotation).find((member) => member.id === closed.id)!;
        const after = await shiftRotationRepository.closeMember(row.id, input.lastDay, userId, tx);
        await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationCrewMember", entityId: row.employeeId, description: `Se cerró la membresía de ${closed.employee} en el equipo ${closed.crew} de la rotación ${describeRotation(rotation)} con último día ${formatDateKey(input.lastDay)} (finalización).`, before: memberAuditSnapshot(row, { employee: closed.employee, crew: closed.crew }), after: memberAuditSnapshot(after, { employee: closed.employee, crew: closed.crew }) });
      }
      const coverage = await recalculateRotationCoverage(tx, affected, [{ from: nextCalendarDateKey(input.lastDay), to: null }], `finalización de la rotación ${describeRotation(rotation)}`);
      await shiftRotationRepository.updateRotation(id, { updatedByUserId: userId }, tx);
      await auditService.registerWithin(tx, {
        ...audit,
        action: "UPDATE",
        entity: "ShiftRotation",
        entityId: id,
        description: `Se finalizó la rotación ${describeRotation(rotation)} con último día ${formatDateKey(input.lastDay)}: ${plan.closeMembers.length} membresía(s) cerrada(s), ${plan.cancelMembers.length} alta(s) futura(s) cancelada(s), ${plan.deleteVersions.length} versión(es) futura(s) cancelada(s).`,
        after: { lastDay: input.lastDay, closeMembers: plan.closeMembers.length, cancelMembers: plan.cancelMembers.length, closeVersions: plan.closeVersions.length, deleteVersions: plan.deleteVersions.length },
      });
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      const full = await requireRotation(id, tx);
      return { rotation: await responseForActor(full, await assessRotationRow(full, tx), actor), applied: { ...visible, transitionOverlaps: overlapsForActor(visible.transitionOverlaps, actor) } };
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async createCrew(rotationId: string, input: CreateCrewInput, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireActorRotation(rotationId, actor, tx);
      const crew = await shiftRotationRepository.createCrew(rotationId, input, audit?.userId ?? null, tx);
      await auditService.registerWithin(tx, { ...audit, action: "CREATE", entity: "ShiftRotationCrew", entityId: crew.id, description: `Se creó el equipo ${describeCrew(crew)} en la rotación ${describeRotation(rotation)}. No admite altas hasta que una versión incluya su grilla.`, after: { id: crew.id, code: crew.code, name: crew.name, sortOrder: crew.sortOrder, status: crew.status } });
      return crew;
    }, ROTATION_TRANSACTION_OPTIONS)));
  },

  async updateCrew(rotationId: string, crewId: string, input: UpdateCrewInput, actor: ShiftActor, audit?: AuditContext) {
    return withShiftActorErrors(actor, () => withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireActorRotation(rotationId, actor, tx);
      const before = rotation.crews.find((crew) => crew.id === crewId);
      if (!before) throw notFound("el equipo solicitado");
      // R8.3: activar o inactivar un equipo de una rotación ACTIVA cambia lo que
      // rige para sus miembros vigentes o futuros.
      if (input.status !== undefined && input.status !== before.status && rotation.status === "ACTIVO") {
        await assertEmployeesWritable(actor, openMemberIds(rotation, crewId), tx);
      }
      if (input.status === "INACTIVO" && before.status !== "INACTIVO" && before.members.length) {
        throw new AppError(`El equipo ${describeCrew(before)} tuvo membresías: inactivarlo cambiaría también los días pasados. Cerrá o mové sus membresías en su lugar.`, 409, "ROTATION_CREW_HAS_MEMBERS");
      }
      const updated = await shiftRotationRepository.updateCrew(crewId, { ...input, updatedByUserId: audit?.userId ?? null }, tx);
      const action = input.status && input.status !== before.status ? (input.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
      await auditService.registerWithin(tx, { ...audit, action, entity: "ShiftRotationCrew", entityId: crewId, description: `Se actualizó el equipo ${describeCrew(updated)} de la rotación ${describeRotation(rotation)}.`, before: { code: before.code, name: before.name, sortOrder: before.sortOrder, status: before.status }, after: { code: updated.code, name: updated.name, sortOrder: updated.sortOrder, status: updated.status } });
      return updated;
    }, ROTATION_TRANSACTION_OPTIONS)));
  },
};
