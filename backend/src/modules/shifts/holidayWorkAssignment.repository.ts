import type { Prisma } from "@prisma/client";
import { employeeStructureWhere } from "../../shared/prisma/employeeStructureWhere";
import { periodFromCalendarDate } from "../../shared/datetime/argentinaTime";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import type { HolidayWorkCandidatesQuery } from "./holidayWorkAssignment.schemas";
import type { HolidayWorkAssignmentFields } from "./holidayWorkAssignmentChanges";

const employeeSelect = { id: true, legajo: true, firstName: true, lastName: true, status: true } as const;

// Escrituras de convocatoria: aceptan la transacción que además recalcula la
// cobertura de los legajos cambiados (holidayWorkAssignment.service.ts, §20).
type AssignmentWriter = Pick<PrismaTransactionClient, "holidayWorkAssignment">;
const shiftTemplateSelect = { id: true, code: true, name: true } as const;

// Mismo criterio de búsqueda ya usado (duplicado a propósito, no
// compartido) en employees.repository.ts (buildOptionsWhere) y
// timeEntries.repository.ts (employeeSearchWhere) — no existe un helper
// compartido para esto hoy en el repo.
function candidatesWhere(query: HolidayWorkCandidatesQuery): Prisma.EmployeeWhereInput {
  const search = query.search?.trim();
  // Turno fijo REAL del feriado (§20): HABILITADO, vigente ese día y aplicable
  // a su día de semana (weekdays vacío = todos). Sin fecha, el criterio previo.
  const fixedOnDate: Prisma.ShiftAssignmentWhereInput = query.date
    ? {
        status: "HABILITADO",
        shiftTemplate: { status: "ACTIVO" },
        effectiveFrom: { lte: query.date },
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: query.date } }] }, { OR: [{ weekdays: { isEmpty: true } }, { weekdays: { has: query.date.getUTCDay() } }] }],
      }
    : { status: "HABILITADO" };
  // Miembro de una rotación ACTIVA ese día: su turno sale de la rotación.
  const rotationOnDate: Prisma.ShiftRotationCrewMemberWhereInput | null = query.date
    ? { effectiveFrom: { lte: query.date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: query.date } }], crew: { rotation: { status: "ACTIVO" } } }
    : null;
  return {
    status: "ACTIVO",
    AND: [
      ...(query.shiftTemplateId ? [{ shiftAssignments: { some: { ...fixedOnDate, shiftTemplateId: query.shiftTemplateId } } }] : []),
      ...(query.withoutShift ? [{ shiftAssignments: { none: fixedOnDate } }, ...(rotationOnDate ? [{ shiftRotationMemberships: { none: rotationOnDate } }] : [])] : []),
    ],
    ...(search
      ? {
          OR: [
            { legajo: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export const holidayWorkAssignmentRepository = {
  // Etapa 14H.4: findMany + count son lecturas independientes (ninguna
  // depende del resultado de la otra) — $transaction([...]) las pinaba a una
  // única conexión de Neon en serie, sin ganar concurrencia real pese a
  // pedirlas "juntas". Promise.all sobre el cliente global (pool de
  // conexiones) sí las corre en paralelo. Mismo patrón ya aplicado 9+ veces
  // en las series 14G/14H (ver docs/decisions/WORK_REGIMES_PERFORMANCE_AND_KEYS_14H2.md
  // y anteriores) — where/select/orderBy/skip/take sin cambios, cero impacto
  // de contrato. Este era, además, el endpoint más lento medido en esta
  // pantalla (candidates, ~811ms en el journey 14H.1/14H.3).
  findCandidates(query: HolidayWorkCandidatesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeWhereInput = { AND: [candidatesWhere(query), ...employeeStructureWhere(query), accessWhere] };
    const skip = (query.page - 1) * query.take;
    return Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          ...employeeSelect,
          // Sin fecha no hay franco ni período que marcar: filtro imposible, sin filas.
          dayOffs: { where: query.date ? { date: query.date, status: "ACTIVO" } : { id: { in: [] } }, select: { id: true }, take: 1 },
          monthlyClosures: { where: query.date ? { period: periodFromCalendarDate(query.date) } : { id: { in: [] } }, select: { status: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.employee.count({ where }),
    ]);
  },

  findByDate(date: Date, accessWhere: Prisma.EmployeeWhereInput) {
    return prisma.holidayWorkAssignment.findMany({
      where: { date, status: "ACTIVA", employee: accessWhere },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
      orderBy: [{ employee: { lastName: "asc" } }],
    });
  },

  // Guardado en lote (una consulta por paso, nunca una por empleado): cada
  // viaje a la base corre dentro de la transacción con tiempo límite.
  findExistingForEmployees(date: Date, employeeIds: string[], db: AssignmentWriter = prisma) {
    return db.holidayWorkAssignment.findMany({ where: { date, employeeId: { in: employeeIds } } });
  },

  createMany(date: Date, items: Array<{ employeeId: string; fields: HolidayWorkAssignmentFields }>, userId: string | null, db: AssignmentWriter = prisma) {
    return db.holidayWorkAssignment.createMany({
      data: items.map(({ employeeId, fields }) => ({ date, employeeId, ...fields, createdByUserId: userId, updatedByUserId: userId })),
    });
  },

  /** Mismos campos finales para todas las filas del grupo; nunca toca createdByUserId. */
  updateMany(ids: string[], fields: HolidayWorkAssignmentFields, userId: string | null, db: AssignmentWriter = prisma) {
    return db.holidayWorkAssignment.updateMany({ where: { id: { in: ids } }, data: { ...fields, updatedByUserId: userId } });
  },

  findForEmployeesWithRelations(date: Date, employeeIds: string[], db: AssignmentWriter = prisma) {
    return db.holidayWorkAssignment.findMany({
      where: { date, employeeId: { in: employeeIds } },
      include: { employee: { select: employeeSelect }, shiftTemplate: { select: shiftTemplateSelect } },
    });
  },
};
