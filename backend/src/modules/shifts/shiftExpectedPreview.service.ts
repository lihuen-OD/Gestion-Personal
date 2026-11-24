import { argentinaCalendarDate, calendarDateKey, nextCalendarDateKey, previousCalendarDateKey, scheduledInstantForShiftTime } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { prisma } from "../../shared/prisma/client";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { activeRegimeKindOn } from "./expectedShiftResolver";
import {
  loadEmployeeWorkdayContext,
  projectExpectedWorkday,
  resolveEmployeeExpectedShift,
  workdayDateKeys,
  type EmployeeWorkdayContext,
  type WorkdayShiftTemplate,
} from "./expectedWorkday";
import { isMondayKey, isValidCycleLength, rotationWeekIndex, rotationWeekLabel, type ExpectedBlock, type RotationConfiguration } from "./rotationPlan";
import { computeExpectedMinutes, parseShiftTime } from "./shiftTemplateTime";
import { transitionCheck, type ScheduledInterval } from "./shiftRotationReadiness";
import { shiftExpectedPreviewRepository, type PreviewEmployeeRow, type PreviewMembershipRow, type PreviewRotationRow } from "./shiftExpectedPreview.repository";
import type { ExpectedShiftPreviewQuery } from "./shiftExpectedPreview.schemas";

type PreviewWarning = {
  code: "ROTATION_PLAN_MISSING" | "ROTATION_PLAN_CONFLICT" | "MULTIPLE_FIXED_ASSIGNMENTS" | "FIXED_ASSIGNMENTS_OVERLAP" | "EXPECTED_WORKDAY_UNRESOLVED" | "TRANSITION_OVERLAP";
  severity: "ERROR" | "WARNING";
  message: string;
  relatedDate?: string;
};

type InternalBlock = {
  operationalDate: string;
  blockIndex: number;
  source: "ROTATION" | "FIXED_ASSIGNMENT" | "HOLIDAY_CONVOCATION";
  template: { id: string; code: string; startTime: string; endTime: string; crossesMidnight: boolean };
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  durationMinutes: number;
};

type InternalCell = ReturnType<typeof buildCell>;

function simulatedContext(context: EmployeeWorkdayContext, rotationId: string, inactive: boolean): EmployeeWorkdayContext {
  if (!inactive || !context.rotation) return context;
  const rotation: RotationConfiguration = {
    memberships: context.rotation.memberships,
    rotations: context.rotation.rotations.map((item) => (item.id === rotationId ? { ...item, status: "ACTIVO" } : item)),
  };
  return { ...context, rotation: rotation as EmployeeWorkdayContext["rotation"] };
}

function fixedBlock(dateKey: string, template: WorkdayShiftTemplate, blockIndex: number): InternalBlock | null {
  const startMinute = parseShiftTime(template.startTime);
  const endMinute = parseShiftTime(template.endTime);
  if (startMinute === null || endMinute === null) return null;
  const durationMinutes = computeExpectedMinutes(template.startTime, template.endTime, template.crossesMidnight);
  if (durationMinutes <= 0) return null;
  const scheduledStartAt = scheduledInstantForShiftTime(argentinaCalendarDate(dateKey), template.startTime);
  return {
    operationalDate: dateKey,
    blockIndex,
    source: "FIXED_ASSIGNMENT",
    template: { id: template.id, code: template.code ?? "", startTime: template.startTime, endTime: template.endTime, crossesMidnight: template.crossesMidnight },
    scheduledStartAt,
    scheduledEndAt: new Date(scheduledStartAt.getTime() + durationMinutes * 60_000),
    durationMinutes,
  };
}

function rotationBlock(block: ExpectedBlock): InternalBlock {
  return {
    operationalDate: block.operationalDate,
    blockIndex: block.blockIndex,
    source: block.source,
    template: {
      id: block.template.id,
      code: block.template.code,
      startTime: block.template.startTime,
      endTime: block.template.endTime,
      crossesMidnight: block.template.crossesMidnight,
    },
    scheduledStartAt: block.scheduledStartAt,
    scheduledEndAt: block.scheduledEndAt,
    durationMinutes: block.durationMinutes,
  };
}

function serializeBlock(block: InternalBlock) {
  return {
    operationalDate: block.operationalDate,
    blockIndex: block.blockIndex,
    source: block.source,
    template: block.template,
    scheduledStartAt: block.scheduledStartAt.toISOString(),
    scheduledEndAt: block.scheduledEndAt.toISOString(),
    durationMinutes: block.durationMinutes,
  };
}

function activeMembership(memberships: PreviewMembershipRow[], employeeId: string, dateKey: string) {
  return memberships.find((membership) => {
    if (membership.employeeId !== employeeId) return false;
    const from = calendarDateKey(membership.effectiveFrom);
    const to = membership.effectiveTo ? calendarDateKey(membership.effectiveTo) : null;
    return from <= dateKey && (to === null || to >= dateKey);
  }) ?? null;
}

