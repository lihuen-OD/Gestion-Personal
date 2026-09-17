import { prisma } from "../../shared/prisma/client";

// Etapa 15M.4: consultas de sólo lectura para la reconciliación histórica de
// Hora normal (dry-run y resolución de alcance). Las escrituras del modo
// repair viven directamente en `normalHoursReconciliation.service.ts`, dentro
// de su propio `prisma.$transaction(async (tx) => ...)` — mismo criterio ya
// documentado en `timeEntries.repository.ts` (`doubleHourRuleScopeWhere`):
// el `tx` real de este proyecto viene de un cliente extendido con métricas
// que no coincide con `Prisma.TransactionClient`, así que no se puede tipar
// como parámetro de una función de repositorio de nivel superior sin
// repetir esa anotación; se mantiene inline en el único lugar que abre esa
// transacción.
//
// El filtro `workShiftId: { not: null }` en `findNormalEntriesForEmployee` es
// deliberado y crítico: excluye por completo cualquier TimeEntry NORMAL_BASE
// que no venga de un WorkShift (carga manual pura) — este módulo sólo puede
// tocar filas que el bug de la Etapa 13F pudo haber corrompido, nunca una
// carga manual legítima sin turno asociado.
export const normalHoursReconciliationRepository = {
  findEmployeeByLegajo(legajo: string) {
    return prisma.employee.findFirst({ where: { legajo }, select: { id: true, legajo: true } });
  },

  findNormalConcept() {
    return prisma.hourConcept.findFirst({ where: { systemRole: "NORMAL_BASE" }, select: { id: true, name: true } });
  },

  findEmployeeIdsWithSegmentActivity(bounds: { start: Date; end: Date }) {
    return prisma.timeSegment
      .findMany({
        where: { date: { gte: bounds.start, lt: bounds.end }, workShift: { status: "PROCESADO" } },
        select: { employeeId: true },
        distinct: ["employeeId"],
      })
      .then((rows) => rows.map((row) => row.employeeId));
  },

  findEmployeesByIds(employeeIds: string[]) {
    return prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, legajo: true } });
  },

  findSegmentsForEmployee(employeeId: string, bounds: { start: Date; end: Date }) {
    return prisma.timeSegment.findMany({
      where: { employeeId, date: { gte: bounds.start, lt: bounds.end }, workShift: { status: "PROCESADO" } },
      select: { id: true, date: true, minutes: true, workShiftId: true, toDateTime: true, workShift: { select: { source: true } } },
      orderBy: [{ date: "asc" }, { toDateTime: "asc" }],
    });
  },

  findNormalEntriesForEmployee(employeeId: string, normalConceptId: string, bounds: { start: Date; end: Date }) {
    return prisma.timeEntry.findMany({
      where: { employeeId, hourConceptId: normalConceptId, workShiftId: { not: null }, date: { gte: bounds.start, lt: bounds.end } },
      select: {
        id: true, date: true, period: true, day: true, hours: true, totalMinutes: true, actualMinutes: true,
        status: true, workShiftId: true, timeSegmentId: true, source: true, observation: true, createdAt: true, updatedAt: true,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
  },
};
