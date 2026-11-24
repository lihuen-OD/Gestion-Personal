import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import type { AuditContext, RegisterAuditInput } from "../audit/audit.service";
import { lockEmployeeCoverage } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, coverageWindowOf, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { shiftAssignmentRepository } from "./shiftAssignment.repository";
import type { CreateShiftAssignmentInput, ListShiftAssignmentsQuery, UpdateShiftAssignmentInput } from "./shiftAssignment.schemas";
import { assertFixedAssignmentsCompatibleWithRotations } from "./shiftRotationTransitions";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";

// La asignación y el recálculo de la cobertura de novedades van juntos.
const SHIFT_ASSIGNMENT_TRANSACTION_OPTIONS = { timeout: 30_000 };

function describeShift(template: { code: string; name: string }) {
  return `${template.code} - ${template.name}`;
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      throw new AppError("Related employee, shift template or user not found", 400, "RELATION_CONSTRAINT");
    }
  }
  throw error;
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    mapPrismaError(error);
    throw error;
  }
}

export const shiftAssignmentService = {
  async summary(user: Express.AuthUser) {
    const rows = await shiftAssignmentRepository.countByTemplateAndStatus(employeeAccessWhere(user));
    const byTemplate = new Map<string, { shiftTemplateId: string; total: number; enabled: number; disabled: number; other: number }>();
    for (const row of rows) {
      const count = row._count._all;
      const summary = byTemplate.get(row.shiftTemplateId) || { shiftTemplateId: row.shiftTemplateId, total: 0, enabled: 0, disabled: 0, other: 0 };
      summary.total += count;
      if (row.status === "HABILITADO") summary.enabled += count;
      else if (row.status === "DESHABILITADO") summary.disabled += count;
      else summary.other += count;
      byTemplate.set(row.shiftTemplateId, summary);
    }
    return Array.from(byTemplate.values());
  },

  list(query: ListShiftAssignmentsQuery, user: Express.AuthUser) {
    return shiftAssignmentRepository.findMany(query, employeeAccessWhere(user));
  },

  /**
   * Etapa 5 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §13.2): asignar,
   * editar, habilitar/deshabilitar o quitar un turno cambia la jornada
   * esperada; la cobertura de novedades de esos legajos se recalcula en la
   * MISMA transacción, sólo dentro de la vigencia anterior y la nueva.
   */
  async assign(input: CreateShiftAssignmentInput, user: Express.AuthUser, audit?: AuditContext) {
    const template = await prisma.shiftTemplate.findUnique({ where: { id: input.shiftTemplateId } });
    if (!template) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");

    const employeeIds = Array.from(new Set(input.employeeIds));
    const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, legajo: true, firstName: true, lastName: true } });
    if (employees.length !== employeeIds.length) throw new AppError("Uno o más empleados no existen", 404, "EMPLOYEE_NOT_FOUND");
    const employeeLabels = new Map(employees.map((employee) => [employee.id, formatEmployeeReference(employee)]));

    const vigency = { observation: input.observation, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, weekdays: input.weekdays };
    const outcome = await execute(() => prisma.$transaction(async (tx) => {
      await lockEmployeeCoverage(tx, employeeIds);
      const results = [];
      const audits: RegisterAuditInput[] = [];
      const ranges: Array<{ from: Date; to: Date | null }> = [];
      const changedEmployees: string[] = [];
      const existingRows = await shiftAssignmentRepository.findExistingMany(employeeIds, input.shiftTemplateId, tx);
      const existingByEmployee = new Map(existingRows.map((row) => [row.employeeId, row]));
      const affectedIds = employeeIds.filter((employeeId) => existingByEmployee.get(employeeId)?.status !== "HABILITADO");
      await assertFixedAssignmentsCompatibleWithRotations(tx, affectedIds.map((employeeId) => ({
        employeeId,
        employee: employeeLabels.get(employeeId)!,
        effectiveFrom: input.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: input.effectiveTo?.toISOString().slice(0, 10) ?? null,
        weekdays: input.weekdays,
        template,
      })));
      for (const employeeId of employeeIds) {
        const existing = existingByEmployee.get(employeeId) ?? null;

        if (!existing) {
          const created = await shiftAssignmentRepository.create(employeeId, input.shiftTemplateId, vigency, user.id, tx);
          // Etapa 10B: entityId=employeeId (no created.id, el id de la
          // asignación) — mismo criterio ya usado en employees.service.ts, es
          // lo que permite que este evento aparezca en el tab "Historial de
          // Eventos"/"Auditoría" del propio legajo (hallazgo 10A §7/§11).
          audits.push({
            action: "CREATE",
            entity: "ShiftAssignment",
            entityId: employeeId,
            description: `Se asignó el turno ${describeShift(template)} al empleado ${created.employee.legajo}.`,
            after: created as unknown as Prisma.InputJsonValue,
          });
          ranges.push({ from: input.effectiveFrom, to: input.effectiveTo ?? null });
          changedEmployees.push(employeeId);
          results.push(created);
          continue;
        }

        if (existing.status === "DESHABILITADO") {
          const reenabled = await shiftAssignmentRepository.reEnable(existing.id, vigency, user.id, tx);
          // Etapa 10B: entityId=employeeId, mismo criterio que arriba.
          audits.push({
            action: "ACTIVATE",
            entity: "ShiftAssignment",
            entityId: employeeId,
            description: `Se rehabilitó el turno ${describeShift(template)} para el empleado ${reenabled.employee.legajo}.`,
            before: existing as unknown as Prisma.InputJsonValue,
            after: reenabled as unknown as Prisma.InputJsonValue,
          });
          ranges.push({ from: input.effectiveFrom, to: input.effectiveTo ?? null }, { from: existing.effectiveFrom, to: existing.effectiveTo });
          changedEmployees.push(employeeId);
          results.push(reenabled);
          continue;
        }

        results.push(await shiftAssignmentRepository.findById(existing.id, tx));
      }
      const window = coverageWindowOf(ranges);
      const coverage = window
        ? await recalculateNoveltyCoverage(tx, { employeeIds: changedEmployees, ...window }, { source: "SHIFT_ASSIGNMENT_CHANGED", label: `asignación del turno ${describeShift(template)}` })
        : null;
      return { results, audits, coverage };
    }, SHIFT_ASSIGNMENT_TRANSACTION_OPTIONS));

    // La auditoría se registra recién cuando la transacción confirmó.
    for (const entry of outcome.audits) await auditService.register({ ...audit, ...entry });
    if (outcome.coverage) await auditNoveltyCoverageRecalculation(outcome.coverage, audit);
    return outcome.results;
  },

  async update(id: string, input: UpdateShiftAssignmentInput, user: Express.AuthUser, audit?: AuditContext) {
    const before = await shiftAssignmentRepository.findById(id);
    if (!before) throw new AppError("No encontramos la asignación solicitada", 404, "SHIFT_ASSIGNMENT_NOT_FOUND");

    const data: Prisma.ShiftAssignmentUncheckedUpdateInput = {};
    if (input.observation !== undefined) data.observation = input.observation;
    if (input.effectiveFrom !== undefined) data.effectiveFrom = input.effectiveFrom;
    if (input.effectiveTo !== undefined) data.effectiveTo = input.effectiveTo;
    if (input.weekdays !== undefined) data.weekdays = input.weekdays;

    // Mismo chequeo que workRegimesService.closeAssignment: si solo se envía
    // uno de los dos campos, se valida contra el valor ya guardado, no solo
    // contra lo que vino en este payload.
    const effectiveFrom = input.effectiveFrom ?? before.effectiveFrom;
    const effectiveTo = input.effectiveTo !== undefined ? input.effectiveTo : before.effectiveTo;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new AppError("effectiveTo no puede ser anterior a effectiveFrom", 400, "SHIFT_ASSIGNMENT_INVALID_RANGE");
    }

    let action: "UPDATE" | "ACTIVATE" | "DEACTIVATE" = "UPDATE";
    if (input.status && input.status !== before.status) {
      data.status = input.status;
      if (input.status === "DESHABILITADO") {
        data.disabledAt = new Date();
        data.disabledByUserId = user.id;
        action = "DEACTIVATE";
      } else {
        data.disabledAt = null;
        data.disabledByUserId = null;
        data.assignedAt = new Date();
        data.assignedByUserId = user.id;
        action = "ACTIVATE";
      }
    }

    // Sólo la observación no cambia la jornada esperada.
    const affectsWorkday = data.status !== undefined || data.effectiveFrom !== undefined || data.effectiveTo !== undefined || data.weekdays !== undefined;
    const { item, coverage } = await execute(() => prisma.$transaction(async (tx) => {
      if (affectsWorkday) await lockEmployeeCoverage(tx, [before.employeeId]);
      const resultingStatus = input.status ?? before.status;
      if (affectsWorkday && resultingStatus === "HABILITADO") {
        await assertFixedAssignmentsCompatibleWithRotations(tx, [{
          employeeId: before.employeeId,
          employee: formatEmployeeReference(before.employee),
          effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
          effectiveTo: effectiveTo?.toISOString().slice(0, 10) ?? null,
          weekdays: input.weekdays ?? before.weekdays,
          template: before.shiftTemplate,
        }]);
      }
      const updated = await shiftAssignmentRepository.update(id, data, tx);
      const window = affectsWorkday ? coverageWindowOf([{ from: before.effectiveFrom, to: before.effectiveTo }, { from: updated.effectiveFrom, to: updated.effectiveTo }]) : null;
      const recalculated = window
        ? await recalculateNoveltyCoverage(tx, { employeeIds: [before.employeeId], ...window }, { source: "SHIFT_ASSIGNMENT_CHANGED", label: `cambio del turno ${describeShift(updated.shiftTemplate)} del legajo ${updated.employee.legajo}` })
        : null;
      return { item: updated, coverage: recalculated };
    }, SHIFT_ASSIGNMENT_TRANSACTION_OPTIONS));
    // Etapa 10B: entityId=employeeId (no id, el id de la asignación), mismo
    // criterio que assign() arriba.
    await auditService.register({
      ...audit,
      action,
      entity: "ShiftAssignment",
      entityId: before.employeeId,
      description: `Se ${action === "DEACTIVATE" ? "deshabilitó" : action === "ACTIVATE" ? "habilitó" : "actualizó"} el turno ${describeShift(item.shiftTemplate)} para el empleado ${item.employee.legajo}.`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as unknown as Prisma.InputJsonValue,
    });
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    return item;
  },

  async remove(id: string, audit?: AuditContext) {
    const before = await shiftAssignmentRepository.findById(id);
    if (!before) throw new AppError("No encontramos la asignación solicitada", 404, "SHIFT_ASSIGNMENT_NOT_FOUND");
    const coverage = await execute(() => prisma.$transaction(async (tx) => {
      await lockEmployeeCoverage(tx, [before.employeeId]);
      await shiftAssignmentRepository.remove(id, tx);
      return recalculateNoveltyCoverage(
        tx,
        { employeeIds: [before.employeeId], from: before.effectiveFrom, to: before.effectiveTo },
        { source: "SHIFT_ASSIGNMENT_CHANGED", label: `baja del turno ${describeShift(before.shiftTemplate)} del legajo ${before.employee.legajo}` },
      );
    }, SHIFT_ASSIGNMENT_TRANSACTION_OPTIONS));
    // Etapa 10B: entityId=employeeId, mismo criterio que assign()/update() arriba.
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "ShiftAssignment",
      entityId: before.employeeId,
      description: `Se quitó la asociación del turno ${describeShift(before.shiftTemplate)} con el empleado ${before.employee.legajo}.`,
      before: before as unknown as Prisma.InputJsonValue,
    });
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return { id };
  },
};
