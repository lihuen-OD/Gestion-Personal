import { Prisma, type HourConceptWorkTreatment } from "@prisma/client";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { AppError } from "../../shared/errors/AppError";
import { mapAssociatedEmployee } from "../../shared/prisma/employeeAssociationQuery";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";
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
      throw new AppError("Ese código acaba de ser utilizado. Solicitá uno nuevo e intentá nuevamente.", 409, "HOUR_CONCEPT_UNIQUE_CONSTRAINT");
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

function assertActiveAssignableAdditionalConcept(item: { systemRole?: string | null; status?: string }) {
  assertAssignableAdditionalConcept(item);
  if (item.status !== "ACTIVO") {
    throw new AppError("Sólo se pueden asignar conceptos adicionales activos", 409, "HOUR_CONCEPT_NOT_ASSIGNABLE");
  }
}

function assertNotSystemManaged(item: { systemRole?: string | null }) {
  if (item.systemRole === "NORMAL_BASE") {
    throw new AppError("El concepto base Horas normales es administrado por el sistema", 409, "HOUR_CONCEPT_SYSTEM_MANAGED");
  }
}

// Mismo lenguaje de negocio que la UI (frontend/src/utils/workedTimeAccounting.ts).
const workTreatmentLabels: Record<HourConceptWorkTreatment, string> = {
  WITHIN_BASE: "Dentro de la jornada",
  ADDITIVE_TO_WORKED_TOTAL: "Horas adicionales",
};

function treatmentLabel(treatment: HourConceptWorkTreatment | null) {
  return treatment ? workTreatmentLabels[treatment] : "sin tratamiento";
}

