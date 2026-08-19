import { Prisma } from "@prisma/client";
import type { OpenShiftOverflowAction, WorkRegimeKind } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { argentinaCalendarDate, argentinaDateKey } from "../../shared/datetime/argentinaTime";
import { findActiveEmployeeWorkRegime, workRegimesRepository } from "./workRegimes.repository";
import type {
  AssignWorkRegimeInput,
  CreateWorkRegimeInput,
  ListWorkRegimesQuery,
  UpdateWorkRegimeAssignmentInput,
  UpdateWorkRegimeInput,
} from "./workRegimes.schemas";

export interface ActiveWorkRegime {
  kind: WorkRegimeKind;
  alertOnOutOfShift: boolean;
  openShiftOverflowAction: OpenShiftOverflowAction;
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
  };
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

async function assertNoOverlap(employeeId: string, effectiveFrom: Date, effectiveTo: Date | null | undefined, excludeId?: string) {
  const overlapping = await workRegimesRepository.findOverlappingAssignment(employeeId, effectiveFrom, effectiveTo, excludeId);
  if (overlapping) {
    throw new AppError(
      `La vigencia se superpone con una asignación existente (${overlapping.workRegime.code} - ${overlapping.workRegime.name}, desde ${overlapping.effectiveFrom.toISOString().slice(0, 10)}${overlapping.effectiveTo ? ` hasta ${overlapping.effectiveTo.toISOString().slice(0, 10)}` : ""}).`,
      409,
      "WORK_REGIME_ASSIGNMENT_OVERLAP",
    );
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
    const item = await execute(() => workRegimesRepository.create(data, audit?.userId));
    await auditWorkRegimeChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateWorkRegimeInput, audit?: AuditContext) {
    const before = await execute(() => workRegimesRepository.findById(id));
    const item = await execute(() => workRegimesRepository.update(id, data, audit?.userId));
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

    const item = await workRegimesRepository.createAssignment({
      employeeId,
      workRegimeId: data.workRegimeId,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
      assignedByUserId: audit?.userId,
    });
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "EmployeeWorkRegime",
      entityId: item.id,
      description: `Se asignó el régimen laboral ${item.workRegime.code} - ${item.workRegime.name} al empleado desde ${data.effectiveFrom.toISOString().slice(0, 10)}.`,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async updateAssignment(employeeId: string, assignmentId: string, data: UpdateWorkRegimeAssignmentInput, audit?: AuditContext) {
    const before = await workRegimesRepository.findAssignmentById(employeeId, assignmentId);
    if (!before) throw new AppError("No encontramos la asignación de régimen solicitada", 404, "WORK_REGIME_ASSIGNMENT_NOT_FOUND");

    if (data.workRegimeId) {
      await execute(() => workRegimesRepository.findById(data.workRegimeId!));
    }

    const effectiveFrom = data.effectiveFrom ?? before.effectiveFrom;
    const effectiveTo = data.effectiveTo !== undefined ? data.effectiveTo : before.effectiveTo;
    await assertNoOverlap(employeeId, effectiveFrom, effectiveTo, assignmentId);

    const item = await workRegimesRepository.updateAssignment(assignmentId, {
      ...(data.workRegimeId ? { workRegimeId: data.workRegimeId } : {}),
      ...(data.effectiveFrom ? { effectiveFrom: data.effectiveFrom } : {}),
      ...(data.effectiveTo !== undefined ? { effectiveTo: data.effectiveTo } : {}),
    });
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeWorkRegime",
      entityId: item.id,
      description: `Se actualizó la asignación de régimen laboral del empleado (${item.workRegime.code} - ${item.workRegime.name}).`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },

  async closeAssignment(employeeId: string, assignmentId: string, effectiveTo: Date, audit?: AuditContext) {
    const before = await workRegimesRepository.findAssignmentById(employeeId, assignmentId);
    if (!before) throw new AppError("No encontramos la asignación de régimen solicitada", 404, "WORK_REGIME_ASSIGNMENT_NOT_FOUND");
    if (effectiveTo < before.effectiveFrom) {
      throw new AppError("effectiveTo no puede ser anterior a effectiveFrom", 400, "WORK_REGIME_ASSIGNMENT_INVALID_RANGE");
    }

    const item = await workRegimesRepository.updateAssignment(assignmentId, { effectiveTo });
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "EmployeeWorkRegime",
      entityId: item.id,
      description: `Se cerró la vigencia de la asignación de régimen laboral (${item.workRegime.code} - ${item.workRegime.name}) al ${effectiveTo.toISOString().slice(0, 10)}.`,
      before: before as unknown as Prisma.InputJsonValue,
      after: item as Prisma.InputJsonValue,
    });
    return item;
  },
};
