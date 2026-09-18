import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";
import { periodCalendarBounds } from "../../shared/datetime/argentinaTime";
import type { CreateNoveltyInput, ListNoveltiesQuery } from "./novelties.schemas";

const noveltyInclude = {
  employee: { select: { id: true, legajo: true, cuil: true, dni: true, firstName: true, lastName: true, status: true } },
  noveltyType: {
    select: {
      id: true,
      code: true,
      name: true,
      exportsToFinnegans: true,
      allowsHours: true,
      timeEntryBehavior: true,
      allowsDateRange: true,
      finnegansRequiresValidity: true,
      finnegansCode: true,
      finnegansName: true,
      approvalRoles: true,
    },
  },
  targetHourConcept: { select: { id: true, name: true } },
  documents: { select: { fileName: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.NoveltyInclude;

// Etapa 15M.15: intersección real de [fromDate, effectiveToDate] contra el
// mes completo del período, mismo criterio de negocio que
// `novelties.dateRange.ts::noveltyCoversDay` (generalizado de "cubre este
// día" a "toca este mes") en vez de inventar uno nuevo:
// - toDate cerrado: interseca si fromDate < fin de mes Y toDate >= inicio.
// - toDate null Y el tipo permite rango (`allowsDateRange`): novedad
//   vigente abierta -- sigue "activa" en cualquier mes posterior a que
//   empezó, sin límite de fin.
// - toDate null Y el tipo NO permite rango: no es una novedad abierta, es
//   de un único día (mismo criterio que `noveltyCoversDay`) -- sólo
//   interseca el mes de esa fecha exacta.
// A propósito NO es la misma regla que `finnegansExport.repository.ts`
// (Etapa 15L.3B.1: un período "dueño" único por `fromDate`, sin
// intersección, para no exportar la misma fila dos veces). Son dos
// preguntas distintas sobre el mismo campo -- ver comentario en
// docs/PROJECT_UI_CONTEXT.md "Novedades por período".
function periodIntersectionWhere(period: string): Prisma.NoveltyWhereInput {
  const { start, end } = periodCalendarBounds(period);
  return {
    OR: [
      { fromDate: { lt: end }, toDate: { not: null, gte: start } },
      { fromDate: { lt: end }, toDate: null, noveltyType: { allowsDateRange: true } },
      { fromDate: { gte: start, lt: end }, toDate: null, noveltyType: { allowsDateRange: false } },
    ],
  };
}

function buildWhere(query: ListNoveltiesQuery, employeeAccessWhere: Prisma.EmployeeWhereInput): Prisma.NoveltyWhereInput {
  const search = query.search?.trim();
  const conditions: Prisma.NoveltyWhereInput[] = [
    { employee: employeeAccessWhere },
    ...(query.employeeId ? [{ employeeId: query.employeeId }] : []),
    ...(query.noveltyTypeId ? [{ noveltyTypeId: query.noveltyTypeId }] : []),
    ...(query.status ? [{ status: query.status }] : []),
    ...(query.exportable !== undefined
      ? [
          {
            noveltyType: {
              exportsToFinnegans: query.exportable,
              ...(query.exportable ? { finnegansCode: { not: null } } : {}),
            },
          },
        ]
      : []),
    ...(query.from || query.to
      ? [
          {
            fromDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          },
        ]
      : []),
    ...(query.period ? [periodIntersectionWhere(query.period)] : []),
    ...(search
      ? [
          {
            OR: [
              { employee: { legajo: { contains: search, mode: "insensitive" as const } } },
              { employee: { cuil: { contains: search, mode: "insensitive" as const } } },
              { employee: { dni: { contains: search, mode: "insensitive" as const } } },
              { employee: { firstName: { contains: search, mode: "insensitive" as const } } },
              { employee: { lastName: { contains: search, mode: "insensitive" as const } } },
              { noveltyType: { code: { contains: search, mode: "insensitive" as const } } },
              { noveltyType: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          },
        ]
      : []),
  ];
  return { AND: conditions };
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
    return prisma.noveltyType.findUnique({ where: { id } });
  },

  countEmployees(ids: string[], employeeAccessWhere: Prisma.EmployeeWhereInput) {
    return prisma.employee.count({ where: { AND: [{ id: { in: ids } }, employeeAccessWhere] } });
  },

  // Etapa 15G.1 (docs/decisions/NOVELTIES_AS_ADMINISTRATIVE_JUSTIFICATION_15G1.md):
  // decisión funcional final — crear novedades nunca crea ni modifica
  // TimeEntry, sea cual sea `status` o `timeEntryBehavior` del tipo. Antes
  // de esta etapa existía un `options.createZeroTimeEntries` que disparaba un efecto
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
  // modifica TimeEntry, sea cual sea `timeEntryBehavior` del tipo.
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

  // Etapa 15G.3 (docs/decisions/NOVELTY_OVERLAP_DUPLICATE_RULES_15G3.md):
  // busca novedades del MISMO tipo para los mismos empleados cuyo rango de
  // fechas se superpone con el nuevo (toDate null se trata como si fuera
  // igual a fromDate, tanto del lado existente como del nuevo). Ignora
  // RECHAZADO -- una novedad rechazada no debe impedir volver a cargarla.
  // Sólo compara contra el MISMO noveltyTypeId: la incompatibilidad entre
  // tipos distintos (p. ej. Vacaciones + Licencia médica) no está resuelta
  // hoy por ninguna regla de negocio existente y queda fuera de alcance.
  findOverlapping(employeeIds: string[], noveltyTypeId: string, fromDate: Date, toDate: Date | null) {
    const rangeEnd = toDate || fromDate;
    return prisma.novelty.findMany({
      where: {
        employeeId: { in: employeeIds },
        noveltyTypeId,
        status: { not: "RECHAZADO" },
        fromDate: { lte: rangeEnd },
        OR: [{ toDate: null, fromDate: { gte: fromDate } }, { toDate: { gte: fromDate } }],
      },
      select: { id: true, fromDate: true, toDate: true, employee: { select: { legajo: true } } },
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
