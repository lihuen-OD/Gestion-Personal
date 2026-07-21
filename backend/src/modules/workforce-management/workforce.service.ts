import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";

async function ensureVisible(employeeIds: string[], user: Express.AuthUser) {
  const count = await prisma.employee.count({ where: { AND: [{ id: { in: employeeIds } }, employeeAccessWhere(user)] } });
  if (count !== new Set(employeeIds).size) throw new AppError("Uno o más legajos están fuera de tu alcance", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
}

export async function notifyUsers(userIds: string[], input: { type: string; title: string; message: string; entityType?: string; entityId?: string; link?: string; priority?: string }) {
  const recipients = Array.from(new Set(userIds.filter(Boolean)));
  if (!recipients.length) return;
  await prisma.systemNotification.createMany({ data: recipients.map((recipientUserId) => ({ recipientUserId, ...input })) });
}

export async function notifyRrhh(input: Parameters<typeof notifyUsers>[1]) {
  const users = await prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  await notifyUsers(users.map((item) => item.id), input);
}

async function attendanceRecipients(employeeId: string) {
  const [rrhh, responsible] = await Promise.all([
    prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } }),
    prisma.employeeAssignment.findMany({
      where: { employeeId, type: "TIME_RESPONSIBLE", userId: { not: null }, OR: [{ status: null }, { status: { in: ["ACTIVO", "Activo"] } }] },
      select: { userId: true },
    }),
  ]);
  return [...rrhh.map((item) => item.id), ...responsible.flatMap((item) => item.userId ? [item.userId] : [])];
}

function scheduledDate(actual: Date, time: string, addDay = false) {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(actual);
  result.setHours(hours || 0, minutes || 0, 0, 0);
  if (addDay) result.setDate(result.getDate() + 1);
  return result;
}

async function createShiftAlert(input: { employeeId: string; workShiftId: string; type: "INGRESO_TARDE" | "SALIDA_ANTICIPADA" | "SALIDA_TARDIA" | "TURNO_NO_IDENTIFICADO"; scheduledAt?: Date; actualAt: Date; differenceMinutes?: number }) {
  const alert = await prisma.shiftAlert.upsert({
    where: { workShiftId_type: { workShiftId: input.workShiftId, type: input.type } },
    create: input,
    update: { actualAt: input.actualAt, scheduledAt: input.scheduledAt, differenceMinutes: input.differenceMinutes, status: "PENDIENTE" },
  });
  const labels = { INGRESO_TARDE: "Ingreso fuera de tolerancia", SALIDA_ANTICIPADA: "Salida anticipada", SALIDA_TARDIA: "Salida fuera de tolerancia", TURNO_NO_IDENTIFICADO: "Turno no identificado" };
  await notifyUsers(await attendanceRecipients(input.employeeId), { type: "ALERTA_FICHADA", title: labels[input.type], message: "La fichada requiere seguimiento. Las horas no fueron modificadas automáticamente.", entityType: "ShiftAlert", entityId: alert.id, link: "/asistencia", priority: "ALTA" });
  return alert;
}

export async function evaluateShiftEntry(employeeId: string, workShiftId: string, actualAt: Date) {
  const templates = await prisma.shiftTemplate.findMany({ where: { status: "ACTIVO" } });
  const matches = templates.map((template) => {
    const scheduledAt = scheduledDate(actualAt, template.startTime);
    return { template, scheduledAt, difference: Math.round((actualAt.getTime() - scheduledAt.getTime()) / 60_000) };
  }).filter((item) => Math.abs(item.difference) <= item.template.detectionWindowMinutes).sort((a, b) => Math.abs(a.difference) - Math.abs(b.difference));
  const match = matches[0];
  if (!match) return createShiftAlert({ employeeId, workShiftId, type: "TURNO_NO_IDENTIFICADO", actualAt });
  await prisma.workShift.update({ where: { id: workShiftId }, data: { shiftTemplateId: match.template.id } });
  if (match.difference > match.template.entryToleranceMinutes) await createShiftAlert({ employeeId, workShiftId, type: "INGRESO_TARDE", actualAt, scheduledAt: match.scheduledAt, differenceMinutes: match.difference });
}

export async function evaluateShiftExit(employeeId: string, workShiftId: string, actualAt: Date) {
  const shift = await prisma.workShift.findUnique({ where: { id: workShiftId }, include: { shiftTemplate: true } });
  if (!shift?.shiftTemplate) return;
  const scheduledAt = scheduledDate(shift.startAt, shift.shiftTemplate.endTime, shift.shiftTemplate.crossesMidnight);
  const difference = Math.round((actualAt.getTime() - scheduledAt.getTime()) / 60_000);
  if (difference < -shift.shiftTemplate.exitToleranceMinutes) await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_ANTICIPADA", actualAt, scheduledAt, differenceMinutes: difference });
  if (difference > shift.shiftTemplate.exitToleranceMinutes) await createShiftAlert({ employeeId, workShiftId, type: "SALIDA_TARDIA", actualAt, scheduledAt, differenceMinutes: difference });
}

function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(year!, month! - 1, 1)), end: new Date(Date.UTC(year!, month!, 1)) };
}

