import { Prisma } from "@prisma/client";
import { formatEmployeeReference, loadEmployeeReferences } from "../../shared/audit/employeeReference";
import { argentinaCalendarDate, formatArgentinaDate, periodCalendarBounds, periodFromCalendarDate } from "../../shared/datetime/argentinaTime";
import { AppError } from "../../shared/errors/AppError";
import { isMonthlyClosureLocked } from "../../shared/monthlyClosure/closureLock";
import { employeePeriodKey, findProtectedClosurePeriods, ProtectedClosurePeriodError } from "../../shared/monthlyClosure/closurePeriodGuard";
import { prisma } from "../../shared/prisma/client";
import { roles } from "../../shared/security/roles";
import type { AuditContext, RegisterAuditInput } from "../audit/audit.service";
import { auditService } from "../audit/audit.service";
import { employeeAccessWhere } from "../employees/employeeAccess";
import { auditClosureRecalculations } from "../workforce-management/closureRecalculationAudit";
import { findClosuresForEmployeePeriods, rebuildClosureSnapshots } from "../workforce-management/closureSnapshot";
import { lockEmployeeDays } from "./employeeDayLock";
import { ensureDayOffActivityAlert, findClockWorkShiftsForOperationalDate, resolveDayOffActivityAlerts } from "./employeeDayOffActivity";
import { employeeDayOffRepository, type EmployeeDayOffRow } from "./employeeDayOff.repository";
import type { EmployeeDayOffsByDateQuery, ListEmployeeDayOffsQuery, SaveEmployeeDayOffsInput } from "./employeeDayOff.schemas";

// Mismo presupuesto que la convocatoria a feriado: alertas, incidentes y
// snapshots se recalculan dentro de la transacción del guardado.
const DAY_OFF_TRANSACTION_OPTIONS = { timeout: 30_000 };

type ChangeKind = "CREATE" | "ACTIVATE" | "DEACTIVATE" | "UPDATE";

function mapPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") throw new AppError("Empleado o usuario relacionado inexistente", 400, "RELATION_CONSTRAINT");
    // El advisory lock por empleado + fecha ya serializa los guardados; esto
    // sólo traduce la garantía final del @@unique si algo la alcanzara.
    if (error.code === "P2002") throw new AppError("El franco de esa persona para esa fecha se guardó en paralelo. Volvé a intentar.", 409, "DAY_OFF_CONCURRENT_UPDATE");
  }
  throw error;
}

function describe(kind: ChangeKind, reference: string, dateLabel: string) {
  if (kind === "CREATE") return `Se asignó franco a ${reference} para el ${dateLabel}.`;
  if (kind === "DEACTIVATE") return `Se canceló el franco de ${reference} para el ${dateLabel}.`;
  if (kind === "ACTIVATE") return `Se reactivó el franco de ${reference} para el ${dateLabel}.`;
  return `Se actualizó la nota del franco de ${reference} para el ${dateLabel}.`;
}

const auditAction = { CREATE: "CREATE", ACTIVATE: "ACTIVATE", DEACTIVATE: "DEACTIVATE", UPDATE: "UPDATE" } as const;

function toItem(row: EmployeeDayOffRow) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    date: row.date.toISOString().slice(0, 10),
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    employee: row.employee,
  };
}

