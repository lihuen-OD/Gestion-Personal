/**
 * Cargador EN LOTE de la configuración de rotaciones — R4.3b
 * (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5).
 *
 * Traduce las tablas de R4.1/R4.1A al snapshot puro de rotationPlan.ts. No
 * decide nada: REST, MISSING, CONFLICT y SHIFTS los decide
 * `resolveRotationDayPlan` (núcleo de R4.2), que siguen llamando los
 * consumidores — no hay un resolver paralelo.
 *
 * Consultas constantes por lote, nunca por empleado ni por día:
 *   1. membresías vigentes en el rango (si no hay, termina: camino legacy
 *      sin más consultas — con las tablas vacías éste es el único costo);
 *   2. las rotaciones de esas membresías, con equipos, versiones del rango,
 *      días, bloques y plantillas, en una sola consulta (`join`).
 */
import { argentinaCalendarDate, calendarDateKey } from "../../shared/datetime/argentinaTime";
import type { PrismaTransactionClient } from "../../shared/prisma/client";
import type { RotationConfiguration, RotationTemplateRef } from "./rotationPlan";
import type { ShiftTemplateRef } from "./workShiftEvaluation.service";

/** Plantilla cargada: lo que necesita el núcleo (RotationTemplateRef) + tolerancias/umbrales de la jornada. */
export type LoadedRotationTemplate = ShiftTemplateRef & RotationTemplateRef;

export type RotationLoaderReader = Pick<PrismaTransactionClient, "shiftRotationCrewMember" | "shiftRotation">;

export const EMPTY_ROTATION_CONFIGURATION: RotationConfiguration<LoadedRotationTemplate> = Object.freeze({ memberships: [], rotations: [] }) as RotationConfiguration<LoadedRotationTemplate>;

const rotationTemplateSelect = {
  id: true,
  code: true,
  startTime: true,
  endTime: true,
  crossesMidnight: true,
  status: true,
  entryToleranceBeforeMinutes: true,
  entryToleranceAfterMinutes: true,
  exitToleranceBeforeMinutes: true,
  exitToleranceAfterMinutes: true,
  minimumMinutesForCompliance: true,
  maximumInformativeMinutes: true,
  missingOutAlertAfterMinutes: true,
  absoluteOpenShiftLimitMinutes: true,
} as const;

const toKey = (date: Date | null) => (date ? calendarDateKey(date) : null);

export async function loadRotationConfiguration(
  db: RotationLoaderReader,
  input: { fromKey: string; toKey: string; employeeIds?: string[]; activeEmployeesOnly?: boolean },
): Promise<RotationConfiguration<LoadedRotationTemplate>> {
  const employeeIds = input.employeeIds ? [...new Set(input.employeeIds)] : undefined;
  if (employeeIds && !employeeIds.length) return EMPTY_ROTATION_CONFIGURATION;
  const from = argentinaCalendarDate(input.fromKey);
  const to = argentinaCalendarDate(input.toKey);
  const inRange = { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] };

  const memberships = await db.shiftRotationCrewMember.findMany({
    where: {
      ...inRange,
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      ...(input.activeEmployeesOnly ? { employee: { status: "ACTIVO" } } : {}),
    },
    select: { employeeId: true, crewId: true, effectiveFrom: true, effectiveTo: true, crew: { select: { rotationId: true } } },
  });
  if (!memberships.length) return EMPTY_ROTATION_CONFIGURATION;

  const rotations = await db.shiftRotation.findMany({
    relationLoadStrategy: "join",
    where: { id: { in: [...new Set(memberships.map((membership) => membership.crew.rotationId))] } },
    select: {
      id: true,
      code: true,
      status: true,
      crews: { select: { id: true, code: true, status: true } },
      versions: {
        where: inRange,
        select: {
          id: true,
          rotationId: true,
          cycleLengthWeeks: true,
          anchorWeekStart: true,
          effectiveFrom: true,
          effectiveTo: true,
          days: {
            select: {
              id: true,
              crewId: true,
              cycleWeekIndex: true,
              weekday: true,
              kind: true,
              blocks: { select: { blockIndex: true, shiftTemplate: { select: rotationTemplateSelect } } },
            },
          },
        },
      },
    },
  });

  return {
    memberships: memberships.map((membership) => ({
      employeeId: membership.employeeId,
      rotationId: membership.crew.rotationId,
      crewId: membership.crewId,
      effectiveFrom: calendarDateKey(membership.effectiveFrom),
      effectiveTo: toKey(membership.effectiveTo),
    })),
    rotations: rotations.map((rotation) => ({
      id: rotation.id,
      code: rotation.code,
      status: rotation.status,
      crews: rotation.crews,
      versions: rotation.versions.map((version) => ({
        id: version.id,
        rotationId: version.rotationId,
        cycleLengthWeeks: version.cycleLengthWeeks,
        anchorWeekStart: calendarDateKey(version.anchorWeekStart),
        effectiveFrom: calendarDateKey(version.effectiveFrom),
        effectiveTo: toKey(version.effectiveTo),
        days: version.days.map((day) => ({
          id: day.id,
          crewId: day.crewId,
          cycleWeekIndex: day.cycleWeekIndex,
          weekday: day.weekday,
          kind: day.kind,
          blocks: day.blocks.map((block) => ({ blockIndex: block.blockIndex, template: block.shiftTemplate })),
        })),
      })),
    })),
  };
}
