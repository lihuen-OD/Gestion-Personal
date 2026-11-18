import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "../../shared/prisma/client";
import { periodCalendarBounds } from "../../shared/datetime/argentinaTime";
import type { CreateNoveltyCommand, ListNoveltiesQuery, noveltyListSortKeys } from "./novelties.schemas";
import { resolveOrderBy, type SortOrderByMap } from "../../shared/validation/listSort";
import { noveltyOverlapsRangeWhere } from "./novelties.dateRange";

const noveltyListOrderBy: SortOrderByMap<(typeof noveltyListSortKeys)[number], Prisma.NoveltyOrderByWithRelationInput> = {
  legajo: (order) => [{ employee: { legajo: order } }],
  employee: (order) => [{ employee: { lastName: order } }, { employee: { firstName: order } }],
  noveltyType: (order) => [{ noveltyType: { name: order } }, { fromDate: "desc" }],
  fromDate: (order) => [{ fromDate: order }, { createdAt: order }],
  status: (order) => [{ status: order }, { fromDate: "desc" }],
};

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
      // Motor de cobertura (etapa 3): el guard de cierres necesita saber si
      // el tipo registra tiempo.
      coverageMode: true,
      coverageCountsTowardTotal: true,
      // §17: el detalle de un día muestra el valor configurado del tipo.
      coverageFixedMinutes: true,
      // §18: quién puede ajustar un día de cobertura.
      allowedLoadRoles: true,
    },
  },
  targetHourConcept: { select: { id: true, name: true } },
  documents: { select: { fileName: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.NoveltyInclude;

// Etapa 15M.15: intersección real de [fromDate, toDate ?? fromDate] contra el
// mes completo del período, mismo criterio que
// `novelties.dateRange.ts::noveltyCoversDay` (generalizado de "cubre este
// día" a "toca este mes"). Etapa 3 de cobertura
// (docs/decisions/NOVELTY_COVERAGE_ENGINE.md §6.3): `toDate` nulo es siempre
// un único día, también en tipos que admiten rango — sólo toca el mes de
// `fromDate`; nunca es una novedad "vigente abierta".
// A propósito NO es la misma regla que `finnegansExport.repository.ts`
// (Etapa 15L.3B.1: un período "dueño" único por `fromDate`, sin
// intersección, para no exportar la misma fila dos veces). Son dos
// preguntas distintas sobre el mismo campo -- ver comentario en
// docs/PROJECT_UI_CONTEXT.md "Novedades por período".
function periodIntersectionWhere(period: string): Prisma.NoveltyWhereInput {
  const { start, end } = periodCalendarBounds(period);
  return noveltyOverlapsRangeWhere(start, end);
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

async function createManyWithin(tx: PrismaTransactionClient, input: CreateNoveltyCommand, status: "PENDIENTE" | "APROBADO", createdByUserId?: string | null) {
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
          quantityMinutes: input.quantityMinutes ?? null,
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
}

export const noveltiesRepository = {
  /**
   * Categoría documental de las novedades (mismo criterio que usaba la
   * pantalla): activa, con alcance NOVEDAD; si hay varias, la de tipo NOVEDAD.
   */
  async findNoveltyDocumentCategory() {
    const categories = await prisma.documentCategory.findMany({
      where: { status: "ACTIVO", scopes: { array_contains: "NOVEDAD" } },
      select: { id: true, code: true, name: true, kind: true, uploadRoles: true },
      orderBy: { code: "asc" },
    });
    return categories.find((category) => category.kind === "NOVEDAD") ?? categories[0] ?? null;
  },

  findEmployeeIdentities(employeeIds: string[]) {
    return prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, legajo: true, firstName: true, lastName: true } });
  },

  /** Documentos de las novedades, dentro de la transacción del alta. */
  createDocumentsWithin(tx: PrismaTransactionClient, rows: Prisma.EmployeeDocumentUncheckedCreateInput[]) {
    return Promise.all(rows.map((data) => tx.employeeDocument.create({ data, select: { id: true, employeeId: true, noveltyId: true, fileName: true } })));
  },

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
        orderBy: resolveOrderBy(query, noveltyListOrderBy, [{ fromDate: "desc" }, { createdAt: "desc" }], { id: "asc" }),
        skip,
        take: query.take,
      }),
      prisma.novelty.count({ where }),
    ]);
  },

  // `db` permite leer dentro de la transacción de una mutación (etapa 3).
  findById(id: string, employeeAccessWhere: Prisma.EmployeeWhereInput = {}, db: PrismaTransactionClient = prisma) {
    return db.novelty.findFirst({
      where: { id, employee: employeeAccessWhere },
      include: noveltyInclude,
    });
  },

  findNoveltyType(id: string, db: PrismaTransactionClient = prisma) {
    return db.noveltyType.findUnique({ where: { id } });
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
  // Etapa 3 (docs/decisions/NOVELTY_COVERAGE_ENGINE.md): con `db`, crea dentro
  // de la transacción del servicio, que en la misma operación genera la
  // cobertura diaria (NoveltyDayCoverage) — nunca TimeEntry. Sin `db`, abre su
  // propia transacción como antes.
  createMany(input: CreateNoveltyCommand, status: "PENDIENTE" | "APROBADO", createdByUserId?: string | null, db: PrismaTransactionClient | null = null) {
    if (!db) return prisma.$transaction((tx) => createManyWithin(tx, input, status, createdByUserId));
    return createManyWithin(db, input, status, createdByUserId);
  },


  // Etapa 15G.1: aprobar sólo cambia `status`/auditoría — nunca crea ni
  // modifica TimeEntry, sea cual sea `timeEntryBehavior` del tipo.
  approve(id: string, approvedByUserId: string, db: PrismaTransactionClient = prisma) {
    return db.novelty.update({
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

  reject(id: string, db: PrismaTransactionClient = prisma) {
    return db.novelty.update({
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

  // NoveltyDayCoverage cae por Cascade (dato derivado de la novedad).
  remove(id: string, db: PrismaTransactionClient = prisma) {
    return db.novelty.delete({ where: { id } });
  },
};
