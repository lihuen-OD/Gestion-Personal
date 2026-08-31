import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import type { AuditContext } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { workforceService } from "../workforce-management/workforce.service";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";
import type { HolidayWorkCandidatesQuery, SaveHolidayWorkAssignmentsInput } from "./holidayWorkAssignment.schemas";

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      throw new AppError("Related employee, shift template or user not found", 400, "RELATION_CONSTRAINT");
    }
    // Carrera entre dos guardados simultáneos para el mismo (date,
    // employeeId) — findExisting no lo vio a tiempo. El unique compuesto en
    // base es la garantía real de "nunca dos convocatorias activas para el
    // mismo feriado"; esto sólo lo traduce a un error prolijo en vez de 500.
    if (error.code === "P2002") {
      throw new AppError("Ya existe una convocatoria para este empleado en esta fecha", 409, "HOLIDAY_WORK_ASSIGNMENT_ALREADY_EXISTS");
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

export const holidayWorkAssignmentService = {
  // Etapa 12D: nunca duplica el cálculo de calendario — delega 100% en
  // workforceService.holidayDatesInRange (workforce-management, dueño de
  // DoubleHourRule), que a su vez reutiliza calendarPreview(kind=FERIADO)
  // sin tocar su lógica. Este módulo (shifts) sólo consume la respuesta.
  holidayDates(from: Date, to: Date) {
    return workforceService.holidayDatesInRange(from, to);
  },

  async candidates(query: HolidayWorkCandidatesQuery, user: Express.AuthUser) {
    const [items, total] = await holidayWorkAssignmentRepository.findCandidates(query, employeeAccessWhere(user));
    return { items, meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  async listByDate(date: Date, user: Express.AuthUser) {
    const assignments = await holidayWorkAssignmentRepository.findByDate(date, employeeAccessWhere(user));
    return { date: dateKey(date), assignments };
  },

  // Cada entrada del array es un upsert independiente por (date, employeeId)
  // — nunca "reemplaza todo lo cargado para la fecha" (ver justificación en
  // holidayWorkAssignment.schemas.ts y en el doc de decisión 12D §6). Esto
  // no crea TimeSegment/TimeEntry, no toca DoubleHourRule ni ninguna tabla
  // de liquidación, y no dispara ninguna notificación — es sólo la
  // expectativa de convocatoria.
  async save(input: SaveHolidayWorkAssignmentsInput, user: Express.AuthUser, audit?: AuditContext) {
    const employeeIds = input.assignments.map((item) => item.employeeId);
    const uniqueEmployeeIds = new Set(employeeIds);
    if (uniqueEmployeeIds.size !== employeeIds.length) {
      throw new AppError("Un mismo empleado aparece más de una vez en el mismo guardado", 400, "HOLIDAY_WORK_DUPLICATE_EMPLOYEE");
    }
    const existingEmployees = await prisma.employee.count({ where: { id: { in: employeeIds } } });
    if (existingEmployees !== uniqueEmployeeIds.size) throw new AppError("Uno o más empleados no existen", 404, "EMPLOYEE_NOT_FOUND");

    const dateLabel = dateKey(input.date);
    const results = [];
    for (const item of input.assignments) {
      const existing = await holidayWorkAssignmentRepository.findExisting(input.date, item.employeeId);

      if (!existing) {
        // Nada que cancelar si la convocatoria nunca existió — evita crear
        // filas CANCELADA "vacías" sólo porque el frontend mandó un item
        // desmarcado que ya estaba desmarcado.
        if (item.status === "CANCELADA") continue;
        const created = await execute(() => holidayWorkAssignmentRepository.create(input.date, item.employeeId, item, user.id));
        await auditService.register({
          ...audit,
          action: "CREATE",
          entity: "HolidayWorkAssignment",
          entityId: item.employeeId,
          description: `Se convocó a ${created.employee.legajo} a trabajar el feriado del ${dateLabel}.`,
          after: created as unknown as Prisma.InputJsonValue,
        });
        results.push(created);
        continue;
      }

      const statusChanged = existing.status !== item.status;
      const updated = await execute(() => holidayWorkAssignmentRepository.update(existing.id, item, user.id));
      await auditService.register({
        ...audit,
        action: statusChanged ? (item.status === "CANCELADA" ? "DEACTIVATE" : "ACTIVATE") : "UPDATE",
        entity: "HolidayWorkAssignment",
        entityId: item.employeeId,
        description: statusChanged
          ? `Se ${item.status === "CANCELADA" ? "canceló" : "reactivó"} la convocatoria de ${updated.employee.legajo} para el feriado del ${dateLabel}.`
          : `Se actualizó la convocatoria de ${updated.employee.legajo} para el feriado del ${dateLabel}.`,
        before: existing as unknown as Prisma.InputJsonValue,
        after: updated as unknown as Prisma.InputJsonValue,
      });
      results.push(updated);
    }

    return results;
  },
};
