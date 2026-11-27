import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { formatArgentinaDate, periodFromCalendarDate } from "../../shared/datetime/argentinaTime";
import { employeePeriodKey } from "../../shared/monthlyClosure/closurePeriodGuard";
import { assertProtectedPeriodCorrection } from "../../shared/monthlyClosure/protectedPeriodCorrection";
import { isMonthlyClosureLocked } from "../../shared/monthlyClosure/closureLock";
import type { AuditContext, RegisterAuditInput } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { workforceService } from "../workforce-management/workforce.service";
import { holidayWorkAssignmentRepository } from "./holidayWorkAssignment.repository";
import { formatEmployeeReference } from "../../shared/audit/employeeReference";
import { lockEmployeeDays } from "../employee-day-offs/employeeDayLock";
import { employeeDayOffRepository } from "../employee-day-offs/employeeDayOff.repository";
import { auditNoveltyCoverageRecalculation, lockNoveltyCoverageForEmployees, rebuildNoveltyCoverageSnapshots, recalculateNoveltyCoverage } from "../novelties/noveltyCoverageRecalculation";

// Mismo presupuesto que el guardado de francos: la cobertura de novedades de
// los legajos cambiados se recalcula dentro de la transacción del guardado.
const HOLIDAY_WORK_TRANSACTION_OPTIONS = { timeout: 30_000 };
import type { HolidayWorkCandidatesQuery, SaveHolidayWorkAssignmentsInput } from "./holidayWorkAssignment.schemas";
import { activatedHolidayWorkAssignmentChanges, groupHolidayWorkAssignmentUpdates, planHolidayWorkAssignmentChanges } from "./holidayWorkAssignmentChanges";
import { validateConvocationSchedules } from "./holidayConvocationValidation";
import { resolveConvocationSchedules } from "./holidayConvocationSchedule";

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
    const [rows, total] = await holidayWorkAssignmentRepository.findCandidates(query, employeeAccessWhere(user));
    // Turno REAL de cada candidato ese día (§20): fijo vigente, rotación o
    // ninguno — la pantalla nunca sugiere un turno vencido.
    const schedules = query.date ? await resolveConvocationSchedules(prisma, rows.map((row) => row.id), dateKey(query.date)) : null;
    // Franco ACTIVO ese día: no se puede convocar sin cancelarlo antes
    // (EMPLOYEE_DAY_OFF.md §5); la pantalla lo muestra bloqueado.
    // Período enviado/aprobado: sólo RRHH lo corrige, con motivo (como francos).
    const items = rows.map(({ dayOffs, monthlyClosures, ...employee }) => ({
      ...employee,
      dayOff: dayOffs.length > 0,
      periodLocked: isMonthlyClosureLocked(monthlyClosures[0] ?? null),
      expectedSchedule: schedules?.get(employee.id) ?? null,
    }));
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
  // Desde §20 (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md, reemplaza §16)
  // la convocatoria SÓLO define la obligación de asistir: no cambia el
  // multiplicador de nadie, así que no reinterpreta horas. Lo único derivado es
  // la cobertura de novedades (la obligación del día) de los legajos que
  // cambiaron, en la misma transacción.
  //
  // Alcance (docs/decisions/HOLIDAY_WORK_ASSIGNMENTS_12D.md §5): Nivel 1, 2 y 3
  // escriben sólo sobre legajos de su alcance (employeeAccessWhere, mismo
  // criterio que francos), todo o nada.
  async save(input: SaveHolidayWorkAssignmentsInput, user: Express.AuthUser, audit?: AuditContext) {
    const employeeIds = input.assignments.map((item) => item.employeeId);
    const uniqueEmployeeIds = new Set(employeeIds);
    if (uniqueEmployeeIds.size !== employeeIds.length) {
      throw new AppError("Un mismo empleado aparece más de una vez en el mismo guardado", 400, "HOLIDAY_WORK_DUPLICATE_EMPLOYEE");
    }
    // Un legajo inexistente o ajeno responde igual (403): nunca se revela si
    // existe fuera del alcance. Antes de la transacción, para todo el lote.
    const inScope = await employeeDayOffRepository.countEmployeesInScope(employeeIds, employeeAccessWhere(user));
    if (inScope !== uniqueEmployeeIds.size) throw new AppError("Employee not found or outside your scope", 403, "EMPLOYEE_SCOPE_FORBIDDEN");
    // Sólo se convoca a un feriado del calendario (§20, P7): una convocatoria
    // en otra fecha no tendría efecto. Cancelar siempre se permite.
    if (input.assignments.some((item) => item.status === "ACTIVA") && !(await workforceService.holidayDatesInRange(input.date, input.date)).length) {
      throw new AppError(`El ${formatArgentinaDate(input.date)} no es feriado: sólo se convoca a fechas de feriado del calendario.`, 422, "HOLIDAY_WORK_DATE_NOT_HOLIDAY");
    }

    const dateLabel = formatArgentinaDate(input.date);
    const correctionReason = input.correctionReason?.trim() || null;
    const { results, audits, coverage } = await execute(() => prisma.$transaction(async (tx) => {
      // docs/decisions/EMPLOYEE_DAY_OFF.md §5: convocatoria + franco el mismo
      // día es contradictorio y se bloquea en la escritura. Mismo lock por
      // empleado + fecha que el guardado de francos: nunca quedan los dos activos.
      await lockEmployeeDays(tx, employeeIds.map((employeeId) => ({ employeeId, dateKey: dateKey(input.date) })));
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
      const changedIds = changes.filter((change) => change.kind === "CREATE" || change.kind === "UPDATE").map((change) => change.employeeId);
      // Período enviado/aprobado: la convocatoria cambia la obligación (y la
      // cobertura del cierre) — sólo RRHH y con motivo, igual que francos
      // (EMPLOYEE_DAY_OFF.md §12). Sin cambios efectivos no hay nada que proteger.
      const period = periodFromCalendarDate(input.date);
      const protectedPeriods = await assertProtectedPeriodCorrection(tx, changedIds.map((employeeId) => ({ employeeId, period })), {
        role: user.role,
        correctionReason,
        forbiddenMessage: "El período ya fue enviado a cierre. Pedile a RRHH que corrija la convocatoria si hace falta.",
        reasonRequiredCode: "HOLIDAY_WORK_CORRECTION_REASON_REQUIRED",
      });
      const correctionSuffix = (employeeId: string) => (protectedPeriods.has(employeePeriodKey({ employeeId, period })) ? ` Motivo: ${correctionReason}` : "");
      // §20 (D9): ninguna convocatoria ACTIVA sin horario resoluble.
      const scheduleWarnings = await validateConvocationSchedules(tx, dateKey(input.date), activatedHolidayWorkAssignmentChanges(changes));
      const auditSuffix = (employeeId: string) => `${correctionSuffix(employeeId)}${scheduleWarnings.has(employeeId) ? ` ${scheduleWarnings.get(employeeId)}` : ""}`;
      // Orden de locks (NOVELTY_COVERAGE_ENGINE.md §13.6): día → cobertura.
      await lockNoveltyCoverageForEmployees(tx, changedIds);
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
      // Aviso visible (rotación con conflicto resuelta con la plantilla): nunca se oculta.
      const saved = responseEmployeeIds.map((employeeId) => {
        const row = savedByEmployee.get(employeeId)!;
        const scheduleWarning = scheduleWarnings.get(employeeId);
        return scheduleWarning ? { ...row, scheduleWarning } : row;
      });
      const withCorrection = (row: object, employeeId: string) => ({ ...row, ...(correctionSuffix(employeeId) ? { correctionReason } : {}) }) as unknown as Prisma.InputJsonValue;
      const pendingAudits: RegisterAuditInput[] = [];
      for (const change of changes) {
        if (change.kind === "SKIP" || change.kind === "UNCHANGED") continue;
        const row = savedByEmployee.get(change.employeeId)!;
        if (change.kind === "CREATE") {
          pendingAudits.push({
            action: "CREATE",
            entity: "HolidayWorkAssignment",
            entityId: change.employeeId,
            description: `Se convocó a ${row.employee.legajo} a trabajar el feriado del ${dateLabel}.${auditSuffix(change.employeeId)}`,
            after: withCorrection(row, change.employeeId),
          });
          continue;
        }
        const status = change.fields.status;
        const statusChanged = change.existing.status !== status;
        pendingAudits.push({
          action: statusChanged ? (status === "CANCELADA" ? "DEACTIVATE" : "ACTIVATE") : "UPDATE",
          entity: "HolidayWorkAssignment",
          entityId: change.employeeId,
          description: (statusChanged
            ? `Se ${status === "CANCELADA" ? "canceló" : "reactivó"} la convocatoria de ${row.employee.legajo} para el feriado del ${dateLabel}.`
            : `Se actualizó la convocatoria de ${row.employee.legajo} para el feriado del ${dateLabel}.`) + auditSuffix(change.employeeId),
          before: change.existing as unknown as Prisma.InputJsonValue,
          after: withCorrection(row, change.employeeId),
        });
      }
      // Sin ningún cambio efectivo la cobertura es idéntica a la de antes:
      // recalcular no cambiaría nada. La validación de francos ya se aplicó.
      if (!changedIds.length) return { results: saved, audits: pendingAudits, coverage: null };
      // Sólo los legajos que cambiaron: la convocatoria de uno nunca toca la
      // cobertura, las horas ni los cierres de otro (§20).
      const coverageReason = { source: "HOLIDAY_WORK_ASSIGNMENT_CHANGED" as const, label: `cambio de la convocatoria del feriado del ${dateLabel}` };
      const coverage = await recalculateNoveltyCoverage(tx, { from: input.date, to: input.date, employeeIds: changedIds }, coverageReason, { rebuildSnapshots: false });
      coverage.rebuiltClosures = await rebuildNoveltyCoverageSnapshots(tx, coverage.changedPairs, coverageReason);
      return { results: saved, audits: pendingAudits, coverage };
    }, HOLIDAY_WORK_TRANSACTION_OPTIONS));

    // La auditoría se registra recién cuando la transacción confirmó.
    for (const entry of audits) await auditService.register({ ...audit, ...entry });
    if (!coverage) return results;
    await auditNoveltyCoverageRecalculation(coverage, audit);
    return results;
  },
};
