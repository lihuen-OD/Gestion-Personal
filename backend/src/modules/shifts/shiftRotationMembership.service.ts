/**
 * Membresías de rotación (alta, baja, cambio de equipo, cancelación) — R4.6
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * - Alta y cambio de equipo rigen desde MAÑANA o después; la baja puede tener
 *   como último día HOY. Nunca se borra historia: baja y cambio cierran una
 *   fila; sólo un alta que nunca rigió (futura, o de una rotación INACTIVA) se
 *   cancela, con su snapshot en el AuditLog.
 * - Una sola membresía por persona y fecha en TODAS las rotaciones (servicio +
 *   EXCLUDE de la base).
 * - SIN_TURNO bloquea la membresía. Turnos fijos superpuestos: Opción C
 *   (§24.11) — 409 con el detalle, o `closeFixedAssignments` los cierra en
 *   X−1 (o los deshabilita si empiezan desde X) en la misma transacción.
 * - Garantía 2: el turno del día anterior al alta (fijo, otra rotación, otro
 *   equipo) no puede superponerse con el primer bloque; la baja conserva el
 *   bloque nocturno del último día y valida contra el turno del día siguiente.
 */
import type { Prisma } from "@prisma/client";
import { nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { auditService, type AuditContext, type RegisterAuditInput } from "../audit/audit.service";
import { auditNoveltyCoverageRecalculationWithin } from "../novelties/noveltyCoverageRecalculation";
import { lockEmployeeCoverage } from "../novelties/noveltyCoverage.service";
import { clearShiftAssignmentSummaryCache } from "./shiftAssignment.cache";
import { shiftRotationRepository, type RotationFullRow } from "./shiftRotation.repository";
import type { AddMembersInput, CloseMemberInput, ListMembersQuery, MoveMemberInput } from "./shiftRotation.schemas";
import { assessRotationRow } from "./shiftRotation.service";
import {
  allMembers,
  assertNoNewBlockingIssues,
  assertNotBefore,
  describeCrew,
  describeRotation,
  employeeLabel,
  keyOf,
  keyOrNull,
  memberAuditSnapshot,
  notFound,
  rangeLabel,
  recalculateRotationCoverage,
  ROTATION_TRANSACTION_OPTIONS,
  rotationSnapshot,
  todayAndTomorrow,
} from "./shiftRotation.support";
import { withRotationErrors } from "./shiftRotationErrors";
import { formatDateKey, isOpenOnOrAfter, rangesOverlap } from "./shiftRotationReadiness";
import { storedConfiguration, transitionIssuesForEntry, transitionIssuesForExit } from "./shiftRotationTransitions";
import type { RotationConfiguration } from "./rotationPlan";

type Db = PrismaTransactionClient;

async function requireRotation(id: string, db: Db) {
  const rotation = await shiftRotationRepository.findFull(id, db);
  if (!rotation) throw notFound();
  return rotation;
}

function memberRow(rotation: RotationFullRow, memberId: string) {
  for (const crew of rotation.crews) {
    const member = crew.members.find((candidate) => candidate.id === memberId);
    if (member) return { member, crew };
  }
  throw notFound("la membresía solicitada");
}

function memberResponse(member: { id: string; crewId: string; employeeId: string; effectiveFrom: Date; effectiveTo: Date | null; employee: { legajo: string; firstName: string; lastName: string; status: "ACTIVO" | "INACTIVO" } }, crew: { code: string; name: string }) {
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

function withAddedMemberships(rotation: RotationFullRow, rows: Array<{ employeeId: string; crewId: string; effectiveFrom: string; effectiveTo: string | null }>, closing?: { memberId: string; lastDay: string }): RotationConfiguration {
  const stored = storedConfiguration(rotation);
  const memberIds = allMembers(rotation).map((member) => member.id);
  const memberships = stored.memberships.map((membership, index) => (closing && memberIds[index] === closing.memberId ? { ...membership, effectiveTo: closing.lastDay } : membership));
  return { memberships: [...memberships, ...rows.map((row) => ({ ...row, rotationId: rotation.id }))], rotations: [{ ...rotationSnapshot(rotation), status: "ACTIVO" }] };
}

export const shiftRotationMembershipService = {
  async list(rotationId: string, query: ListMembersQuery) {
    const rotation = await requireRotation(rotationId, prisma);
    const at = query.at ?? todayAndTomorrow().today;
    return rotation.crews.flatMap((crew) =>
      crew.members
        .filter((member) => query.history || isOpenOnOrAfter(keyOrNull(member.effectiveTo), at))
        .map((member) => memberResponse(member, crew)),
    );
  },

  async add(rotationId: string, crewId: string, input: AddMembersInput, audit?: AuditContext) {
    const outcome = await withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireRotation(rotationId, tx);
      const crew = rotation.crews.find((candidate) => candidate.id === crewId);
      if (!crew) throw notFound("el equipo solicitado");
      if (crew.status !== "ACTIVO") throw new AppError(`El equipo ${describeCrew(crew)} está inactivo: no admite altas.`, 409, "ROTATION_CREW_INACTIVE");
      const { tomorrow } = todayAndTomorrow();
      assertNotBefore(input.effectiveFrom, tomorrow, "El alta");
      const from = input.effectiveFrom;
      const to = input.effectiveTo ?? null;
      const employeeIds = [...new Set(input.employeeIds)];

      const employees = await shiftRotationRepository.employeesByIds(employeeIds, tx);
      if (employees.length !== employeeIds.length) throw new AppError("Uno o más empleados no existen.", 404, "EMPLOYEE_NOT_FOUND");
      const inactive = employees.filter((employee) => employee.status !== "ACTIVO");
      if (inactive.length) throw new AppError(`No se puede dar de alta a personas inactivas: ${inactive.map(employeeLabel).join("; ")}.`, 409, "ROTATION_EMPLOYEE_INACTIVE");
      const labels = new Map(employees.map((employee) => [employee.id, employeeLabel(employee)]));

      const overlapping = await shiftRotationRepository.overlappingMemberships(employeeIds, from, to, tx);
      if (overlapping.length) {
        throw new AppError(
          `Ya tienen una membresía de rotación en esas fechas: ${overlapping.map((row) => `${labels.get(row.employeeId)} (rotación ${describeRotation(row.crew.rotation)}, equipo ${describeCrew(row.crew)}, ${rangeLabel(keyOf(row.effectiveFrom), keyOrNull(row.effectiveTo))})`).join("; ")}.`,
          409,
          "ROTATION_MEMBERSHIP_OVERLAP",
        );
      }

      const regimes = await shiftRotationRepository.regimesOf(employeeIds, tx);
      const sinTurno = regimes.filter((row) => row.workRegime.kind === "SIN_TURNO" && rangesOverlap(from, to, keyOf(row.effectiveFrom), keyOrNull(row.effectiveTo)));
      if (sinTurno.length) {
        throw new AppError(`Tienen régimen SIN_TURNO en esas fechas, incompatible con una rotación: ${[...new Set(sinTurno.map((row) => labels.get(row.employeeId)))].join("; ")}.`, 409, "ROTATION_SIN_TURNO_OVERLAP");
      }

      const fixed = (await shiftRotationRepository.fixedAssignmentsOf(employeeIds, tx)).filter((row) => row.status === "HABILITADO" && rangesOverlap(from, to, keyOf(row.effectiveFrom), keyOrNull(row.effectiveTo)));
      if (fixed.length && !input.closeFixedAssignments) {
        throw new AppError(
          `Tienen turnos fijos superpuestos con el alta: ${fixed.map((row) => `${labels.get(row.employeeId)} — ${row.shiftTemplate.code} ${rangeLabel(keyOf(row.effectiveFrom), keyOrNull(row.effectiveTo))}`).join("; ")}. Para cerrarlos desde el ${formatDateKey(from)}, repetí el alta con closeFixedAssignments.`,
          409,
          "ROTATION_FIXED_ASSIGNMENT_OVERLAP",
          { assignments: fixed.map((row) => ({ employeeId: row.employeeId, employee: labels.get(row.employeeId), template: row.shiftTemplate.code, effectiveFrom: keyOf(row.effectiveFrom), effectiveTo: keyOrNull(row.effectiveTo) })) },
        );
      }

      const rows = employeeIds.map((employeeId) => ({ employeeId, crewId, effectiveFrom: from, effectiveTo: to }));
      const transition = await transitionIssuesForEntry(tx, { rotationId, proposed: withAddedMemberships(rotation, rows), entries: employeeIds.map((employeeId) => ({ employeeId, employee: labels.get(employeeId) ?? "", firstDay: from })) });
      if (transition.overlaps.length) {
        throw new AppError(`El primer turno de la rotación del ${formatDateKey(from)} se superpone con el turno del día anterior.`, 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: transition.overlaps });
      }
      const before = await assessRotationRow(rotation, tx);
      await lockEmployeeCoverage(tx, employeeIds);

      const userId = audit?.userId ?? null;
      const audits: RegisterAuditInput[] = [];
      const previousDay = previousCalendarDateKey(from);
      for (const row of fixed) {
        const startsLater = keyOf(row.effectiveFrom) >= from;
        if (startsLater) await shiftRotationRepository.disableFixedAssignment(row.id, userId, tx);
        else await shiftRotationRepository.closeFixedAssignment(row.id, previousDay, tx);
        audits.push({
          action: startsLater ? "DEACTIVATE" : "UPDATE",
          entity: "ShiftAssignment",
          entityId: row.employeeId,
          description: startsLater
            ? `Se deshabilitó el turno fijo ${row.shiftTemplate.code} de ${labels.get(row.employeeId)} (empezaba el ${formatDateKey(keyOf(row.effectiveFrom))}) por su alta en la rotación ${describeRotation(rotation)}.`
            : `Se cerró el turno fijo ${row.shiftTemplate.code} de ${labels.get(row.employeeId)} con último día ${formatDateKey(previousDay)} por su alta en la rotación ${describeRotation(rotation)}.`,
          before: { shiftAssignmentId: row.id, status: row.status, effectiveFrom: keyOf(row.effectiveFrom), effectiveTo: keyOrNull(row.effectiveTo) } as Prisma.InputJsonValue,
          after: startsLater ? { status: "DESHABILITADO" } : { effectiveTo: previousDay },
        });
      }
      const created = await shiftRotationRepository.createMemberships(rows, userId, tx);
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "dar el alta");
      for (const membership of created) {
        audits.push({ action: "CREATE", entity: "ShiftRotationCrewMember", entityId: membership.employeeId, description: `Se dio de alta a ${labels.get(membership.employeeId)} en el equipo ${describeCrew(crew)} de la rotación ${describeRotation(rotation)} ${rangeLabel(from, to)}.`, after: memberAuditSnapshot(membership, { employee: labels.get(membership.employeeId), crew: describeCrew(crew) }) });
      }
      for (const entry of audits) await auditService.registerWithin(tx, { ...audit, ...entry });
      const coverage = await recalculateRotationCoverage(tx, employeeIds, [{ from, to }], `alta en la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      const createdIds = new Set(created.map((membership) => membership.id));
      const members = after.crews.flatMap((candidate) => candidate.members.filter((member) => createdIds.has(member.id)).map((member) => memberResponse(member, candidate)));
      return { members, closedFixedAssignments: fixed.length, restsAtTransition: transition.restsAtTransition };
    }, ROTATION_TRANSACTION_OPTIONS));
    if (outcome.closedFixedAssignments) clearShiftAssignmentSummaryCache();
    return outcome;
  },

  async close(rotationId: string, memberId: string, input: CloseMemberInput, audit?: AuditContext) {
    return withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireRotation(rotationId, tx);
      const { member, crew } = memberRow(rotation, memberId);
      const { today } = todayAndTomorrow();
      const from = keyOf(member.effectiveFrom);
      const currentTo = keyOrNull(member.effectiveTo);
      assertNotBefore(input.lastDay, today, "El último día de la membresía");
      if (input.lastDay < from) throw new AppError(`El último día no puede ser anterior al inicio de la membresía (${formatDateKey(from)}). Si nunca rigió, cancelá el alta.`, 422, "ROTATION_MEMBER_RANGE");
      if (currentTo !== null && input.lastDay >= currentTo) throw new AppError(`La membresía ya termina el ${formatDateKey(currentTo)}.`, 409, "ROTATION_MEMBER_ALREADY_CLOSED");
      const transitions = await transitionIssuesForExit(tx, rotation, [{ employeeId: member.employeeId, lastDay: input.lastDay }]);
      if (transitions.overlaps.length) {
        throw new AppError("El último turno de la rotación se superpone con el turno que rige al día siguiente.", 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: transitions.overlaps });
      }
      await lockEmployeeCoverage(tx, [member.employeeId]);
      const updated = await shiftRotationRepository.closeMember(memberId, input.lastDay, audit?.userId ?? null, tx);
      const who = employeeLabel(member.employee);
      await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationCrewMember", entityId: member.employeeId, description: `Se dio de baja a ${who} del equipo ${describeCrew(crew)} de la rotación ${describeRotation(rotation)} con último día ${formatDateKey(input.lastDay)}.`, before: memberAuditSnapshot(member, { employee: who, crew: describeCrew(crew) }), after: memberAuditSnapshot(updated, { employee: who, crew: describeCrew(crew) }) });
      const coverage = await recalculateRotationCoverage(tx, [member.employeeId], [{ from: nextCalendarDateKey(input.lastDay), to: currentTo }], `baja de la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      return { member: memberResponse({ ...member, effectiveTo: updated.effectiveTo }, crew), withoutFixedShiftAfter: transitions.withoutFixedShift, restsAtTransition: transitions.restsAtTransition };
    }, ROTATION_TRANSACTION_OPTIONS));
  },

  async move(rotationId: string, memberId: string, input: MoveMemberInput, audit?: AuditContext) {
    return withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireRotation(rotationId, tx);
      const { member, crew } = memberRow(rotation, memberId);
      const { tomorrow } = todayAndTomorrow();
      assertNotBefore(input.effectiveFrom, tomorrow, "El cambio de equipo");
      const from = keyOf(member.effectiveFrom);
      const currentTo = keyOrNull(member.effectiveTo);
      if (input.effectiveFrom <= from) throw new AppError("La membresía todavía no empezó: cancelá el alta y dala de nuevo en el otro equipo.", 409, "ROTATION_MEMBER_NOT_STARTED");
      if (currentTo !== null && currentTo < input.effectiveFrom) throw new AppError(`La membresía termina el ${formatDateKey(currentTo)}, antes del cambio.`, 409, "ROTATION_MEMBER_RANGE");
      const target = rotation.crews.find((candidate) => candidate.id === input.toCrewId);
      if (!target) throw notFound("el equipo de destino");
      if (target.id === crew.id) throw new AppError("La persona ya pertenece a ese equipo.", 409, "ROTATION_MEMBER_SAME_CREW");
      if (target.status !== "ACTIVO") throw new AppError(`El equipo ${describeCrew(target)} está inactivo.`, 409, "ROTATION_CREW_INACTIVE");
      const lastDay = previousCalendarDateKey(input.effectiveFrom);
      const who = employeeLabel(member.employee);
      const proposed = withAddedMemberships(rotation, [{ employeeId: member.employeeId, crewId: target.id, effectiveFrom: input.effectiveFrom, effectiveTo: currentTo }], { memberId, lastDay });
      const transition = await transitionIssuesForEntry(tx, { rotationId, proposed, entries: [{ employeeId: member.employeeId, employee: who, firstDay: input.effectiveFrom }], previousFromProposed: true });
      if (transition.overlaps.length) {
        throw new AppError(`El último turno en ${describeCrew(crew)} se superpone con el primero en ${describeCrew(target)}.`, 409, "ROTATION_TRANSITION_OVERLAP", { overlaps: transition.overlaps });
      }
      const before = await assessRotationRow(rotation, tx);
      await lockEmployeeCoverage(tx, [member.employeeId]);
      const userId = audit?.userId ?? null;
      const closed = await shiftRotationRepository.closeMember(memberId, lastDay, userId, tx);
      const [created] = await shiftRotationRepository.createMemberships([{ employeeId: member.employeeId, crewId: target.id, effectiveFrom: input.effectiveFrom, effectiveTo: currentTo }], userId, tx);
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "cambiar de equipo");
      await auditService.registerWithin(tx, { ...audit, action: "UPDATE", entity: "ShiftRotationCrewMember", entityId: member.employeeId, description: `${who} pasa del equipo ${describeCrew(crew)} al equipo ${describeCrew(target)} de la rotación ${describeRotation(rotation)} desde el ${formatDateKey(input.effectiveFrom)}.`, before: memberAuditSnapshot(member, { employee: who, crew: describeCrew(crew) }), after: { closed: memberAuditSnapshot(closed, { employee: who, crew: describeCrew(crew) }), opened: memberAuditSnapshot(created!, { employee: who, crew: describeCrew(target) }) } });
      const coverage = await recalculateRotationCoverage(tx, [member.employeeId], [{ from: input.effectiveFrom, to: currentTo }], `cambio de equipo en la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      const createdRow = after.crews.flatMap((candidate) => candidate.members.map((row) => ({ row, candidate }))).find(({ row }) => row.id === created!.id)!;
      return { closed: memberResponse({ ...member, effectiveTo: closed.effectiveTo }, crew), opened: memberResponse(createdRow.row, createdRow.candidate), restsAtTransition: transition.restsAtTransition };
    }, ROTATION_TRANSACTION_OPTIONS));
  },

  async cancel(rotationId: string, memberId: string, audit?: AuditContext) {
    return withRotationErrors(() => prisma.$transaction(async (tx) => {
      await shiftRotationRepository.lockRotation(tx, rotationId);
      const rotation = await requireRotation(rotationId, tx);
      const { member, crew } = memberRow(rotation, memberId);
      const { today } = todayAndTomorrow();
      const from = keyOf(member.effectiveFrom);
      if (rotation.status === "ACTIVO" && from <= today) {
        throw new AppError(`La membresía ya rige desde el ${formatDateKey(from)}: no se cancela, se da de baja con un último día.`, 409, "ROTATION_MEMBER_HAS_RULED");
      }
      const before = await assessRotationRow(rotation, tx);
      await lockEmployeeCoverage(tx, [member.employeeId]);
      const who = employeeLabel(member.employee);
      // Garantía 3: snapshot completo antes de borrar (nunca rigió).
      await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftRotationCrewMember", entityId: member.employeeId, description: `Se canceló el alta de ${who} en el equipo ${describeCrew(crew)} de la rotación ${describeRotation(rotation)} (${rangeLabel(from, keyOrNull(member.effectiveTo))}); nunca rigió.`, before: memberAuditSnapshot(member, { employee: who, crew: describeCrew(crew) }) });
      await shiftRotationRepository.deleteMember(memberId, tx);
      const after = await requireRotation(rotationId, tx);
      assertNoNewBlockingIssues(before, await assessRotationRow(after, tx), "cancelar el alta");
      const coverage = await recalculateRotationCoverage(tx, [member.employeeId], [{ from, to: keyOrNull(member.effectiveTo) }], `cancelación de un alta en la rotación ${describeRotation(rotation)}`);
      if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
      return { id: memberId };
    }, ROTATION_TRANSACTION_OPTIONS));
  },
};
