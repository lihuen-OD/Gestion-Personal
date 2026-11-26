import { createHash } from "node:crypto";
import { assertEmployeesWritable, canManageShiftGroup, type ShiftActor } from "../shifts/shiftWriteAccess";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { argentinaCalendarDate, previousCalendarDateKey, todayArgentinaDateKey, nextCalendarDateKey } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { auditService, type AuditContext } from "../audit/audit.service";
import { auditNoveltyCoverageRecalculationWithin, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { computeExpectedMinutes } from "../shifts/shiftTemplateTime";

type Db = PrismaTransactionClient;

export type ReplaceShiftTemplateScheduleInput = {
  effectiveFrom: string;
  startTime: string;
  endTime: string;
  code: string;
  name: string;
  acknowledgePendingDependencies?: boolean;
  confirmationToken?: string;
};

const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true } as const;
const employeeLabel = (employee: { legajo: string; firstName: string; lastName: string }) => `${employee.lastName}, ${employee.firstName} · Legajo ${employee.legajo}`;

function tokenOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * "Ya rigió" según R4.6: cualquiera de estas cuatro fuentes vuelve inmutable
 * el horario y el retiro sin fecha de la plantilla.
 */
export async function shiftTemplateHistory(templateId: string, today = todayArgentinaDateKey(), db: Db = prisma) {
  const date = argentinaCalendarDate(today);
  const [assignment, holiday, workShift, rotationBlock] = await Promise.all([
    db.shiftAssignment.findFirst({ where: { shiftTemplateId: templateId, effectiveFrom: { lte: date } }, select: { id: true } }),
    db.holidayWorkAssignment.findFirst({ where: { shiftTemplateId: templateId, date: { lte: date } }, select: { id: true } }),
    db.workShift.findFirst({ where: { shiftTemplateId: templateId }, select: { id: true } }),
    db.shiftRotationBlock.findFirst({ where: { shiftTemplateId: templateId, day: { version: { effectiveFrom: { lte: date } } } }, select: { id: true } }),
  ]);
  return {
    hasRuled: Boolean(assignment || holiday || workShift || rotationBlock),
    sources: { assignment: Boolean(assignment), holiday: Boolean(holiday), workShift: Boolean(workShift), rotation: Boolean(rotationBlock) },
  };
}

/** Un fijo todavía sin adoptar su plantilla impide cambiar reglas en carrera. */
export function pendingFixedEntryJobs(templateId: string, db: Db = prisma) {
  return db.clockPunchPostProcessJob.count({
    where: {
      kind: "ENTRY",
      status: { in: ["PENDING", "PROCESSING", "FAILED"] },
      workShift: { shiftTemplateId: null },
      employee: { shiftAssignments: { some: { shiftTemplateId: templateId, status: "HABILITADO" } } },
    },
  });
}

async function requireTemplate(templateId: string, db: Db) {
  const template = await db.shiftTemplate.findUnique({ where: { id: templateId }, include: { shiftGroup: true } });
  if (!template) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
  return template;
}

