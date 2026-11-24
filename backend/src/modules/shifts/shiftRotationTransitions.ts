/**
 * Transiciones entre regímenes de turno — R4.6, garantía 2
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.9).
 *
 * Las vigencias son inclusivas: cerrar una membresía o una versión en L
 * conserva el plan completo de L, incluido un bloque nocturno 19:00 → 07:00
 * que termina en L+1. Lo que se valida acá es que el primer turno del régimen
 * siguiente (turno fijo, otra rotación, otro equipo, otra versión) no se
 * superponga con ese último bloque. Se comparan instantes reales.
 */
import { argentinaCalendarDate, nextCalendarDateKey, previousCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { FixedAssignment } from "./expectedShiftResolver";
import { fixedAssignmentsInVigency } from "./expectedShiftResolver";
import { loadRotationConfiguration } from "./rotationPlan.loader";
import type { RotationConfiguration, RotationTemplateRef } from "./rotationPlan";
import { shiftRotationRepository, type RotationFullRow } from "./shiftRotation.repository";
import { allMembers, keyOf, keyOrNull, membershipFacts, rotationSnapshot } from "./shiftRotation.support";
import { fixedIntervalsOn, rotationIntervalsOn, transitionCheck, type ScheduledInterval } from "./shiftRotationReadiness";

type Db = PrismaTransactionClient;

export type TransitionOverlap = { employeeId: string; employee: string; outgoing: string; incoming: string };
export type TransitionRest = { employeeId: string; employee: string; restMinutes: number };

type FixedRef = RotationTemplateRef & { code: string };

async function fixedAssignmentsByEmployee(db: Db, employeeIds: string[]) {
  const rows = employeeIds.length ? await shiftRotationRepository.fixedAssignmentsOf(employeeIds, db) : [];
  const map = new Map<string, FixedAssignment<FixedRef>[]>();
  for (const row of rows) {
    const list = map.get(row.employeeId) ?? [];
    list.push({ status: row.status, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, weekdays: row.weekdays, template: { id: row.shiftTemplate.id, code: row.shiftTemplate.code, startTime: row.shiftTemplate.startTime, endTime: row.shiftTemplate.endTime, crossesMidnight: row.shiftTemplate.crossesMidnight, status: row.shiftTemplate.status } });
    map.set(row.employeeId, list);
  }
  return map;
}

/** Configuración de rotaciones de estas personas en `dateKey`, sin la rotación excluida. */
async function otherRotations(db: Db, employeeIds: string[], dateKey: string, excludeRotationId: string): Promise<RotationConfiguration> {
  const config = await loadRotationConfiguration(db, { fromKey: dateKey, toKey: dateKey, employeeIds });
  return { memberships: config.memberships.filter((membership) => membership.rotationId !== excludeRotationId), rotations: config.rotations.filter((rotation) => rotation.id !== excludeRotationId) };
}

/** Configuración de una rotación tal como está guardada (snapshot de su fila completa). */
export function storedConfiguration(rotation: RotationFullRow): RotationConfiguration {
  return {
    memberships: allMembers(rotation).map((member) => ({ employeeId: member.employeeId, rotationId: rotation.id, crewId: member.crewId, effectiveFrom: keyOf(member.effectiveFrom), effectiveTo: keyOrNull(member.effectiveTo) })),
    rotations: [rotationSnapshot(rotation)],
  };
}

function labelsOf(rotation: RotationFullRow) {
  return new Map(allMembers(rotation).map((member) => [member.employeeId, membershipFacts(member).employeeLabel]));
}

/**
 * Salida de la rotación (baja o finalización) con último día L: bloques de la
 * rotación en L frente a lo que rige en L+1 (turno fijo u otra rotación).
 */
export async function transitionIssuesForExit(db: Db, rotation: RotationFullRow, exits: Array<{ employeeId: string; lastDay: string }>) {
  const overlaps: TransitionOverlap[] = [];
  const restsAtTransition: TransitionRest[] = [];
  const withoutFixedShift: Array<{ employeeId: string; employee: string; from: string }> = [];
  if (!exits.length) return { overlaps, restsAtTransition, withoutFixedShift };
  const ids = [...new Set(exits.map((exit) => exit.employeeId))];
  const labels = labelsOf(rotation);
  const config = storedConfiguration(rotation);
  const fixed = await fixedAssignmentsByEmployee(db, ids);
  for (const exit of exits) {
    const next = nextCalendarDateKey(exit.lastDay);
    const outgoing = rotationIntervalsOn(config, exit.employeeId, exit.lastDay);
    const others = await otherRotations(db, [exit.employeeId], next, rotation.id);
    const assignments = fixed.get(exit.employeeId) ?? [];
    const incoming: ScheduledInterval[] = others.memberships.length ? rotationIntervalsOn(others, exit.employeeId, next) : fixedIntervalsOn(assignments, exit.employeeId, next);
    const employee = labels.get(exit.employeeId) ?? "";
    const result = transitionCheck(outgoing, incoming);
    for (const overlap of result.overlaps) overlaps.push({ employeeId: exit.employeeId, employee, ...overlap });
    if (result.restMinutes !== null) restsAtTransition.push({ employeeId: exit.employeeId, employee, restMinutes: result.restMinutes });
    if (!others.memberships.length && !fixedAssignmentsInVigency(assignments, argentinaCalendarDate(next)).length) withoutFixedShift.push({ employeeId: exit.employeeId, employee, from: next });
  }
  return { overlaps, restsAtTransition, withoutFixedShift };
}

/**
 * Entrada a la rotación (alta o cambio de equipo) desde X con la configuración
 * propuesta `proposed`: lo que regía en X−1 (turno fijo, otra rotación u otro
 * equipo) frente a los bloques propuestos en X.
 */
export async function transitionIssuesForEntry(db: Db, input: { rotationId: string; proposed: RotationConfiguration; entries: Array<{ employeeId: string; employee: string; firstDay: string }>; previousFromProposed?: boolean }) {
  const overlaps: TransitionOverlap[] = [];
  const restsAtTransition: TransitionRest[] = [];
  if (!input.entries.length) return { overlaps, restsAtTransition };
  const fixed = await fixedAssignmentsByEmployee(db, [...new Set(input.entries.map((entry) => entry.employeeId))]);
  for (const entry of input.entries) {
    const previous = previousCalendarDateKey(entry.firstDay);
    const incoming = rotationIntervalsOn(input.proposed, entry.employeeId, entry.firstDay);
    let outgoing: ScheduledInterval[];
    if (input.previousFromProposed) {
      outgoing = rotationIntervalsOn(input.proposed, entry.employeeId, previous);
    } else {
      const others = await otherRotations(db, [entry.employeeId], previous, input.rotationId);
      outgoing = others.memberships.length ? rotationIntervalsOn(others, entry.employeeId, previous) : fixedIntervalsOn(fixed.get(entry.employeeId) ?? [], entry.employeeId, previous);
    }
    const result = transitionCheck(outgoing, incoming);
    for (const overlap of result.overlaps) overlaps.push({ employeeId: entry.employeeId, employee: entry.employee, ...overlap });
    if (result.restMinutes !== null) restsAtTransition.push({ employeeId: entry.employeeId, employee: entry.employee, restMinutes: result.restMinutes });
  }
  return { overlaps, restsAtTransition };
}

/** Rotación de una persona en `dateKey` (para la protección inversa en turnos fijos). */
export async function rotationIntervalsForEmployee(employeeId: string, dateKey: string, db: Db = prisma): Promise<ScheduledInterval[]> {
  const config = await loadRotationConfiguration(db, { fromKey: dateKey, toKey: dateKey, employeeIds: [employeeId] });
  return config.memberships.length ? rotationIntervalsOn(config, employeeId, dateKey) : [];
}

