import { Prisma, type DoubleHourRuleKind } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { argentinaCalendarDate, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate, scopesCouldOverlap } from "./doubleHourRuleMatching";
import type { ListNotificationsQuery } from "./workforce.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      throw new AppError("Related employee, shift template, rule or user not found", 400, "RELATION_CONSTRAINT");
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

export async function attendanceRecipients(employeeId: string) {
  const [rrhh, responsible] = await Promise.all([
    prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } }),
    prisma.employeeAssignment.findMany({
      where: { employeeId, type: "TIME_RESPONSIBLE", userId: { not: null }, OR: [{ status: null }, { status: { in: ["ACTIVO", "Activo"] } }] },
      select: { userId: true },
    }),
  ]);
  return [...rrhh.map((item) => item.id), ...responsible.flatMap((item) => item.userId ? [item.userId] : [])];
}

function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function computeExpectedMinutes(startTime: string, endTime: string, crossesMidnight: boolean) {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  return crossesMidnight ? 24 * 60 - start + end : end - start;
}

function periodRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(year!, month! - 1, 1)), end: new Date(Date.UTC(year!, month!, 1)) };
}

// Etapa 8B: para recurrenceType FECHA, fromDate/toDate ya no son la
// condición de matching (eso vive en `dates`) — pero siguen siendo columnas
// NOT NULL usadas como pre-filtro de vigencia grueso antes de evaluar
// ruleMatchesDate (ver timeEntries.repository.ts). Se derivan acá,
// server-side, como min/max de TODAS las fechas configuradas (activas o no)
// para que ese pre-filtro nunca excluya una fecha real por error — nunca se
// confía en lo que mande el cliente para estas dos columnas en una regla
// FECHA.
function fechaVigencyFromDates(dates: Array<{ date: Date }>) {
  const timestamps = dates.map((entry) => new Date(entry.date).getTime());
  return { fromDate: new Date(Math.min(...timestamps)), toDate: new Date(Math.max(...timestamps)) };
}