function activeVersion(rotation: PreviewRotationRow, dateKey: string) {
  return rotation.versions.find((version) => {
    const from = calendarDateKey(version.effectiveFrom);
    const to = version.effectiveTo ? calendarDateKey(version.effectiveTo) : null;
    return from <= dateKey && (to === null || to >= dateKey);
  }) ?? null;
}

function buildCell(input: {
  context: EmployeeWorkdayContext;
  employeeId: string;
  dateKey: string;
  rotation: PreviewRotationRow;
  memberships: PreviewMembershipRow[];
}) {
  const operational = resolveEmployeeExpectedShift(input.context, input.dateKey, "WORK_OBLIGATION");
  const expectedResolution = resolveEmployeeExpectedShift(input.context, input.dateKey, "EXPECTED_WORKDAY");
  const expectedWorkday = projectExpectedWorkday(expectedResolution);
  const dayPlan = expectedResolution.dayPlan;
  const fixedCandidates = expectedResolution.fixedCandidates;
  const plannedBlocks: InternalBlock[] = dayPlan?.kind === "SHIFTS"
    ? dayPlan.blocks.map(rotationBlock)
    : dayPlan
      ? []
      : fixedCandidates.map((template, index) => fixedBlock(input.dateKey, template, index)).filter((block): block is InternalBlock => block !== null);
  const effectiveBlocks: InternalBlock[] = operational.blocks.length
    ? operational.blocks.map(rotationBlock)
    : operational.obligation === "SHIFT"
      ? operational.fixedCandidates.map((template, index) => fixedBlock(input.dateKey, template, index)).filter((block): block is InternalBlock => block !== null)
      : [];
  const warnings: PreviewWarning[] = [];
  if (dayPlan?.kind === "MISSING") warnings.push({ code: "ROTATION_PLAN_MISSING", severity: "ERROR", message: "Falta completar la configuración de la rotación para esta fecha." });
  if (dayPlan?.kind === "CONFLICT") warnings.push({ code: "ROTATION_PLAN_CONFLICT", severity: "ERROR", message: "La configuración de la rotación es contradictoria para esta fecha." });
  if (!dayPlan && fixedCandidates.length > 1) warnings.push({ code: "MULTIPLE_FIXED_ASSIGNMENTS", severity: "WARNING", message: "Hay más de un turno fijo aplicable en esta fecha." });
  if (expectedWorkday.unresolvedReason === "SHIFT_ASSIGNMENTS_OVERLAP") warnings.push({ code: "FIXED_ASSIGNMENTS_OVERLAP", severity: "ERROR", message: "Los turnos fijos aplicables se superponen." });
  else if (expectedWorkday.obligation === "UNRESOLVED") warnings.push({ code: "EXPECTED_WORKDAY_UNRESOLVED", severity: "WARNING", message: "No se puede resolver con certeza la jornada esperada." });

  const membership = activeMembership(input.memberships, input.employeeId, input.dateKey);
  const crew = membership ? input.rotation.crews.find((item) => item.id === membership.crewId) ?? null : null;
  const version = membership ? activeVersion(input.rotation, input.dateKey) : null;
  const anchorKey = version ? calendarDateKey(version.anchorWeekStart) : null;
  const cycleWeekIndex = version && anchorKey && isValidCycleLength(version.cycleLengthWeeks) && isMondayKey(anchorKey)
    ? rotationWeekIndex(anchorKey, version.cycleLengthWeeks, input.dateKey)
    : null;
  const planningKind = dayPlan?.kind ?? (fixedCandidates.length ? "FIXED_ASSIGNMENT" : "NONE");

  return {
    date: input.dateKey,
    assignment: membership
      ? {
          membershipId: membership.id,
          effectiveFrom: calendarDateKey(membership.effectiveFrom),
          effectiveTo: membership.effectiveTo ? calendarDateKey(membership.effectiveTo) : null,
          crew: crew ? { id: crew.id, code: crew.code, name: crew.name } : null,
          version: version
            ? { id: version.id, effectiveFrom: calendarDateKey(version.effectiveFrom), effectiveTo: version.effectiveTo ? calendarDateKey(version.effectiveTo) : null }
            : null,
          cycleWeekIndex,
          cycleWeekLabel: cycleWeekIndex === null ? null : rotationWeekLabel(cycleWeekIndex),
        }
      : null,
    planning: {
      kind: planningKind,
      reason: dayPlan?.kind === "MISSING" || dayPlan?.kind === "CONFLICT" ? dayPlan.reason : null,
      detail: dayPlan?.kind === "CONFLICT" ? dayPlan.detail : [],
      origin: dayPlan && dayPlan.kind !== "CONFLICT" ? dayPlan.origin : null,
      blocks: plannedBlocks.map(serializeBlock),
    },
    effective: {
      obligation: operational.obligation,
      source: operational.source,
      reason: operational.reason,
      blocks: effectiveBlocks.map(serializeBlock),
    },
    expectedWorkday,
    facts: {
      dayOff: input.context.dayOffDates.has(input.dateKey),
      holidayScope: input.context.holidays.get(input.dateKey) ?? null,
      convoked: input.context.convocations.has(input.dateKey) && input.context.holidays.has(input.dateKey),
      regimeKind: activeRegimeKindOn(input.context.regimes, argentinaCalendarDate(input.dateKey)),
    },
    transitionFromPrevious: null as null | { previousOperationalDate: string; restMinutes: number | null; overlap: boolean },
    warnings,
    _plannedBlocks: plannedBlocks,
  };
}

