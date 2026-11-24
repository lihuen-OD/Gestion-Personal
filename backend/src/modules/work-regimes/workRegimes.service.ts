import { Prisma } from "@prisma/client";
import type { OpenShiftOverflowAction, WorkRegimeKind } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { lockEmployeeCoverage, lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, coverageWindowOf, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { argentinaCalendarDate, argentinaDateKey, formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import { mapAssociatedEmployee } from "../../shared/prisma/employeeAssociationQuery";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { classifyWorkRegimeVigency, findActiveEmployeeWorkRegime, findActiveEmployeeWorkRegimesForDate, workRegimesRepository } from "./workRegimes.repository";
import type {
  AssignWorkRegimeInput,
  CreateWorkRegimeInput,
  ListWorkRegimeEmployeesQuery,
  ListWorkRegimesQuery,
  UpdateWorkRegimeAssignmentInput,
  UpdateWorkRegimeInput,
} from "./workRegimes.schemas";
import { shiftRotationRepository } from "../shifts/shiftRotation.repository";
import { rangesOverlap } from "../shifts/shiftRotationReadiness";

export interface ActiveWorkRegime {
  kind: WorkRegimeKind;
  alertOnOutOfShift: boolean;
  openShiftOverflowAction: OpenShiftOverflowAction;
  // Etapa 10D: umbral en minutos para JORNADA_EXTENDIDA — null = el régimen
  // no opina, el llamador debe caer al umbral del turno o al default (600 min).
  extendedShiftAlertMinutes: number | null;
}

// Etapa 15M.7C: fuente semántica única para decidir si la ausencia de un
// turno válido constituye un hallazgo. `alertOnOutOfShift` queda como opción
// histórica para TURNO_OBLIGATORIO, pero nunca puede contradecir un régimen
// cuyo propio kind declara que no requiere turno.
// El cambio de régimen y el recálculo de la cobertura de novedades van juntos (etapa 5).
const WORK_REGIME_TRANSACTION_OPTIONS = { timeout: 30_000 };

export function shouldSuppressMissingShiftAlert(regime: Pick<ActiveWorkRegime, "kind" | "alertOnOutOfShift"> | null): boolean {
  if (!regime) return false;
  if (regime.kind === "SIN_TURNO" || regime.kind === "TURNO_FLEXIBLE") return true;
  return !regime.alertOnOutOfShift;
}

function normalizeShiftAlertPolicy<T extends { kind?: WorkRegimeKind; alertOnOutOfShift?: boolean }>(data: T, previousKind?: WorkRegimeKind): T {
  if (data.kind === "SIN_TURNO" || data.kind === "TURNO_FLEXIBLE") {
    return { ...data, alertOnOutOfShift: false };
  }
  if (data.kind === "TURNO_OBLIGATORIO" && previousKind && previousKind !== "TURNO_OBLIGATORIO" && data.alertOnOutOfShift === undefined) {
    return { ...data, alertOnOutOfShift: true };
  }
  return data;
}

// Resuelve el régimen vigente de un empleado para la fecha calendario
// Argentina del instante dado. Devuelve null si no tiene ningún régimen
// asignado para esa fecha — en ese caso el llamador debe comportarse
// exactamente igual que si el módulo de régimen no existiera.
export async function resolveActiveWorkRegime(employeeId: string, instant: Date): Promise<ActiveWorkRegime | null> {
  const referenceDate = argentinaCalendarDate(argentinaDateKey(instant));
  const assignment = await findActiveEmployeeWorkRegime(employeeId, referenceDate);
  if (!assignment) return null;
  return {
    kind: assignment.workRegime.kind,
    alertOnOutOfShift: assignment.workRegime.alertOnOutOfShift,
    openShiftOverflowAction: assignment.workRegime.openShiftOverflowAction,
    extendedShiftAlertMinutes: assignment.workRegime.extendedShiftAlertMinutes,
  };
}

// Etapa 15M.19B: versión batch de resolveActiveWorkRegime — un Map en vez de
// N llamadas individuales (usado por workObligation.service.ts, que evalúa
// muchos empleados candidatos por corrida). El orden `effectiveFrom desc` +
// "el primero que aparece por empleado gana" reproduce el mismo desempate
// que `findFirst` en la versión de un solo empleado.
export async function resolveActiveWorkRegimesForDate(referenceDate: Date): Promise<Map<string, ActiveWorkRegime>> {
  const rows = await findActiveEmployeeWorkRegimesForDate(referenceDate);
  const byEmployee = new Map<string, ActiveWorkRegime>();
  for (const row of rows) {
    if (byEmployee.has(row.employeeId)) continue;
    byEmployee.set(row.employeeId, {
      kind: row.workRegime.kind,
      alertOnOutOfShift: row.workRegime.alertOnOutOfShift,
      openShiftOverflowAction: row.workRegime.openShiftOverflowAction,
      extendedShiftAlertMinutes: row.workRegime.extendedShiftAlertMinutes,
    });
  }
  return byEmployee;
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("El código de régimen laboral ya existe", 409, "WORK_REGIME_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("No encontramos el régimen laboral solicitado", 404, "WORK_REGIME_NOT_FOUND");
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

async function auditWorkRegimeChange(
  action: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE",
  item: { id: string; code: string; name: string },
  audit: AuditContext | undefined,
  before?: unknown,
) {
  const verb = { CREATE: "Se creó", UPDATE: "Se actualizó", ACTIVATE: "Se activó", DEACTIVATE: "Se inactivó" }[action];
  await auditService.register({
    ...audit,
    action,
    entity: "WorkRegime",
    entityId: item.id,
    description: `${verb} el régimen laboral ${item.code} - ${item.name}.`,
    before: before as Prisma.InputJsonValue | undefined,
    after: item as Prisma.InputJsonValue,
  });
}

async function assertEmployeeExists(employeeId: string) {
  const employee = await workRegimesRepository.employeeExists(employeeId);
  if (!employee) throw new AppError("No encontramos el empleado solicitado", 404, "EMPLOYEE_NOT_FOUND");
}

async function assertNoOverlap(employeeId: string, effectiveFrom: Date, effectiveTo: Date | null | undefined, excludeId?: string, db?: PrismaTransactionClient) {
  const overlapping = await workRegimesRepository.findOverlappingAssignment(employeeId, effectiveFrom, effectiveTo, excludeId, db);
  if (overlapping) {
    throw new AppError(
      `La vigencia se superpone con una asignación existente (${overlapping.workRegime.code} - ${overlapping.workRegime.name}, desde ${formatArgentinaDate(overlapping.effectiveFrom)}${overlapping.effectiveTo ? ` hasta ${formatArgentinaDate(overlapping.effectiveTo)}` : ""}).`,
      409,
      "WORK_REGIME_ASSIGNMENT_OVERLAP",
    );
  }
}

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

async function assertSinTurnoWithoutRotation(employeeId: string, effectiveFrom: Date, effectiveTo: Date | null | undefined, db: PrismaTransactionClient) {
  const memberships = await shiftRotationRepository.overlappingMemberships(employeeId ? [employeeId] : [], dateKey(effectiveFrom), effectiveTo ? dateKey(effectiveTo) : null, db);
  if (memberships.length) {
    const row = memberships[0]!;
    throw new AppError(`El régimen SIN_TURNO se superpone con la rotación ${row.crew.rotation.code} - ${row.crew.rotation.name}, equipo ${row.crew.code} - ${row.crew.name}. Cerrá primero la membresía.`, 409, "WORK_REGIME_OVERLAPS_ROTATION");
  }
}

export const workRegimesService = {
  async list(query: ListWorkRegimesQuery) {
    const [items, total] = await workRegimesRepository.findMany(query);
    return {
      items,
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },

  getById(id: string) {
    return execute(() => workRegimesRepository.findById(id));
  },

  async create(data: CreateWorkRegimeInput, audit?: AuditContext) {
    const normalizedData = normalizeShiftAlertPolicy(data);
    const item = await execute(() => workRegimesRepository.create(normalizedData, audit?.userId));
    await auditWorkRegimeChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateWorkRegimeInput, audit?: AuditContext) {
    const before = await execute(() => workRegimesRepository.findById(id));
    const normalizedData = normalizeShiftAlertPolicy(data, before.kind);
    // El tipo (obligatorio/flexible/sin turno) decide la jornada esperada de
    // todos los legajos con ese régimen: misma transacción que el recálculo
    // de su cobertura (NOVELTY_COVERAGE_ENGINE.md §13.2). Otros campos no la cambian.
    const kindChanged = normalizedData.kind !== undefined && normalizedData.kind !== before.kind;
    const { item, coverage } = kindChanged
      ? await execute(() => prisma.$transaction(async (tx) => {
          await lockNoveltyCoverageGlobally(tx);
          const assignments = await tx.employeeWorkRegime.findMany({ where: { workRegimeId: id }, select: { employeeId: true, effectiveFrom: true, effectiveTo: true } });
          if (normalizedData.kind === "SIN_TURNO" && assignments.length) {
            const byEmployee = new Map(assignments.map((row) => [row.employeeId, row]));
            const memberships = await tx.shiftRotationCrewMember.findMany({
              where: { employeeId: { in: [...byEmployee.keys()] } },
              include: { crew: { include: { rotation: { select: { code: true, name: true } } } } },
            });
            const conflict = memberships.find((member) => {
              const assignment = byEmployee.get(member.employeeId)!;
              return rangesOverlap(dateKey(assignment.effectiveFrom), assignment.effectiveTo ? dateKey(assignment.effectiveTo) : null, dateKey(member.effectiveFrom), member.effectiveTo ? dateKey(member.effectiveTo) : null);
            });
            if (conflict) throw new AppError(`No se puede convertir el régimen a SIN_TURNO porque una asignación se superpone con la rotación ${conflict.crew.rotation.code} - ${conflict.crew.rotation.name}.`, 409, "WORK_REGIME_OVERLAPS_ROTATION");
          }
          const updated = await workRegimesRepository.update(id, normalizedData, audit?.userId, tx);
          const window = coverageWindowOf(assignments.map((row) => ({ from: row.effectiveFrom, to: row.effectiveTo })));
          const recalculated = window
            ? await recalculateNoveltyCoverage(tx, { employeeIds: [...new Set(assignments.map((row) => row.employeeId))], ...window }, { source: "WORK_REGIME_CHANGED", label: `cambio del tipo del régimen ${updated.code} - ${updated.name}` })
            : null;
          return { item: updated, coverage: recalculated };
        }, WORK_REGIME_TRANSACTION_OPTIONS))
      : { item: await execute(() => workRegimesRepository.update(id, normalizedData, audit?.userId)), coverage: null };
    if (coverage) await auditNoveltyCoverageRecalculation(coverage, audit);
    const action = data.status && data.status !== before.status ? (data.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await auditWorkRegimeChange(action, item, audit, before);
    return item;
  },

  async updateStatus(id: string, status: "ACTIVO" | "INACTIVO", audit?: AuditContext) {
    return workRegimesService.update(id, { status }, audit);
  },

  async getHistory(employeeId: string) {
    await assertEmployeeExists(employeeId);
    return workRegimesRepository.findHistoryByEmployee(employeeId);
  },

  async getCurrent(employeeId: string, date: Date | undefined) {
    await assertEmployeeExists(employeeId);
    const referenceDate = argentinaCalendarDate(argentinaDateKey(date ?? new Date()));
    return findActiveEmployeeWorkRegime(employeeId, referenceDate);
  },

  async assign(employeeId: string, data: AssignWorkRegimeInput, audit?: AuditContext) {
    await assertEmployeeExists(employeeId);
    await execute(() => workRegimesRepository.findById(data.workRegimeId));
    await assertNoOverlap(employeeId, data.effectiveFrom, data.effectiveTo);

    const { item, coverage } = await prisma.$transaction(async (tx) => {
      await lockEmployeeCoverage(tx, [employeeId]);
      await assertNoOverlap(employeeId, data.effectiveFrom, data.effectiveTo, undefined, tx);
      // Releer después del lock compartido con rotaciones: el catálogo pudo
      // cambiar de kind mientras esta asignación esperaba la transacción.
      const lockedRegime = await execute(() => workRegimesRepository.findById(data.workRegimeId, tx));
      if (lockedRegime.kind === "SIN_TURNO") await assertSinTurnoWithoutRotation(employeeId, data.effectiveFrom, data.effectiveTo, tx);
      const created = await workRegimesRepository.createAssignment({
        employeeId,
        workRegimeId: data.workRegimeId,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        assignedByUserId: audit?.userId,
      }, tx);
      const recalculated = await recalculateNoveltyCoverage(
        tx,
        { employeeIds: [employeeId], from: data.effectiveFrom, to: data.effectiveTo ?? null },
        { source: "WORK_REGIME_CHANGED", label: `asignación del régimen ${created.workRegime.code} - ${created.workRegime.name}` },
      );
      return { item: created, coverage: recalculated };
    }, WORK_REGIME_TRANSACTION_OPTIONS);
    // Etapa 10B: entityId debe ser employeeId (no item.id, el id de la
    // asignación) — mismo criterio ya usado en todo employees.service.ts
    // (entity nombra qué cambió, entityId siempre ancla al legajo) — es lo
    // que permite que este evento aparezca en el tab "Historial de Eventos"/
    // "Auditoría" del propio legajo, que filtra por entityId=employee.id
    // (hallazgo 10A §7/§11, antes quedaba invisible ahí).
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "EmployeeWorkRegime",
      entityId: employeeId,
      description: `Se asignó el régimen laboral ${item.workRegime.code} - ${item.workRegime.name} al empleado desde ${formatArgentinaDate(data.effectiveFrom)}.`,
      after: item as Prisma.InputJsonValue,
    });
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return item;
  },

  async updateAssignment(employeeId: string, assignmentId: string, data: UpdateWorkRegimeAssignmentInput, audit?: AuditContext) {
    const before = await workRegimesRepository.findAssignmentById(employeeId, assignmentId);
    if (!before) throw new AppError("No encontramos la asignación de régimen solicitada", 404, "WORK_REGIME_ASSIGNMENT_NOT_FOUND");

    const requestedRegimeId = data.workRegimeId;
    if (requestedRegimeId) await execute(() => workRegimesRepository.findById(requestedRegimeId));

    const effectiveFrom = data.effectiveFrom ?? before.effectiveFrom;
    const effectiveTo = data.effectiveTo !== undefined ? data.effectiveTo : before.effectiveTo;
    await assertNoOverlap(employeeId, effectiveFrom, effectiveTo, assignmentId);

    const { item, coverage } = await prisma.$transaction(async (tx) => {
      await lockEmployeeCoverage(tx, [employeeId]);
      await assertNoOverlap(employeeId, effectiveFrom, effectiveTo, assignmentId, tx);
      const targetRegimeId = requestedRegimeId ?? before.workRegimeId;
      const lockedRegime = await execute(() => workRegimesRepository.findById(targetRegimeId, tx));
      if (lockedRegime.kind === "SIN_TURNO") await assertSinTurnoWithoutRotation(employeeId, effectiveFrom, effectiveTo, tx);
      const updated = await workRegimesRepository.updateAssignment(assignmentId, {
        ...(data.workRegimeId ? { workRegimeId: data.workRegimeId } : {}),
        ...(data.effectiveFrom ? { effectiveFrom: data.effectiveFrom } : {}),
        ...(data.effectiveTo !== undefined ? { effectiveTo: data.effectiveTo } : {}),
      }, tx);
      const window = coverageWindowOf([{ from: before.effectiveFrom, to: before.effectiveTo }, { from: updated.effectiveFrom, to: updated.effectiveTo }])!;
      const recalculated = await recalculateNoveltyCoverage(tx, { employeeIds: [employeeId], ...window }, { source: "WORK_REGIME_CHANGED", label: `cambio de la asignación del régimen ${updated.workRegime.code} - ${updated.workRegime.name}` });
      return { item: updated, coverage: recalculated };
    }, WORK_REGIME_TRANSACTION_OPTIONS);
    // Etapa 10B: entityId=employeeId, mismo criterio que assign() arriba.
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeWorkRegime",
      entityId: employeeId,
      description: `Se actualizó la asignación de régimen laboral del empleado (${item.workRegime.code} - ${item.workRegime.name}).`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return item;
  },

  async closeAssignment(employeeId: string, assignmentId: string, effectiveTo: Date, audit?: AuditContext) {
    const before = await workRegimesRepository.findAssignmentById(employeeId, assignmentId);
    if (!before) throw new AppError("No encontramos la asignación de régimen solicitada", 404, "WORK_REGIME_ASSIGNMENT_NOT_FOUND");
    if (effectiveTo < before.effectiveFrom) {
      throw new AppError("effectiveTo no puede ser anterior a effectiveFrom", 400, "WORK_REGIME_ASSIGNMENT_INVALID_RANGE");
    }

    const { item, coverage } = await prisma.$transaction(async (tx) => {
      await lockEmployeeCoverage(tx, [employeeId]);
      const updated = await workRegimesRepository.updateAssignment(assignmentId, { effectiveTo }, tx);
      const window = coverageWindowOf([{ from: before.effectiveFrom, to: before.effectiveTo }, { from: updated.effectiveFrom, to: updated.effectiveTo }])!;
      const recalculated = await recalculateNoveltyCoverage(tx, { employeeIds: [employeeId], ...window }, { source: "WORK_REGIME_CHANGED", label: `cierre de la asignación del régimen ${updated.workRegime.code} - ${updated.workRegime.name}` });
      return { item: updated, coverage: recalculated };
    }, WORK_REGIME_TRANSACTION_OPTIONS);
    // Etapa 10B: entityId=employeeId, mismo criterio que assign()/updateAssignment() arriba.
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeWorkRegime",
      entityId: employeeId,
      description: `Se cerró la vigencia de la asignación de régimen laboral (${item.workRegime.code} - ${item.workRegime.name}) al ${formatArgentinaDate(effectiveTo)}.`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return item;
  },

  async listEmployees(workRegimeId: string, query: ListWorkRegimeEmployeesQuery, user: Express.AuthUser) {
    await execute(() => workRegimesRepository.findById(workRegimeId));
    const referenceDate = argentinaCalendarDate(argentinaDateKey(query.date ?? new Date()));
    const [rows, total] = await workRegimesRepository.findEmployees(workRegimeId, query, referenceDate, employeeAccessWhere(user));
    const items = rows.map((row) => ({
      id: row.id,
      employeeId: row.employee.id,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      vigencyStatus: classifyWorkRegimeVigency(row.effectiveFrom, row.effectiveTo, referenceDate),
      employee: mapAssociatedEmployee(row.employee),
    }));
    return {
      items,
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },
};
