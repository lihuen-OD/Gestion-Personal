import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate } from "../../shared/datetime/argentinaTime";
import type { AuditContext, RegisterAuditInput } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { workforceService } from "../workforce-management/workforce.service";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";
import { formatEmployeeReference, loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { lockEmployeeDays } from "../employee-day-offs/employeeDayLock";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";
import { reinterpretSpecialHoursOnDates } from "../workforce-management/specialHourReinterpretation";
import { lockNoveltyCoverageGlobally } from "../novelties/noveltyCoverage.service";
import { auditNoveltyCoverageRecalculation, rebuildNoveltyCoverageSnapshots, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";
import { describeReinterpretation, reinterpretationMetadata } from "../workforce-management/specialHourReinterpretationSummary";

// Mismo presupuesto que el cambio de una regla de Hora Especial: la
// reinterpretación de la fecha corre dentro de la transacción del guardado.
const HOLIDAY_WORK_TRANSACTION_OPTIONS = { timeout: 30_000 };
import type { HolidayWorkCandidatesQuery, SaveHolidayWorkAssignmentsInput } from "./holidayWorkAssignment.schemas";
import { groupHolidayWorkAssignmentUpdates, planHolidayWorkAssignmentChanges } from "./holidayWorkAssignmentChanges";

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mapPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      throw new AppError("Related employee, shift template or user not found", 400, "RELATION_CONSTRAINT");
    }
    // Carrera entre dos guardados simultáneos para el mismo (date,
    // employeeId) — la lectura de lo existente no lo vio a tiempo. El unique
    // compuesto en base es la garantía real de "nunca dos convocatorias
    // activas para el mismo feriado"; esto sólo lo traduce a un error prolijo
    // en vez de 500.
    if (error.code === "P2002") {
      throw new AppError("Ya existe una convocatoria para este empleado en esta fecha", 409, "HOLIDAY_WORK_ASSIGNMENT_ALREADY_EXISTS");
    }
    // La transacción venció (o no llegó a empezar) y Prisma la revirtió
    // completa: no quedó nada guardado ni auditado. Sin detalle técnico.
    if (error.code === "P2028") {
      throw new AppError("El guardado no se completó porque la operación tardó demasiado. No se guardó ningún cambio: podés intentarlo de nuevo.", 503, "TRANSACTION_TIMEOUT");
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
  // holidayWorkAssignment.schemas.ts y en el doc de decisión 12D §6). No crea
  // TimeSegment/TimeEntry ni dispara notificaciones.
  //
  // Desde §16 (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md) la convocatoria
  // define quién cobra un FERIADO: en la MISMA transacción se reinterpretan
  // las horas ya cargadas de la fecha (todas, porque el primer convocado
  // restringe el FERIADO a los convocados) con el motor central. Si el
  // recálculo falla, la convocatoria no queda guardada a medias.
  async save(input: SaveHolidayWorkAssignmentsInput, user: Express.AuthUser, audit?: AuditContext) {
    const employeeIds = input.assignments.map((item) => item.employeeId);
    const uniqueEmployeeIds = new Set(employeeIds);
    if (uniqueEmployeeIds.size !== employeeIds.length) {
      throw new AppError("Un mismo empleado aparece más de una vez en el mismo guardado", 400, "HOLIDAY_WORK_DUPLICATE_EMPLOYEE");
    }
    const existingEmployees = await prisma.employee.count({ where: { id: { in: employeeIds } } });
    if (existingEmployees !== uniqueEmployeeIds.size) throw new AppError("Uno o más empleados no existen", 404, "EMPLOYEE_NOT_FOUND");

    const dateLabel = formatArgentinaDate(input.date);
    const { results, audits, reinterpretation, coverage } = await execute(() => prisma.$transaction(async (tx) => {
      // docs/decisions/EMPLOYEE_DAY_OFF.md §5: convocatoria + franco el mismo
      // día es contradictorio y se bloquea en la escritura. Mismo lock por
      // empleado + fecha que el guardado de francos: nunca quedan los dos activos.
      await lockEmployeeDays(tx, employeeIds.map((employeeId) => ({ employeeId, dateKey: dateKey(input.date) })));
      // La convocatoria cambia el feriado de todos los legajos de la fecha
      // (el primer convocado restringe el FERIADO): lock global exclusivo de
      // cobertura después del de día (NOVELTY_COVERAGE_ENGINE.md §13.6).
      await lockNoveltyCoverageGlobally(tx);
      const convoked = input.assignments.filter((item) => item.status === "ACTIVA").map((item) => item.employeeId);
      const dayOffConflicts = convoked.length
        ? await tx.employeeDayOff.findMany({ where: { date: input.date, status: "ACTIVO", employeeId: { in: convoked } }, select: { employee: { select: { legajo: true, firstName: true, lastName: true } } } })
        : [];
      if (dayOffConflicts.length) {
        throw new AppError(
          `No se puede convocar: ${dayOffConflicts.map((item) => formatEmployeeReference(item.employee)).join("; ")} tiene franco asignado el ${dateLabel}. Cancelá el franco primero.`,
          409,
          "HOLIDAY_WORK_CONFLICTS_DAY_OFF",
        );
      }
      // En lote: una lectura de lo existente, la diferencia en memoria y una
      // escritura por paso (nunca una consulta por empleado). Un item que no
      // cambia ningún campo editable no se escribe ni se audita; un CANCELADA
      // para una convocatoria que nunca existió no crea una fila vacía.
      const existingRows = await holidayWorkAssignmentRepository.findExistingForEmployees(input.date, employeeIds, tx);
      const changes = planHolidayWorkAssignmentChanges(input.assignments, existingRows);
      const creates = changes.flatMap((change) => (change.kind === "CREATE" ? [change] : []));
      if (creates.length) await holidayWorkAssignmentRepository.createMany(input.date, creates, user.id, tx);
      for (const group of groupHolidayWorkAssignmentUpdates(changes)) {
        await holidayWorkAssignmentRepository.updateMany(group.ids, group.fields, user.id, tx);
      }
      const responseEmployeeIds = changes.filter((change) => change.kind !== "SKIP").map((change) => change.employeeId);
      const savedByEmployee = new Map(
        responseEmployeeIds.length
          ? (await holidayWorkAssignmentRepository.findForEmployeesWithRelations(input.date, responseEmployeeIds, tx)).map((row) => [row.employeeId, row])
          : [],
      );
      const saved = responseEmployeeIds.map((employeeId) => savedByEmployee.get(employeeId)!);
      const pendingAudits: RegisterAuditInput[] = [];
      for (const change of changes) {
        if (change.kind === "SKIP" || change.kind === "UNCHANGED") continue;
        const row = savedByEmployee.get(change.employeeId)!;
        if (change.kind === "CREATE") {
          pendingAudits.push({
            action: "CREATE",
            entity: "HolidayWorkAssignment",
            entityId: change.employeeId,
            description: `Se convocó a ${row.employee.legajo} a trabajar el feriado del ${dateLabel}.`,
            after: row as unknown as Prisma.InputJsonValue,
          });
          continue;
        }
        const status = change.fields.status;
        const statusChanged = change.existing.status !== status;
        pendingAudits.push({
          action: statusChanged ? (status === "CANCELADA" ? "DEACTIVATE" : "ACTIVATE") : "UPDATE",
          entity: "HolidayWorkAssignment",
          entityId: change.employeeId,
          description: statusChanged
            ? `Se ${status === "CANCELADA" ? "canceló" : "reactivó"} la convocatoria de ${row.employee.legajo} para el feriado del ${dateLabel}.`
            : `Se actualizó la convocatoria de ${row.employee.legajo} para el feriado del ${dateLabel}.`,
          before: change.existing as unknown as Prisma.InputJsonValue,
          after: row as unknown as Prisma.InputJsonValue,
        });
      }
      // Sin ningún cambio efectivo, las fuentes que leen la cobertura y la
      // reinterpretación son idénticas a las de antes: recalcular no cambiaría
      // nada. Los locks y la validación de francos ya se aplicaron igual.
      if (!changes.some((change) => change.kind === "CREATE" || change.kind === "UPDATE")) {
        return { results: saved, audits: pendingAudits, reinterpretation: null, coverage: null };
      }
      // Cobertura de la fecha (todos los legajos) antes de reinterpretar las
      // horas: los snapshots que reconstruye la reinterpretación ya la incluyen.
      const coverageReason = { source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED" as const, label: `cambio de la convocatoria del feriado del ${dateLabel}` };
      const coverage = await recalculateNoveltyCoverage(tx, { from: input.date, to: input.date }, coverageReason, { rebuildSnapshots: false });
      const result = await reinterpretSpecialHoursOnDates(tx, [input.date], { reason: "HOLIDAY_WORK_ASSIGNMENT_CHANGED", date: dateKey(input.date) });
      coverage.rebuiltClosures = await rebuildNoveltyCoverageSnapshots(tx, coverage.changedPairs, coverageReason, result.rebuiltClosures);
      return { results: saved, audits: pendingAudits, reinterpretation: result, coverage };
    }, HOLIDAY_WORK_TRANSACTION_OPTIONS));

    // La auditoría se registra recién cuando la transacción confirmó.
    for (const entry of audits) await auditService.register({ ...audit, ...entry });
    if (!reinterpretation || !coverage) return results;
    if (reinterpretation.timeEntries + reinterpretation.breakdowns > 0) {
      await auditService.register({
        ...audit,
        action: "UPDATE",
        entity: "HolidayWorkAssignment",
        description: `Convocatoria del feriado del ${dateLabel}: ${describeReinterpretation(reinterpretation)}`,
        after: reinterpretationMetadata(reinterpretation) as Prisma.InputJsonValue,
      });
      await auditClosureRecalculations(
        reinterpretation.rebuiltClosures,
        `cambio de la convocatoria del feriado del ${dateLabel}`,
        audit,
        (ids) => loadEmployeeReferences(prisma, ids),
      );
    }
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return results;
  },
};
