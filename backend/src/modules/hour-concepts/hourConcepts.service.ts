import { Prisma } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { mapAssociatedEmployee } from "../../shared/prisma/employeeAssociationQuery";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { hourConceptsRepository, invalidateHourConceptsCache } from "./hourConcepts.repository";
import type {
  CreateHourConceptInput,
  EnableHourConceptEmployeesInput,
  ListHourConceptEmployeesQuery,
  ListHourConceptsQuery,
  UpdateHourConceptInput,
} from "./hourConcepts.schemas";

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AppError("Hour concept code already exists", 409, "HOUR_CONCEPT_UNIQUE_CONSTRAINT");
    }
    if (error.code === "P2025") {
      throw new AppError("Hour concept not found", 404, "HOUR_CONCEPT_NOT_FOUND");
    }
    if (error.code === "P2003") {
      throw new AppError("Related employee or hour concept not found", 400, "RELATION_CONSTRAINT");
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

async function auditChange(action: "CREATE" | "UPDATE", item: { id: string; code: string; name: string }, audit?: AuditContext) {
  await auditService.register({
    ...audit,
    action,
    entity: "HourConcept",
    entityId: item.id,
    description: `${action === "CREATE" ? "Se creo" : "Se actualizo"} el concepto horario ${item.code} - ${item.name}.`,
    after: item as Prisma.InputJsonValue,
  });
}

function assertAssignableAdditionalConcept(item: { systemRole?: string | null }) {
  if (item.systemRole === "NORMAL_BASE") {
    throw new AppError("Horas normales es la grilla base y no se asigna por legajo", 409, "HOUR_CONCEPT_BASE_NOT_ASSIGNABLE");
  }
}

function assertActiveAssignableAdditionalConcept(item: { systemRole?: string | null; status?: string; deletedAt?: Date | null }) {
  assertAssignableAdditionalConcept(item);
  if (item.status !== "ACTIVO" || item.deletedAt) {
    throw new AppError("Sólo se pueden asignar conceptos adicionales activos", 409, "HOUR_CONCEPT_NOT_ASSIGNABLE");
  }
}

function assertNotSystemManaged(item: { systemRole?: string | null }) {
  if (item.systemRole === "NORMAL_BASE") {
    throw new AppError("El concepto base Horas normales es administrado por el sistema", 409, "HOUR_CONCEPT_SYSTEM_MANAGED");
  }
}

export const hourConceptsService = {
  async list(query: ListHourConceptsQuery) {
    const [items, total] = await hourConceptsRepository.findMany(query);
    return {
      items,
      meta: {
        total,
        page: query.page,
        pageSize: query.take,
        hasMore: query.page * query.take < total,
      },
    };
  },

  async create(data: CreateHourConceptInput, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.create(data));
    invalidateHourConceptsCache();
    await auditChange("CREATE", item, audit);
    return item;
  },

  async update(id: string, data: UpdateHourConceptInput, audit?: AuditContext) {
    const current = await execute(() => hourConceptsRepository.findById(id));
    assertNotSystemManaged(current);
    const item = await execute(() => hourConceptsRepository.update(id, data));
    invalidateHourConceptsCache();
    await auditChange("UPDATE", item, audit);
    return item;
  },

  async listEmployees(hourConceptId: string, query: ListHourConceptEmployeesQuery, user: Express.AuthUser) {
    await execute(() => hourConceptsRepository.findById(hourConceptId));
    const [rows, total] = await hourConceptsRepository.findEmployees(hourConceptId, query, employeeAccessWhere(user));
    const items = rows.map((row) => ({
      employeeId: row.employeeId,
      employee: mapAssociatedEmployee(row.employee),
    }));
    return {
      items,
      meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total },
    };
  },

  // Habilitar/quitar empleados desde el propio concepto (Etapa 8N) — mismo
  // join EmployeeHourConcept que ya escribe employeesService.replaceHourConcepts
  // desde el legajo (reutiliza el repository, no duplica la escritura), pero
  // agrega/quita puntualmente en vez de reemplazar todo el set del empleado.
  async enableEmployees(hourConceptId: string, input: EnableHourConceptEmployeesInput, audit?: AuditContext) {
    const concept = await execute(() => hourConceptsRepository.findById(hourConceptId));
    assertActiveAssignableAdditionalConcept(concept);
    const employeeIds = Array.from(new Set(input.employeeIds));
    const existingEmployees = await hourConceptsRepository.countExistingEmployees(employeeIds);
    if (existingEmployees !== employeeIds.length) throw new AppError("Uno o más empleados no existen", 404, "EMPLOYEE_NOT_FOUND");

    await execute(() => hourConceptsRepository.enableForEmployees(hourConceptId, employeeIds));
    await auditService.register({
      ...audit,
      action: "CREATE",
      entity: "EmployeeHourConcept",
      entityId: hourConceptId,
      description: `Se habilitó el concepto horario para ${employeeIds.length} empleado(s).`,
      after: { hourConceptId, employeeIds } as Prisma.InputJsonValue,
    });
    return { hourConceptId, employeeIds };
  },

  async disableEmployee(hourConceptId: string, employeeId: string, audit?: AuditContext) {
    const concept = await execute(() => hourConceptsRepository.findById(hourConceptId));
    assertAssignableAdditionalConcept(concept);
    const existing = await hourConceptsRepository.findEmployeeHourConcept(hourConceptId, employeeId);
    if (!existing) throw new AppError("El empleado no tiene este concepto habilitado", 404, "EMPLOYEE_HOUR_CONCEPT_NOT_FOUND");

    await execute(() => hourConceptsRepository.disableForEmployee(hourConceptId, employeeId));
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "EmployeeHourConcept",
      entityId: hourConceptId,
      description: `Se quitó el concepto horario del empleado ${employeeId}.`,
      before: existing as Prisma.InputJsonValue,
    });
    return { hourConceptId, employeeId };
  },

  // Eliminación (Etapa 8O/8P):
  // - Sin uso real (las 6 relaciones en cero): delete físico, igual que 8O.
  // - Con uso y force=false: 409, no borra nada — el frontend debe volver a
  //   pedir confirmación explícita con force=true (nunca se decide solo).
  // - Con uso y force=true: baja lógica (status INACTIVO + deletedAt). Nunca
  //   toca TimeEntry/TimeSegment/WorkShift/Novelty — esas 4 relaciones son
  //   historial real y dos de ellas (TimeEntry/TimeSegment) tienen FK
  //   obligatoria sin onDelete explícito (Restrict por default de Prisma),
  //   así que un delete físico ni siquiera podría ejecutarse mientras
  //   existan filas ahí. Solo se desvincula lo que es configuración pura:
  //   empleados habilitados (delete real, sin valor histórico) y reglas
  //   horarias (desactivadas, no borradas).
  async remove(id: string, force: boolean, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.findWithUsage(id));
    assertNotSystemManaged(item);
    const usageCount =
      item._count.employees +
      item._count.timeEntries +
      item._count.novelties +
      item._count.timeSegments +
      item._count.workShifts +
      item._count.rules;

    if (usageCount === 0) {
      await execute(() => hourConceptsRepository.delete(id));
      invalidateHourConceptsCache();
      await auditService.register({
        ...audit,
        action: "DELETE",
        entity: "HourConcept",
        entityId: item.id,
        description: `Se eliminó el concepto horario ${item.code} - ${item.name} (sin uso histórico).`,
        before: { id: item.id, code: item.code, name: item.name } as Prisma.InputJsonValue,
      });
      return { id: item.id, code: item.code, name: item.name, mode: "DELETED" as const };
    }

    if (!force) {
      throw new AppError(
        "Este concepto tiene uso histórico. Podés eliminarlo de todas formas (se conserva la trazabilidad de lo ya cargado) o deshabilitarlo.",
        409,
        "HOUR_CONCEPT_IN_USE",
      );
    }

    await execute(() => hourConceptsRepository.disableAllEmployees(id));
    await execute(() => hourConceptsRepository.deactivateAllRules(id));
    const softDeleted = await execute(() => hourConceptsRepository.softDelete(id));
    invalidateHourConceptsCache();
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "HourConcept",
      entityId: item.id,
      description:
        `Se eliminó (baja lógica) el concepto horario ${item.code} - ${item.name} con uso histórico: ` +
        `se desvincularon ${item._count.employees} empleado(s) habilitado(s) y se desactivaron ${item._count.rules} regla(s). ` +
        `El historial se conserva intacto (${item._count.timeEntries} entrada(s) de horas, ${item._count.timeSegments} segmento(s), ` +
        `${item._count.workShifts} turno(s), ${item._count.novelties} novedad(es)).`,
      before: { id: item.id, code: item.code, name: item.name, usage: item._count } as Prisma.InputJsonValue,
    });
    return { id: softDeleted.id, code: softDeleted.code, name: softDeleted.name, mode: "SOFT_DELETED" as const };
  },
};
