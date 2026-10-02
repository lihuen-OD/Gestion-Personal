import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { resolveOrderBy } from "../../shared/validation/listSort";
import { createRepositoryListCache, pageFromCappedList, REPOSITORY_LIST_CACHE_MAX_ROWS } from "../../shared/cache/repositoryListCache";
import { associatedEmployeeSelect, buildEmployeeAssociationWhere } from "../../shared/prisma/employeeAssociationQuery";
import { countedBreakdownStatusWhere } from "../time-entries/workedTimeAccounting";
import { findClosuresForHourConcept, rebuildClosureSnapshots, type ClosureSnapshotRecalculation } from "../workforce-management/closureSnapshot";
import type { CreateHourConceptInput, ListHourConceptEmployeesQuery, ListHourConceptsQuery, UpdateHourConceptInput } from "./hourConcepts.schemas";

// Cache en memoria para listados sin filtros. Etapa 14I.3: helper compartido
// (backend/src/shared/cache/repositoryListCache.ts) — mismo TTL, misma
// semántica, sin cambio de comportamiento. Ver docs/decisions/
// BACKEND_REPOSITORY_LIST_CACHE_HELPER_14I3.md.
type HourConceptRow = Awaited<ReturnType<typeof prisma.hourConcept.findMany>>[number];
const CACHE_TTL_MS = 120_000; // 2 minutos
const listCache = createRepositoryListCache<HourConceptRow[]>(CACHE_TTL_MS);

export function invalidateHourConceptsCache() {
  listCache.clear();
}

function hasActiveFilters(query: ListHourConceptsQuery): boolean {
  return !!(query.kind || query.status || query.search?.trim());
}

function buildWhere(query: ListHourConceptsQuery): Prisma.HourConceptWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Corregir el tratamiento o eliminar un concepto recalcula snapshots de
// cierre dentro de la misma transacción (3 consultas por período afectado):
// más que el default de 5s de Prisma contra Neon si el concepto tiene varios
// meses de historia.
const HISTORY_TRANSACTION_OPTIONS = { timeout: 30_000 };

// Desgloses que cuentan del concepto, por empleado+período: alcance de una
// reinterpretación y pares cuyos cierres hay que recalcular. 1 consulta.
function countedBreakdownPairs(db: PrismaTransactionClient, hourConceptId: string) {
  return db.hourConceptBreakdown.groupBy({
    by: ["employeeId", "period"],
    where: { hourConceptId, status: countedBreakdownStatusWhere },
    _count: { _all: true },
  });
}

function summarizePairs(pairs: Array<{ employeeId: string; period: string; _count: { _all: number } }>) {
  return {
    breakdowns: pairs.reduce((sum, pair) => sum + pair._count._all, 0),
    employees: new Set(pairs.map((pair) => pair.employeeId)).size,
    periods: new Set(pairs.map((pair) => pair.period)).size,
  };
}

function findPageFromDatabase(query: ListHourConceptsQuery) {
    const where = buildWhere(query);
    const skip = (query.page - 1) * query.take;
    return Promise.all([
      prisma.hourConcept.findMany({
        where,
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        skip,
        take: query.take,
      }),
      prisma.hourConcept.count({ where }),
    ]);
}

