import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { shiftAlertRepository } from "./shiftAlert.repository";
import type { ListShiftAlertsQuery, ResolveShiftAlertInput } from "./shiftAlert.schemas";

export const shiftAlertService = {
  async list(query: ListShiftAlertsQuery, user: Express.AuthUser) {
    const { items, total } = await shiftAlertRepository.findMany(query, employeeAccessWhere(user));
    const hasMore = items.length > query.take;
    const trimmed = hasMore ? items.slice(0, query.take) : items;
    return {
      items: trimmed,
      meta: {
        total,
        pageSize: query.take,
        hasMore,
        nextBefore: trimmed.length ? trimmed[trimmed.length - 1]!.createdAt.toISOString() : null,
      },
    };
  },

  async resolve(id: string, input: ResolveShiftAlertInput, user: Express.AuthUser, audit?: AuditContext) {
    const before = await shiftAlertRepository.findById(id, employeeAccessWhere(user));
    if (!before) throw new AppError("No encontramos la alerta solicitada", 404, "SHIFT_ALERT_NOT_FOUND");
    if (before.status !== "PENDIENTE") throw new AppError("La alerta ya fue resuelta", 400, "SHIFT_ALERT_ALREADY_RESOLVED");
    const item = await shiftAlertRepository.resolve(id, input.resolution, input.reason, user.id);
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "ShiftAlert",
      entityId: id,
      description: `${input.resolution === "RESUELTA" ? "Se resolvió" : "Se descartó"} una alerta de turno para el legajo ${item.employee.legajo}. Motivo: ${input.reason}`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as unknown as Prisma.InputJsonValue,
    });
    return item;
  },
};
