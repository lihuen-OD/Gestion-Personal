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
// con exportsToFinnegans=true. A propósito ya NO filtra por vínculo
// Finnegans activo (antes: `finnegansLinks: { some: { status: "ACTIVO" } }`)
// — la ausencia de un vínculo activo pasa a ser un blocker de readiness
// (MISSING_LINK, ver finnegansExport.readiness.ts), no un motivo para que
// la fila desaparezca en silencio de la preview (antes:
// `.filter((row) => row.Novedad)` en el service, retirado en esa etapa).
//
// Etapa 15L.3B.1 (docs/decisions/FINNEGANS_EXPORT_MONTHLY_OWNERSHIP_15L3B.md):
// el período dueño de una novedad es EXCLUSIVAMENTE el mes de `fromDate` —
// `toDate` ya no participa en la selección. Antes, un filtro de
// solapamiento (`fromDate <= finMes AND (toDate IS NULL OR toDate >=
// inicioMes)`) podía hacer que una novedad cross-month (30/01→02/02)
// apareciera como candidata tanto en enero como en febrero, y que una
// novedad open-ended (toDate=null) reapareciera indefinidamente en todos
// los meses posteriores a fromDate — ambos casos, confirmados y auditados
// en 15L.3B (no implementada), quedan resueltos acá: `fromDate` dentro de
// `[range.from, range.to]` es la única condición de pertenencia mensual.
// `toDate` sigue siendo el dato real de vigencia/"Fecha hasta" exportada
// (finnegansExport.service.ts, sin cambios) y lo que usa la grilla horaria
// para mostrar la novedad en pantalla (`novelties.dateRange.ts`, módulo
// distinto, no tocado) — sólo deja de decidir en qué período Finnegans se
// exporta.
function buildWhere(period: string, employeeId?: string): Prisma.NoveltyWhereInput {
  const range = periodRange(period);
  return {
    ...(employeeId ? { employeeId } : {}),
    status: "APROBADO",
    fromDate: { gte: range.from, lte: range.to },
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
        noveltyType: true,
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
