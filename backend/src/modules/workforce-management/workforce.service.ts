import { Prisma, type DoubleHourRuleKind } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import { isMonthlyClosureLocked } from "../../shared/monthlyClosure/closureLock";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { humanizePeriodEs } from "../../shared/datetime/argentinaTime";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate, scopesCouldOverlap } from "./doubleHourRuleMatching";
import type { CorrectionsQuery, ListNotificationsQuery } from "./workforce.schemas";
import { buildClosureSnapshots } from "./closureSnapshot";
import { employeeReferenceSelect, formatEmployeeReference, loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { auditClosureRecalculations } from "./closureRecalculationAudit";
import { reinterpretSpecialHours, type RuleCalendar, type SpecialHourReinterpretation } from "./specialHourReinterpretation";
import { describeReinterpretation, reinterpretationMetadata } from "./specialHourReinterpretationSummary";
import { afterNotificationCursor, formatNotificationCursor, NOTIFICATION_ORDER_BY, notificationEventDateWhere, throughNotificationCursor } from "./notificationListing";

// Identidad humana para la descripción de auditoría (nunca el employeeId).
const employeeReferenceInclude = { employee: { select: employeeReferenceSelect } } as const;

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

// `eventAt`: fecha efectiva del hecho que origina la notificación, la pasa el
// productor que la conoce (ShiftAlert.actualAt, WorkShift.startAt, ...). Se
// persiste una sola vez y no se vuelve a derivar. Sin hecho propio se omite y
// la DB usa el mismo instante que createdAt (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md).
export async function notifyUsers(userIds: string[], input: { type: string; title: string; message: string; entityType?: string; entityId?: string; link?: string; priority?: string; eventAt?: Date }) {
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

// ── Reglas de Hora Especial: cambio + reinterpretación de la historia ──────
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15). Crear, editar,
// inactivar o eliminar una regla corre en la misma transacción que el
// recálculo de todo lo derivado: si el recálculo falla, la regla no cambia.
const SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS = { timeout: 30_000 };

type RuleForChange = RuleCalendar & { name: string; kind: DoubleHourRuleKind; multiplier: Prisma.Decimal | number; status: string };

function ruleCalendar(rule: RuleForChange): RuleCalendar {
  return { id: rule.id, recurrenceType: rule.recurrenceType, fromDate: rule.fromDate, toDate: rule.toDate, weekdays: rule.weekdays, dates: rule.dates };
}

const WEEKDAY_PLURALS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

function ruleNoun(rule: Pick<RuleForChange, "kind">) {
  return rule.kind === "FERIADO" ? "el feriado" : "la regla de horas especiales";
}

function formatMultiplierLabel(multiplier: Prisma.Decimal | number) {
  return `x${Number(multiplier)}`;
}

// Calendario en lenguaje de negocio: "03/10/2026", "los domingos desde 01/09/2026"...
function describeRuleSchedule(rule: RuleForChange) {
  if (rule.recurrenceType === "FECHA") {
    const dates = rule.dates.filter((entry) => entry.isActive).map((entry) => entry.date).sort((a, b) => a.getTime() - b.getTime());
    if (!dates.length) return "sin fechas activas";
    if (dates.length <= 3) return dates.map(formatArgentinaDate).join(", ");
    return `${dates.length} fechas del ${formatArgentinaDate(dates[0]!)} al ${formatArgentinaDate(dates[dates.length - 1]!)}`;
  }
  const range = rule.toDate ? `del ${formatArgentinaDate(rule.fromDate)} al ${formatArgentinaDate(rule.toDate)}` : `desde el ${formatArgentinaDate(rule.fromDate)}`;
  if (rule.recurrenceType === "RANGO") return range;
  const weekdays = [...rule.weekdays].sort().map((day) => WEEKDAY_PLURALS[day]).filter(Boolean).join(", ");
  return `los ${weekdays} ${range}`;
}

async function auditSpecialHourRuleClosures(rule: RuleForChange, result: SpecialHourReinterpretation, audit?: AuditContext) {
  const ofRule = rule.kind === "FERIADO" ? "del feriado" : "de la regla de horas especiales";
  await auditClosureRecalculations(result.rebuiltClosures, `cambio ${ofRule} ${rule.name}`, audit, (employeeIds) => loadEmployeeReferences(prisma, employeeIds));
}

export const workforceService = {
  async closures(period: string, user: Express.AuthUser) {
    return prisma.monthlyTimeClosure.findMany({ where: { period, employee: employeeAccessWhere(user) }, include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } }, submittedBy: { select: { name: true } }, reviewedBy: { select: { name: true } } }, orderBy: { employee: { lastName: "asc" } } });
  },
  async submitClosures(period: string, employeeIds: string[], user: Express.AuthUser, audit?: AuditContext) {
    if (user.role === roles.rrhh) throw new AppError("RH no envía cierres para aprobación", 400, "CLOSURE_SUBMIT_ROLE_INVALID");
    await ensureVisible(employeeIds, user);
    // Snapshot de auditoría del cierre (closureSnapshot.ts): base, Horas
    // normales residuales, conceptos, total trabajado y equivalencia con el
    // mismo modelo y criterio de estado que la grilla por legajo.
    const snapshots = await buildClosureSnapshots(prisma, employeeIds, period);
    const result = await execute(() => prisma.$transaction(employeeIds.map((employeeId) => {
      const snapshot = snapshots.get(employeeId)!;
      return prisma.monthlyTimeClosure.upsert({ where: { employeeId_period: { employeeId, period } }, create: { employeeId, period, status: "ENVIADO", snapshot, submittedByUserId: user.id, submittedAt: new Date() }, update: { status: "ENVIADO", snapshot, submittedByUserId: user.id, submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null, reviewNote: null } });
    })));
    // Una sola consulta de identidades para todo el lote (no una por legajo).
    const employeeReference = await loadEmployeeReferences(prisma, employeeIds);
    await Promise.all(result.map((item) => auditService.register({ ...audit, action: "UPDATE", entity: "MonthlyTimeClosure", entityId: item.id, description: `Se envió a revisión el cierre de ${humanizePeriodEs(period)} de ${employeeReference(item.employeeId)}.`, after: item as Prisma.InputJsonValue })));
    await notifyRrhh({ type: "CIERRE_MENSUAL", title: "Cierres mensuales recibidos", message: `${result.length} legajos de ${humanizePeriodEs(period)} esperan aprobación.`, link: `/cierres?period=${period}`, priority: "ALTA" });
    return result;
  },
  async approveClosures(ids: string[], note: string | undefined, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.monthlyTimeClosure.findMany({ where: { id: { in: ids }, status: "ENVIADO" }, include: employeeReferenceInclude });
    const result = await execute(() => prisma.monthlyTimeClosure.updateMany({ where: { id: { in: ids }, status: "ENVIADO" }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } }));
    await Promise.all(before.map((item) => auditService.register({ ...audit, action: "APPROVE", entity: "MonthlyTimeClosure", entityId: item.id, description: `Se aprobó el cierre de ${humanizePeriodEs(item.period)} de ${formatEmployeeReference(item.employee)}.`, before: item as Prisma.InputJsonValue })));
    return result;
  },
  async returnClosure(id: string, reason: string, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.monthlyTimeClosure.findUnique({ where: { id }, include: employeeReferenceInclude });
    if (!before) throw new AppError("No encontramos el cierre solicitado", 404, "MONTHLY_CLOSURE_NOT_FOUND");
    const item = await execute(() => prisma.monthlyTimeClosure.update({ where: { id }, data: { status: "DEVUELTO", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: reason } }));
    await auditService.register({ ...audit, action: "RETURN", entity: "MonthlyTimeClosure", entityId: id, description: `Se devolvió el cierre de ${humanizePeriodEs(item.period)} de ${formatEmployeeReference(before.employee)} — motivo: ${reason}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  async createCorrection(input: { timeEntryId: string; proposedHours: number; reason: string }, user: Express.AuthUser, audit?: AuditContext) {
    const entry = await prisma.timeEntry.findFirst({ where: { id: input.timeEntryId, employee: employeeAccessWhere(user) }, include: employeeReferenceInclude });
    if (!entry) throw new AppError("Carga horaria no encontrada", 404, "TIME_ENTRY_NOT_FOUND");
    const closure = await prisma.monthlyTimeClosure.findUnique({ where: { employeeId_period: { employeeId: entry.employeeId, period: entry.period } } });
    if (!closure || !isMonthlyClosureLocked(closure)) throw new AppError("El período todavía permite edición directa", 400, "PERIOD_NOT_CLOSED");
    const result = await execute(() => prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.create({ data: { employeeId: entry.employeeId, timeEntryId: entry.id, closureId: closure.id, previousHours: entry.hours, proposedHours: input.proposedHours, reason: input.reason, createdByUserId: user.id } });
      await tx.monthlyTimeClosure.update({ where: { id: closure.id }, data: { status: "CORRECCION_PENDIENTE" } });
      return request;
    }));
    await auditService.register({ ...audit, action: "CREATE", entity: "TimeCorrectionRequest", entityId: result.id, description: `Se solicitó una corrección de carga horaria de ${humanizePeriodEs(entry.period)} para ${formatEmployeeReference(entry.employee)} (de ${entry.hours}h a ${input.proposedHours}h).`, after: result as Prisma.InputJsonValue });
    await notifyRrhh({ type: "CORRECCION_HORARIA", title: "Corrección posterior al cierre", message: `Se solicitó modificar una carga de ${humanizePeriodEs(entry.period)}.`, entityType: "TimeCorrectionRequest", entityId: result.id, link: "/cierres", priority: "ALTA" });
    return result;
  },
  // Sin `take`: acotado por período (a lo sumo una corrección por carga del mes) — ver correctionsQuerySchema.
  corrections(user: Express.AuthUser, query: CorrectionsQuery) { return prisma.timeCorrectionRequest.findMany({ where: { employee: employeeAccessWhere(user), timeEntry: { period: query.period }, ...(query.status ? { status: query.status } : {}) }, include: { employee: { select: { legajo: true, firstName: true, lastName: true } }, timeEntry: { include: { hourConcept: true } }, createdBy: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }); },
  async approveCorrection(id: string, user: Express.AuthUser, audit?: AuditContext) {
    const { before, after } = await execute(() => prisma.$transaction(async (tx) => {
      const request = await tx.timeCorrectionRequest.findUniqueOrThrow({ where: { id }, include: employeeReferenceInclude });
      if (request.status !== "PENDIENTE") throw new AppError("La corrección ya fue revisada", 400, "CORRECTION_ALREADY_REVIEWED");
      const hours = Number(request.proposedHours);
      await tx.timeEntry.update({ where: { id: request.timeEntryId }, data: { hours, totalMinutes: Math.round(hours * 60), approvedByUserId: user.id, approvedAt: new Date() } });
      const updated = await tx.timeCorrectionRequest.update({ where: { id }, data: { status: "APROBADA", reviewedByUserId: user.id, reviewedAt: new Date() } });
      if (request.closureId) await tx.monthlyTimeClosure.update({ where: { id: request.closureId }, data: { status: "APROBADO", reviewedByUserId: user.id, reviewedAt: new Date() } });
      return { before: request, after: updated };
    }));
    await auditService.register({ ...audit, action: "APPROVE", entity: "TimeCorrectionRequest", entityId: id, description: `Se aprobó la corrección de carga horaria de ${formatEmployeeReference(before.employee)} (de ${before.previousHours}h a ${before.proposedHours}h).`, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue });
    return after;
  },
  async rejectCorrection(id: string, note: string | undefined, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.timeCorrectionRequest.findUnique({ where: { id }, include: employeeReferenceInclude });
    if (!before) throw new AppError("No encontramos la corrección solicitada", 404, "TIME_CORRECTION_NOT_FOUND");
    const item = await execute(() => prisma.timeCorrectionRequest.update({ where: { id }, data: { status: "RECHAZADA", reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note || null } }));
    await auditService.register({ ...audit, action: "REJECT", entity: "TimeCorrectionRequest", entityId: id, description: `Se rechazó la corrección de carga horaria de ${formatEmployeeReference(before.employee)}.`, before: before as Prisma.InputJsonValue, after: item as Prisma.InputJsonValue });
    return item;
  },
  // Etapa 9I: antes hacía fetch-all con take:200 fijo, sin paginación real.
  // Ahora pagina por page/take real y filtra por status server-side.
  // Etapa 14G.6: `prisma.$transaction([...])` (forma array, findMany+count)
  // -> `Promise.all([...])` sobre el cliente `prisma` global. Mismo
  // antipatrón ya corregido en time-entries (14C.2/14G.2/14G.3) y en
  // shifts/shiftAlert (14G.5): las 2 queries son de sólo lectura e
  // independientes (un listado + su count total), sin necesidad de una foto
  // transaccional consistente entre sí, y la forma-array de `$transaction`
  // las ejecutaba secuencialmente sobre una única conexión. La cache backend
  // agregada en esta etapa (ver workforce.cache.ts) usa un TTL corto (10s)
  // precisamente porque los write paths de SystemNotification siguen
  // dispersos en 5+ módulos (novelties/workforce-management/time-entries/
  // shifts/attendance, todos vía notifyUsers/notifyRrhh o creación directa)
  // — no es un conjunto cerrado y enumerable con confianza (criterio de
  // docs/PERFORMANCE_STANDARDS.md §5), así que no se invalida al crear una
  // notificación nueva, sólo al marcar como leída (mismo write path que este
  // módulo sí controla). Ver docs/decisions/
  // WORKFORCE_MANAGEMENT_NOTIFICATIONS_PERFORMANCE_14G6.md §9 para el riesgo
  // aceptado explícitamente (mismo criterio ya usado en 14G.5 para
  // shiftAlertListCache, acotado por un TTL más corto todavía).
  //
  // Etapa "orden por fecha efectiva" (docs/decisions/NOTIFICATIONS_EVENT_ORDER.md):
  // orden, filtro de fechas y paginación se resuelven en la DB sobre
  // `eventAt` (persistido e inmutable) — antes se paginaba por createdAt y la
  // fecha del hecho se derivaba después, sólo para la página. `after` pide lo
  // que sigue a una fila; `through` devuelve la ventana visible completa
  // (hasta esa fila inclusive, acotada por `take`). `meta.nextCursor` es la
  // última fila cubierta y `hasMore` dice si existe algo después de ella.
  async notifications(query: ListNotificationsQuery, user: Express.AuthUser) {
    const where: Prisma.SystemNotificationWhereInput = {
      recipientUserId: user.id,
      ...(query.status ? { status: query.status } : {}),
      ...notificationEventDateWhere(query.dateFrom, query.dateTo),
    };
    const position = query.after ? afterNotificationCursor(query.after) : query.through ? throughNotificationCursor(query.through) : undefined;
    const skip = position ? 0 : (query.page - 1) * query.take;
    const [notifications, total] = await Promise.all([
      prisma.systemNotification.findMany({ where: position ? { AND: [where, position] } : where, orderBy: NOTIFICATION_ORDER_BY, skip, take: query.take }),
      prisma.systemNotification.count({ where }),
    ]);
    const lastRow = notifications.at(-1);
    const boundary = lastRow ?? query.through ?? query.after;
    const hasMore = boundary
      ? Boolean(await prisma.systemNotification.findFirst({ where: { AND: [where, afterNotificationCursor(boundary)] }, select: { id: true } }))
      : false;
    const shiftAlertIds = notifications.filter((item) => item.entityType === "ShiftAlert" && item.entityId).map((item) => item.entityId!);
    const workShiftIds = notifications.filter((item) => item.entityType === "WorkShift" && item.entityId).map((item) => item.entityId!);
    const employeeIds = notifications.filter((item) => item.entityType === "Employee" && item.entityId).map((item) => item.entityId!);
    // Etapa 15G.2 (docs/decisions/ALERT_TO_NOVELTY_FLOW_15G2.md): "no
    // asistió" (SIN_ACTIVIDAD_REGISTRADA, entityType AttendanceInactivityIncident)
    // no llegaba con `employee` -- mismo patrón exacto que ShiftAlert/
    // WorkShift/Employee de arriba, sólo agrega el cuarto entityType.
    const inactivityIncidentIds = notifications.filter((item) => item.entityType === "AttendanceInactivityIncident" && item.entityId).map((item) => item.entityId!);
    const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true } as const;
    const [alerts, shifts, employees, incidents] = shiftAlertIds.length || workShiftIds.length || employeeIds.length || inactivityIncidentIds.length
      ? await Promise.all([
          shiftAlertIds.length ? prisma.shiftAlert.findMany({ where: { id: { in: shiftAlertIds } }, select: { id: true, employee: { select: employeeSelect } } }) : Promise.resolve([]),
          workShiftIds.length ? prisma.workShift.findMany({ where: { id: { in: workShiftIds } }, select: { id: true, employee: { select: employeeSelect } } }) : Promise.resolve([]),
          employeeIds.length ? prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: employeeSelect }) : Promise.resolve([]),
          inactivityIncidentIds.length ? prisma.attendanceInactivityIncident.findMany({ where: { id: { in: inactivityIncidentIds } }, select: { id: true, employee: { select: employeeSelect } } }) : Promise.resolve([]),
        ])
      : [[], [], [], []];
    const employeeByAlert = new Map(alerts.map((alert) => [alert.id, alert.employee]));
    const employeeByShift = new Map(shifts.map((shift) => [shift.id, shift.employee]));
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeByIncident = new Map(incidents.map((incident) => [incident.id, incident.employee]));
    // La fecha a mostrar es `eventAt` de la propia fila (fijada al crearla);
    // la entidad de origen sólo aporta el empleado, nunca la fecha.
    const items = notifications.map((item) => {
      if (!item.entityId) return item;
      if (item.entityType === "ShiftAlert") return { ...item, employee: employeeByAlert.get(item.entityId) };
      if (item.entityType === "WorkShift") return { ...item, employee: employeeByShift.get(item.entityId) };
      if (item.entityType === "Employee") return { ...item, employee: employeeById.get(item.entityId) };
      if (item.entityType === "AttendanceInactivityIncident") return { ...item, employee: employeeByIncident.get(item.entityId) };
      return item;
    });
    return { items, meta: { total, page: query.page, pageSize: query.take, hasMore, nextCursor: boundary ? formatNotificationCursor(boundary) : null } };
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
    const { item, reinterpretation } = await execute(() => prisma.$transaction(async (tx) => {
      const created = await tx.doubleHourRule.create({
        data: {
          ...data,
          ...(data.recurrenceType === "FECHA" && dates?.length ? fechaVigencyFromDates(dates) : {}),
          createdByUserId: user.id,
          employees: { create: employeeIds.map((employeeId: string) => ({ employeeId })) },
          ...(dates ? { dates: { create: dates.map((entry: { date: Date; isActive?: boolean }) => ({ date: entry.date, isActive: entry.isActive ?? true })) } } : {}),
        },
        include: { employees: true, dates: true },
      });
      const result = await reinterpretSpecialHours(tx, { before: null, after: ruleCalendar(created) }, { doubleHourRuleId: created.id, doubleHourRuleName: created.name });
      return { item: created, reinterpretation: result };
    }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS));
    await auditService.register({
      ...audit, action: "CREATE", entity: "DoubleHourRule", entityId: item.id,
      description: `Se creó ${ruleNoun(item)} ${item.name} (${describeRuleSchedule(item)}, ${formatMultiplierLabel(item.multiplier)}). ${describeReinterpretation(reinterpretation)}`,
      after: { ...item, reinterpretation: reinterpretationMetadata(reinterpretation) } as Prisma.InputJsonValue,
    });
    await auditSpecialHourRuleClosures(item, reinterpretation, audit);
    return item;
  },
  async updateDoubleRule(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true, dates: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const { employeeIds, dates, ...data } = input;
    const recurrenceType = data.recurrenceType ?? before.recurrenceType;
    const { item, reinterpretation } = await execute(() => prisma.$transaction(async (tx) => {
      const updated = await tx.doubleHourRule.update({
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
      // before y after: un cambio de fechas/alcance alcanza tanto lo que
      // dejó de matchear como lo que empezó a matchear.
      const result = await reinterpretSpecialHours(tx, { before: ruleCalendar(before), after: ruleCalendar(updated) }, { doubleHourRuleId: id, doubleHourRuleName: updated.name });
      return { item: updated, reinterpretation: result };
    }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS));
    const changes = [
      Number(before.multiplier) !== Number(item.multiplier) ? `de ${formatMultiplierLabel(before.multiplier)} a ${formatMultiplierLabel(item.multiplier)}` : null,
      before.status !== item.status ? (item.status === "ACTIVO" ? "reactivada" : "inactivada") : null,
    ].filter(Boolean).join(", ");
    await auditService.register({
      ...audit, action: "UPDATE", entity: "DoubleHourRule", entityId: id,
      description: `Se actualizó ${ruleNoun(item)} ${item.name} (${describeRuleSchedule(item)})${changes ? ` ${changes}` : ""}. ${describeReinterpretation(reinterpretation)}`,
      before: before as Prisma.InputJsonValue,
      after: { ...item, reinterpretation: reinterpretationMetadata(reinterpretation) } as Prisma.InputJsonValue,
    });
    await auditSpecialHourRuleClosures(item, reinterpretation, audit);
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
  // Etapa 12D: función fina para que Turnos (holidayWorkAssignment.service.ts)
  // consuma fechas de feriado SIN duplicar el cálculo de calendario ni
  // reimplementar ruleMatchesDate/buildActiveDatesByRule — reutiliza
  // calendarPreview(kind=FERIADO) tal cual y sólo angosta la forma de
  // respuesta a lo que un consumidor de "expectativa de trabajo" necesita
  // (nunca multiplier/priority/hasOverlap/hasConflict — eso es liquidación,
  // ver docs/decisions/SPECIAL_HOUR_RULE_CLASSIFICATION_12A.md §12).
  async holidayDatesInRange(from: Date, to: Date) {
    const days = await workforceService.calendarPreview(from, to, "FERIADO");
    return days.map((day) => ({ date: day.date, rules: day.rules.map((rule) => ({ id: rule.id, name: rule.name })) }));
  },
  // Eliminar = la regla se creó por error: se borra físicamente, haya o no
  // empezado/terminado su vigencia y esté ACTIVA o INACTIVA. Conservar una
  // regla válida que ya no debe aplicar es Inactivar (PATCH status), no esto.
  // En una transacción: se retira su traza (SpecialHourRuleApplication es
  // RESTRICT hacia la regla; empleados y fechas caen por CASCADE), se borra y
  // se reinterpretan las horas que alcanzaba como si nunca hubiera existido
  // (las reglas que quedan resuelven el multiplicador). Nunca toca minutos,
  // fichadas ni jornadas. Si el recálculo falla, la regla sigue existiendo.
  // El AuditLog (before = configuración completa) conserva la historia.
  async removeDoubleRule(id: string, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true, dates: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    const reinterpretation = await execute(() => prisma.$transaction(async (tx) => {
      await tx.specialHourRuleApplication.deleteMany({ where: { doubleHourRuleId: id } });
      await tx.doubleHourRule.delete({ where: { id } });
      return reinterpretSpecialHours(tx, { before: ruleCalendar(before), after: null }, { doubleHourRuleId: id, doubleHourRuleName: before.name });
    }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS));
    await auditService.register({
      ...audit, action: "DELETE", entity: "DoubleHourRule", entityId: id,
      description: `Se eliminó definitivamente ${ruleNoun(before)} ${before.name} (${describeRuleSchedule(before)}, ${formatMultiplierLabel(before.multiplier)}). ${describeReinterpretation(reinterpretation)}`,
      before: before as Prisma.InputJsonValue,
      after: { reinterpretation: reinterpretationMetadata(reinterpretation) } as Prisma.InputJsonValue,
    });
    await auditSpecialHourRuleClosures(before, reinterpretation, audit);
    return { mode: "DELETED" as const, id };
  },
};
