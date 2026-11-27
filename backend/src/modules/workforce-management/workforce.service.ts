import { Prisma, type DoubleHourRuleKind } from "@prisma/client";
import { shiftTemplateWhereForScope, type ShiftGroupScope } from "../shifts/shiftGroupAccess";
import { assertEmployeesWritable, assertShiftGroupWritable, canManageShiftGroup, isGlobalActor, type ShiftActor } from "../shifts/shiftWriteAccess";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { lockClosurePeriods } from "../../shared/monthlyClosure/closurePeriodGuard";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { roles } from "../../shared/security/roles";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { argentinaDateKey, argentinaDayRange, calendarDateKey, humanizePeriodEs, nextCalendarDateKey, periodCalendarBounds, todayArgentinaDateKey } from "../../shared/datetime/argentinaTime";
import { resolveEmployeeNotificationRecipients, type RecipientsReader } from "./employeeNotificationRecipients";
import { assertActorAuthorizedWithin, assertConfirmedPlan, DeletionPlanBuilder, type DeletionConfirmation, type DeletionPreview } from "../../shared/deletion/deletionPlan";
import { buildActiveDatesByRule, resolveWinningRules, ruleMatchesDate, scopesCouldOverlap } from "./doubleHourRuleMatching";
import type { ListNotificationsQuery } from "./workforce.schemas";
import { buildClosureSnapshots, confirmedClosureResult, pendingNoveltyReviewOf } from "./closureSnapshot";
import { findOperationalClosureBlockers, groupClosureBlockers, noveltyReviewBlockers, type ClosureBlocker } from "./closureBlockers";
import { employeeReferenceSelect, formatEmployeeReference, loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { auditClosureRecalculations } from "./closureRecalculationAudit";
import { reinterpretSpecialHours, type RuleCalendar, type SpecialHourReinterpretation } from "./specialHourReinterpretation";
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, describeNoveltyCoverageRecalculation, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { describeReinterpretation, reinterpretationMetadata } from "./specialHourReinterpretationSummary";
import { afterNotificationCursor, formatNotificationCursor, NOTIFICATION_ORDER_BY, notificationEventDateWhere, throughNotificationCursor } from "./notificationListing";
import { assertClockPunchPostProcessSettled } from "../clock/clockPunchPostProcess.guard";
import { computeExpectedMinutes } from "../shifts/shiftTemplateTime";
import { assertShiftGroupAssignable, describeShiftGroup } from "../shifts/shiftGroup.service";
import { shiftGroupSummarySelect } from "../shifts/shiftGroup.repository";
import { pendingFixedEntryJobs, shiftTemplateHistory, shiftTemplateScheduleService, type ReplaceShiftTemplateScheduleInput } from "./shiftTemplateSchedule.service";

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
// `db`: PERF-5D — el post-proceso de una fichada la escribe en la transacción
// de su paso (efectos + marca del paso juntos); el resto usa el cliente global.
export async function notifyUsers(userIds: string[], input: { type: string; title: string; message: string; entityType?: string; entityId?: string; link?: string; priority?: string; eventAt?: Date }, db: Pick<PrismaTransactionClient, "systemNotification"> = prisma) {
  const recipients = Array.from(new Set(userIds.filter(Boolean)));
  if (!recipients.length) return;
  await db.systemNotification.createMany({ data: recipients.map((recipientUserId) => ({ recipientUserId, ...input })) });
}

export async function notifyRrhh(input: Parameters<typeof notifyUsers>[1]) {
  const users = await prisma.user.findMany({ where: { role: "NIVEL_1_RRHH", status: "ACTIVO" }, select: { id: true } });
  await notifyUsers(users.map((item) => item.id), input);
}

/**
 * Destinatarios de un aviso operativo del legajo: RRHH + responsables
 * directos Nivel 2 + Nivel 3 heredados
 * (employeeNotificationRecipients.ts). `eventAt`: instante del hecho que
 * origina el aviso; la vigencia de TIME_RESPONSIBLE se evalúa en su día
 * Argentina, no en el momento en que se procesa o reintenta.
 */
export async function attendanceRecipients(employeeId: string, eventAt: Date, db?: RecipientsReader) {
  return resolveEmployeeNotificationRecipients(employeeId, argentinaDateKey(eventAt), db);
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

// ── Turnos: cobertura de novedades de quienes usan la plantilla (etapa 5) ──
const SHIFT_TEMPLATE_TRANSACTION_OPTIONS = { timeout: 30_000 };
// R3.1: cada plantilla del catálogo trae su grupo (`shiftGroup: null` = sin
// grupo). Es clasificación: no participa de ningún cálculo de jornada.
const SHIFT_TEMPLATE_GROUP_INCLUDE = { shiftGroup: { select: shiftGroupSummarySelect } } as const;

/** Frase de auditoría del grupo de una plantilla, con nombres (nunca ids). */
function shiftGroupAuditPhrase(before: { code: string; name: string } | null | undefined, after: { code: string; name: string } | null | undefined): string {
  const label = (group: { code: string; name: string } | null | undefined) => (group ? describeShiftGroup(group) : "sin grupo");
  return ` Grupo: ${label(before)} → ${label(after)}.`;
}

/**
 * Cambio de horario/minutos/estado de una plantilla: recalcula sólo los
 * legajos que la tienen asignada (cualquier estado: la asignación puede
 * volver a habilitarse con su vigencia) o convocada a un feriado, dentro de la
 * ventana de esas vigencias/fechas (NOVELTY_COVERAGE_ENGINE.md §13.2). Quien
 * llama ya tomó el lock global de cobertura.
 */
type CoverageRange = { employeeId: string; from: Date; to: Date | null };

/**
 * R4.3b (docs/decisions/SHIFT_ROTATION_AUDIT_PLAN.md §25.5): miembros de
 * rotación cuyas grillas usan la plantilla, con el período de su membresía
 * acotado a la vigencia de las versiones que la usan. Sin ninguna membresía
 * (hoy, todos los entornos) no consulta las tablas de la grilla.
 */
async function rotationTemplateCoverageRanges(tx: PrismaTransactionClient, shiftTemplateId: string, options: { activeRotationsOnly?: boolean } = {}): Promise<CoverageRange[]> {
  if (!(await tx.shiftRotationCrewMember.findFirst({ select: { id: true } }))) return [];
  const blocks = await tx.shiftRotationBlock.findMany({
    where: { shiftTemplateId, ...(options.activeRotationsOnly ? { day: { version: { rotation: { status: "ACTIVO" } } } } : {}) },
    select: { day: { select: { crewId: true, version: { select: { effectiveFrom: true, effectiveTo: true } } } } },
  });
  if (!blocks.length) return [];
  const spanByCrew = new Map<string, { from: Date; to: Date | null }>();
  for (const { day } of blocks) {
    const span = spanByCrew.get(day.crewId);
    const versionTo = day.version.effectiveTo;
    spanByCrew.set(day.crewId, span
      ? { from: span.from < day.version.effectiveFrom ? span.from : day.version.effectiveFrom, to: span.to === null || versionTo === null ? null : span.to > versionTo ? span.to : versionTo }
      : { from: day.version.effectiveFrom, to: versionTo });
  }
  const members = await tx.shiftRotationCrewMember.findMany({ where: { crewId: { in: [...spanByCrew.keys()] } }, select: { employeeId: true, crewId: true, effectiveFrom: true, effectiveTo: true } });
  const ranges: CoverageRange[] = [];
  for (const member of members) {
    const span = spanByCrew.get(member.crewId)!;
    const from = member.effectiveFrom > span.from ? member.effectiveFrom : span.from;
    const to = member.effectiveTo === null ? span.to : span.to === null ? member.effectiveTo : member.effectiveTo < span.to ? member.effectiveTo : span.to;
    if (to === null || to >= from) ranges.push({ employeeId: member.employeeId, from, to });
  }
  return ranges;
}

/**
 * R8.3 (§26): legajos cuyo horario u obligación REAL cambia si cambia esta
 * plantilla desde hoy: fijos HABILITADOS vigentes o futuros, convocatorias
 * ACTIVAS futuras y miembros vigentes o futuros de rotaciones ACTIVAS cuyas
 * versiones la usan. Mismas fuentes que el recálculo de cobertura, sin la
 * historia ni lo inactivo.
 */
async function templateAffectedEmployeeIds(tx: PrismaTransactionClient, shiftTemplateId: string): Promise<string[]> {
  const today = new Date(`${todayArgentinaDateKey()}T00:00:00.000Z`);
  const [assignments, convocations, rotationRanges] = await Promise.all([
    tx.shiftAssignment.findMany({ where: { shiftTemplateId, status: "HABILITADO", OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, select: { employeeId: true } }),
    tx.holidayWorkAssignment.findMany({ where: { shiftTemplateId, status: "ACTIVA", date: { gte: today } }, select: { employeeId: true } }),
    rotationTemplateCoverageRanges(tx, shiftTemplateId, { activeRotationsOnly: true }),
  ]);
  return [...new Set([
    ...assignments.map((row) => row.employeeId),
    ...convocations.map((row) => row.employeeId),
    ...rotationRanges.filter((range) => range.to === null || range.to >= today).map((range) => range.employeeId),
  ])];
}

/** Campos de una plantilla que no cambian horarios ni obligaciones (clasificación y rótulos). */
const SHIFT_TEMPLATE_DESCRIPTIVE_FIELDS = new Set(["code", "name", "description", "categoryName", "shiftGroupId"]);

/**
 * R8.3 (§26): un cambio con efecto real sobre empleados exige, además del
 * grupo, todos los legajos afectados en el alcance (403 sin escribir). Nivel 1
 * no consulta nada.
 */
async function assertTemplateEffectWritable(tx: PrismaTransactionClient, actor: ShiftActor, shiftTemplateId: string) {
  if (isGlobalActor(actor)) return;
  await assertEmployeesWritable(actor, await templateAffectedEmployeeIds(tx, shiftTemplateId), tx);
}

async function recalculateTemplateCoverage(tx: PrismaTransactionClient, shiftTemplateId: string, label: string) {
  const [assignments, convocations, rotationRanges] = await Promise.all([
    tx.shiftAssignment.findMany({ where: { shiftTemplateId }, select: { employeeId: true, effectiveFrom: true, effectiveTo: true } }),
    tx.holidayWorkAssignment.findMany({ where: { shiftTemplateId }, select: { employeeId: true, date: true } }),
    rotationTemplateCoverageRanges(tx, shiftTemplateId),
  ]);
  const reason = { source: "SHIFT_TEMPLATE_CHANGED" as const, label };
  const ranges: CoverageRange[] = [
    ...assignments.map((row) => ({ employeeId: row.employeeId, from: row.effectiveFrom, to: row.effectiveTo })),
    ...convocations.map((row) => ({ employeeId: row.employeeId, from: row.date, to: row.date as Date | null })),
    ...rotationRanges,
  ];
  if (!ranges.length) return recalculateNoveltyCoverage(tx, { employeeIds: [] }, reason);
  const from = new Date(Math.min(...ranges.map((range) => range.from.getTime())));
  const to = ranges.some((range) => range.to === null) ? null : new Date(Math.max(...ranges.map((range) => range.to!.getTime())));
  return recalculateNoveltyCoverage(tx, { employeeIds: [...new Set(ranges.map((range) => range.employeeId))], from, to }, reason);
}

// ── Reglas de Hora Especial: cambio + reinterpretación de la historia ──────
// (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §15). Crear, editar,
// inactivar o eliminar una regla corre en la misma transacción que el
// recálculo de todo lo derivado: si el recálculo falla, la regla no cambia.
const SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS = { timeout: 30_000 };
const CLOSURE_TRANSACTION_OPTIONS = { timeout: 30_000 };

type RuleForChange = RuleCalendar & { name: string; kind: DoubleHourRuleKind; multiplier: Prisma.Decimal | number; status: string };

function ruleCalendar(rule: RuleForChange): RuleCalendar & { kind: DoubleHourRuleKind } {
  return { id: rule.id, recurrenceType: rule.recurrenceType, fromDate: rule.fromDate, toDate: rule.toDate, weekdays: rule.weekdays, dates: rule.dates, kind: rule.kind };
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

/**
 * Eliminación de una regla (protocolo de shared/deletion). El motor sólo lee
 * reglas ACTIVO: dentro de la transacción la regla se inactiva ANTES de
 * reinterpretar, para recalcular como si no existiera (mismo orden que alta y
 * edición: primero el estado nuevo, después la reinterpretación). Antes la
 * reinterpretación corría con la regla todavía activa: no cambiaba ningún
 * multiplicador, no detectaba períodos protegidos y después se borraban sus
 * aplicaciones también en esos períodos.
 */
async function planDoubleRuleDeletionWithin(tx: PrismaTransactionClient, id: string) {
  // Cambio que alcanza a cualquier legajo: lock global de cobertura primero (NOVELTY_COVERAGE_ENGINE.md §13.6).
  await lockNoveltyCoverageGlobally(tx);
  const before = await tx.doubleHourRule.findUnique({ where: { id }, include: { employees: true, dates: true } });
  if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
  if (before.status === "ACTIVO") await tx.doubleHourRule.update({ where: { id }, data: { status: "INACTIVO" } });
  const reinterpretation = await reinterpretSpecialHours(tx, { before: ruleCalendar(before), after: null }, { doubleHourRuleId: id, doubleHourRuleName: before.name });
  const changedRows = [...reinterpretation.changes.timeEntries, ...reinterpretation.changes.breakdowns];
  const reference = await loadEmployeeReferences(tx, [...new Set(changedRows.map((row) => row.employeeId))]);
  const pairs = new Map(changedRows.map((row) => [`${row.employeeId}:${row.date.slice(0, 7)}`, `${reference(row.employeeId)} · ${humanizePeriodEs(row.date.slice(0, 7))}`]));
  const noun = ruleNoun(before);
  const builder = new DeletionPlanBuilder()
    .add("doubleHourRule.delete", "DELETE", before.kind === "FERIADO" ? "Feriado que se elimina" : "Regla que se elimina", `Se borra con su configuración propia: ${before.dates.length} ${before.dates.length === 1 ? "fecha" : "fechas"} y ${before.employees.length} ${before.employees.length === 1 ? "persona elegida" : "personas elegidas"}.`, [{ id, name: before.name }])
    .add("hours.recalculate", "RECALCULATE", "Personas y períodos que se recalculan", `Se recalculan como si ${noun} no existiera: ${reinterpretation.timeEntries} cargas, ${reinterpretation.breakdowns} desgloses y ${reinterpretation.segments} tramos de fichada. Cambia sólo el multiplicador, nunca los minutos; ${reinterpretation.rebuiltClosures.length} cierres abiertos se reconstruyen. Los períodos enviados o aprobados no se tocan.`, [...pairs.entries()].map(([pairId, name]) => ({ id: pairId, name })), { affectsPeople: true })
    .add("hours.rows", "RECALCULATE", "Registros horarios que cambian de multiplicador", "Detalle técnico de la reinterpretación (cargas, desgloses y tramos).", [...changedRows, ...reinterpretation.changes.segments].map((row) => ({ id: row.id, name: row.id })), { listed: false });
  const protectedPeriods = reinterpretation.protectedPeriods.filter((period) => period.timeEntries + period.breakdowns + period.segments + period.missingHistory > 0);
  if (protectedPeriods.length) {
    builder.block(
      "DOUBLE_HOUR_RULE_PROTECTED_HISTORY",
      `La regla tiene resultados en períodos enviados o aprobados (${[...new Set(protectedPeriods.map((period) => humanizePeriodEs(period.period)))].join(", ")}). No se puede eliminar porque se perdería su traza histórica; inactivala o corregí esos períodos mediante el procedimiento explícito de RRHH.`,
    );
  }
  return {
    before,
    reinterpretation,
    preview: builder.build(
      { kind: "doubleHourRule", id, code: null, name: before.name, label: before.kind === "FERIADO" ? "Feriado" : "Regla de horas especiales" },
      {
        // Configuración completa que desaparece, no sólo el calendario usado
        // por el motor: incluye multiplicador/prioridad/estado, alcance,
        // autoría y las filas propias de empleados y fechas.
        deletedRule: before,
        concreteResults: reinterpretation.changes,
        rebuiltClosures: reinterpretation.rebuiltClosures.map(confirmedClosureResult),
        protectedPeriods: reinterpretation.protectedPeriods,
      },
    ),
  };
}

/** La vista previa reinterpreta en una transacción que siempre se revierte. */
class DeletionPreviewRollback extends Error {
  constructor(readonly preview: DeletionPreview) { super("deletion preview rollback"); }
}

async function deleteDoubleRuleWithin(tx: PrismaTransactionClient, plan: Awaited<ReturnType<typeof planDoubleRuleDeletionWithin>>, audit?: AuditContext) {
  const { before, reinterpretation } = plan;
  // Sin períodos protegidos alcanzados no quedan aplicaciones de la regla: la
  // reinterpretación ya las reemplazó. Se borran explícitamente por si acaso.
  await tx.specialHourRuleApplication.deleteMany({ where: { doubleHourRuleId: before.id } });
  await tx.doubleHourRule.delete({ where: { id: before.id } });
  await auditService.registerWithin(tx, {
    ...audit, action: "DELETE", entity: "DoubleHourRule", entityId: before.id,
    description: `Se eliminó definitivamente ${ruleNoun(before)} ${before.name} (${describeRuleSchedule(before)}, ${formatMultiplierLabel(before.multiplier)}). ${describeReinterpretation(reinterpretation)}`,
    before: before as Prisma.InputJsonValue,
    after: { reinterpretation: reinterpretationMetadata(reinterpretation) } as Prisma.InputJsonValue,
  });
  if (reinterpretation.rebuiltClosures.length) {
    const reference = await loadEmployeeReferences(tx, reinterpretation.rebuiltClosures.map((closure) => closure.employeeId));
    const ofRule = before.kind === "FERIADO" ? "del feriado" : "de la regla de horas especiales";
    for (const closure of reinterpretation.rebuiltClosures) {
      await auditService.registerWithin(tx, {
        ...audit, action: "UPDATE", entity: "MonthlyTimeClosure", entityId: closure.id,
        description: `Se recalculó el snapshot del cierre de ${humanizePeriodEs(closure.period)} de ${reference(closure.employeeId)} por eliminación ${ofRule} ${before.name}. El estado del cierre no cambia.`,
        before: { snapshot: closure.before } as Prisma.InputJsonValue,
        after: { snapshot: closure.after } as Prisma.InputJsonValue,
      });
    }
  }
}

async function auditSpecialHourRuleClosures(rule: RuleForChange, result: SpecialHourReinterpretation, audit?: AuditContext) {
  const ofRule = rule.kind === "FERIADO" ? "del feriado" : "de la regla de horas especiales";
  await auditClosureRecalculations(result.rebuiltClosures, `cambio ${ofRule} ${rule.name}`, audit, (employeeIds) => loadEmployeeReferences(prisma, employeeIds));
}

// D-4: tanto sectores anteriores como nuevos son válidos. El motor distingue
// su semántica con la clasificación persistida del sector (Sector.isLegacy,
// A8-3): anterior = FK legacy del legajo; nuevo = “Ubicado dentro de” sobre
// los alcances del puesto.
async function assertRuleSectorSupported(sectorId: string | null | undefined, currentSectorId: string | null = null) {
  if (!sectorId || sectorId === currentSectorId) return;
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } });
  if (!sector) throw new AppError("El sector seleccionado no existe.", 400, "DOUBLE_HOUR_RULE_SECTOR_INVALID");
}

// A8 §12.4 (AT-4): alta rechaza cualquier destino archivado; edición sólo
// conserva SIN CAMBIO una FK que la regla ya apuntara a un registro hoy
// archivado — toda asignación nueva hacia un archivado se rechaza. Con
// `lock` (dentro de la transacción del guardado) es la comprobación
// AUTORITATIVA: bloquea los destinos nuevos (FOR SHARE) antes de leer su
// archivo, así el UPDATE de archivo de la limpieza no se cuela entre la
// comprobación y la escritura; `current` son las FKs leídas en esa misma
// transacción. Sin `lock` es el rechazo temprano.
type RuleTargetKey = "companyId" | "sectorId" | "positionId" | "costCenterId";
const RULE_TARGETS: Record<RuleTargetKey, { table: "Company" | "Sector" | "Position" | "CostCenter"; label: string }> = {
  companyId: { table: "Company", label: "empresa" },
  sectorId: { table: "Sector", label: "sector" },
  positionId: { table: "Position", label: "puesto" },
  // Desde la eliminación controlada un centro de costo también puede quedar archivado.
  costCenterId: { table: "CostCenter", label: "centro de costo" },
};
type RuleTargetReader = Pick<PrismaTransactionClient, "company" | "sector" | "position" | "costCenter" | "$queryRawUnsafe">;

async function assertRuleDestinationsNotArchived(
  db: RuleTargetReader,
  input: { companyId?: string | null; sectorId?: string | null; positionId?: string | null; costCenterId?: string | null },
  current?: { companyId?: string | null; sectorId?: string | null; positionId?: string | null; costCenterId?: string | null } | null,
  options: { lock?: boolean } = {},
) {
  const keys = Object.keys(RULE_TARGETS) as RuleTargetKey[];
  const changed = keys.filter((key) => input[key] !== undefined && (input[key] ?? null) !== (current?.[key] ?? null) && Boolean(input[key]));
  if (!changed.length) return;
  if (options.lock) {
    for (const key of changed) await db.$queryRawUnsafe(`SELECT "id" FROM "${RULE_TARGETS[key].table}" WHERE "id" = $1 FOR SHARE`, input[key]);
  }
  const idsOf = (key: RuleTargetKey) => (changed.includes(key) ? [input[key]!] : []);
  const [companies, sectors, positions, costCenters] = await Promise.all([
    idsOf("companyId").length ? db.company.findMany({ where: { id: { in: idsOf("companyId") }, archivedAt: { not: null } }, select: { name: true } }) : Promise.resolve([]),
    idsOf("sectorId").length ? db.sector.findMany({ where: { id: { in: idsOf("sectorId") }, archivedAt: { not: null } }, select: { name: true } }) : Promise.resolve([]),
    idsOf("positionId").length ? db.position.findMany({ where: { id: { in: idsOf("positionId") }, archivedAt: { not: null } }, select: { name: true } }) : Promise.resolve([]),
    idsOf("costCenterId").length ? db.costCenter.findMany({ where: { id: { in: idsOf("costCenterId") }, archivedAt: { not: null } }, select: { name: true } }) : Promise.resolve([]),
  ]);
  const archived = [
    ...companies.map((row) => `${RULE_TARGETS.companyId.label} “${row.name}”`),
    ...sectors.map((row) => `${RULE_TARGETS.sectorId.label} “${row.name}”`),
    ...positions.map((row) => `${RULE_TARGETS.positionId.label} “${row.name}”`),
    ...costCenters.map((row) => `${RULE_TARGETS.costCenterId.label} “${row.name}”`),
  ];
  if (archived.length) {
    throw new AppError(`No se puede asignar la regla a un registro archivado: ${archived.join(", ")}.`, 400, "DOUBLE_HOUR_RULE_DESTINATION_ARCHIVED");
  }
}

const CLOSURE_BLOCKERS_LISTED = 10;

/**
 * Texto del 409 de cierre (respaldo legible: el errorHandler oculta `details`
 * en producción). La pantalla no lo interpreta: consulta la vista previa
 * estructurada `GET /closures/blockers`.
 */
export function closureBlockersMessage(blockers: ClosureBlocker[]) {
  const listed = blockers.slice(0, CLOSURE_BLOCKERS_LISTED).map((item) => `${formatEmployeeReference(item.employee)}: ${item.title} (${formatArgentinaDate(item.date)})`);
  const rest = blockers.length - listed.length;
  return `No se puede cerrar: hay ${blockers.length} ${blockers.length === 1 ? "pendiente que puede" : "pendientes que pueden"} cambiar las horas del período. ${listed.join("; ")}${rest > 0 ? `; y ${rest} más` : ""}. Resolvelos desde Asistencia o Carga de horas y volvé a cerrar.`;
}

export const workforceService = {
  async closures(period: string, user: Express.AuthUser) {
    const rows = await prisma.monthlyTimeClosure.findMany({ where: { period, employee: employeeAccessWhere(user) }, include: { employee: { select: { id: true, legajo: true, firstName: true, lastName: true } }, closedBy: { select: { name: true } }, reopenedBy: { select: { name: true } } }, orderBy: { employee: { lastName: "asc" } } });
    const employeeIds = rows.map((row) => row.employeeId);
    const batches = employeeIds.length ? await prisma.finnegansExportBatch.findMany({ where: { period, items: { some: { employeeId: { in: employeeIds } } } }, select: { version: true, createdAt: true, items: { where: { employeeId: { in: employeeIds } }, select: { employeeId: true } } }, orderBy: { version: "desc" } }) : [];
    const exportsByEmployee = new Map<string, { count: number; latestVersion: number; latestExportedAt: Date }>();
    for (const batch of batches) for (const employeeId of new Set(batch.items.map((item) => item.employeeId))) {
      const current = exportsByEmployee.get(employeeId);
      exportsByEmployee.set(employeeId, { count: (current?.count ?? 0) + 1, latestVersion: Math.max(current?.latestVersion ?? 0, batch.version), latestExportedAt: current && current.latestExportedAt > batch.createdAt ? current.latestExportedAt : batch.createdAt });
    }
    return rows.map((row) => ({ ...row, exportHistory: exportsByEmployee.get(row.employeeId) ?? null }));
  },
  /**
   * Vista previa de bloqueantes del período, agrupada por legajo, con el mismo
   * criterio que la validación definitiva de `closeClosures`. Sólo legajos del
   * alcance del usuario (employeeAccessWhere) y todavía no CERRADO. Los días
   * de novedades en revisión salen del mismo snapshot del cierre, calculado
   * sólo para quienes tienen cobertura de novedades en el período.
   */
  async closureBlockers(period: string, user: Express.AuthUser) {
    const employees = await prisma.employee.findMany({
      where: { ...employeeAccessWhere(user), monthlyClosures: { none: { period, status: "CERRADO" } } },
      select: { id: true, legajo: true, firstName: true, lastName: true },
    });
    const employeeIds = employees.map((employee) => employee.id);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    const [operational, withCoverage] = await Promise.all([
      findOperationalClosureBlockers(prisma, employeeIds, period),
      employeeIds.length ? prisma.noveltyDayCoverage.findMany({ where: { period, employeeId: { in: employeeIds } }, select: { employeeId: true }, distinct: ["employeeId"] }) : Promise.resolve([]),
    ]);
    const reviewIds = withCoverage.map((row) => row.employeeId);
    const snapshots = reviewIds.length ? await buildClosureSnapshots(prisma, reviewIds, period) : new Map();
    const novelty = reviewIds.flatMap((employeeId) => noveltyReviewBlockers(byId.get(employeeId)!, period, pendingNoveltyReviewOf(snapshots.get(employeeId)).reviewDates));
    const groups = groupClosureBlockers([...operational, ...novelty]);
    return { period, employees: groups, totals: { employees: groups.length, blockers: operational.length + novelty.length } };
  },
  // `settleClockPunchPostProcess` (PERF-5D): lo pasa el controller (el worker
  // del post-proceso de fichadas depende de este módulo; así no hay ciclo).
  async closeClosures(period: string, employeeIds: string[], user: Express.AuthUser, audit?: AuditContext, hooks: { settleClockPunchPostProcess?: (scope: { employeeIds: string[] }) => Promise<unknown> } = {}) {
    await ensureVisible(employeeIds, user);
    // PERF-5D (docs/decisions/F12_PERF_5.md): Motor B de una salida corre en
    // el post-proceso durable de la fichada. Antes del snapshot se procesa en
    // línea lo pendiente de estos legajos (incluidos jobs FAILED); si algo
    // sigue sin terminar, el envío se bloquea (409) en vez de cerrar con
    // desgloses incompletos.
    await hooks.settleClockPunchPostProcess?.({ employeeIds });
    // Snapshot de auditoría del cierre (closureSnapshot.ts): base, Horas
    // normales residuales, conceptos, total trabajado y equivalencia con el
    // mismo modelo y criterio de estado que la grilla por legajo.
    // D-5 (ORG_LOCATION_REORGANIZATION.md §18.1): lock EXCLUSIVO por empleado +
    // período y snapshot armado DENTRO de la transacción: ninguna escritura
    // (carga, fichada, reinterpretación) puede intercalarse con el envío.
    const result = await execute(() => prisma.$transaction(async (tx) => {
      await lockClosurePeriods(tx, employeeIds.map((employeeId) => ({ employeeId, period })), "EXCLUSIVE");
      await assertClockPunchPostProcessSettled(tx, employeeIds, period);
      const alreadyClosed = await tx.monthlyTimeClosure.findMany({ where: { employeeId: { in: employeeIds }, period, status: "CERRADO" }, select: { employeeId: true } });
      if (alreadyClosed.length) throw new AppError("Uno o más períodos ya están cerrados.", 409, "MONTHLY_CLOSURE_ALREADY_CLOSED", { employeeIds: alreadyClosed.map((row) => row.employeeId) });
      // Criterio único con la vista previa de Cierres mensuales (closureBlockers.ts).
      const blockers = await findOperationalClosureBlockers(tx, employeeIds, period);
      if (blockers.length) {
        throw new AppError(closureBlockersMessage(blockers), 409, "CLOSURE_HAS_OPERATIONAL_BLOCKERS", { employees: groupClosureBlockers(blockers) });
      }
      const snapshots = await buildClosureSnapshots(tx, employeeIds, period);
      // NOVELTY_COVERAGE_ENGINE.md §12: un período con cobertura de novedades
      // en revisión no se consolida en silencio — se rechaza el envío completo.
      const pendingReview = employeeIds
        .map((employeeId) => ({ employeeId, ...pendingNoveltyReviewOf(snapshots.get(employeeId)) }))
        .filter((item) => item.reviewDays > 0);
      if (pendingReview.length) {
        const reference = await loadEmployeeReferences(tx, pendingReview.map((item) => item.employeeId));
        const detail = pendingReview.map((item) => `${reference(item.employeeId)}: ${item.reviewDays} día(s) (${item.reviewDates.map((date) => (date.length === 10 ? formatArgentinaDate(date) : date)).join(", ")})`).join("; ");
        throw new AppError(
          `No se puede cerrar: hay novedades con días para revisar. ${detail}.`,
          409,
          "CLOSURE_HAS_PENDING_NOVELTY_REVIEW",
          { employees: pendingReview.map((item) => ({ employeeId: item.employeeId, reviewDays: item.reviewDays, reviewDates: item.reviewDates })) },
        );
      }
      const saved = [];
      for (const employeeId of employeeIds) {
        const snapshot = snapshots.get(employeeId)!;
        saved.push(await tx.monthlyTimeClosure.upsert({ where: { employeeId_period: { employeeId, period } }, create: { employeeId, period, status: "CERRADO", snapshot, closedByUserId: user.id, closedAt: new Date() }, update: { status: "CERRADO", snapshot, closedByUserId: user.id, closedAt: new Date(), reopenedAt: null, reopenedByUserId: null, reopenReason: null } }));
      }
      return saved;
    }, CLOSURE_TRANSACTION_OPTIONS));
    // Una sola consulta de identidades para todo el lote (no una por legajo).
    const employeeReference = await loadEmployeeReferences(prisma, employeeIds);
    await Promise.all(result.map((item) => auditService.register({ ...audit, action: "UPDATE", entity: "MonthlyTimeClosure", entityId: item.id, description: `Se cerró definitivamente ${humanizePeriodEs(period)} de ${employeeReference(item.employeeId)}.`, after: item as Prisma.InputJsonValue })));
    return result;
  },
  async reopenClosure(id: string, input: { reason: string; acknowledgeExportedHistory: boolean }, user: Express.AuthUser, audit?: AuditContext) {
    const before = await prisma.monthlyTimeClosure.findFirst({ where: { id, employee: employeeAccessWhere(user) }, include: employeeReferenceInclude });
    if (!before) throw new AppError("No encontramos el cierre solicitado", 404, "MONTHLY_CLOSURE_NOT_FOUND");
    if (before.status !== "CERRADO") throw new AppError("El período ya está abierto.", 409, "MONTHLY_CLOSURE_ALREADY_OPEN");
    const { item, exportedBatches } = await execute(() => prisma.$transaction(async (tx) => {
      await lockClosurePeriods(tx, [before], "EXCLUSIVE");
      const current = await tx.monthlyTimeClosure.findUnique({ where: { id }, select: { status: true } });
      if (current?.status !== "CERRADO") throw new AppError("El período ya está abierto.", 409, "MONTHLY_CLOSURE_ALREADY_OPEN");
      const exportedBatches = await tx.finnegansExportBatch.findMany({ where: { period: before.period, items: { some: { employeeId: before.employeeId } } }, select: { id: true, version: true, createdAt: true }, orderBy: { version: "desc" } });
      if (exportedBatches.length && !input.acknowledgeExportedHistory) {
        throw new AppError("Este período ya fue exportado. Confirmá que comprendés que la reapertura no modifica las versiones históricas.", 409, "CLOSURE_REOPEN_EXPORTED_CONFIRMATION_REQUIRED", { exports: exportedBatches });
      }
      const item = await tx.monthlyTimeClosure.update({ where: { id }, data: { status: "ABIERTO", reopenedByUserId: user.id, reopenedAt: new Date(), reopenReason: input.reason } });
      return { item, exportedBatches };
    }, CLOSURE_TRANSACTION_OPTIONS));
    await auditService.register({ ...audit, action: "RETURN", entity: "MonthlyTimeClosure", entityId: id, description: `Se reabrió ${humanizePeriodEs(item.period)} de ${formatEmployeeReference(before.employee)} — motivo: ${input.reason}.`, before: before as Prisma.InputJsonValue, after: { item, exportedHistoryPreserved: exportedBatches } as unknown as Prisma.InputJsonValue });
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
  /**
   * R8: sólo plantillas de grupos administrables (`shiftGroupAccess.ts`); una
   * plantilla sin grupo es sólo de Nivel 1.
   */
  async shiftTemplates(scope: ShiftGroupScope) {
    const tomorrow = new Date(`${nextCalendarDateKey(todayArgentinaDateKey())}T00:00:00.000Z`);
    const rows = await prisma.shiftTemplate.findMany({
      ...(scope.all ? {} : { where: shiftTemplateWhereForScope(scope) }),
      orderBy: { startTime: "asc" },
      include: {
        ...SHIFT_TEMPLATE_GROUP_INCLUDE,
        _count: { select: {
          assignments: { where: { status: "HABILITADO", OR: [{ effectiveTo: null }, { effectiveTo: { gte: tomorrow } }] } },
          holidayWorkAssignments: { where: { status: "ACTIVA", date: { gte: tomorrow } } },
          rotationBlocks: { where: { day: { version: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: tomorrow } }] } } } },
        } },
      },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, inUseFromTomorrow: (_count?.assignments ?? 0) + (_count?.holidayWorkAssignments ?? 0) + (_count?.rotationBlocks ?? 0) > 0 }));
  },
  /** R8.3: el grupo de la plantilla tiene que ser administrable (sin grupo = sólo Nivel 1). */
  async createShiftTemplate(input: any, actor: ShiftActor, audit?: AuditContext) {
    assertShiftGroupWritable(actor, input.shiftGroupId ?? null);
    const crossesMidnight = input.endTime <= input.startTime;
    // R3.1: un grupo nuevo para la plantilla debe existir y estar ACTIVO.
    const group = await assertShiftGroupAssignable(input.shiftGroupId, null);
    const item = await execute(() => prisma.shiftTemplate.create({
      data: {
        ...input,
        crossesMidnight,
        expectedMinutes: computeExpectedMinutes(input.startTime, input.endTime, crossesMidnight),
        createdByUserId: audit?.userId || null,
        updatedByUserId: audit?.userId || null,
      },
      include: SHIFT_TEMPLATE_GROUP_INCLUDE,
    }));
    const groupPhrase = group ? ` Grupo: ${describeShiftGroup(group)}.` : "";
    await auditService.register({ ...audit, action: "CREATE", entity: "ShiftTemplate", entityId: item.id, description: `Se creó el turno ${item.code} - ${item.name}.${groupPhrase}`, after: item as Prisma.InputJsonValue });
    return item;
  },
  /**
   * R8.3: una plantilla de un grupo no administrable responde 404 (igual que
   * inexistente); moverla exige administrar también el grupo destino.
   */
  async updateShiftTemplate(id: string, input: any, actor: ShiftActor, audit?: AuditContext) {
    const { item, coverage, before, groupChanged, nextGroup } = await execute(() => prisma.$transaction(async (tx) => {
      // Mismo orden que el reemplazo fechado: cobertura global → plantilla.
      // Las ediciones de catálogo son infrecuentes y así no pueden cruzarse
      // con un plan de reemplazo ni con escritores por legajo.
      await lockNoveltyCoverageGlobally(tx);
      await tx.$queryRaw`SELECT id FROM "ShiftTemplate" WHERE id = ${id} FOR UPDATE`;
      const before = await tx.shiftTemplate.findUnique({ where: { id }, include: SHIFT_TEMPLATE_GROUP_INCLUDE });
      if (!before || !canManageShiftGroup(actor, before.shiftGroupId)) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
      // R3.1: cambiar el grupo es clasificación, no planificación horaria.
      const groupChanged = input.shiftGroupId !== undefined && (input.shiftGroupId ?? null) !== (before.shiftGroupId ?? null);
      if (groupChanged) assertShiftGroupWritable(actor, input.shiftGroupId ?? null);
      // R8.3: horario, tolerancias, límites o estado cambian lo que rige para
      // quienes la usan; nombre, código o categoría no.
      const changesEffect = Object.keys(input).some((field) => !SHIFT_TEMPLATE_DESCRIPTIVE_FIELDS.has(field) && input[field] !== (before as unknown as Record<string, unknown>)[field]);
      if (changesEffect) await assertTemplateEffectWritable(tx, actor, id);
      const nextGroup = groupChanged ? await assertShiftGroupAssignable(input.shiftGroupId, before.shiftGroupId ?? null, tx) : null;
      const startTime = input.startTime ?? before.startTime;
      const endTime = input.endTime ?? before.endTime;
      const crossesMidnight = endTime <= startTime;
      const expectedMinutes = computeExpectedMinutes(startTime, endTime, crossesMidnight);
      const scheduleChanged = startTime !== before.startTime || endTime !== before.endTime;
      const retiring = (input.status !== undefined && input.status !== before.status && input.status === "INACTIVO") || groupChanged;
      if (scheduleChanged || retiring) {
        const history = await shiftTemplateHistory(id, todayArgentinaDateKey(), tx);
        if (history.hasRuled) {
          const code = scheduleChanged ? "SHIFT_TEMPLATE_SCHEDULE_LOCKED" : "SHIFT_TEMPLATE_HISTORY_LOCKED";
          throw new AppError(scheduleChanged
            ? "El horario de este turno ya rigió y no se puede reescribir. Usá el reemplazo de horario con fecha para conservar el pasado."
            : "El turno ya rigió: no se puede inactivar ni cambiar de grupo porque eso alteraría la resolución histórica.", 409, code, history.sources);
        }
      }
      const rulesChanged = [
        "entryToleranceBeforeMinutes", "entryToleranceAfterMinutes", "exitToleranceBeforeMinutes", "exitToleranceAfterMinutes",
        "minimumMinutesForCompliance", "maximumInformativeMinutes", "missingOutAlertAfterMinutes", "absoluteOpenShiftLimitMinutes",
      ].some((field) => input[field] !== undefined && input[field] !== (before as unknown as Record<string, unknown>)[field]);
      if (rulesChanged) {
        const pending = await pendingFixedEntryJobs(id, tx);
        if (pending > 0) throw new AppError(`Hay ${pending} fichada(s) de entrada pendientes de procesar para este turno. Reprocesalas antes de cambiar tolerancias o límites.`, 409, "SHIFT_TEMPLATE_RULES_PENDING_PUNCHES", { pending });
      }
      // Horario, minutos o estado cambian la jornada esperada de quienes usan
      // el turno: misma transacción que el recálculo de su cobertura (etapa 5).
      const affectsWorkday = scheduleChanged || crossesMidnight !== before.crossesMidnight || expectedMinutes !== before.expectedMinutes || (input.status !== undefined && input.status !== before.status);
      const updated = await tx.shiftTemplate.update({
        where: { id },
        data: {
          ...input,
          crossesMidnight,
          expectedMinutes,
          updatedByUserId: audit?.userId || null,
        },
        include: SHIFT_TEMPLATE_GROUP_INCLUDE,
      });
      const recalculated = affectsWorkday ? await recalculateTemplateCoverage(tx, id, `cambio del turno ${updated.code} - ${updated.name}`) : null;
      return { item: updated, coverage: recalculated, before, groupChanged, nextGroup };
    }, SHIFT_TEMPLATE_TRANSACTION_OPTIONS));
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    await auditService.register({
      ...audit,
      action: input.status && input.status !== before.status ? input.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE" : "UPDATE",
      entity: "ShiftTemplate",
      entityId: id,
      description: `Se actualizó el turno ${item.code} - ${item.name}.${groupChanged ? shiftGroupAuditPhrase(before.shiftGroup, nextGroup) : ""}`,
      before: before as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
  // Revisión de la eliminación controlada: conteo, escritura y auditoría en una
  // transacción Serializable (una asignación o jornada concurrente aborta una
  // de las dos, nunca se borra en cascada en silencio). Las convocatorias de
  // feriado son historia como las jornadas: con ellas el turno se inactiva,
  // en vez de dejar su referencia en NULL.
  async removeShiftTemplate(id: string, actor: ShiftActor, audit?: AuditContext) {
    return execute(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShiftTemplate" WHERE id = ${id} FOR UPDATE`;
      const before = await tx.shiftTemplate.findUnique({ where: { id }, include: { _count: { select: { workShifts: true, assignments: true, holidayWorkAssignments: true, rotationBlocks: true } } } });
      if (!before || !canManageShiftGroup(actor, before.shiftGroupId)) throw new AppError("No encontramos el turno solicitado", 404, "SHIFT_TEMPLATE_NOT_FOUND");
      // R8.3: borrarla deja sin turno a sus convocatorias futuras (SetNull).
      await assertTemplateEffectWritable(tx, actor, id);
      const history = await shiftTemplateHistory(id, todayArgentinaDateKey(), tx);
      if (history.hasRuled) throw new AppError("El turno ya rigió y debe conservarse activo para no alterar la historia. Si cambia el horario, usá el reemplazo con fecha.", 409, "SHIFT_TEMPLATE_HISTORY_LOCKED", history.sources);
      if (before._count.rotationBlocks > 0) throw new AppError("No se puede eliminar el turno porque forma parte de una versión de rotación. Reemplazalo en una versión futura.", 409, "SHIFT_TEMPLATE_IN_ROTATION");
      if (before._count.assignments > 0) {
        throw new AppError("No se puede eliminar el turno porque tiene asignaciones de empleados asociadas", 409, "SHIFT_TEMPLATE_HAS_ASSIGNMENTS");
      }
      await tx.shiftTemplate.delete({ where: { id } });
      await auditService.registerWithin(tx, { ...audit, action: "DELETE", entity: "ShiftTemplate", entityId: id, description: `Se eliminó el turno sin uso ${before.code} - ${before.name}.`, before: before as Prisma.InputJsonValue });
      return { mode: "DELETED" as const, id, relatedWorkShifts: 0 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  },
  previewShiftTemplateScheduleReplacement(id: string, input: ReplaceShiftTemplateScheduleInput, actor: ShiftActor) {
    return shiftTemplateScheduleService.preview(id, input, actor);
  },
  replaceShiftTemplateSchedule(id: string, input: ReplaceShiftTemplateScheduleInput, actor: ShiftActor, audit?: AuditContext) {
    return shiftTemplateScheduleService.replace(id, input, actor, audit);
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
    await assertRuleDestinationsNotArchived(prisma, input);
    await assertRuleSectorSupported(input.sectorId);
    const { employeeIds, dates, ...data } = input;
    const { item, reinterpretation } = await execute(() => prisma.$transaction(async (tx) => {
      await lockNoveltyCoverageGlobally(tx);
      await assertRuleDestinationsNotArchived(tx, input, null, { lock: true });
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
    if (reinterpretation.noveltyCoverage) await auditNoveltyCoverageRecalculation(reinterpretation.noveltyCoverage, audit);
    return item;
  },
  async updateDoubleRule(id: string, input: any, audit?: AuditContext) {
    const before = await prisma.doubleHourRule.findUnique({ where: { id }, include: { employees: true, dates: true } });
    if (!before) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
    // Sólo se rechazan asignaciones NUEVAS: conservar sin cambio una FK ya
    // apuntando a un archivado es admitido (§12.4).
    await assertRuleDestinationsNotArchived(prisma, input, before);
    await assertRuleSectorSupported(input.sectorId, before.sectorId);
    const { employeeIds, dates, ...data } = input;
    const recurrenceType = data.recurrenceType ?? before.recurrenceType;
    const { item, reinterpretation } = await execute(() => prisma.$transaction(async (tx) => {
      await lockNoveltyCoverageGlobally(tx);
      // Autoritativa: contra las FKs de la regla leídas en esta transacción.
      const current = await tx.doubleHourRule.findUnique({ where: { id }, select: { companyId: true, sectorId: true, positionId: true } });
      if (!current) throw new AppError("No encontramos la regla solicitada", 404, "DOUBLE_HOUR_RULE_NOT_FOUND");
      await assertRuleDestinationsNotArchived(tx, input, current, { lock: true });
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
    if (reinterpretation.noveltyCoverage) await auditNoveltyCoverageRecalculation(reinterpretation.noveltyCoverage, audit);
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
  // Endpoint anterior (DELETE): mismo plan y misma corrección de orden que la
  // eliminación controlada, sin vista previa. Con períodos protegidos alcanzados, 409.
  async removeDoubleRule(id: string, audit?: AuditContext) {
    const coverage = await execute(() => prisma.$transaction(async (tx) => {
      const plan = await planDoubleRuleDeletionWithin(tx, id);
      if (plan.preview.blockers.length) {
        throw new AppError(plan.preview.blockers.map((item) => item.message).join(" "), 409, "DOUBLE_HOUR_RULE_PROTECTED_HISTORY", { protectedPeriods: plan.reinterpretation.protectedPeriods });
      }
      await deleteDoubleRuleWithin(tx, plan, audit);
      return plan.reinterpretation.noveltyCoverage;
    }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS));
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    return { mode: "DELETED" as const, id };
  },

  async previewDoubleRuleDeletion(id: string): Promise<DeletionPreview> {
    try {
      await prisma.$transaction(async (tx) => {
        const plan = await planDoubleRuleDeletionWithin(tx, id);
        throw new DeletionPreviewRollback(plan.preview);
      }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof DeletionPreviewRollback) return error.preview;
      mapPrismaError(error);
      throw error;
    }
    throw new AppError("No se pudo calcular la vista previa.", 500, "DELETION_PREVIEW_FAILED");
  },

  async executeDoubleRuleDeletion(id: string, confirmation: DeletionConfirmation, audit?: AuditContext) {
    const { preview, coverage } = await execute(() => prisma.$transaction(async (tx) => {
      await assertActorAuthorizedWithin(tx, audit?.userId, [roles.rrhh]);
      const plan = await planDoubleRuleDeletionWithin(tx, id);
      assertConfirmedPlan(plan.preview, confirmation);
      await deleteDoubleRuleWithin(tx, plan, audit);
      return { preview: plan.preview, coverage: plan.reinterpretation.noveltyCoverage };
    }, SPECIAL_HOUR_RULE_TRANSACTION_OPTIONS));
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    return { done: true, target: preview.target, groups: preview.groups };
  },
};