export const employeeDayOffService = {
  async list(query: ListEmployeeDayOffsQuery, user: Express.AuthUser) {
    const [rows, total] = await employeeDayOffRepository.findForPeriod(query, periodCalendarBounds(query.period), employeeAccessWhere(user));
    return { items: rows.map(toItem), meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  async byDate(query: EmployeeDayOffsByDateQuery, user: Express.AuthUser) {
    const date = argentinaCalendarDate(query.date);
    const period = periodFromCalendarDate(date);
    const [employees, total] = await employeeDayOffRepository.findCandidatesByDate(query, date, period, employeeAccessWhere(user));
    const items = employees.map((employee) => {
      const dayOff = employee.dayOffs[0] ?? null;
      const closure = employee.monthlyClosures[0] ?? null;
      return {
        employee: { id: employee.id, legajo: employee.legajo, firstName: employee.firstName, lastName: employee.lastName },
        dayOff: dayOff ? { id: dayOff.id, status: dayOff.status, notes: dayOff.notes, updatedAt: dayOff.updatedAt } : null,
        holidayWork: employee.holidayWorkAssignments.length > 0,
        // Un período enviado/aprobado sólo admite la corrección de RRHH con motivo.
        periodLocked: isMonthlyClosureLocked(closure),
      };
    });
    return { date: query.date, items, meta: { total, page: query.page, pageSize: query.take, hasMore: query.page * query.take < total } };
  },

  /**
   * Guardado en lote (docs/decisions/EMPLOYEE_DAY_OFF.md §8-§13). Cada ítem es
   * un upsert de (employeeId, date); un ítem sin cambios no escribe ni audita.
   * Todo lo derivado (alertas de actividad, incidentes de inactividad,
   * snapshots de cierres no protegidos) se resuelve en la misma transacción.
   */
  async save(input: SaveEmployeeDayOffsInput, user: Express.AuthUser, audit?: AuditContext) {
    const employeeIds = input.employees.map((item) => item.employeeId);
    if (new Set(employeeIds).size !== employeeIds.length) {
      throw new AppError("Una misma persona aparece más de una vez en el mismo guardado.", 400, "DAY_OFF_DUPLICATE_EMPLOYEE");
    }
    // El alcance se verifica para CADA persona del lote antes de escribir: un
    // UUID ajeno nunca se guarda, aunque el resto del lote sea válido.
    const inScope = await employeeDayOffRepository.countEmployeesInScope(employeeIds, employeeAccessWhere(user));
    if (inScope !== employeeIds.length) throw new AppError("Employee not found or outside your scope", 403, "EMPLOYEE_SCOPE_FORBIDDEN");

    const date = argentinaCalendarDate(input.date);
    const period = periodFromCalendarDate(date);
    const dateLabel = formatArgentinaDate(input.date);
    const correctionReason = input.correctionReason?.trim() || null;

    const outcome = await prisma.$transaction(async (tx) => {
      await lockEmployeeDays(tx, employeeIds.map((employeeId) => ({ employeeId, dateKey: input.date })));
      const existingByEmployee = new Map((await employeeDayOffRepository.findOnDate(tx, date, employeeIds)).map((row) => [row.employeeId, row]));

      const changes: Array<{ kind: ChangeKind; employeeId: string; notes: string | null; existing: EmployeeDayOffRow | null }> = [];
      for (const item of input.employees) {
        const existing = existingByEmployee.get(item.employeeId) ?? null;
        const notes = item.notes === undefined ? existing?.notes ?? null : item.notes?.trim() || null;
        if (!existing) {
          // Cancelar algo que nunca existió no crea filas vacías.
          if (item.status === "ACTIVO") changes.push({ kind: "CREATE", employeeId: item.employeeId, notes, existing });
          continue;
        }
        if (existing.status !== item.status) changes.push({ kind: item.status === "ACTIVO" ? "ACTIVATE" : "DEACTIVATE", employeeId: item.employeeId, notes, existing });
        else if ((existing.notes ?? null) !== notes) changes.push({ kind: "UPDATE", employeeId: item.employeeId, notes, existing });
      }
      if (!changes.length) return { saved: [] as EmployeeDayOffRow[], audits: [] as RegisterAuditInput[], rebuilt: [], alerts: 0, resolvedAlerts: 0, resolvedIncidents: 0 };

      // Un franco reinterpreta horas: en un período enviado/aprobado sólo RRHH,
      // con motivo (mismo criterio que la corrección de una hora, §12).
      const protectedPeriods = await findProtectedClosurePeriods(tx, changes.map((change) => ({ employeeId: change.employeeId, period })));
      if (protectedPeriods.size) {
        if (user.role !== roles.rrhh) {
          throw new ProtectedClosurePeriodError(
            [...protectedPeriods.entries()].map(([key, status]) => ({ employeeId: key.split(":")[0]!, period, status })),
            "El período ya fue enviado a cierre. Pedile a RRHH que corrija el franco si hace falta.",
          );
        }
        if (!correctionReason) throw new AppError("Indicá el motivo de la corrección: el período ya fue enviado a cierre.", 400, "DAY_OFF_CORRECTION_REASON_REQUIRED");
      }

      const activated = changes.filter((change) => change.kind === "CREATE" || change.kind === "ACTIVATE").map((change) => change.employeeId);
      const deactivated = changes.filter((change) => change.kind === "DEACTIVATE").map((change) => change.employeeId);

      // Feriado + convocatoria + franco es contradictorio: se bloquea acá (y en
      // la convocatoria) en vez de resolverlo en silencio (§5).
      const conflicts = await employeeDayOffRepository.findActiveHolidayWork(tx, date, activated);
      if (conflicts.length) {
        throw new AppError(
          `No se puede asignar franco: ${conflicts.map((conflict) => formatEmployeeReference(conflict.employee)).join("; ")} está convocado a trabajar el feriado del ${dateLabel}. Cancelá la convocatoria primero.`,
          409,
          "DAY_OFF_CONFLICTS_HOLIDAY_WORK",
        );
      }

      const saved: EmployeeDayOffRow[] = [];
      const audits: RegisterAuditInput[] = [];
      for (const change of changes) {
        const row = change.existing
          ? await employeeDayOffRepository.update(tx, change.existing.id, { status: change.kind === "DEACTIVATE" ? "CANCELADO" : "ACTIVO", notes: change.notes, userId: user.id })
          : await employeeDayOffRepository.create(tx, { employeeId: change.employeeId, date, notes: change.notes, userId: user.id });
        saved.push(row);
        const isCorrection = protectedPeriods.has(employeePeriodKey({ employeeId: change.employeeId, period }));
        audits.push({
          action: auditAction[change.kind],
          entity: "EmployeeDayOff",
          entityId: row.id,
          description: `${describe(change.kind, formatEmployeeReference(row.employee), dateLabel)}${isCorrection ? ` Motivo: ${correctionReason}` : ""}`,
          ...(change.existing ? { before: toItem(change.existing) as unknown as Prisma.InputJsonValue } : {}),
          after: { ...toItem(row), ...(isCorrection ? { correctionReason } : {}) } as unknown as Prisma.InputJsonValue,
        });
      }

      // Franco creado después de la fichada (§8): las jornadas de esa fecha
      // operativa quedan a revisar; al cancelar, sus alertas se resuelven.
      const shifts = await findClockWorkShiftsForOperationalDate(tx, [...activated, ...deactivated], input.date);
      const activatedSet = new Set(activated);
      let alerts = 0;
      for (const shift of shifts.filter((item) => activatedSet.has(item.employeeId))) {
        if (await ensureDayOffActivityAlert(tx, shift)) alerts += 1;
      }
      const resolvedAlerts = await resolveDayOffActivityAlerts(tx, shifts.filter((item) => !activatedSet.has(item.employeeId)).map((item) => item.id));
      const resolvedIncidents = (await employeeDayOffRepository.resolvePendingInactivity(tx, date, activated)).count;

      // Snapshots: sólo cierres no protegidos (un protegido no se reconstruye
      // automáticamente, ni siquiera en la corrección de RRHH — §12).
      const pairs = [...new Set(changes.map((change) => change.employeeId))].map((employeeId) => ({ employeeId, period }));
      const closures = (await findClosuresForEmployeePeriods(tx, pairs)).filter((closure) => !protectedPeriods.has(employeePeriodKey(closure)));
      const rebuilt = await rebuildClosureSnapshots(tx, closures, { reason: "EMPLOYEE_DAY_OFF_CHANGED", date: input.date });

      return { saved, audits, rebuilt, alerts, resolvedAlerts, resolvedIncidents };
    }, DAY_OFF_TRANSACTION_OPTIONS).catch(mapPrismaError);

    // La auditoría se registra recién cuando la transacción confirmó.
    for (const entry of outcome.audits) await auditService.register({ ...audit, ...entry });
    await auditClosureRecalculations(outcome.rebuilt, `cambio de francos del ${dateLabel}`, audit, (ids) => loadEmployeeReferences(prisma, ids));

    return {
      date: input.date,
      items: outcome.saved.map(toItem),
      summary: {
        changed: outcome.saved.length,
        unchanged: input.employees.length - outcome.saved.length,
        activityAlerts: outcome.alerts,
        resolvedActivityAlerts: outcome.resolvedAlerts,
        resolvedInactivityIncidents: outcome.resolvedIncidents,
      },
    };
  },
};