export const workforceService = {
  async closures(period: string, user: Express.AuthUser) {
    return prisma.monthlyTimeClosure.findMany({ where: { period, employee: employeeAccessWhere(user) }, include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } }, submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } }, orderBy: { employee: { lastName: "asc" } } });
  },
  async submitClosures(period: string, employeeIds: string[], user: Express.AuthUser) {
    if (user.role === roles.rrhh) throw new AppError("RH no envía cierres para aprobación", 400, "CLOSURE_SUBMIT_ROLE_INVALID");
    await ensureVisible(employeeIds, user);
    const range = periodRange(period);
    const rows = await prisma.timeEntry.groupBy({ by: ["employeeId", "status"], where: { employeeId: { in: employeeIds }, period }, _sum: { hours: true }, _count: true });
    const snapshots = new Map(employeeIds.map((id) => [id, rows.filter((row) => row.employeeId === id).map((row) => ({ status: row.status, hours: Number(row._sum.hours || 0), records: row._count }))]));
    const result = await prisma.$transaction(employeeIds.map((employeeId) => prisma.monthlyTimeClosure.upsert({ where: { employeeId_period: { employeeId, period } }, create: { employeeId, period, status: "ENVIADO", snapshot: { range, entries: snapshots.get(employeeId) } as Prisma.InputJsonValue, submittedByUserId: user.id, submittedAt: new Date() }, update: { status: "ENVIADO", snapshot: { range, entries: snapshots.get(employeeId) } as Prisma.InputJsonValue, submittedByUserId: user.id, submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null, reviewNote: null } })));
    await notifyRrhh({ type: "CIERRE_MENSUAL", title: "Cierres mensuales recibidos", message: `${result.length} legajos de ${period} esperan aprobación.`, link: `/cierres?period=${period}`, priority: "ALTA" });
    return result;
  },
  async approveClosures(ids: string[], note: string | undefined, user: Express.AuthUser) {
    const result = await prisma.monthlyTimeClosure.updateMany({ where: { id: { in: ids }, status: "ENVIADO" }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } });
    return result;
  },
  returnClosure(id: string, reason: string, user: Express.AuthUser) {
    return prisma.monthlyTimeClosure.update({ where: { id }, data: { status: "DEVUELTO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: reason } });
  },
  async createCorrection(input: { timeEntryId: string; proposedHours: number; reason: string }, user: Express.AuthUser) {
    const entry = await prisma.timeEntry.findFirst({ where: { id: input.timeEntryId, employee: employeeAccessWhere(user) } });
    if (!entry) throw new AppError("Carga horaria no encontrada", 404, "TIME_ENTRY_NOT_FOUND");
    const closure = await prisma.monthlyTimeClosure.findUnique({ where: { employeeId_period: { employeeId: entry.employeeId, period: entry.period } } });
    if (!closure || !["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"].includes(closure.status)) throw new AppError("El período todavía permite edición directa", 400, "PERIOD_NOT_CLOSED");
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.create({ data: { employeeId: entry.employeeId, timeEntryId: entry.id, closureId: closure.id, previousHours: entry.hours, proposedHours: input.proposedHours, reason: input.reason, createdByUserId: user.id } });
      await tx.monthlyTimeClosure.update({ where: { id: closure.id }, data: { status: "CORRECCION_PENDIENTE" } });
      return request;
    });
    await notifyRrhh({ type: "CORRECCION_HORARIA", title: "Corrección posterior al cierre", message: `Se solicitó modificar una carga de ${entry.period}.`, entityType: "TimeCorrectionRequest", entityId: result.id, link: "/cierres", priority: "ALTA" });
    return result;
  },
  corrections(user: Express.AuthUser) { return prisma.timeCorrectionRequest.findMany({ where: { employee: employeeAccessWhere(user) }, include: { employee: { select: { legajo: true, firstName: true, lastName: true } }, timeEntry: { include: { hourConcept: true } }, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 500 }); },
  async approveCorrection(id: string, user: Express.AuthUser) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.findUniqueOrThrow({ where: { id } });
      if (request.status !== "PENDIENTE") throw new AppError("La corrección ya fue revisada", 400, "CORRECTION_ALREADY_REVIEWED");
      const hours = Number(request.proposedHours);
      await tx.timeEntry.update({ where: { id: request.timeEntryId }, data: { hours, totalMinutes: Math.round(hours * 60), approvedByUserId: user.id, approvedAt: new Date() } });
      const updated = await tx.timeCorrectionRequest.update({ where: { id }, data: { status: "APROBADA", reviewedByUserId: user.id, reviewedAt: new Date() } });
      if (request.closureId) await tx.monthlyTimeClosure.update({ where: { id: request.closureId }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date() } });
      return updated;
    });
  },
  rejectCorrection(id: string, note: string | undefined, user: Express.AuthUser) { return prisma.timeCorrectionRequest.update({ where: { id }, data: { status: "RECHAZADA", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } }); },
  async notifications(user: Express.AuthUser) {
    const notifications = await prisma.systemNotification.findMany({ where: { recipientUserId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
    const shiftAlertIds = notifications.filter((item) => item.entityType === "ShiftAlert" && item.entityId).map((item) => item.entityId!);
    if (!shiftAlertIds.length) return notifications;
    const alerts = await prisma.shiftAlert.findMany({
      where: { id: { in: shiftAlertIds } },
      select: { id: true, employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } },
    });
    const employeeByAlert = new Map(alerts.map((alert) => [alert.id, alert.employee]));
    return notifications.map((item) => ({ ...item, employee: item.entityId ? employeeByAlert.get(item.entityId) : undefined }));
  },
  unreadNotificationCount(user: Express.AuthUser) { return prisma.systemNotification.count({ where: { recipientUserId: user.id, status: "NO_LEIDA" } }); },
  markNotificationRead(id: string, user: Express.AuthUser) { return prisma.systemNotification.updateMany({ where: { id, recipientUserId: user.id }, data: { status: "LEIDA", readAt: new Date() } }); },
  shiftTemplates() { return prisma.shiftTemplate.findMany({ orderBy: { startTime: "asc" } }); },
  async createShiftTemplate(input: any, audit?: AuditContext) {
    const item = await prisma.shiftTemplate.create({ data: { ...input, crossesMidnight: input.endTime <= input.startTime } });
    await auditService.register({ ...audit, action: "CREATE", entity: "ShiftTemplate", entityId: item.id, description: `Se creó el turno ${item.code} - ${item.name}.`, after: item as Prisma.InputJsonValue });
    return item;
  },
  async updateShiftTemplate(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!before) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
    const startTime = input.startTime ?? before.startTime;
    const endTime = input.endTime ?? before.endTime;
    const item = await prisma.shiftTemplate.update({ where: { id }, data: { ...input, crossesMidnight: endTime <= startTime } });
    await auditService.register({
      ...audit,
      action: input.status && input.status !== before.status ? input.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE" : "UPDATE",
      entity: "ShiftTemplate",
      entityId: id,
      description: `Se actualizó el turno ${item.code} - ${item.name}.`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
  async removeShiftTemplate(id: string, audit?: AuditContext) {
    const before = await prisma.shiftTemplate.findUnique({ where: { id }, include: { _count: { select: { workShifts: true } } } });
    if (!before) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
    if (before._count.workShifts > 0) {
      const item = await prisma.shiftTemplate.update({ where: { id }, data: { status: "INACTIVO" } });
      await auditService.register({ ...audit, action: "DEACTIVATE", entity: "ShiftTemplate", entityId: id, description: `Se inactivó el turno ${before.code} porque tiene jornadas históricas asociadas.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
      return { mode: "INACTIVATED" as const, item, relatedWorkShifts: before._count.workShifts };
    }
    await prisma.shiftTemplate.delete({ where: { id } });
    await auditService.register({ ...audit, action: "DELETE", entity: "ShiftTemplate", entityId: id, description: `Se eliminó el turno sin uso ${before.code} - ${before.name}.`, before: before as Prisma.InputJsonValue });
    return { mode: "DELETED" as const, id, relatedWorkShifts: 0 };
  },
  doubleRules() { return prisma.doubleHourRule.findMany({ include: { employees: { include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } } }, orderBy: { fromDate: "desc" } }); },
  async createDoubleRule(input: any, user: Express.AuthUser, audit?: AuditContext) {
    const { employeeIds, ...data } = input;
    const item = await prisma.doubleHourRule.create({ data: { ...data, createdByUserId: user.id, employees: { create: employeeIds.map((employeeId: string) => ({ employeeId })) } }, include: { employees: true } });
    await auditService.register({ ...audit, action: "CREATE", entity: "DoubleHourRule", entityId: item.id, description: `Se creó la regla de horas especiales ${item.name}.`, after: item as Prisma.InputJsonValue });
    return item;
  },
  async updateDoubleRule(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const { employeeIds, ...data } = input;
    const item = await prisma.doubleHourRule.update({
      where: { id },
      data: {
        ...data,
        ...(employeeIds ? { employees: { deleteMany: {}, create: employeeIds.map((employeeId: string) => ({ employeeId })) } } : {}),
      },
      include: { employees: { include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } } },
    });
    await auditService.register({ ...audit, action: "UPDATE", entity: "DoubleHourRule", entityId: id, description: `Se actualizó la regla de horas especiales ${item.name}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  async removeDoubleRule(id: string, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const hasStarted = before.fromDate <= new Date();
    if (hasStarted) {
      const item = await prisma.doubleHourRule.update({ where: { id }, data: { status: "INACTIVO" }, include: { employees: true } });
      await auditService.register({ ...audit, action: "DEACTIVATE", entity: "DoubleHourRule", entityId: id, description: `Se inactivó la regla ${before.name} porque su vigencia ya había comenzado.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
      return { mode: "INACTIVATED" as const, item };
    }
    await prisma.doubleHourRule.delete({ where: { id } });
    await auditService.register({ ...audit, action: "DELETE", entity: "DoubleHourRule", entityId: id, description: `Se eliminó la regla futura ${before.name}.`, before: before as Prisma.InputJsonValue });
    return { mode: "DELETED" as const, id };
  },
};