// La eliminación corre en una transacción: si mientras tanto se cargó una
// hora con este concepto, la FK RESTRICT la aborta entera (no borra nada).
async function executeRemoval<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AppError("Se cargaron horas de este concepto mientras se eliminaba. No se borró nada; volvé a intentarlo.", 409, "HOUR_CONCEPT_CHANGED_DURING_DELETE");
    }
    mapPrismaError(error);
    throw error;
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

  async nextCode() {
    const rows = await hourConceptsRepository.findGeneratedCodes();
    const occupied = new Set(
      rows
        .map(({ code }) => /^HOR-(\d+)$/.exec(code)?.[1])
        .filter((value): value is string => value !== undefined)
        .map(Number),
    );
    let next = 1;
    while (occupied.has(next)) next += 1;
    return { code: `HOR-${String(next).padStart(3, "0")}` };
  },

  async create(data: CreateHourConceptInput, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.create(data));
    invalidateHourConceptsCache();
    await auditChange("CREATE", item, audit);
    return item;
  },

  // workTreatment es una clasificación corregible por RRHH
  // (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §2): si cambia, los
  // desgloses conservan sus minutos y toda la historia se lee con el
  // tratamiento nuevo; los snapshots de cierre afectados se recalculan.
  async update(id: string, data: UpdateHourConceptInput, audit?: AuditContext) {
    const current = await execute(() => hourConceptsRepository.findById(id));
    assertNotSystemManaged(current);
    const treatmentChanged = data.workTreatment !== undefined && data.workTreatment !== current.workTreatment;
    if (!treatmentChanged) {
      const item = await execute(() => hourConceptsRepository.update(id, data));
      invalidateHourConceptsCache();
      await auditChange("UPDATE", item, audit);
      return item;
    }

    const { item, reinterpreted, rebuiltClosures } = await execute(() =>
      hourConceptsRepository.updateReinterpretingHistory(id, data, {
        reason: "HOUR_CONCEPT_WORK_TREATMENT_CHANGED",
        hourConceptId: id,
        hourConceptCode: current.code,
      }),
    );
    invalidateHourConceptsCache();
    const change = `de "${treatmentLabel(current.workTreatment)}" a "${treatmentLabel(item.workTreatment)}"`;
    await auditService.register({
      ...audit,
      action: "UPDATE",
      entity: "HourConcept",
      entityId: item.id,
      description:
        `Se corrigió el tratamiento del concepto horario ${item.code} - ${item.name} ${change}. ` +
        `${reinterpreted.breakdowns} desglose(s) de ${reinterpreted.employees} legajo(s) en ${reinterpreted.periods} período(s) conservan sus minutos ` +
        `y se leen con el tratamiento nuevo; se recalcularon ${rebuiltClosures.length} cierre(s).`,
      before: current as Prisma.InputJsonValue,
      after: { ...item, reinterpreted, recalculatedClosureIds: rebuiltClosures.map((closure) => closure.id) } as Prisma.InputJsonValue,
    });
    await auditClosureRecalculations(rebuiltClosures, `corrección del tratamiento de ${item.code} - ${item.name} (${change})`, audit, hourConceptsRepository.employeeReferences);
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
      description: `Se habilitó el concepto horario ${concept.name} para ${employeeIds.length} empleado(s).`,
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
      description: `Se quitó el concepto horario ${concept.name} de ${formatEmployeeReference(existing.employee)}.`,
      before: existing as Prisma.InputJsonValue,
    });
    return { hourConceptId, employeeId };
  },

  // Eliminar definitivamente = configuración creada por error
  // (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md §14). Borra el concepto y
  // su historial específico; conserva fichadas, jornadas y Horas base. Para
  // conservar la historia de un concepto válido se deshabilita, no se elimina.
  async remove(id: string, audit?: AuditContext) {
    const item = await execute(() => hourConceptsRepository.findWithUsage(id));
    assertNotSystemManaged(item);
    // Un TimeEntry de un concepto adicional es del modelo previo a 6L, cuando
    // la jornada fichada se guardaba con el concepto elegido: esos minutos
    // pueden ser trabajo real. No se borran ni se reclasifican a ciegas.
    if (item._count.timeEntries > 0) {
      throw new AppError(
        `Este concepto tiene ${item._count.timeEntries} carga(s) de horas del modelo anterior que pueden ser jornada trabajada. ` +
          "No se puede eliminar definitivamente sin revisarlas; deshabilitalo para que no se use más.",
        409,
        "HOUR_CONCEPT_HAS_LEGACY_TIME_ENTRIES",
      );
    }

    const result = await executeRemoval(() =>
      hourConceptsRepository.deletePermanently(id, { reason: "HOUR_CONCEPT_DELETED", hourConceptId: id, hourConceptCode: item.code }),
    );
    invalidateHourConceptsCache();
    const { rebuiltClosures, ...summary } = result;
    await auditService.register({
      ...audit,
      action: "DELETE",
      entity: "HourConcept",
      entityId: item.id,
      description:
        `Se eliminó definitivamente el concepto horario ${item.code} - ${item.name}: ` +
        `${summary.deletedBreakdowns} desglose(s), ${summary.deletedRules} regla(s) y ${summary.deletedEmployeeAssignments} habilitación(es) por legajo borradas; ` +
        `${summary.reclassifiedSegments} tramo(s) y ${summary.reclassifiedWorkShifts} jornada(s) reclasificados a Hora normal; ` +
        `${summary.unlinkedNovelties} novedad(es) desvinculadas; ${rebuiltClosures.length} cierre(s) recalculados. ` +
        "Fichadas, jornadas y Horas base se conservan.",
      before: item as Prisma.InputJsonValue,
      after: { ...summary, recalculatedClosureIds: rebuiltClosures.map((closure) => closure.id) } as Prisma.InputJsonValue,
    });
    await auditClosureRecalculations(rebuiltClosures, `eliminación definitiva del concepto ${item.code} - ${item.name}`, audit, hourConceptsRepository.employeeReferences);
    return { ...summary, recalculatedClosures: rebuiltClosures.length };
  },
};
