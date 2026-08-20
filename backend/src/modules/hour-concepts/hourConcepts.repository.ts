import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { associatedEmployeeSelect, buildEmployeeAssociationWhere } from "../../shared/prisma/employeeAssociationQuery";
import type { CreateHourConceptInput, ListHourConceptEmployeesQuery, ListHourConceptsQuery, UpdateHourConceptInput } from "./hourConcepts.schemas";

// Cache en memoria para listados sin filtros
type HourConceptRow = Awaited<ReturnType<typeof prisma.hourConcept.findMany>>[number];
let listCache: { data: HourConceptRow[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 120_000; // 2 minutos

export function invalidateHourConceptsCache() {
  listCache = null;
}

function hasActiveFilters(query: ListHourConceptsQuery): boolean {
  return !!(query.kind || query.status || query.search?.trim() || query.includeDeleted);
}

function buildWhere(query: ListHourConceptsQuery): Prisma.HourConceptWhereInput {
  const search = query.search?.trim();
  return {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
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

export const hourConceptsRepository = {
  async findMany(query: ListHourConceptsQuery): Promise<[HourConceptRow[], number]> {
    if (hasActiveFilters(query)) {
      const where = buildWhere(query);
      const skip = (query.page - 1) * query.take;
      return prisma.$transaction([
        prisma.hourConcept.findMany({
          where,
          orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
          skip,
          take: query.take,
        }),
        prisma.hourConcept.count({ where }),
      ]);
    }

    if (!listCache || Date.now() >= listCache.expiresAt) {
      const data = await prisma.hourConcept.findMany({
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { kind: "asc" }, { name: "asc" }],
        take: 500,
      });
      listCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    const skip = (query.page - 1) * query.take;
    const page = listCache.data.slice(skip, skip + query.take);
    return [page, listCache.data.length];
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

  // Clasificación automática de jornadas (etapa de Turnos V1): reglas de
  // aplicación de concepto activas, con el nombre del concepto ya
  // denormalizado para no repetir el join en cada segmento clasificado.
  async findActiveRules() {
    const rules = await prisma.hourConceptRule.findMany({
      where: { status: "ACTIVO", hourConcept: { status: "ACTIVO" } },
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
  async findEmployees(hourConceptId: string, query: ListHourConceptEmployeesQuery, accessWhere: Prisma.EmployeeWhereInput) {
    const where: Prisma.EmployeeHourConceptWhereInput = {
      hourConceptId,
      employee: {
        AND: [buildEmployeeAssociationWhere(query), accessWhere, ...(query.status ? [{ status: query.status }] : [])],
      },
    };
    const skip = (query.page - 1) * query.take;
    const [items, total] = await prisma.$transaction([
      prisma.employeeHourConcept.findMany({
        where,
        select: { employeeId: true, employee: { select: associatedEmployeeSelect } },
        orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { employeeId: "asc" }],
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

  // Eliminación segura (Etapa 8O): mismo criterio que positions.service.ts /
  // workforce.service.ts::removeShiftTemplate — contar uso real antes de
  // permitir el delete físico. Se cuentan las 6 relaciones reales de
  // HourConcept en schema.prisma (no solo EmployeeHourConcept/HourConceptRule
  // que pidió el usuario, también timeEntries/novelties/timeSegments/
  // workShifts, que igual representan uso histórico real).
  findWithUsage(id: string) {
    return prisma.hourConcept.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        _count: {
          select: {
            employees: true,
            timeEntries: true,
            novelties: true,
            timeSegments: true,
            workShifts: true,
            rules: true,
          },
        },
      },
    });
  },

  delete(id: string) {
    return prisma.hourConcept.delete({ where: { id } });
  },

  // Las 3 operaciones de la eliminación forzada (Etapa 8P) — cada una toca
  // solo relaciones de CONFIGURACIÓN (nunca TimeEntry/TimeSegment/WorkShift/
  // Novelty, que son historial real):
  // - EmployeeHourConcept no tiene status propio (pura existencia on/off),
  //   así que "desvincular" es delete real de esas filas — reutiliza el
  //   mismo criterio que disableForEmployee, en batch.
  disableAllEmployees(hourConceptId: string) {
    return prisma.employeeHourConcept.deleteMany({ where: { hourConceptId } });
  },

  // - HourConceptRule SÍ tiene status, así que se desactiva (no se borra):
  //   TimeSegment.hourConceptRuleId ya es nullable con onDelete SetNull, con
  //   lo cual borrar la regla sería técnicamente seguro, pero desactivar es
  //   más conservador y no requiere confiar en ese detalle de FK.
  deactivateAllRules(hourConceptId: string) {
    return prisma.hourConceptRule.updateMany({ where: { hourConceptId, status: "ACTIVO" }, data: { status: "INACTIVO" } });
  },

  // - El concepto en sí queda INACTIVO (mismo efecto que "deshabilitado" en
  //   fichador/clasificación, que ya filtran por status ACTIVO) + deletedAt
  //   para que el catálogo lo oculte por default. Nunca se borra la fila.
  softDelete(id: string) {
    return prisma.hourConcept.update({ where: { id }, data: { status: "INACTIVO", deletedAt: new Date() } });
  },
};