export const workforceService = {
  async closures(period: string, user: Express.AuthUser) {
    return prisma.monthlyTimeClosure.findMany({ where: { period, employee: employeeAccessWhere(user) }, include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } }, submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } }, orderBy: { employee: { lastName: "asc" } } });
  },
  async submitClosures(period: string, employeeIds: string[], user: Express.AuthUser, audit?: AuditContext) {
    if (user.role === roles.rrhh) throw new AppError("RH no envía cierres para aprobación", 400, "CLOSURE_SUBMIT_ROLE_INVALID");
    await ensureVisible(employeeIds, user);
    const range = periodRange(period);
    // Etapa 6M: el snapshot de cierre sólo captura Horas normales/base — los
    // conceptos adicionales viven en HourConceptBreakdown, fuera de este
    // groupBy. El snapshot es sólo auditoría (nadie lo vuelve a leer hoy).
    const rows = await prisma.timeEntry.groupBy({
      by: ["employeeId", "status"],
      where: { employeeId: { in: employeeIds }, period, hourConcept: { systemRole: "NORMAL_BASE" } },
      _sum: { hours: true },
      _count: true,
    });
    const snapshots = new Map(employeeIds.map((id) => [id, rows.filter((row) => row.employeeId === id).map((row) => ({ status: row.status, hours: Number(row._sum.hours || 0), records: row._count }))]));
    const result = await execute(() => prisma.$transaction(employeeIds.map((employeeId) => prisma.monthlyTimeClosure.upsert({ where: { employeeId_period: { employeeId, period } }, create: { employeeId, period, status: "ENVIADO", snapshot: { range, entries: snapshots.get(employeeId) } as Prisma.InputJsonValue, submittedByUserId: user.id, submittedAt: new Date() }, update: { status: "ENVIADO", snapshot: { range, entries: snapshots.get(employeeId) } as Prisma.InputJsonValue, submittedByUserId: user.id, submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null, reviewNote: null } }))));
    await Promise.all(result.map((item) => auditService.register({ ...audit, action: "UPDATE", entity: "MonthlyTimeClosure", entityId: item.id, description: `Se envió a revisión el cierre de ${period} (legajo ${item.employeeId}).`, after: item as Prisma.InputJsonValue })));
    await notifyRrhh({ type: "CIERRE_MENSUAL", title: "Cierres mensuales recibidos", message: `${result.length} legajos de ${period} esperan aprobación.`, link: `/cierres?period=${period}`, priority: "ALTA" });
    return result;
  },
  async approveClosures(ids: string[], note: string | undefined, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.monthlyTimeClosure.findMany({ where: { id: { in: ids }, status: "ENVIADO" } });
    const result = await execute(() => prisma.monthlyTimeClosure.updateMany({ where: { id: { in: ids }, status: "ENVIADO" }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } }));
    await Promise.all(before.map((item) => auditService.register({ ...audit, action: "APPROVE", entity: "MonthlyTimeClosure", entityId: item.id, description: `Se aprobó el cierre de ${item.period} (legajo ${item.employeeId}).`, before: item as Prisma.InputJsonValue })));
    return result;
  },
  async returnClosure(id: string, reason: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.monthlyTimeClosure.findUnique({ where: { id } });
    if (!before) throw new AppError("No encontramos el cierre solicitado", 404, "MONTHLY_CLOSURE_NOT_FOUND");
    const item = await execute(() => prisma.monthlyTimeClosure.update({ where: { id }, data: { status: "DEVUELTO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: reason } }));
    await auditService.register({ ...audit, action: "RETURN", entity: "MonthlyTimeClosure", entityId: id, description: `Se devolvió el cierre de ${item.period} (legajo ${item.employeeId}) — motivo: ${reason}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  async createCorrection(input: { timeEntryId: string; proposedHours: number; reason: string }, user: Express.AuthUser, audit?: AuditContext) {
    const entry = await prisma.timeEntry.findFirst({ where: { id: input.timeEntryId, employee: employeeAccessWhere(user) } });
    if (!entry) throw new AppError("Carga horaria no encontrada", 404, "TIME_ENTRY_NOT_FOUND");
    const closure = await prisma.monthlyTimeClosure.findUnique({ where: { employeeId_period: { employeeId: entry.employeeId, period: entry.period } } });
    if (!closure || !["ENVIADO", "APROBADO", "CORRECCION_PENDIENTE"].includes(closure.status)) throw new AppError("El período todavía permite edición directa", 400, "PERIOD_NOT_CLOSED");
    const result = await execute(() => prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.create({ data: { employeeId: entry.employeeId, timeEntryId: entry.id, closureId: closure.id, previousHours: entry.hours, proposedHours: input.proposedHours, reason: input.reason, createdByUserId: user.id } });
      await tx.monthlyTimeClosure.update({ where: { id: closure.id }, data: { status: "CORRECCION_PENDIENTE" } });
      return request;
    }));
    await auditService.register({ ...audit, action: "CREATE", entity: "TimeCorrectionRequest", entityId: result.id, description: `Se solicitó una corrección de carga horaria de ${entry.period} (legajo ${entry.employeeId}, de ${entry.hours}h a ${input.proposedHours}h).`, after: result as Prisma.InputJsonValue });
    await notifyRrhh({ type: "CORRECCION_HORARIA", title: "Corrección posterior al cierre", message: `Se solicitó modificar una carga de ${entry.period}.`, entityType: "TimeCorrectionRequest", entityId: result.id, link: "/cierres", priority: "ALTA" });
    return result;
  },
  corrections(user: Express.AuthUser) { return prisma.timeCorrectionRequest.findMany({ where: { employee: employeeAccessWhere(user) }, include: { employee: { select: { legajo: true, firstName: true, lastName: true } }, timeEntry: { include: { hourConcept: true } }, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 500 }); },
  async approveCorrection(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const { before, after } = await execute(() => prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.findUniqueOrThrow({ where: { id } });
      if (request.status !== "PENDIENTE") throw new AppError("La corrección ya fue revisada", 400, "CORRECTION_ALREADY_REVIEWED");
      const hours = Number(request.proposedHours);
      await tx.timeEntry.update({ where: { id: request.timeEntryId }, data: { hours, totalMinutes: Math.round(hours * 60), approvedByUserId: user.id, approvedAt: new Date() } });
      const updated = await tx.timeCorrectionRequest.update({ where: { id }, data: { status: "APROBADA", reviewedByUserId: user.id, reviewedAt: new Date() } });
      if (request.closureId) await tx.monthlyTimeClosure.update({ where: { id: request.closureId }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date() } });
      return { before: request, after: updated };
    }));
    await auditService.register({ ...audit, action: "APPROVE", entity: "TimeCorrectionRequest", entityId: id, description: `Se aprobó la corrección de carga horaria (legajo ${before.employeeId}, de ${before.previousHours}h a ${before.proposedHours}h).`, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue });
    return after;
  },
  async rejectCorrection(id: string, note: string | undefined, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.timeCorrectionRequest.findUnique({ where: { id } });
    if (!before) throw new AppError("No encontramos la corrección solicitada", 404, "TIME_CORRECTION_NOT_FOUND");
    const item = await execute(() => prisma.timeCorrectionRequest.update({ where: { id }, data: { status: "RECHAZADA", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } }));
    await auditService.register({ ...audit, action: "REJECT", entity: "TimeCorrectionRequest", entityId: id, description: `Se rechazó la corrección de carga horaria (legajo ${before.employeeId}).`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  // Etapa 9I: antes hacía fetch-all con take:200 fijo, sin paginación real.
  // Ahora pagina por page/take real (mismo patrón $transaction([findMany,count])
  // que noveltiesRepository/positions.repository) y filtra por status
  // server-side. Deliberadamente sin cache: los write paths de
  // SystemNotification están dispersos en 5+ módulos (novelties/
  // workforce-management/time-entries/shifts/attendance, todos vía
  // notifyUsers/notifyRrhh o creación directa) — no es un conjunto cerrado y
  // enumerable con confianza (criterio de docs/PERFORMANCE_STANDARDS.md §5),
  // así que queda sin cachear, igual que closures() en 9C.
  async notifications(query: ListNotificationsQuery, user: Express.AuthUser) {
    const where: Prisma.SystemNotificationWhereInput = { recipientUserId: user.id, ...(query.status ? { status: query.status } : {}) };
    const skip = (query.page - 1) * query.take;
    const [notifications, total] = await prisma.$transaction([
      prisma.systemNotification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: query.take }),
      prisma.systemNotification.count({ where }),
    ]);
    const shiftAlertIds = notifications.filter((item) => item.entityType === "ShiftAlert" && item.entityId).map((item) => item.entityId!);
    const workShiftIds = notifications.filter((item) => item.entityType === "WorkShift" && item.entityId).map((item) => item.entityId!);
    const employeeIds = notifications.filter((item) => item.entityType === "Employee" && item.entityId).map((item) => item.entityId!);
    const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true } as const;
    const [alerts, shifts, employees] = shiftAlertIds.length || workShiftIds.length || employeeIds.length
      ? await Promise.all([
          shiftAlertIds.length ? prisma.shiftAlert.findMany({ where: { id: { in: shiftAlertIds } }, select: { id: true, employee: { select: employeeSelect } } }) : Promise.resolve([]),
          workShiftIds.length ? prisma.workShift.findMany({ where: { id: { in: workShiftIds } }, select: { id: true, employee: { select: employeeSelect } } }) : Promise.resolve([]),
          employeeIds.length ? prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: employeeSelect }) : Promise.resolve([]),
        ])
      : [[], [], []];
    const employeeByAlert = new Map(alerts.map((alert) => [alert.id, alert.employee]));
    const employeeByShift = new Map(shifts.map((shift) => [shift.id, shift.employee]));
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const items = notifications.map((item) => {
      if (!item.entityId) return item;
      if (item.entityType === "ShiftAlert") return { ...item, employee: employeeByAlert.get(item.entityId) };
      if (item.entityType === "WorkShift") return { ...item, employee: employeeByShift.get(item.entityId) };
      if (item.entityType === "Employee") return { ...item, employee: employeeById.get(item.entityId) };
      return item;
    });
    return { items, meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },
  unreadNotificationCount(user: Express.AuthUser) { return prisma.systemNotification.count({ where: { recipientUserId: user.id, status: "NO_LEIDA" } }); },
  markNotificationRead(id: string, user: Express.AuthUser) { return prisma.systemNotification.updateMany({ where: { id, recipientUserId: user.id }, data: { status: "LEIDA", readAt: new Date() } }); },
  shiftTemplates() { return prisma.shiftTemplate.findMany({ orderBy: { startTime: "asc" } }); },
  async createShiftTemplate(input: any, audit?: AuditContext) {
    const crossesMidnight = input.endTime <= input.startTime;
    const item = await execute(() => prisma.shiftTemplate.create({
      data: {
        ...input,
        crossesMidnight,
        expectedMinutes: computeExpectedMinutes(input.startTime, input.endTime, crossesMidnight),
        createdByUserId: audit?.userId || null,
        updatedByUserId: audit?.userId || null,
      },
    }));
    await auditService.register({ ...audit, action: "CREATE", entity: "ShiftTemplate", entityId: item.id, description: `Se creó el turno ${item.code} - ${item.name}.`, after: item as Prisma.InputJsonValue });
    return item;
  },
  async updateShiftTemplate(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.shiftTemplate.findUnique({ where: { id } });
    if (!before) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
    const startTime = input.startTime ?? before.startTime;
    const endTime = input.endTime ?? before.endTime;
    const crossesMidnight = endTime <= startTime;
    const item = await execute(() => prisma.shiftTemplate.update({
      where: { id },
      data: {
        ...input,
        crossesMidnight,
        expectedMinutes: computeExpectedMinutes(startTime, endTime, crossesMidnight),
        updatedByUserId: audit?.userId || null,
      },
    }));
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
    const before = await prisma.shiftTemplate.findUnique({ where: { id }, include: { _count: { select: { workShifts: true, assignments: true } } } });
    if (!before) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
    if (before._count.workShifts > 0) {
      const item = await prisma.shiftTemplate.update({ where: { id }, data: { status: "INACTIVO" } });
      await auditService.register({ ...audit, action: "DEACTIVATE", entity: "ShiftTemplate", entityId: id, description: `Se inactivó el turno ${before.code} porque tiene jornadas históricas asociadas.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
      return { mode: "INACTIVATED" as const, item, relatedWorkShifts: before._count.workShifts };
    }
    if (before._count.assignments > 0) {
      throw new AppError("No se puede eliminar el turno porque tiene asignaciones de empleados asociadas", 409, "SHIFT_TEMPLATE_HAS_ASSIGNMENTS");
    }
    await prisma.shiftTemplate.delete({ where: { id } });
    await auditService.register({ ...audit, action: "DELETE", entity: "ShiftTemplate", entityId: id, description: `Se eliminó el turno sin uso ${before.code} - ${before.name}.`, before: before as Prisma.InputJsonValue });
    return { mode: "DELETED" as const, id, relatedWorkShifts: 0 };
  },
  // Etapa 8B: se agregan dates (calendario FECHA) y los 4 nombres de scope
  // (empresa/sector/centro de costo/puesto) para que el frontend no necesite
  // otra consulta para mostrarlos.
  doubleRules() {
    return prisma.doubleHourRule.findMany({
      include: {
        employees: { include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } },
        dates: { orderBy: { date: "asc" } },
        company: { select: { id: true, name: true } },
        sector: { select: { id: true, name: true } },
        costCenter: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
      orderBy: { fromDate: "desc" },
    });
  },
  async createDoubleRule(input: any, user: Express.AuthUser, audit?: AuditContext) {
    const { employeeIds, dates, ...data } = input;
    const item = await execute(() => prisma.doubleHourRule.create({
      data: {
        ...data,
        ...(data.recurrenceType === "FECHA" && dates?.length ? fechaVigencyFromDates(dates) : {}),
        createdByUserId: user.id,
        employees: { create: employeeIds.map((employeeId: string) => ({ employeeId })) },
        ...(dates ? { dates: { create: dates.map((entry: { date: Date; isActive?: boolean }) => ({ date: entry.date, isActive: entry.isActive ?? true })) } } : {}),
      },
      include: { employees: true, dates: true },
    }));
    await auditService.register({ ...audit, action: "CREATE", entity: "DoubleHourRule", entityId: item.id, description: `Se creó la regla de horas especiales ${item.name}.`, after: item as Prisma.InputJsonValue });
    return item;
  },
  async updateDoubleRule(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true, dates: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const { employeeIds, dates, ...data } = input;
    const recurrenceType = data.recurrenceType ?? before.recurrenceType;
    const item = await prisma.doubleHourRule.update({
      where: { id },
      data: {
        ...data,
        ...(recurrenceType === "FECHA" && dates?.length ? fechaVigencyFromDates(dates) : {}),
        ...(employeeIds ? { employees: { deleteMany: {}, create: employeeIds.map((employeeId: string) => ({ employeeId })) } } : {}),
        ...(dates ? { dates: { deleteMany: {}, create: dates.map((entry: { date: Date; isActive?: boolean }) => ({ date: entry.date, isActive: entry.isActive ?? true })) } } : {}),
      },
      include: {
        employees: { include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } } } },
        dates: { orderBy: { date: "asc" } },
        company: { select: { id: true, name: true } },
        sector: { select: { id: true, name: true } },
        costCenter: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    });
    await auditService.register({ ...audit, action: "UPDATE", entity: "DoubleHourRule", entityId: id, description: `Se actualizó la regla de horas especiales ${item.name}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  // Etapa 8B: preview de calendario — de sólo configuración (no depende de
  // fichadas reales). Para cada fecha del rango, qué reglas ACTIVAS matchean
  // por calendario (ruleMatchesDate) y si sus alcances podrían superponerse
  // (scopesCouldOverlap, heurístico) con prioridad empatada entre las que sí
  // podrían superponerse (resolveWinningRules) — es una alerta de
  // configuración para RRHH, no la resolución real por empleado, que sólo
  // ocurre en el motor al fichar.
  // Etapa 12B: `kind` opcional filtra por clasificación estructurada (nunca
  // por nombre) — sin pasarlo, comportamiento idéntico al de antes de esta
  // etapa. Es el filtro que consumiría a futuro la pantalla de asignaciones
  // de feriado de Turnos (kind="FERIADO"), sin duplicar este cálculo.
  async calendarPreview(from: Date, to: Date, kind?: DoubleHourRuleKind) {
    const rules = await prisma.doubleHourRule.findMany({
      where: { status: "ACTIVO", fromDate: { lte: to }, OR: [{ toDate: null }, { toDate: { gte: from } }], ...(kind ? { kind } : {}) },
      include: { employees: { select: { employeeId: true } }, dates: true },
    });
    const activeDatesByRule = buildActiveDatesByRule(rules);
    const days: Array<{ date: string; rules: Array<{ id: string; name: string; priority: number; multiplier: number; kind: DoubleHourRuleKind }>; hasOverlap: boolean; hasConflict: boolean }> = [];
    for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + 86_400_000)) {
      const matched = rules.filter((rule) => ruleMatchesDate(rule, cursor, activeDatesByRule));
      if (!matched.length) continue;
      const scopes = matched.map((rule) => ({ companyId: rule.companyId, sectorId: rule.sectorId, costCenterId: rule.costCenterId, positionId: rule.positionId, employeeIds: rule.employees.map((item) => item.employeeId) }));
      let hasOverlap = false;
      for (let i = 0; i < matched.length && !hasOverlap; i++) {
        for (let j = i + 1; j < matched.length; j++) {
          if (scopesCouldOverlap(scopes[i]!, scopes[j]!)) { hasOverlap = true; break; }
        }
      }
      const overlappingRules = matched.filter((_, index) => matched.some((_other, otherIndex) => index !== otherIndex && scopesCouldOverlap(scopes[index]!, scopes[otherIndex]!)));
      const { conflicting } = resolveWinningRules(overlappingRules.length ? overlappingRules : matched);
      days.push({
        date: cursor.toISOString().slice(0, 10),
        rules: matched.map((rule) => ({ id: rule.id, name: rule.name, priority: rule.priority, multiplier: Number(rule.multiplier), kind: rule.kind })),
        hasOverlap,
        hasConflict: hasOverlap && conflicting,
      });
    }
    return days;
  },
  async removeDoubleRule(id: string, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const today = argentinaCalendarDate(todayArgentinaDateKey());
    const hasStarted = before.fromDate <= today;
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
