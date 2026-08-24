import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { shiftAssignmentRepository } from "./shiftAssignment.repository";
import type { CreateShiftAssignmentInput, ListShiftAssignmentsQuery, UpdateShiftAssignmentInput } from "./shiftAssignment.schemas";

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

  async assign(input: CreateShiftAssignmentInput, user: Express.AuthUser, audit?: AuditContext) {
    const template = await prisma.shiftTemplate.findUnique({ where: { id: input.shiftTemplateId } });
    if (!template) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");

    const employeeIds = Array.from(new Set(input.employeeIds));
    const existingEmployees = await prisma.employee.count({ where: { id: { in: employeeIds } } });
    if (existingEmployees !== employeeIds.length) throw new AppError("Uno o más empleados no existen", 404, "EMPLOYEE_NOT_FOUND");

    const results = [];
    for (const employeeId of employeeIds) {
      const existing = await shiftAssignmentRepository.findExisting(employeeId, input.shiftTemplateId);

      if (!existing) {
        const created = await execute(() =>
          shiftAssignmentRepository.create(
            employeeId,
            input.shiftTemplateId,
            { observation: input.observation, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, weekdays: input.weekdays },
            user.id,
          ),
        );
        await auditService.register({
          ...audit,
          action: "CREATE",
          entity: "ShiftAssignment",
          entityId: created.id,
          description: `Se asignó el turno ${describeShift(template)} al empleado ${created.employee.legajo}.`,
          after: created as unknown as Prisma.InputJsonValue,
        });
        results.push(created);
        continue;
      }

      if (existing.status === "DESHABILITADO") {
        const reenabled = await execute(() =>
          shiftAssignmentRepository.reEnable(
            existing.id,
            { observation: input.observation, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, weekdays: input.weekdays },
            user.id,
          ),
        );
        await auditService.register({
          ...audit,
          action: "ACTIVATE",
          entity: "ShiftAssignment",
          entityId: existing.id,
          description: `Se rehabilitó el turno ${describeShift(template)} para el empleado ${reenabled.employee.legajo}.`,
          before: existing as unknown as Prisma.InputJsonValue,
          after: reenabled as unknown as Prisma.InputJsonValue,
        });
        results.push(reenabled);
        continue;
      }

      results.push(await shiftAssignmentRepository.findById(existing.id));
    }

    return results;
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

    const item = await execute(() => shiftAssignmentRepository.update(id, data));
    await auditService.register({
      ...audit,
      action,
      entity: "ShiftAssignment",
      entityId: id,
      description: `Se ${action === "DEACTIVATE" ? "deshabilitó" : action === "ACTIVATE" ? "habilitó" : "actualizó"} el turno ${describeShift(item.shiftTemplate)} para el empleado ${item.employee.legajo}.`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as unknown as Prisma.InputJsonValue,
    });
    return item;
  },

  async remove(id: string, audit?: AuditContext) {
    const before = await shiftAssignmentRepository.findById(id);
    if (!before) throw new AppError("No encontramos la asignación solicitada", 404, "SHIFT_ASSIGNMENT_NOT_FOUND");
    await shiftAssignmentRepository.remove(id);
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "ShiftAssignment",
      entityId: id,
      description: `Se quitó la asociación del turno ${describeShift(before.shiftTemplate)} con el empleado ${before.employee.legajo}.`,
      before: before as unknown as Prisma.InputJsonValue,
    });
    return { id };
  },
};