async function replacementPlan(templateId: string, input: ReplaceShiftTemplateScheduleInput, db: Db, actor: ShiftActor) {
  const template = await requireTemplate(templateId, db);
  // R8.3: plantilla de un grupo no administrable → 404, igual que inexistente.
  if (!canManageShiftGroup(actor, template.shiftGroupId)) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
  const tomorrow = nextCalendarDateKey(todayArgentinaDateKey());
  if (input.effectiveFrom < tomorrow) {
    throw new AppError(`El reemplazo debe empezar desde el ${tomorrow} o después.`, 422, "SHIFT_TEMPLATE_REPLACEMENT_DATE");
  }
  const from = argentinaCalendarDate(input.effectiveFrom);
  const [assignments, holidayDependencies, versionDependencies] = await Promise.all([
    db.shiftAssignment.findMany({
      where: { shiftTemplateId: templateId, status: "HABILITADO", OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
      include: { employee: { select: employeeSelect } },
      orderBy: [{ employeeId: "asc" }, { effectiveFrom: "asc" }],
    }),
    db.holidayWorkAssignment.findMany({
      where: { shiftTemplateId: templateId, status: "ACTIVA", date: { gte: from } },
      include: { employee: { select: employeeSelect } },
      orderBy: [{ date: "asc" }, { employeeId: "asc" }],
    }),
    db.shiftRotationVersion.findMany({
      where: {
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        days: { some: { blocks: { some: { shiftTemplateId: templateId } } } },
      },
      include: {
        rotation: { select: { code: true, name: true, shiftGroupId: true } },
        days: { where: { blocks: { some: { shiftTemplateId: templateId } } }, include: { crew: { select: { code: true, name: true } } } },
      },
      orderBy: { effectiveFrom: "asc" },
    }),
  ]);
  const assignmentPlan = assignments.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employee: employeeLabel(row.employee),
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    weekdays: row.weekdays,
    observation: row.observation,
    updatedAt: row.updatedAt.toISOString(),
    action: row.effectiveFrom < from ? "SPLIT" as const : "REPOINT" as const,
  }));
  const pendingDependencies = {
    holidayAssignments: holidayDependencies.map((row) => ({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      employeeId: row.employeeId,
      employee: employeeLabel(row.employee),
      updatedAt: row.updatedAt.toISOString(),
    })),
    // R8.7: una rotación de otro grupo (datos inconsistentes: la plantilla cambió
    // de grupo con una versión futura que la usa) no se nombra a Nivel 2/3.
    rotationVersions: versionDependencies.map((row) => ({
      id: row.id,
      rotation: canManageShiftGroup(actor, row.rotation.shiftGroupId) ? `${row.rotation.code} - ${row.rotation.name}` : "Rotación de otro grupo",
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
      crews: canManageShiftGroup(actor, row.rotation.shiftGroupId) ? [...new Set(row.days.map((day) => `${day.crew.code} - ${day.crew.name}`))].sort() : [],
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
  // R8.3 (R-4): el reemplazo reescribe fijos y deja convocatorias pendientes de
  // personas concretas: todas tienen que estar en el alcance de legajos, o
  // nada se muestra ni se escribe.
  await assertEmployeesWritable(actor, [...assignmentPlan.map((row) => row.employeeId), ...pendingDependencies.holidayAssignments.map((row) => row.employeeId)], db);
  const canonical = {
    template: { id: template.id, updatedAt: template.updatedAt.toISOString() },
    requested: { effectiveFrom: input.effectiveFrom, startTime: input.startTime, endTime: input.endTime, code: input.code, name: input.name },
    assignments: assignmentPlan,
    pendingDependencies,
  };
  return {
    template,
    effectiveFrom: input.effectiveFrom,
    assignments: assignmentPlan,
    pendingDependencies,
    complete: pendingDependencies.holidayAssignments.length === 0 && pendingDependencies.rotationVersions.length === 0,
    confirmationToken: tokenOf(canonical),
  };
}

export const shiftTemplateScheduleService = {
  async preview(templateId: string, input: ReplaceShiftTemplateScheduleInput, actor: ShiftActor) {
    const plan = await replacementPlan(templateId, input, prisma, actor);
    const { template, ...publicPlan } = plan;
    return { ...publicPlan, template: { id: template.id, code: template.code, name: template.name } };
  },

  async replace(templateId: string, input: ReplaceShiftTemplateScheduleInput, actor: ShiftActor, audit?: AuditContext) {
    if (!input.confirmationToken) throw new AppError("Falta el token de confirmación del reemplazo.", 400, "SHIFT_TEMPLATE_REPLACEMENT_CONFIRMATION_REQUIRED");
    try {
      return await prisma.$transaction(async (tx) => {
        // Orden global de cobertura → plantilla. Bloquea altas/cambios de
        // fijos, membresías, versiones y regímenes mientras se confirma el
        // plan, de modo que el token y el conjunto de asignaciones no cambien
        // entre la relectura y la escritura.
        await lockNoveltyCoverageGlobally(tx);
        await tx.$queryRaw`SELECT id FROM "ShiftTemplate" WHERE id = ${templateId} FOR UPDATE`;
        const plan = await replacementPlan(templateId, input, tx, actor);
        if (plan.confirmationToken !== input.confirmationToken) {
          throw new AppError("La configuración cambió desde la vista previa. Revisá el impacto actualizado y volvé a confirmar.", 409, "SHIFT_TEMPLATE_REPLACEMENT_STALE", {
            preview: { ...plan, template: { id: plan.template.id, code: plan.template.code, name: plan.template.name } },
          });
        }
        if (!plan.complete && !input.acknowledgePendingDependencies) {
          throw new AppError("Hay convocatorias o versiones de rotación que requieren intervención explícita antes de completar el reemplazo.", 409, "SHIFT_TEMPLATE_REPLACEMENT_DEPENDENCIES", { pendingDependencies: plan.pendingDependencies });
        }
        const employeeIds = [...new Set(plan.assignments.map((row) => row.employeeId))];
        const old = plan.template;
        const crossesMidnight = input.endTime <= input.startTime;
        const created = await tx.shiftTemplate.create({
          data: {
            code: input.code,
            name: input.name,
            description: old.description,
            categoryName: old.categoryName,
            shiftGroupId: old.shiftGroupId,
            startTime: input.startTime,
            endTime: input.endTime,
            crossesMidnight,
            expectedMinutes: computeExpectedMinutes(input.startTime, input.endTime, crossesMidnight),
            entryToleranceBeforeMinutes: old.entryToleranceBeforeMinutes,
            entryToleranceAfterMinutes: old.entryToleranceAfterMinutes,
            exitToleranceBeforeMinutes: old.exitToleranceBeforeMinutes,
            exitToleranceAfterMinutes: old.exitToleranceAfterMinutes,
            minimumMinutesForCompliance: old.minimumMinutesForCompliance,
            maximumInformativeMinutes: old.maximumInformativeMinutes,
            missingOutAlertAfterMinutes: old.missingOutAlertAfterMinutes,
            absoluteOpenShiftLimitMinutes: old.absoluteOpenShiftLimitMinutes,
            warningThresholdMinutes: old.warningThresholdMinutes,
            reviewThresholdMinutes: old.reviewThresholdMinutes,
            criticalThresholdMinutes: old.criticalThresholdMinutes,
            status: "ACTIVO",
            createdByUserId: audit?.userId ?? null,
            updatedByUserId: audit?.userId ?? null,
          },
          include: { shiftGroup: true },
        });
        const previousDay = argentinaCalendarDate(previousCalendarDateKey(input.effectiveFrom));
        for (const row of plan.assignments) {
          if (row.action === "REPOINT") {
            await tx.shiftAssignment.update({ where: { id: row.id }, data: { shiftTemplateId: created.id } });
          } else {
            await tx.shiftAssignment.update({ where: { id: row.id }, data: { effectiveTo: previousDay } });
            await tx.shiftAssignment.create({
              data: {
                employeeId: row.employeeId,
                shiftTemplateId: created.id,
                status: "HABILITADO",
                effectiveFrom: argentinaCalendarDate(input.effectiveFrom),
                effectiveTo: row.effectiveTo ? argentinaCalendarDate(row.effectiveTo) : null,
                weekdays: row.weekdays,
                observation: row.observation,
                assignedByUserId: audit?.userId ?? null,
              },
            });
          }
          await auditService.registerWithin(tx, {
            ...audit,
            action: "UPDATE",
            entity: "ShiftAssignment",
            entityId: row.employeeId,
            description: `Se reemplazó el horario ${old.code} por ${created.code} para ${row.employee} desde el ${input.effectiveFrom}.`,
            before: { shiftAssignmentId: row.id, shiftTemplateId: old.id, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo } as Prisma.InputJsonValue,
            after: { shiftTemplateId: created.id, effectiveFrom: input.effectiveFrom, action: row.action } as Prisma.InputJsonValue,
          });
        }
        await auditService.registerWithin(tx, {
          ...audit,
          action: "CREATE",
          entity: "ShiftTemplate",
          entityId: created.id,
          description: `Se creó el turno ${created.code} - ${created.name} para reemplazar el horario ${old.code} - ${old.name} desde el ${input.effectiveFrom}${plan.complete ? "." : "; quedaron dependencias futuras informadas pendientes de intervención."}`,
          after: created as unknown as Prisma.InputJsonValue,
        });
        const to = plan.assignments.some((row) => row.effectiveTo === null)
          ? null
          : plan.assignments.map((row) => row.effectiveTo).filter((value): value is string => Boolean(value)).sort().at(-1) ?? input.effectiveFrom;
        const coverage = employeeIds.length
          ? await recalculateNoveltyCoverage(tx, { employeeIds, from: argentinaCalendarDate(input.effectiveFrom), to: to ? argentinaCalendarDate(to) : null }, { source: "SHIFT_TEMPLATE_CHANGED", label: `reemplazo del horario ${old.code} por ${created.code}` })
          : null;
        if (coverage) await auditNoveltyCoverageRecalculationWithin(tx, coverage, audit);
        return { template: created, assignments: plan.assignments.length, complete: plan.complete, pendingDependencies: plan.pendingDependencies };
      }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Ya existe un turno con el código indicado para el reemplazo.", 409, "SHIFT_TEMPLATE_DUPLICATE");
      }
      throw error;
    }
  },
};