export const hourConceptsRepository = {
  // Etapa 14H.5: findMany + count son lecturas independientes (ninguna
  // depende del resultado de la otra) — $transaction([...]) las pinaba a una
  // única conexión de Neon en serie sin ganar concurrencia real. Promise.all
  // sobre el cliente global sí las corre en paralelo. Mismo patrón ya
  // aplicado 10+ veces en las series 14G/14H. Esta rama (con filtros) no la
  // ejercita HourConceptsPage.tsx (filtra en memoria sobre un fetch-all), pero
  // sí un caller real: timeEntryApiService.ts llama
  // hourConceptApiService.getAll({status:"ACTIVO"}), que sí manda status y
  // por lo tanto entra acá — confirmado con grep, no es código muerto.
  async findMany(query: ListHourConceptsQuery): Promise<[HourConceptRow[], number]> {
    if (hasActiveFilters(query)) return findPageFromDatabase(query);

    const data = await listCache.getOrLoad(() =>
      prisma.hourConcept.findMany({
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        take: REPOSITORY_LIST_CACHE_MAX_ROWS + 1,
      }),
    );

    return pageFromCappedList(data, query.page, query.take) ?? findPageFromDatabase(query);
  },

  findById(id: string) {
    return prisma.hourConcept.findUniqueOrThrow({ where: { id } });
  },

  create(data: CreateHourConceptInput) {
    return prisma.hourConcept.create({ data });
  },

  update(id: string, data: UpdateHourConceptInput) {
    return prisma.hourConcept.update({ where: { id }, data });
  },

  // Corrección de workTreatment (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md
  // §2): los desgloses no se tocan. Toda lectura (grilla, Por persona,
  // export, resumen, dashboard, panel de cierre) une HourConceptBreakdown con
  // el HourConcept.workTreatment vigente (accountingBreakdownSelect), así que
  // actualizar el concepto ya reinterpreta toda la historia. Lo único
  // persistido con la lectura anterior son los snapshots de cierre: se
  // recalculan en la misma transacción.
  updateReinterpretingHistory(id: string, data: UpdateHourConceptInput, recalculation: ClosureSnapshotRecalculation) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.hourConcept.update({ where: { id }, data });
      const pairs = await countedBreakdownPairs(tx, id);
      const closures = await findClosuresForHourConcept(tx, id, pairs);
      const rebuiltClosures = await rebuildClosureSnapshots(tx, closures, recalculation);
      return { item, reinterpreted: summarizePairs(pairs), rebuiltClosures };
    }, HISTORY_TRANSACTION_OPTIONS);
  },

  // Clasificación automática de jornadas (Motor A): devuelve exclusivamente
  // reglas activas de conceptos que también son elegibles para automatización.
  // Etapa 15M.7B: el mismo universo funcional que Motor B respecto de
  // status/loadMode; la habilitación por empleado se intersecta
  // después en classifySegmentsForEmployee (Etapa 15I).
  async findActiveRules() {
    const rules = await prisma.hourConceptRule.findMany({
      where: {
        status: "ACTIVO",
        hourConcept: {
          status: "ACTIVO",
          loadMode: { in: ["AUTOMATIC", "BOTH"] },
        },
      },
      include: { hourConcept: { select: { name: true } } },
    });
    return rules.map((rule) => ({
      id: rule.id,
      hourConceptId: rule.hourConceptId,
      hourConceptName: rule.hourConcept.name,
      startTime: rule.startTime,
      endTime: rule.endTime,
      crossesMidnight: rule.crossesMidnight,
      priority: rule.priority,
    }));
  },

  async findEnabledConceptIds(employeeId: string): Promise<Set<string>> {
    const enabled = await prisma.employeeHourConcept.findMany({
      where: { employeeId, hourConcept: { status: "ACTIVO" } },
      select: { hourConceptId: true },
    });
    return new Set(enabled.map((row) => row.hourConceptId));
  },

  // Empleados habilitados para un concepto (Etapa 8G) — EmployeeHourConcept es
  // un simple on/off (sin effectiveFrom/effectiveTo, sin status propio); no se
  // infiere nada desde TimeSegment. Índice [hourConceptId] agregado en la
  // Etapa 8H (ver schema.prisma) — esta consulta ya no depende de un full scan.
  // Etapa 14H.5: mismo antipatrón que findMany arriba — findMany/count de
  // EmployeeHourConcept son lecturas independientes. Endpoint activamente
  // usado por AssociatedEmployeesPanel (embedded) en HourConceptsPage.tsx al
  // editar un concepto existente. Fix directamente análogo al ya aplicado a
  // workRegimesRepository.findEmployees (Etapa 14H.2).
  async findEmployees(hourConceptId: string, query: ListHourConceptEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeHourConceptWhereInput = {
      hourConceptId,
      employee: {
        AND: [buildEmployeeAssociationWhere(query), accessWhere, ...(query.status ? [{ status: query.status }] : [])],
      },
    };
    const skip = (query.page - 1) * query.take;
    const [items, total] = await Promise.all([
      prisma.employeeHourConcept.findMany({
        where,
        select: { employeeId: true, employee: { select: associatedEmployeeSelect } },
        orderBy: resolveOrderBy<"legajo" | "employee", Prisma.EmployeeHourConceptOrderByWithRelationInput>(
          query,
          { legajo: (order) => [{ employee: { legajo: order } }], employee: (order) => [{ employee: { lastName: order } }, { employee: { firstName: order } }] },
          [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }],
          { employeeId: "asc" },
        ),
        skip,
        take: query.take,
      }),
      prisma.employeeHourConcept.count({ where }),
    ]);
    return [items, total] as const;
  },

  countExistingEmployees(employeeIds: string[]) {
    return prisma.employee.count({ where: { id: { in: employeeIds } } });
  },

  findEmployeeHourConcept(hourConceptId: string, employeeId: string) {
    return prisma.employeeHourConcept.findUnique({ where: { employeeId_hourConceptId: { employeeId, hourConceptId } } });
  },

  // Habilitar (Etapa 8N) — reutiliza el mismo join EmployeeHourConcept que ya
  // escribe employeesRepository.replaceHourConcepts (legajo -> conceptos),
  // pero de forma quirúrgica (agrega, no reemplaza el set completo del
  // empleado) para no pisar otros conceptos ya habilitados por otra
  // pantalla/legajo. skipDuplicates: quien ya estaba habilitado no rompe
  // nada — es idempotente, mismo criterio que ShiftAssignment.
  enableForEmployees(hourConceptId: string, employeeIds: string[]) {
    return prisma.employeeHourConcept.createMany({
      data: employeeIds.map((employeeId) => ({ employeeId, hourConceptId })),
      skipDuplicates: true,
    });
  },

  disableForEmployee(hourConceptId: string, employeeId: string) {
    return prisma.employeeHourConcept.delete({ where: { employeeId_hourConceptId: { employeeId, hourConceptId } } });
  },

  // Uso real antes de eliminar: las 7 relaciones de HourConcept en
  // schema.prisma, para la auditoría y para detectar TimeEntry legacy.
  findWithUsage(id: string) {
    return prisma.hourConcept.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        status: true,
        loadMode: true,
        workTreatment: true,
        systemRole: true,
        _count: {
          select: {
            employees: true,
            timeEntries: true,
            novelties: true,
            timeSegments: true,
            workShifts: true,
            rules: true,
            breakdowns: true,
          },
        },
      },
    });
  },

  // Eliminación definitiva (docs/decisions/WORKED_TIME_ACCOUNTING_MODEL.md
  // §14): una transacción con las dependencias en orden explícito, sin
  // depender de ningún ON DELETE de la base.
  //  1. Historial específico del concepto: todos sus desgloses.
  //  2. Evidencia física que lo referencia: TimeSegment y WorkShift se
  //     reclasifican a Hora normal, igual que deja el clasificador un tramo
  //     sin regla (SIN_CONCEPTO_COMPATIBLE). Minutos, fichadas y TimeEntry de
  //     Horas base no se tocan.
  //  3. Novedades que lo tenían como destino: se desvinculan (la novedad es
  //     un hecho del legajo, no del concepto).
  //  4. Configuración: reglas y habilitaciones por legajo.
  //  5. El concepto: el código queda libre.
  //  6. Snapshots de cierre que lo incluían: se recalculan.
  // Un TimeEntry con este concepto (modelo previo a 6L) nunca se borra acá:
  // el service lo rechaza antes y la FK RESTRICT lo garantiza ante una carrera.
  deletePermanently(id: string, recalculation: ClosureSnapshotRecalculation) {
    return prisma.$transaction(async (tx) => {
      const [fallback, pairs] = await Promise.all([
        tx.hourConcept.findFirstOrThrow({ where: { systemRole: "NORMAL_BASE" }, select: { id: true, name: true } }),
        countedBreakdownPairs(tx, id),
      ]);
      const closures = await findClosuresForHourConcept(tx, id, pairs);
      const breakdowns = await tx.hourConceptBreakdown.deleteMany({ where: { hourConceptId: id } });
      const segments = await tx.timeSegment.updateMany({
        where: { hourConceptId: id },
        data: { hourConceptId: fallback.id, hourConceptName: fallback.name, hourConceptRuleId: null, conceptStatus: "SIN_CONCEPTO_COMPATIBLE" },
      });
      const workShifts = await tx.workShift.updateMany({ where: { hourConceptId: id }, data: { hourConceptId: fallback.id, hourConceptName: fallback.name } });
      const novelties = await tx.novelty.updateMany({ where: { targetHourConceptId: id }, data: { targetHourConceptId: null } });
      const rules = await tx.hourConceptRule.deleteMany({ where: { hourConceptId: id } });
      const assignments = await tx.employeeHourConcept.deleteMany({ where: { hourConceptId: id } });
      const concept = await tx.hourConcept.delete({ where: { id }, select: { id: true, code: true, name: true } });
      const rebuiltClosures = await rebuildClosureSnapshots(tx, closures, recalculation);
      return {
        concept,
        deletedBreakdowns: breakdowns.count,
        deletedRules: rules.count,
        deletedEmployeeAssignments: assignments.count,
        reclassifiedSegments: segments.count,
        reclassifiedWorkShifts: workShifts.count,
        unlinkedNovelties: novelties.count,
        rebuiltClosures,
      };
    }, HISTORY_TRANSACTION_OPTIONS);
  },
};
