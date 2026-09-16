import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma/client";

export type FinnegansExportNovelty = Awaited<ReturnType<typeof finnegansExportRepository.findExportableNovelties>>[number];

function periodRange(period: string) {
  const [yearPart, monthPart] = period.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

// Etapa 15L.3A §3/§5: candidata = Novelty APROBADO de un NoveltyType ACTIVO
// con exportsToFinnegans=true, superpuesto con el período pedido. A
// propósito ya NO filtra por vínculo Finnegans activo (antes:
// `finnegansLinks: { some: { status: "ACTIVO" } }`) — la ausencia de un
// vínculo activo pasa a ser un blocker de readiness (MISSING_LINK, ver
// finnegansExport.readiness.ts), no un motivo para que la fila desaparezca
// en silencio de la preview (antes: `.filter((row) => row.Novedad)` en el
// service, retirado en esta etapa). Semántica mensual sin cambios (§5/§32/
// §33 del pedido de esta etapa): una novedad 30/01→02/02 sigue pudiendo
// aparecer tanto en enero como en febrero — deuda documentada, no resuelta
// acá.
function buildWhere(period: string, employeeId?: string): Prisma.NoveltyWhereInput {
  const range = periodRange(period);
  return {
    ...(employeeId ? { employeeId } : {}),
    status: "APROBADO",
    fromDate: { lte: range.to },
    OR: [{ toDate: null }, { toDate: { gte: range.from } }],
    noveltyType: {
      status: "ACTIVO",
      exportsToFinnegans: true,
    },
  };
}

export const finnegansExportRepository = {
  findExportableNovelties(period: string, employeeId?: string) {
    return prisma.novelty.findMany({
      where: buildWhere(period, employeeId),
      include: {
        employee: { select: { id: true, legajo: true, legajoFinnegans: true, firstName: true, lastName: true, costCenter: { select: { code: true } } } },
        noveltyType: {
          include: {
            // Etapa 15L.3A §6: sólo vínculos ACTIVO — un vínculo INACTIVO
            // nunca puede ser el principal de una exportación. El desempate
            // determinista (menor priority, empate por code) vive en
            // finnegansExport.principalLink.ts, no en el `orderBy` acá.
            finnegansLinks: { where: { status: "ACTIVO" } },
          },
        },
      },
      orderBy: [{ fromDate: "asc" }, { employee: { legajo: "asc" } }],
      take: 10000,
    });
  },

  // Etapa 15L.3A §18/§21: mismo criterio de consulta que
  // `timeEntriesRepository.findClosuresForExport` (Etapa 15E.2) — se
  // reimplementa acá (no se importa desde time-entries) para no acoplar la
  // exportación Finnegans al exportador de horas; la política de qué estado
  // cuenta como "aprobado" sí se comparte vía
  // `shared/monthlyClosure/closureLock.ts`.
  findClosuresForExport(employeeIds: string[], period: string) {
    if (!employeeIds.length) return Promise.resolve([]);
    return prisma.monthlyTimeClosure.findMany({
      where: { employeeId: { in: employeeIds }, period },
      select: { employeeId: true, status: true },
    });
  },
};