function scheduledInterval(block: InternalBlock): ScheduledInterval {
  return { start: block.scheduledStartAt, end: block.scheduledEndAt, label: `${block.template.code} ${block.template.startTime}–${block.template.endTime} del ${block.operationalDate}` };
}

function addTransitions(cells: InternalCell[], returnedDates: ReadonlySet<string>) {
  const byDate = new Map(cells.map((cell) => [cell.date, cell]));
  const blocks = cells.flatMap((cell) => cell._plannedBlocks).sort((left, right) => left.scheduledStartAt.getTime() - right.scheduledStartAt.getTime() || left.blockIndex - right.blockIndex);
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1]!;
    const current = blocks[index]!;
    const transition = transitionCheck([scheduledInterval(previous)], [scheduledInterval(current)]);
    const overlap = transition.overlaps.length > 0;
    const currentCell = byDate.get(current.operationalDate);
    if (currentCell && returnedDates.has(current.operationalDate)) {
      currentCell.transitionFromPrevious = { previousOperationalDate: previous.operationalDate, restMinutes: transition.restMinutes, overlap };
      if (overlap) currentCell.warnings.push({ code: "TRANSITION_OVERLAP", severity: "ERROR", message: "Este bloque se superpone con el bloque programado anterior.", relatedDate: previous.operationalDate });
    }
    const previousCell = byDate.get(previous.operationalDate);
    if (overlap && previousCell && returnedDates.has(previous.operationalDate) && !returnedDates.has(current.operationalDate)) {
      previousCell.warnings.push({ code: "TRANSITION_OVERLAP", severity: "ERROR", message: "Este bloque se superpone con el bloque programado siguiente.", relatedDate: current.operationalDate });
    }
  }
}

function publicCell(cell: InternalCell) {
  const { _plannedBlocks: _ignored, ...result } = cell;
  return result;
}

export const shiftExpectedPreviewService = {
  async preview(query: ExpectedShiftPreviewQuery, user: Express.AuthUser) {
    const rotation = await shiftExpectedPreviewRepository.findRotation(query.rotationId);
    if (!rotation) throw new AppError("No encontramos la rotación solicitada", 404, "ROTATION_NOT_FOUND");

    const { items: employees, total } = await shiftExpectedPreviewRepository.findEmployees(query, employeeAccessWhere(user));
    const returnedKeys = workdayDateKeys(argentinaCalendarDate(query.from), argentinaCalendarDate(query.to));
    const internalFrom = previousCalendarDateKey(query.from);
    const internalTo = nextCalendarDateKey(query.to);
    const internalKeys = workdayDateKeys(argentinaCalendarDate(internalFrom), argentinaCalendarDate(internalTo));
    const employeeIds = employees.map((employee) => employee.id);
    const [contexts, memberships] = await Promise.all([
      loadEmployeeWorkdayContext(employeeIds, argentinaCalendarDate(internalFrom), argentinaCalendarDate(internalTo), prisma),
      shiftExpectedPreviewRepository.findMemberships(query.rotationId, employeeIds, internalFrom, internalTo),
    ]);
    const inactive = rotation.status === "INACTIVO";
    const returnedDates = new Set(returnedKeys);

    const data = employees.map((employee: PreviewEmployeeRow) => {
      const loaded = contexts.get(employee.id);
      if (!loaded) throw new AppError("No se pudo cargar el contexto de jornada del legajo", 500, "EXPECTED_SHIFT_CONTEXT_MISSING");
      const context = simulatedContext(loaded, rotation.id, inactive);
      const cells = internalKeys.map((dateKey) => buildCell({ context, employeeId: employee.id, dateKey, rotation, memberships }));
      addTransitions(cells, returnedDates);
      return {
        employee: { id: employee.id, legajo: employee.legajo, firstName: employee.firstName, lastName: employee.lastName, status: employee.status },
        days: cells.filter((cell) => returnedDates.has(cell.date)).map(publicCell),
      };
    });

    return {
      data,
      context: {
        rotation: { id: rotation.id, code: rotation.code, name: rotation.name, shiftGroup: rotation.shiftGroup },
        range: { from: query.from, to: query.to, days: returnedKeys.length },
        persistedStatus: rotation.status,
        readOnly: true as const,
        previewMode: inactive ? "HYPOTHETICAL_INACTIVE" as const : "CURRENT_CONFIGURATION" as const,
        affectsRealObligations: false as const,
      },
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },
};
