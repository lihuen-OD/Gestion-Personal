import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import type { CreateNoveltyInput, ListNoveltiesQuery } from "./novelties.schemas";

const noveltyInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, dni: true, firstName: true, lastName: true, status: true } },
  noveltyType: {
    select: {
      id: true,
      code: true,
      name: true,
      origin: true,
      exportsToFinnegans: true,
      allowsHours: true,
      allowsDateTo: true,
      hasValidity: true,
      blocksTimeEntry: true,
      setsWorkedHoursToZero: true,
      timeImpact: true,
      approvalRoles: true,
      finnegansLinks: {
        where: { status: "ACTIVO" },
        orderBy: { priority: "asc" },
        select: { code: true, name: true, hasValidity: true, status: true },
      },
    },
  },
  targetHourConcept: { select: { id: true, name: true } },
  documents: { select: { fileName: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.NoveltyInclude;

function buildWhere(query: ListNoveltiesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.NoveltyWhereInput {
  const search = query.search?.trim();
  return {
    employee: employeeAccessWhere,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.noveltyTypeId ? { noveltyTypeId: query.noveltyTypeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.exportable !== undefined
      ? {
          noveltyType: {
            exportsToFinnegans: query.exportable,
            ...(query.exportable ? { finnegansLinks: { some: { status: "ACTIVO" } } } : {}),
          },
        }
      : {}),
    ...(query.from || query.to
      ? {
          fromDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { employee: { legajo: { contains: search, mode: "insensitive" } } },
            { employee: { cuil: { contains: search, mode: "insensitive" } } },
            { employee: { dni: { contains: search, mode: "insensitive" } } },
            { employee: { firstName: { contains: search, mode: "insensitive" } } },
            { employee: { lastName: { contains: search, mode: "insensitive" } } },
            { noveltyType: { code: { contains: search, mode: "insensitive" } } },
            { noveltyType: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

export const noveltiesRepository = {
  findMany(query: ListNoveltiesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput) {
    const where = buildWhere(query, employeeAccessWhere);
    const skip = (query.page - 1) * query.take;
    // Etapa 14I.2: findMany + count son lecturas independientes (ninguna
    // depende del resultado de la otra) — $transaction([...]) las pinaba a
    // una única conexión de Neon en serie sin ganar concurrencia real.
    // Mismo patrón ya corregido 15 veces en las series 14C/14G/14H. Ver
    // docs/decisions/BACKEND_TRANSACTION_CLEANUP_P0_14I2.md.
    return Promise.all([
      prisma.novelty.findMany({
        where,
        include: noveltyInclude,
        orderBy: [{ fromDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: query.take,
      }),
      prisma.novelty.count({ where }),
    ]);
  },

  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}) {
    return prisma.novelty.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: noveltyInclude,
    });
  },

  findNoveltyType(id: string) {
    return prisma.noveltyType.findUnique({ where: { id }, include: { finnegansLinks: true } });
  },

  countEmployees(ids: string[], employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: { in: ids } }, employeeAccessWhere] } });
  },

  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // decisión funcional final — crear novedades nunca crea ni modifica
  // TimeEntry, sea cual sea `status` o los campos horarios del tipo
  // (setsWorkedHoursToZero/blocksTimeEntry/timeImpact). Antes de esta etapa
  // existía un `options.createZeroTimeEntries` que disparaba un efecto
  // horario acá adentro (ver `novelties.timeEffects.ts` en el historial de
  // 15G.1 original, eliminado en este ajuste) — se quitó por completo, sin
  // dejar ningún parámetro ni rama de código capaz de volver a escribir
  // TimeEntry desde acá. La transacción se mantiene sólo para la creación
  // atómica de varias filas `Novelty` (alta masiva por legajo) + su lectura
  // final, nada más.
  createMany(input: CreateNoveltyInput, status: "PENDIENTE" | "APROBADO", createdByUserId?: string | null) {
    return prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        input.employeeIds.map((employeeId) =>
          tx.novelty.create({
            data: {
              employeeId,
              noveltyTypeId: input.noveltyTypeId,
              status,
              fromDate: input.fromDate,
              toDate: input.toDate || null,
              quantityHours: input.quantityHours || null,
              quantityDays: input.quantityDays || null,
              observation: input.observation || null,
              targetHourConceptId: input.targetHourConceptId || null,
              createdByUserId: createdByUserId || null,
            },
            select: { id: true },
          }),
        ),
      );

      return tx.novelty.findMany({
        where: {
          id: { in: created.map((item) => item.id) },
        },
        include: noveltyInclude,
        orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }],
      });
    });
  },

  // Etapa 15G.1: aprobar sólo cambia `status`/auditoría — nunca crea ni
  // modifica TimeEntry, ni siquiera para un tipo con setsWorkedHoursToZero.
  approve(id: string, approvedByUserId: string) {
    return prisma.novelty.update({
      where: { id },
      data: {
        status: "APROBADO",
        approvedByUserId,
        approvedAt: new Date(),
        rejectedAt: null,
      },
      include: noveltyInclude,
    });
  },

  reject(id: string) {
    return prisma.novelty.update({
      where: { id },
      data: {
        status: "RECHAZADO",
        approvedByUserId: null,
        approvedAt: null,
        rejectedAt: new Date(),
      },
      include: noveltyInclude,
    });
  },

  remove(id: string) {
    return prisma.novelty.delete({ where: { id } });
  },
};
