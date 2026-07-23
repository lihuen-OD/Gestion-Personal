import type { Prisma } from "@prisma/client";
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

export const shiftAssignmentService = {
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
        const created = await shiftAssignmentRepository.create(employeeId, input.shiftTemplateId, input.observation, user.id);
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
        const reenabled = await shiftAssignmentRepository.reEnable(existing.id, input.observation, user.id);
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

    const data: Prisma.ShiftAssignmentUpdateInput = {};
    if (input.observation !== undefined) data.observation = input.observation;

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

    const item = await shiftAssignmentRepository.update(id, data);
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
